import express, { type Express } from "express";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-logger.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import type { HealthCheck } from "./modules/health/health.service.js";

export interface AppDependencies {
  healthChecks: HealthCheck[];
}

export function createApp({ healthChecks }: AppDependencies): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/health", createHealthRouter(healthChecks));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
