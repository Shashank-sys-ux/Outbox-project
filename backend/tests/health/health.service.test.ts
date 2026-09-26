import { describe, expect, it } from "vitest";
import { runHealthChecks, type HealthCheck } from "../../src/modules/health/health.service.js";

function upCheck(name: string, critical: boolean): HealthCheck {
  return { name, critical, check: async () => undefined };
}

function downCheck(name: string, critical: boolean): HealthCheck {
  return {
    name,
    critical,
    check: async () => {
      throw new Error(`${name} unavailable`);
    },
  };
}

function hangingCheck(name: string, critical: boolean): HealthCheck {
  return { name, critical, check: () => new Promise<void>(() => undefined) };
}

describe("runHealthChecks", () => {
  it("reports ok when every dependency is up", async () => {
    const report = await runHealthChecks([upCheck("redis", true), upCheck("elasticsearch", false)], 100);

    expect(report.status).toBe("ok");
    expect(report.checks.redis?.status).toBe("up");
    expect(report.checks.elasticsearch?.status).toBe("up");
  });

  it("reports degraded when only a non critical dependency is down", async () => {
    const report = await runHealthChecks([upCheck("redis", true), downCheck("elasticsearch", false)], 100);

    expect(report.status).toBe("degraded");
    expect(report.checks.elasticsearch?.status).toBe("down");
  });

  it("reports down when a critical dependency is down", async () => {
    const report = await runHealthChecks([downCheck("redis", true), upCheck("elasticsearch", false)], 100);

    expect(report.status).toBe("down");
    expect(report.checks.redis).toMatchObject({ status: "down", critical: true });
  });

  it("treats a dependency that never answers as down once the timeout passes", async () => {
    const startedAt = Date.now();
    const report = await runHealthChecks([hangingCheck("redis", true)], 50);

    expect(report.status).toBe("down");
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
