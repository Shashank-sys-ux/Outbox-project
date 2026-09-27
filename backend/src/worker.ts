import { UnrecoverableError, Worker, type Job } from "bullmq";
import { env } from "./config/env.js";
import { assertElasticsearchHealthy, elasticsearch } from "./infra/elasticsearch.js";
import { logger } from "./infra/logger.js";
import { mailer } from "./infra/mailer.js";
import { assertDatabaseHealthy, prisma } from "./infra/prisma.js";
import { closeRedisClient, createRedisClient, redis } from "./infra/redis.js";
import { emailSearchIndex } from "./infra/search.js";
import { secretBox } from "./infra/secrets.js";
import { registerGracefulShutdown } from "./infra/shutdown.js";
import { EmailDeliveryRepository } from "./modules/delivery/email-delivery.repository.js";
import { reconcilePendingEmails } from "./modules/delivery/reconciliation.js";
import { createSendEmailProcessor } from "./modules/delivery/send-email.processor.js";
import { SendSlotLimiter } from "./modules/delivery/send-slot-limiter.js";
import { SlackWebhookError } from "./modules/slack/slack.client.js";
import { deliverRateLimitAlert } from "./modules/slack/slack.service.js";
import { enqueueRateLimitAlert, enqueueSearchIndex } from "./queues/producers.js";
import {
  QUEUE_NAMES,
  type RateLimitAlertJobData,
  type SearchIndexJobData,
  type SendEmailJobData,
} from "./queues/queue.types.js";
import { closeQueues, getQueues } from "./queues/queues.js";
import { withTimeout } from "./utils/with-timeout.js";

const STARTUP_CHECK_TIMEOUT_MS = 5000;
const log = logger.child({ process: "worker" });

const workerConnections: ReturnType<typeof createRedisClient>[] = [];

function workerConnection(name: string) {
  const connection = createRedisClient(name, { lazyConnect: false, maxRetriesPerRequest: null });
  workerConnections.push(connection);
  return connection;
}

async function verifyDependencies(): Promise<void> {
  await withTimeout(assertDatabaseHealthy(), STARTUP_CHECK_TIMEOUT_MS, "Database startup check");
  await withTimeout(redis.ping(), STARTUP_CHECK_TIMEOUT_MS, "Redis startup check");
  log.info("Database and Redis are reachable");
  try {
    await assertElasticsearchHealthy(elasticsearch, STARTUP_CHECK_TIMEOUT_MS);
    await emailSearchIndex.ensureIndex();
    log.info({ index: emailSearchIndex.indexName }, "Elasticsearch index is ready");
  } catch (error) {
    log.warn({ err: error }, "Elasticsearch unavailable, indexing jobs will retry until it recovers");
  }
}

async function main(): Promise<void> {
  await verifyDependencies();

  const store = new EmailDeliveryRepository(prisma, secretBox);
  const limiter = new SendSlotLimiter(redis, env.RATE_LIMIT_WINDOW_MS);
  const processor = createSendEmailProcessor({
    store,
    limiter,
    mailer,
    alerts: { rateLimited: enqueueRateLimitAlert },
    indexer: { enqueue: enqueueSearchIndex },
    logger: log.child({ component: "delivery" }),
    config: {
      minSendDelayMs: env.MIN_SEND_DELAY_MS,
      senderHourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      lockDurationMs: env.EMAIL_LOCK_DURATION_MS,
      retryBackoffMs: env.EMAIL_RETRY_BACKOFF_MS,
      slotGraceMs: Math.min(1000, Math.max(250, Math.floor(env.MIN_SEND_DELAY_MS / 2))),
    },
  });

  const emailWorker = new Worker<SendEmailJobData>(
    QUEUE_NAMES.emailSend,
    (job, token) => processor(job, token),
    {
      connection: workerConnection("outbox-worker-email"),
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: env.EMAIL_LOCK_DURATION_MS,
      maxStalledCount: 2,
      autorun: false,
    },
  );

  const indexWorker = new Worker<SearchIndexJobData>(
    QUEUE_NAMES.searchIndex,
    async (job) => ({ result: await emailSearchIndex.indexEmail(job.data.emailId) }),
    { connection: workerConnection("outbox-worker-search"), concurrency: 10, autorun: false },
  );

  const notificationWorker = new Worker<RateLimitAlertJobData>(
    QUEUE_NAMES.notifications,
    async (job) => {
      try {
        return { result: await deliverRateLimitAlert(job.data) };
      } catch (error) {
        if (error instanceof SlackWebhookError && error.permanent) {
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    },
    { connection: workerConnection("outbox-worker-notify"), concurrency: 2, autorun: false },
  );

  emailWorker.on("failed", (job: Job<SendEmailJobData> | undefined, error: Error) => {
    if (!job) {
      return;
    }
    const exhausted =
      error.name === "UnrecoverableError" ||
      job.attemptsMade >= (job.opts.attempts ?? 1) ||
      /stalled more than allowable limit/i.test(error.message);
    if (exhausted) {
      void store
        .markFailed(job.data.emailId, error.message.slice(0, 500), false)
        .then((changed) => {
          if (changed) {
            log.error({ emailId: job.data.emailId, err: error }, "Job exhausted, email marked as failed");
            void enqueueSearchIndex([job.data.emailId]);
          }
        })
        .catch((markError: unknown) => log.error({ err: markError }, "Could not mark exhausted email as failed"));
    }
  });
  emailWorker.on("stalled", (jobId: string) => log.warn({ jobId }, "Email job stalled, it will be retried"));
  indexWorker.on("failed", (job, error) =>
    log.warn({ emailId: job?.data.emailId, attemptsMade: job?.attemptsMade, err: error }, "Elasticsearch indexing failed"),
  );
  notificationWorker.on("failed", (job, error) =>
    log.warn({ userId: job?.data.userId, err: error }, "Slack notification failed"),
  );
  for (const worker of [emailWorker, indexWorker, notificationWorker]) {
    worker.on("error", (error) => log.error({ err: error, queue: worker.name }, "Worker error"));
  }

  await reconcilePendingEmails({
    db: prisma,
    queue: getQueues().emailSend,
    logger: log.child({ component: "reconciliation" }),
  });

  for (const worker of [emailWorker, indexWorker, notificationWorker]) {
    void worker.run();
  }
  log.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      minSendDelayMs: env.MIN_SEND_DELAY_MS,
      maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    },
    "Worker started",
  );

  registerGracefulShutdown({
    logger: log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    tasks: [
      { name: "email-worker", run: () => emailWorker.close() },
      { name: "index-worker", run: () => indexWorker.close() },
      { name: "notification-worker", run: () => notificationWorker.close() },
      {
        name: "worker-connections",
        run: async () => {
          await Promise.all(workerConnections.map((connection) => closeRedisClient(connection)));
        },
      },
      { name: "queues", run: () => closeQueues() },
      { name: "smtp", run: async () => mailer.closeAll() },
      { name: "database", run: () => prisma.$disconnect() },
      { name: "redis", run: () => closeRedisClient(redis) },
      { name: "elasticsearch", run: () => elasticsearch.close() },
    ],
  });
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});
