import { describe, expect, it } from "vitest";
import {
  campaignRequestHash,
  checkRecipients,
  planSendTimes,
  resolveStartAt,
  type CampaignRequest,
} from "../../src/modules/campaigns/scheduling.js";

const request: CampaignRequest = {
  senderId: "0199a0de-0000-7000-8000-000000000001",
  subject: "Hello",
  body: "Hi there",
  recipients: ["a@example.com", "b@example.com"],
  startAt: "2026-10-01T10:00:00.000Z",
  delayBetweenMs: 2000,
  hourlyLimit: 100,
};

describe("planSendTimes", () => {
  it("spaces emails by the requested delay", () => {
    const times = planSendTimes(new Date("2026-10-01T10:00:00.000Z"), 3, 2000);

    expect(times.map((time) => time.toISOString())).toEqual([
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T10:00:02.000Z",
      "2026-10-01T10:00:04.000Z",
    ]);
  });

  it("lets every email share the start time when the delay is zero", () => {
    const times = planSendTimes(new Date("2026-10-01T10:00:00.000Z"), 1000, 0);

    expect(new Set(times.map((time) => time.getTime())).size).toBe(1);
  });
});

describe("checkRecipients", () => {
  it("normalizes, dedupes and reports invalid addresses", () => {
    const result = checkRecipients(["A@Example.com", "a@example.com", "not-an-email", "b@example.com"]);

    expect(result).toEqual({ recipients: ["a@example.com", "b@example.com"], invalid: ["not-an-email"], duplicates: 1 });
  });
});

describe("resolveStartAt", () => {
  const now = new Date("2026-10-01T10:00:00.000Z");

  it("keeps a future start time", () => {
    expect(resolveStartAt("2026-10-01T11:00:00.000Z", now, 60_000).toISOString()).toBe("2026-10-01T11:00:00.000Z");
  });

  it("moves a slightly past start time to now", () => {
    expect(resolveStartAt("2026-10-01T09:59:30.000Z", now, 60_000)).toEqual(now);
  });

  it("rejects a start time far in the past", () => {
    expect(() => resolveStartAt("2026-10-01T09:00:00.000Z", now, 60_000)).toThrow(RangeError);
  });
});

describe("campaignRequestHash", () => {
  it("is stable for the same request regardless of email casing", () => {
    const upper = { ...request, recipients: ["A@EXAMPLE.COM", "b@example.com"] };

    expect(campaignRequestHash(upper)).toBe(campaignRequestHash(request));
  });

  it("changes when anything meaningful changes", () => {
    expect(campaignRequestHash({ ...request, subject: "Other" })).not.toBe(campaignRequestHash(request));
    expect(campaignRequestHash({ ...request, hourlyLimit: 5 })).not.toBe(campaignRequestHash(request));
  });
});
