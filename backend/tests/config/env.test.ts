import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

const required = {
  DATABASE_URL: "postgresql://outbox:secret@localhost:5432/outbox",
  REDIS_URL: "redis://localhost:6379",
  ELASTICSEARCH_URL: "http://localhost:9200",
  SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("parseEnv", () => {
  it("applies defaults for optional values", () => {
    expect(parseEnv(required)).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      LOG_LEVEL: "info",
      SHUTDOWN_TIMEOUT_MS: 10000,
      DATABASE_POOL_MAX: 10,
    });
  });

  it("coerces numeric strings into numbers", () => {
    expect(parseEnv({ ...required, PORT: "8080" }).PORT).toBe(8080);
  });

  it("treats empty strings as missing so defaults still apply", () => {
    expect(parseEnv({ ...required, PORT: "" }).PORT).toBe(4000);
  });

  it("rejects a missing required variable and names it", () => {
    const { REDIS_URL: _omitted, ...withoutRedis } = required;
    expect(() => parseEnv(withoutRedis)).toThrow(/REDIS_URL/);
  });

  it("rejects a database URL that is not postgres", () => {
    expect(() => parseEnv({ ...required, DATABASE_URL: "mysql://localhost:3306/outbox" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("rejects a URL with the wrong protocol", () => {
    expect(() => parseEnv({ ...required, REDIS_URL: "http://localhost:6379" })).toThrow(/REDIS_URL/);
  });

  it("rejects an out of range port", () => {
    expect(() => parseEnv({ ...required, PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects an unknown log level", () => {
    expect(() => parseEnv({ ...required, LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  it("reads the scheduling knobs from the environment", () => {
    const env = parseEnv({
      ...required,
      WORKER_CONCURRENCY: "8",
      MIN_SEND_DELAY_MS: "1500",
      MAX_EMAILS_PER_HOUR_PER_SENDER: "50",
    });
    expect(env).toMatchObject({ WORKER_CONCURRENCY: 8, MIN_SEND_DELAY_MS: 1500, MAX_EMAILS_PER_HOUR_PER_SENDER: 50 });
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => parseEnv({ ...required, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it("rejects half configured Google OAuth", () => {
    expect(() => parseEnv({ ...required, GOOGLE_CLIENT_ID: "id-only" })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it("parses the admin allowlist as lowercase emails", () => {
    expect(parseEnv({ ...required, ADMIN_EMAILS: " Admin@Example.com , ops@example.com" }).ADMIN_EMAILS).toEqual([
      "admin@example.com",
      "ops@example.com",
    ]);
  });
});
