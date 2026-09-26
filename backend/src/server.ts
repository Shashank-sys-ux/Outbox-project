import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { assertElasticsearchHealthy, elasticsearch } from "./infra/elasticsearch.js";
import { logger } from "./infra/logger.js";
import { closeRedisClient, redis } from "./infra/redis.js";
import { closeHttpServer, registerGracefulShutdown } from "./infra/shutdown.js";
import {
  createElasticsearchHealthCheck,
  createRedisHealthCheck,
} from "./modules/health/health.checks.js";
import { HEALTH_CHECK_TIMEOUT_MS } from "./modules/health/health.routes.js";
import { withTimeout } from "./utils/with-timeout.js";

const STARTUP_CHECK_TIMEOUT_MS = 5000;

async function verifyDependencies(): Promise<void> {
  await withTimeout(redis.ping(), STARTUP_CHECK_TIMEOUT_MS, "Redis startup check");
  logger.info("Redis is reachable");

  try {
    await assertElasticsearchHealthy(elasticsearch, STARTUP_CHECK_TIMEOUT_MS);
    logger.info("Elasticsearch is reachable");
  } catch (error) {
    logger.warn(
      { err: error },
      "Elasticsearch is unreachable, starting anyway with search degraded until it recovers",
    );
  }
}

async function main(): Promise<void> {
  await verifyDependencies();

  const app = createApp({
    healthChecks: [
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

  logger.info({ port: env.PORT, nodeEnv: env.NODE_ENV }, `API listening on http://localhost:${env.PORT}`);

  registerGracefulShutdown({
    logger,
    timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    tasks: [
      { name: "http-server", run: () => closeHttpServer(server) },
      { name: "redis", run: () => closeRedisClient(redis) },
      { name: "elasticsearch", run: () => elasticsearch.close() },
    ],
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "API failed to start");
  process.exit(1);
});
