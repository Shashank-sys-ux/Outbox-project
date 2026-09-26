import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";

const required = {
  REDIS_URL: "redis://localhost:6379",
  ELASTICSEARCH_URL: "http://localhost:9200",
};

describe("parseEnv", () => {
  it("applies defaults for optional values", () => {
    expect(parseEnv(required)).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      LOG_LEVEL: "info",
      SHUTDOWN_TIMEOUT_MS: 10000,
    });
  });

  it("coerces numeric strings into numbers", () => {
    expect(parseEnv({ ...required, PORT: "8080" }).PORT).toBe(8080);
  });

  it("treats empty strings as missing so defaults still apply", () => {
    expect(parseEnv({ ...required, PORT: "" }).PORT).toBe(4000);
  });

  it("rejects a missing required variable and names it", () => {
    expect(() => parseEnv({ ELASTICSEARCH_URL: required.ELASTICSEARCH_URL })).toThrow(/REDIS_URL/);
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
});
