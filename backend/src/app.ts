import express, { type Express } from "express";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-logger.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      data: {
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
