import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { env } from "../config/env.js";
import { closeRedisClient, createRedisClient } from "../infra/redis.js";
import {
  QUEUE_NAMES,
  type RateLimitAlertJobData,
  type SearchIndexJobData,
  type SendEmailJobData,
} from "./queue.types.js";

const DAY_SECONDS = 24 * 60 * 60;

export class QueueRegistry {
  readonly emailSend: Queue<SendEmailJobData>;
  readonly searchIndex: Queue<SearchIndexJobData>;
  readonly notifications: Queue<RateLimitAlertJobData>;

  constructor(private readonly connection: Redis) {
    this.emailSend = new Queue<SendEmailJobData>(QUEUE_NAMES.emailSend, {
      connection,
      defaultJobOptions: {
        attempts: env.EMAIL_MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: env.EMAIL_RETRY_BACKOFF_MS },
        removeOnComplete: { age: DAY_SECONDS, count: 10_000 },
        removeOnFail: { age: 7 * DAY_SECONDS },
      },
    });
    this.searchIndex = new Queue<SearchIndexJobData>(QUEUE_NAMES.searchIndex, {
      connection,
      defaultJobOptions: {
        attempts: 10,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * DAY_SECONDS },
      },
    });
    this.notifications = new Queue<RateLimitAlertJobData>(QUEUE_NAMES.notifications, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { age: DAY_SECONDS, count: 1000 },
        removeOnFail: { age: 7 * DAY_SECONDS },
      },
    });
  }

  all(): Queue[] {
    return [this.emailSend, this.searchIndex, this.notifications] as Queue[];
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.all().map((queue) => queue.close()));
    await closeRedisClient(this.connection);
  }
}

let registry: QueueRegistry | undefined;

export function getQueues(): QueueRegistry {
  registry ??= new QueueRegistry(createRedisClient("outbox-queues", { lazyConnect: false }));
  return registry;
}

export async function closeQueues(): Promise<void> {
  if (registry) {
    await registry.close();
    registry = undefined;
  }
}
