import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { HealthCheck } from "../src/modules/health/health.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeCheck(name: string, critical: boolean, healthy: boolean): HealthCheck {
  return {
    name,
    critical,
    check: async () => {
      if (!healthy) {
        throw new Error(`${name} unavailable`);
      }
    },
  };
}

function appWith(redisHealthy: boolean, elasticsearchHealthy: boolean) {
  return createApp({
    healthChecks: [
      fakeCheck("redis", true, redisHealthy),
      fakeCheck("elasticsearch", false, elasticsearchHealthy),
    ],
  });
}

describe("GET /api/health", () => {
  it("returns liveness data and a generated request id", async () => {
    const response = await request(appWith(true, true)).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
    expect(response.headers["x-request-id"]).toMatch(UUID_PATTERN);
  });

  it("reuses a safe incoming request id", async () => {
    const response = await request(appWith(true, true))
      .get("/api/health")
      .set("x-request-id", "trace-abc.123");

    expect(response.headers["x-request-id"]).toBe("trace-abc.123");
  });

  it("replaces an unsafe incoming request id", async () => {
    const response = await request(appWith(true, true))
      .get("/api/health")
      .set("x-request-id", "<script>alert(1)</script>");

    expect(response.headers["x-request-id"]).toMatch(UUID_PATTERN);
  });
});

describe("GET /api/health/ready", () => {
  it("returns 200 ok when all dependencies are up", async () => {
    const response = await request(appWith(true, true)).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });

  it("returns 200 degraded when only Elasticsearch is down", async () => {
    const response = await request(appWith(true, false)).get("/api/health/ready");

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("degraded");
    expect(response.body.data.checks.elasticsearch.status).toBe("down");
  });

  it("returns 503 when Redis is down", async () => {
    const response = await request(appWith(false, true)).get("/api/health/ready");

    expect(response.status).toBe(503);
    expect(response.body.data.status).toBe("down");
  });
});

describe("error responses", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const response = await request(appWith(true, true)).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "NOT_FOUND" });
    expect(response.body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("returns 400 for malformed JSON bodies", async () => {
    const response = await request(appWith(true, true))
      .post("/api/anything")
      .set("content-type", "application/json")
      .send('{"subject": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 for bodies over the size limit", async () => {
    const response = await request(appWith(true, true))
      .post("/api/anything")
      .set("content-type", "application/json")
      .send(JSON.stringify({ body: "x".repeat(1024 * 1024 + 1) }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("security middleware", () => {
  it("rejects protected API calls without a session", async () => {
    const app = appWith(true, true);

    for (const path of ["/api/auth/me", "/api/emails", "/api/senders", "/api/campaigns", "/api/search/emails"]) {
      const response = await request(app).get(path);
      expect(response.status, path).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("ignores a forged session cookie", async () => {
    const response = await request(appWith(true, true))
      .get("/api/auth/me")
      .set("Cookie", `outbox_sid=${"x".repeat(43)}`);

    expect(response.status).toBe(401);
  });

  it("blocks state changing requests from another origin", async () => {
    const response = await request(appWith(true, true))
      .post("/api/campaigns")
      .set("Origin", "https://evil.example")
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("keeps the queue dashboard behind login", async () => {
    const response = await request(appWith(true, true)).get("/admin/queues");

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("/login?returnTo=");
  });

  it("exposes public feature flags and limits", async () => {
    const response = await request(appWith(true, true)).get("/api/config");

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      googleAuth: false,
      slack: false,
      limits: { minSendDelayMs: 2000, maxEmailsPerHourPerSender: 200 },
    });
  });

  it("sends security headers on API responses", async () => {
    const response = await request(appWith(true, true)).get("/api/config");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("redirects to the login page with an error when Google is not configured", async () => {
    const response = await request(appWith(true, true)).get("/api/auth/google");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://localhost:5173/login?error=google_not_configured");
  });
});
