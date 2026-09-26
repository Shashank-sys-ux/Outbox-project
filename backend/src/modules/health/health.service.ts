import { performance } from "node:perf_hooks";
import { withTimeout } from "../../utils/with-timeout.js";

export interface HealthCheck {
  name: string;
  critical: boolean;
  check: () => Promise<void>;
}

export type DependencyStatus = "up" | "down";
export type OverallStatus = "ok" | "degraded" | "down";

export interface DependencyResult {
  status: DependencyStatus;
  critical: boolean;
  latencyMs: number;
}

export interface HealthReport {
  status: OverallStatus;
  checks: Record<string, DependencyResult>;
}

async function runCheck(healthCheck: HealthCheck, timeoutMs: number): Promise<DependencyResult> {
  const startedAt = performance.now();
  let status: DependencyStatus = "up";
  try {
    await withTimeout(healthCheck.check(), timeoutMs, `${healthCheck.name} health check`);
  } catch {
    status = "down";
  }
  return {
    status,
    critical: healthCheck.critical,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

export async function runHealthChecks(checks: HealthCheck[], timeoutMs: number): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (healthCheck) => [healthCheck.name, await runCheck(healthCheck, timeoutMs)] as const),
  );

  const criticalDown = results.some(([, result]) => result.critical && result.status === "down");
  const anyDown = results.some(([, result]) => result.status === "down");

  return {
    status: criticalDown ? "down" : anyDown ? "degraded" : "ok",
    checks: Object.fromEntries(results),
  };
}
