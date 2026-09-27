import { DelayedError, UnrecoverableError } from "bullmq";
import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import type { EmailStatus } from "../../src/generated/prisma/enums.js";
import type { DeliveryContext, EmailDeliveryStore } from "../../src/modules/delivery/email-delivery.repository.js";
import {
  createSendEmailProcessor,
  type DeliveryConfig,
  type SendJob,
  type SlotLimiter,
} from "../../src/modules/delivery/send-email.processor.js";
import type { ReserveRequest, SlotDecision } from "../../src/modules/delivery/send-slot-limiter.js";
import { SmtpDeliveryError, type OutgoingMessage, type SendResult } from "../../src/modules/delivery/smtp-mailer.js";
import type { RateLimitAlertJobData, SendEmailJobData } from "../../src/queues/queue.types.js";

const NOW = Date.UTC(2026, 9, 1, 10, 0, 0);
const config: DeliveryConfig = {
  minSendDelayMs: 2000,
  senderHourlyLimit: 200,
  windowMs: 3_600_000,
  lockDurationMs: 30_000,
  retryBackoffMs: 30_000,
  slotGraceMs: 1000,
};

class FakeStore implements EmailDeliveryStore {
  readonly rows = new Map<string, DeliveryContext>();
  readonly events: Array<{ emailId: string; type: string }> = [];

  add(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
    const email: DeliveryContext = {
      id: `email-${this.rows.size + 1}`,
      status: "scheduled",
      sequence: this.rows.size,
      userId: "user-1",
      campaignId: "campaign-1",
      recipientEmail: "lead@example.com",
      claimedAt: null,
      nextAttemptAt: new Date(NOW),
      campaign: { subject: "Hello", body: "Hi", delayBetweenMs: 0, hourlyLimit: 100 },
      sender: {
        id: "sender-1",
        displayName: "Demo",
        email: "demo@ethereal.email",
        cacheKey: "sender-1@1",
        smtp: { host: "smtp.ethereal.email", port: 587, secure: false, user: "u", password: "p" },
      },
      ...overrides,
    };
    this.rows.set(email.id, email);
    return email;
  }

  status(id: string): EmailStatus | undefined {
    return this.rows.get(id)?.status;
  }

  private pendingOrAbandoned(row: DeliveryContext, abandonedBefore: Date): boolean {
    return (
      row.status === "scheduled" ||
      row.status === "rate_limited" ||
      (row.status === "processing" && (row.claimedAt === null || row.claimedAt < abandonedBefore))
    );
  }

  private update(id: string, allowed: (row: DeliveryContext) => boolean, patch: Partial<DeliveryContext>, event: string) {
    const row = this.rows.get(id);
    if (!row || !allowed(row)) {
      return false;
    }
    Object.assign(row, patch);
    this.events.push({ emailId: id, type: event });
    return true;
  }

  async findForDelivery(emailId: string) {
    const row = this.rows.get(emailId);
    return row ? { ...row } : null;
  }

  async reserveSlot(emailId: string, slot: Date, abandonedBefore: Date) {
    return this.update(emailId, (row) => this.pendingOrAbandoned(row, abandonedBefore), { status: "scheduled", nextAttemptAt: slot, claimedAt: null }, "slot_reserved");
  }

  async markRateLimited(emailId: string, retryAt: Date, _details: { reason: string; windowStart: number }, abandonedBefore: Date) {
    return this.update(emailId, (row) => this.pendingOrAbandoned(row, abandonedBefore), { status: "rate_limited", nextAttemptAt: retryAt, claimedAt: null }, "rate_limited");
  }

  async claim(emailId: string, now: Date, abandonedBefore: Date) {
    return this.update(emailId, (row) => this.pendingOrAbandoned(row, abandonedBefore), { status: "processing", claimedAt: now }, "attempt_started");
  }

  async markSent(emailId: string) {
    return this.update(emailId, (row) => row.status === "processing", { status: "sent", claimedAt: null }, "sent");
  }

  async markRetrying(emailId: string, _error: string, retryAt: Date) {
    return this.update(emailId, (row) => row.status === "processing", { status: "scheduled", nextAttemptAt: retryAt, claimedAt: null }, "retry_scheduled");
  }

  async markFailed(emailId: string) {
    return this.update(emailId, (row) => row.status === "processing", { status: "failed", claimedAt: null }, "failed");
  }
}

class FakeLimiter implements SlotLimiter {
  decisions: SlotDecision[] = [];
  readonly requests: ReserveRequest[] = [];
  alertsClaimed = new Set<string>();

  async reserve(request: ReserveRequest): Promise<SlotDecision> {
    this.requests.push(request);
    return this.decisions.shift() ?? { allowed: true, slot: request.now };
  }

  async claimAlert(senderId: string, scope: string, scopeId: string) {
    const key = `${senderId}:${scope}:${scopeId}`;
    if (this.alertsClaimed.has(key)) {
      return false;
    }
    this.alertsClaimed.add(key);
    return true;
  }
}

class FakeMailer {
  readonly sent: OutgoingMessage[] = [];
  failWith: Error | undefined;
  delayMs = 0;

  async send(_cacheKey: string, _settings: unknown, message: OutgoingMessage): Promise<SendResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    if (this.failWith) {
      throw this.failWith;
    }
    this.sent.push(message);
    return { messageId: message.messageId, previewUrl: "https://ethereal.email/message/abc", response: "250 OK" };
  }
}

class FakeJob implements SendJob {
  delayedUntil: number | undefined;
  constructor(
    public data: SendEmailJobData,
    public attemptsMade = 0,
    public opts: { attempts?: number } = { attempts: 5 },
  ) {}

  async updateData(data: SendEmailJobData) {
    this.data = data;
  }

  async moveToDelayed(timestamp: number) {
    this.delayedUntil = timestamp;
  }
}

let store: FakeStore;
let limiter: FakeLimiter;
let mailer: FakeMailer;
let alerts: RateLimitAlertJobData[];
let now: number;

function processor() {
  return createSendEmailProcessor({
    store,
    limiter,
    mailer,
    alerts: { rateLimited: async (data) => void alerts.push(data) },
    indexer: { enqueue: async () => undefined },
    config,
    logger: pino({ level: "silent" }),
    now: () => now,
  });
}

beforeEach(() => {
  store = new FakeStore();
  limiter = new FakeLimiter();
  mailer = new FakeMailer();
  alerts = [];
  now = NOW;
});

describe("send email processor", () => {
  it("sends a due email and records it as sent", async () => {
    const email = store.add();
    const result = await processor()(new FakeJob({ emailId: email.id }));

    expect(result).toMatchObject({ outcome: "sent" });
    expect(store.status(email.id)).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.messageId).toBe(`<${email.id}@outbox.local>`);
  });

  it("does nothing when the email was already sent", async () => {
    const email = store.add({ status: "sent" });
    const result = await processor()(new FakeJob({ emailId: email.id }));

    expect(result).toEqual({ outcome: "skipped", reason: "already_sent" });
    expect(mailer.sent).toHaveLength(0);
    expect(limiter.requests).toHaveLength(0);
  });

  it("sends only once when two workers pick up the same email at the same time", async () => {
    const email = store.add();
    mailer.delayMs = 20;
    const run = processor();
    const results = await Promise.allSettled([
      run(new FakeJob({ emailId: email.id })),
      run(new FakeJob({ emailId: email.id })),
    ]);

    expect(mailer.sent).toHaveLength(1);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.some((result) => result.status === "rejected" && result.reason instanceof DelayedError)).toBe(true);
    expect(store.status(email.id)).toBe("sent");
  });

  it("waits for a future send slot without sending, then sends at that slot without reserving again", async () => {
    const email = store.add();
    const slot = NOW + 6000;
    limiter.decisions.push({ allowed: true, slot });
    const job = new FakeJob({ emailId: email.id });

    await expect(processor()(job)).rejects.toBeInstanceOf(DelayedError);
    expect(job.delayedUntil).toBe(slot);
    expect(job.data.reservation?.slot).toBe(slot);
    expect(store.rows.get(email.id)?.nextAttemptAt.getTime()).toBe(slot);
    expect(mailer.sent).toHaveLength(0);

    now = slot + 5;
    await processor()(job);
    expect(mailer.sent).toHaveLength(1);
    expect(limiter.requests).toHaveLength(1);
  });

  it("re-reserves when the job comes back long after its slot", async () => {
    const email = store.add();
    const job = new FakeJob({ emailId: email.id, reservation: { slot: NOW - 60_000 } });

    await processor()(job);
    expect(limiter.requests).toHaveLength(1);
  });

  it("reschedules into the next window when the hourly limit is reached and alerts once", async () => {
    const first = store.add({ sequence: 7 });
    const second = store.add({ sequence: 8 });
    const nextWindow = NOW + 20_000;
    const blocked: SlotDecision = {
      allowed: false,
      reason: "sender_limit",
      retryAt: nextWindow,
      windowStart: nextWindow - config.windowMs,
    };
    limiter.decisions.push(blocked, blocked);
    const firstJob = new FakeJob({ emailId: first.id });
    const secondJob = new FakeJob({ emailId: second.id });

    await expect(processor()(firstJob)).rejects.toBeInstanceOf(DelayedError);
    await expect(processor()(secondJob)).rejects.toBeInstanceOf(DelayedError);

    expect(store.status(first.id)).toBe("rate_limited");
    expect(firstJob.delayedUntil).toBe(nextWindow + 7);
    expect(secondJob.delayedUntil).toBe(nextWindow + 8);
    expect(mailer.sent).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      scope: "sender",
      limit: 200,
      retryAt: nextWindow,
      windowStart: nextWindow - config.windowMs,
      windowEnd: nextWindow,
    });
    expect(store.rows.get(second.id)?.nextAttemptAt.getTime()).toBe(nextWindow + 8);
  });

  it("does not alert for a backlog deferral", async () => {
    const email = store.add();
    limiter.decisions.push({ allowed: false, reason: "backlog", retryAt: NOW + 5000, windowStart: NOW });

    await expect(processor()(new FakeJob({ emailId: email.id }))).rejects.toBeInstanceOf(DelayedError);
    expect(store.status(email.id)).toBe("rate_limited");
    expect(alerts).toHaveLength(0);
  });

  it("schedules a retry for a temporary SMTP failure", async () => {
    const email = store.add();
    mailer.failWith = new SmtpDeliveryError("connection reset", "transient", "ECONNRESET");

    await expect(processor()(new FakeJob({ emailId: email.id }, 0))).rejects.toBeInstanceOf(SmtpDeliveryError);
    expect(store.status(email.id)).toBe("scheduled");
    expect(store.events.map((event) => event.type)).toContain("retry_scheduled");
  });

  it("fails permanently on a rejected recipient", async () => {
    const email = store.add();
    mailer.failWith = Object.assign(new Error("550 mailbox unavailable"), { responseCode: 550 });

    await expect(processor()(new FakeJob({ emailId: email.id }))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(store.status(email.id)).toBe("failed");
  });

  it("fails permanently when the last attempt also fails", async () => {
    const email = store.add();
    mailer.failWith = new SmtpDeliveryError("timeout", "transient", "ETIMEDOUT");

    await expect(processor()(new FakeJob({ emailId: email.id }, 4, { attempts: 5 }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(store.status(email.id)).toBe("failed");
  });

  it("recovers an email abandoned by a crashed worker", async () => {
    const email = store.add({ status: "processing", claimedAt: new Date(NOW - 60_000) });

    await processor()(new FakeJob({ emailId: email.id }));
    expect(store.status(email.id)).toBe("sent");
  });

  it("leaves an email alone while another worker still holds a fresh claim", async () => {
    const email = store.add({ status: "processing", claimedAt: new Date(NOW - 5000) });
    const job = new FakeJob({ emailId: email.id });

    await expect(processor()(job)).rejects.toBeInstanceOf(DelayedError);
    expect(job.delayedUntil).toBe(NOW - 5000 + config.lockDurationMs + 1000);
    expect(mailer.sent).toHaveLength(0);
  });

  it("uses the larger of the system delay and the campaign delay as the gap", async () => {
    const email = store.add({ campaign: { subject: "s", body: "b", delayBetweenMs: 10_000, hourlyLimit: 500 } });

    await processor()(new FakeJob({ emailId: email.id }));
    expect(limiter.requests[0]).toMatchObject({
      emailId: email.id,
      gapMs: 10_000,
      campaignLimit: 200,
      senderLimit: 200,
      marginMs: config.slotGraceMs + 25,
    });
  });
});
