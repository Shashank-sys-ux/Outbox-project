import type { Server } from "node:http";
import type { Logger } from "pino";

export interface ShutdownTask {
  name: string;
  run: () => Promise<void>;
}

interface GracefulShutdownOptions {
  tasks: ShutdownTask[];
  timeoutMs: number;
  logger: Logger;
}

export function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function registerGracefulShutdown({ tasks, timeoutMs, logger }: GracefulShutdownOptions): void {
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ reason }, "Shutdown already in progress, forcing exit");
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ reason }, "Graceful shutdown started");

    const forceExitTimer = setTimeout(() => {
      logger.error({ timeoutMs }, "Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, timeoutMs);
    forceExitTimer.unref();

    let finalExitCode = exitCode;
    for (const task of tasks) {
      try {
        await task.run();
        logger.info({ task: task.name }, "Shutdown task completed");
      } catch (error) {
        finalExitCode = 1;
        logger.error({ err: error, task: task.name }, "Shutdown task failed");
      }
    }

    clearTimeout(forceExitTimer);
    logger.info({ exitCode: finalExitCode }, "Graceful shutdown finished");
    process.exit(finalExitCode);
  };

  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });
  process.on("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });
}
