import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env, features } from "./config/env.js";
import { assertElasticsearchHealthy, elasticsearch } from "./infra/elasticsearch.js";
import { logger } from "./infra/logger.js";
import { mailer } from "./infra/mailer.js";
import { assertDatabaseHealthy, prisma } from "./infra/prisma.js";
import { closeRedisClient, redis } from "./infra/redis.js";
import { emailSearchIndex } from "./infra/search.js";
import { closeHttpServer, registerGracefulShutdown } from "./infra/shutdown.js";
import {
  createDatabaseHealthCheck,
  createElasticsearchHealthCheck,
  createRedisHealthCheck,
} from "./modules/health/health.checks.js";
import { HEALTH_CHECK_TIMEOUT_MS } from "./modules/health/health.routes.js";
import { closeQueues } from "./queues/queues.js";
import { withTimeout } from "./utils/with-timeout.js";

const STARTUP_CHECK_TIMEOUT_MS = 5000;
const log = logger.child({ process: "api" });

async function verifyDependencies(): Promise<void> {
  await withTimeout(assertDatabaseHealthy(), STARTUP_CHECK_TIMEOUT_MS, "Database startup check");
  log.info("Database is reachable");

  await withTimeout(redis.ping(), STARTUP_CHECK_TIMEOUT_MS, "Redis startup check");
  log.info("Redis is reachable");

  try {
    await assertElasticsearchHealthy(elasticsearch, STARTUP_CHECK_TIMEOUT_MS);
    await emailSearchIndex.ensureIndex();
    log.info({ index: emailSearchIndex.indexName }, "Elasticsearch is reachable");
  } catch (error) {
    log.warn({ err: error }, "Elasticsearch is unreachable, starting anyway with search degraded until it recovers");
  }

  if (!features.googleAuth) {
    log.warn("Google OAuth is not configured, set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_CALLBACK_URL");
  }
  if (!features.slack) {
    log.warn("Slack OAuth is not configured, rate limit alerts will be skipped");
  }
  if (env.ADMIN_EMAILS.length === 0) {
    log.warn("ADMIN_EMAILS is empty, the queue dashboard is disabled for everyone");
  }
}

async function main(): Promise<void> {
  await verifyDependencies();

  const app = createApp({
    healthChecks: [
      createDatabaseHealthCheck(assertDatabaseHealthy),
      createRedisHealthCheck(redis),
      createElasticsearchHealthCheck(elasticsearch, HEALTH_CHECK_TIMEOUT_MS),
    ],
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.PORT, () => {
      server.off("error", reject);
      resolve();
    });
  });

  log.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, `API listening on http://localhost:${env.PORT}`);

  registerGracefulShutdown({
    logger: log,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    tasks: [
      { name: "http-server", run: () => closeHttpServer(server) },
      { name: "queues", run: () => closeQueues() },
      { name: "smtp", run: async () => mailer.closeAll() },
      { name: "database", run: () => prisma.$disconnect() },
      { name: "redis", run: () => closeRedisClient(redis) },
      { name: "elasticsearch", run: () => elasticsearch.close() },
    ],
  });
}

main().catch((error: unknown) => {
  log.fatal({ err: error }, "API failed to start");
  process.exit(1);
});
