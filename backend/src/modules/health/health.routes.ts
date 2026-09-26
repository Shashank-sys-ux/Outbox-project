import { Router } from "express";
import { runHealthChecks, type HealthCheck } from "./health.service.js";

export const HEALTH_CHECK_TIMEOUT_MS = 2000;

export function createHealthRouter(checks: HealthCheck[]): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({
      data: {
        status: "ok",
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  });

  router.get("/ready", async (_req, res) => {
    const report = await runHealthChecks(checks, HEALTH_CHECK_TIMEOUT_MS);
    res.status(report.status === "down" ? 503 : 200).json({
      data: { ...report, timestamp: new Date().toISOString() },
    });
  });

  return router;
}
