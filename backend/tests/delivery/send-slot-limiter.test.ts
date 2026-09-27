import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SendSlotLimiter, type ReserveRequest, type SlotDecision } from "../../src/modules/delivery/send-slot-limiter.js";

const WINDOW_MS = 3_600_000;
const WINDOW_START = 490_000 * WINDOW_MS;
const MINUTE_MS = 60_000;

const redisA = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379/15");
const redisB = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379/15");
const limiter = new SendSlotLimiter(redisA, WINDOW_MS);
const otherProcessLimiter = new SendSlotLimiter(redisB, WINDOW_MS);
const minuteLimiter = new SendSlotLimiter(redisA, MINUTE_MS);
const otherProcessMinuteLimiter = new SendSlotLimiter(redisB, MINUTE_MS);

const base = { senderId: "sender-1", campaignId: "campaign-1", gapMs: 2000, senderLimit: 200, campaignLimit: 200, marginMs: 0 };

let emailCounter = 0;

function reserve(
  target: SendSlotLimiter,
  overrides: Partial<ReserveRequest> & { now: number },
): Promise<SlotDecision> {
  emailCounter += 1;
  return target.reserve({ ...base, emailId: `email-${emailCounter}`, ...overrides });
}

function slotOf(decision: SlotDecision): number {
  if (!decision.allowed) {
    throw new Error(`expected an allowed slot, got ${decision.reason}`);
  }
  return decision.slot;
}

function randomSource(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

beforeEach(async () => {
  await redisA.flushdb();
});

afterAll(async () => {
  await redisA.quit();
  await redisB.quit();
});

describe("SendSlotLimiter", () => {
  it("hands out slots spaced by the minimum delay", async () => {
    const now = WINDOW_START + 1000;
    const first = await reserve(limiter, { now });
    const second = await reserve(limiter, { now });
    const third = await reserve(limiter, { now });

    expect(first).toEqual({ allowed: true, slot: now });
    expect(second).toMatchObject({ allowed: true, slot: now + 2000 });
    expect(third).toMatchObject({ allowed: true, slot: now + 4000 });
  });

  it("stops at the sender limit and retries when the oldest send leaves the rolling window", async () => {
    const now = WINDOW_START + 1000;
    for (let index = 0; index < 3; index += 1) {
      expect((await reserve(limiter, { senderLimit: 3, now })).allowed).toBe(true);
    }
    const blocked = await reserve(limiter, { senderLimit: 3, now });

    expect(blocked).toEqual({ allowed: false, reason: "sender_limit", retryAt: now + WINDOW_MS, windowStart: now });
    expect(await redisA.zcard("rl:{s:sender-1}:slots")).toBe(3);
    expect(await redisA.get("rl:{s:sender-1}:last_slot")).toBe(String(now + 4000));

    const retried = await reserve(limiter, { senderLimit: 3, now: now + WINDOW_MS });
    expect(retried).toEqual({ allowed: true, slot: now + WINDOW_MS });
  });

  it("applies the campaign limit separately from the sender limit", async () => {
    const now = WINDOW_START;
    await reserve(limiter, { campaignLimit: 1, now });
    const blocked = await reserve(limiter, { campaignLimit: 1, now });
    const otherCampaign = await reserve(limiter, { campaignId: "campaign-2", campaignLimit: 1, now });

    expect(blocked).toMatchObject({ allowed: false, reason: "campaign_limit", retryAt: now + WINDOW_MS });
    expect(otherCampaign.allowed).toBe(true);
  });

  it("computes the campaign retry time from that campaign's own sends", async () => {
    const now = WINDOW_START;
    await reserve(limiter, { campaignId: "campaign-2", campaignLimit: 2, senderLimit: 10, now });
    const firstOfCampaign = slotOf(await reserve(limiter, { campaignLimit: 2, senderLimit: 10, now }));
    await reserve(limiter, { campaignLimit: 2, senderLimit: 10, now });
    const blocked = await reserve(limiter, { campaignLimit: 2, senderLimit: 10, now });

    expect(firstOfCampaign).toBe(now + 2000);
    expect(blocked).toEqual({
      allowed: false,
      reason: "campaign_limit",
      retryAt: firstOfCampaign + WINDOW_MS,
      windowStart: firstOfCampaign,
    });
  });

  it("never exceeds the limit under heavy concurrency from two processes", async () => {
    const now = WINDOW_START + 5000;
    const attempts = Array.from({ length: 120 }, (_, index) =>
      reserve(index % 2 === 0 ? limiter : otherProcessLimiter, { gapMs: 1000, senderLimit: 50, now }),
    );
    const results = await Promise.all(attempts);
    const granted = results.filter((result) => result.allowed);
    const slots = granted.map(slotOf).sort((a, b) => a - b);

    expect(granted).toHaveLength(50);
    expect(new Set(slots).size).toBe(50);
    for (let index = 1; index < slots.length; index += 1) {
      expect((slots[index] ?? 0) - (slots[index - 1] ?? 0)).toBe(1000);
    }
    expect(await redisA.zcard("rl:{s:sender-1}:slots")).toBe(50);
  });

  it("blocks a burst that straddles a clock minute boundary", async () => {
    const boundary = 29_841_382 * MINUTE_MS;
    const first = boundary - 5000;
    const request = { senderLimit: 3, campaignLimit: 3, gapMs: 2000 };
    const slots = [
      slotOf(await reserve(minuteLimiter, { ...request, now: first })),
      slotOf(await reserve(minuteLimiter, { ...request, now: first + 2000 })),
      slotOf(await reserve(minuteLimiter, { ...request, now: first + 4000 })),
    ];
    const fourth = await reserve(minuteLimiter, { ...request, now: first + 6000 });

    expect(slots).toEqual([first, first + 2000, first + 4000]);
    expect(first + 6000).toBeGreaterThan(boundary);
    expect(fourth).toEqual({ allowed: false, reason: "sender_limit", retryAt: first + MINUTE_MS, windowStart: first });
  });

  it("never lets more than N slots fall inside any rolling window, even with random timing and two processes", async () => {
    const limit = 5;
    const gapMs = 700;
    const marginMs = 150;
    const random = randomSource(42);
    const granted: number[] = [];
    let now = WINDOW_START;

    for (let round = 0; round < 160; round += 1) {
      now += Math.floor(random() * 4000);
      const burst = 1 + Math.floor(random() * 3);
      const results = await Promise.all(
        Array.from({ length: burst }, (_, index) =>
          reserve(index % 2 === 0 ? minuteLimiter : otherProcessMinuteLimiter, {
            senderLimit: limit,
            campaignLimit: limit,
            gapMs,
            marginMs,
            now,
          }),
        ),
      );
      for (const result of results) {
        if (result.allowed) {
          granted.push(result.slot);
        } else {
          expect(result.retryAt).toBeGreaterThanOrEqual(now);
        }
      }
    }

    granted.sort((a, b) => a - b);
    expect(granted.length).toBeGreaterThan(limit * 3);
    for (let index = 1; index < granted.length; index += 1) {
      expect((granted[index] ?? 0) - (granted[index - 1] ?? 0)).toBeGreaterThanOrEqual(gapMs);
    }
    for (let index = 0; index + limit < granted.length; index += 1) {
      expect((granted[index + limit] ?? 0) - (granted[index] ?? 0)).toBeGreaterThanOrEqual(MINUTE_MS + marginMs);
    }
  });

  it("widens the rolling window by the jitter margin", async () => {
    const now = WINDOW_START;
    await reserve(minuteLimiter, { senderLimit: 1, marginMs: 500, now });
    const exactlyOneWindowLater = await reserve(minuteLimiter, { senderLimit: 1, marginMs: 500, now: now + MINUTE_MS });
    const afterMargin = await reserve(minuteLimiter, { senderLimit: 1, marginMs: 500, now: now + MINUTE_MS + 500 });

    expect(exactlyOneWindowLater).toMatchObject({ allowed: false, reason: "sender_limit", retryAt: now + MINUTE_MS + 500 });
    expect(afterMargin).toEqual({ allowed: true, slot: now + MINUTE_MS + 500 });
  });

  it("does not count the same email twice when it reserves again", async () => {
    const now = WINDOW_START;
    const request = { senderLimit: 2, campaignLimit: 2, gapMs: 1000 };
    await limiter.reserve({ ...base, ...request, emailId: "email-a", now });
    const again = await limiter.reserve({ ...base, ...request, emailId: "email-a", now: now + 500 });

    expect(again).toEqual({ allowed: true, slot: now + 1000 });
    expect(await redisA.zcard("rl:{s:sender-1}:slots")).toBe(1);
    expect(await redisA.zcard("rl:{s:sender-1}:campaign:campaign-1:slots")).toBe(1);
    expect((await limiter.reserve({ ...base, ...request, emailId: "email-b", now })).allowed).toBe(true);
    expect((await limiter.reserve({ ...base, ...request, emailId: "email-c", now })).allowed).toBe(false);
  });

  it("frees enough room when the limit was lowered below the current count", async () => {
    const now = WINDOW_START;
    const slots = [
      slotOf(await reserve(limiter, { senderLimit: 3, now })),
      slotOf(await reserve(limiter, { senderLimit: 3, now })),
      slotOf(await reserve(limiter, { senderLimit: 3, now })),
    ];
    const blocked = await reserve(limiter, { senderLimit: 2, now });

    expect(blocked).toMatchObject({ allowed: false, reason: "sender_limit", retryAt: (slots[1] ?? 0) + WINDOW_MS });
  });

  it("defers when the reserved backlog is more than one window ahead", async () => {
    const now = WINDOW_START;
    await redisA.set("rl:{s:sender-1}:last_slot", String(WINDOW_START + 2 * WINDOW_MS + 5000));

    expect(await reserve(limiter, { now })).toMatchObject({
      allowed: false,
      reason: "backlog",
      retryAt: WINDOW_START + WINDOW_MS + 7000,
    });
  });

  it("keeps different senders independent", async () => {
    const now = WINDOW_START;
    await reserve(limiter, { senderLimit: 1, now });

    expect((await reserve(limiter, { senderLimit: 1, now })).allowed).toBe(false);
    expect((await reserve(limiter, { senderId: "sender-2", senderLimit: 1, now })).allowed).toBe(true);
  });

  it("puts an expiry on every key it writes", async () => {
    await reserve(limiter, { now: WINDOW_START });
    const keys = await redisA.keys("rl:*");
    const ttls = await Promise.all(keys.map((key) => redisA.pttl(key)));

    expect(keys.length).toBeGreaterThan(0);
    expect(ttls.every((ttl) => ttl > 0)).toBe(true);
    expect(await redisA.pttl("rl:{s:sender-1}:slots")).toBeGreaterThan(WINDOW_MS);
  });

  it("lets only the first caller claim a rate limit alert within a window", async () => {
    const shortLimiter = new SendSlotLimiter(redisA, 200);
    const otherProcessShortLimiter = new SendSlotLimiter(redisB, 200);

    expect(await shortLimiter.claimAlert("sender-1", "sender", "sender-1")).toBe(true);
    expect(await otherProcessShortLimiter.claimAlert("sender-1", "sender", "sender-1")).toBe(false);
    expect(await shortLimiter.claimAlert("sender-1", "campaign", "campaign-1")).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(await otherProcessShortLimiter.claimAlert("sender-1", "sender", "sender-1")).toBe(true);
  });
});
