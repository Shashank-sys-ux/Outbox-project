import { Redis, type RedisOptions } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export function createRedisClient(connectionName: string, overrides: RedisOptions = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectionName,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    ...overrides,
  });

  const log = logger.child({ component: "redis", connection: connectionName });
  client.on("ready", () => log.info("Redis connection ready"));
  client.on("reconnecting", (delayMs: number) => log.warn({ delayMs }, "Redis reconnecting"));
  client.on("error", (error: Error) => log.error({ err: error }, "Redis connection error"));

  return client;
}

export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === "end") {
    return;
  }
  if (client.status === "ready") {
    await client.quit();
    return;
  }
  client.disconnect();
}

export const redis = createRedisClient("outbox-app");
