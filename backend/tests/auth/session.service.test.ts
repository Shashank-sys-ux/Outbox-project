import type { Response } from "express";
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, SessionService } from "../../src/modules/auth/session.service.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379/15");
const sessions = new SessionService(redis, { secret: "test-secret-value-long-enough-0123456789", ttlSeconds: 120, secureCookie: true });

function fakeResponse() {
  const cookies: Array<{ name: string; value?: string; options: Record<string, unknown>; cleared: boolean }> = [];
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => cookies.push({ name, value, options, cleared: false }),
    clearCookie: (name: string, options: Record<string, unknown>) => cookies.push({ name, options, cleared: true }),
  } as unknown as Response;
  return { res, cookies };
}

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
});

describe("SessionService", () => {
  it("creates a session with a secure, http only, same site cookie", async () => {
    const { res, cookies } = fakeResponse();
    const sessionId = await sessions.create(res, "user-1");

    expect(cookies[0]).toMatchObject({
      name: SESSION_COOKIE,
      value: sessionId,
      options: { httpOnly: true, secure: true, sameSite: "lax" },
    });
    expect(await sessions.resolve(sessionId)).toEqual({ sessionId, userId: "user-1" });
  });

  it("never stores the raw session id in Redis", async () => {
    const { res } = fakeResponse();
    const sessionId = await sessions.create(res, "user-1");
    const keys = await redis.keys("sess:*");

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(sessionId);
    expect(await redis.ttl(keys[0] ?? "")).toBeGreaterThan(100);
  });

  it("rejects malformed or unknown session ids", async () => {
    expect(await sessions.resolve(undefined)).toBeNull();
    expect(await sessions.resolve("short")).toBeNull();
    expect(await sessions.resolve("A".repeat(43))).toBeNull();
  });

  it("destroys the session on logout", async () => {
    const { res, cookies } = fakeResponse();
    const sessionId = await sessions.create(res, "user-1");
    await sessions.destroy(res, sessionId);

    expect(await sessions.resolve(sessionId)).toBeNull();
    expect(cookies.at(-1)).toMatchObject({ name: SESSION_COOKIE, cleared: true });
  });
});
