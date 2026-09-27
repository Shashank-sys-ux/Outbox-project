import { DelayedError, UnrecoverableError } from "bullmq";
import type { Logger } from "pino";
import type { RateLimitAlertJobData, SendEmailJobData, SlotReservation } from "../../queues/queue.types.js";
import { isTerminalStatus } from "../emails/email-status.js";
import type { DeliveryContext, EmailDeliveryStore } from "./email-delivery.repository.js";
import type { SlotDecision, ReserveRequest } from "./send-slot-limiter.js";
import { classifySmtpError, textToHtml, type OutgoingMessage, type SendResult, type SmtpSettings } from "./smtp-mailer.js";

export interface DeliveryConfig {
  minSendDelayMs: number;
  senderHourlyLimit: number;
  windowMs: number;
  lockDurationMs: number;
  retryBackoffMs: number;
  slotGraceMs: number;
}

export interface SendJob {
  id?: string | undefined;
  data: SendEmailJobData;
  attemptsMade: number;
  opts: { attempts?: number | undefined };
  updateData(data: SendEmailJobData): Promise<void>;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

export interface SlotLimiter {
  reserve(request: ReserveRequest): Promise<SlotDecision>;
  claimAlert(senderId: string, scope: "sender" | "campaign", scopeId: string): Promise<boolean>;
}

export interface DeliveryDependencies {
  store: EmailDeliveryStore;
  limiter: SlotLimiter;
  mailer: { send(cacheKey: string, settings: SmtpSettings, message: OutgoingMessage): Promise<SendResult> };
  alerts: { rateLimited(data: RateLimitAlertJobData): Promise<void> };
  indexer: { enqueue(emailIds: string[]): Promise<void> };
  config: DeliveryConfig;
  logger: Logger;
  now?: () => number;
}

export type SendOutcome =
  | { outcome: "sent"; messageId: string; previewUrl: string | null }
  | { outcome: "skipped"; reason: string };

const SLOT_TOLERANCE_MS = 25;

export function orderingOffsetMs(sequence: number, windowMs: number): number {
  return Math.min(Math.max(0, sequence), Math.floor(windowMs / 60));
}

export function retryDelayMs(baseMs: number, attempt: number): number {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

export function buildMessage(email: DeliveryContext): OutgoingMessage {
  return {
    messageId: `<${email.id}@outbox.local>`,
    from: { name: email.sender.displayName, address: email.sender.email },
    to: email.recipientEmail,
    subject: email.campaign.subject,
    text: email.campaign.body,
    html: textToHtml(email.campaign.body),
    headers: { "X-Outbox-Email-Id": email.id, "X-Outbox-Campaign-Id": email.campaignId },
  };
}

export function createSendEmailProcessor(deps: DeliveryDependencies) {
  const { store, limiter, mailer, alerts, indexer, config } = deps;
  const clock = deps.now ?? Date.now;

  const delay = async (job: SendJob, token: string | undefined, until: number, data: SendEmailJobData) => {
    await job.updateData(data);
    await job.moveToDelayed(until, token);
    throw new DelayedError();
  };

  const reindex = (emailId: string) =>
    indexer.enqueue([emailId]).catch((error: unknown) => deps.logger.warn({ err: error, emailId }, "Search index enqueue failed"));

  const reservationIsUsable = (reservation: SlotReservation | undefined, now: number) =>
    reservation !== undefined && now >= reservation.slot - SLOT_TOLERANCE_MS && now - reservation.slot <= config.slotGraceMs;

  const notifyLimit = async (email: DeliveryContext, decision: Extract<SlotDecision, { allowed: false }>, limit: number) => {
    if (decision.reason === "backlog") {
      return;
    }
    const scope = decision.reason === "sender_limit" ? "sender" : "campaign";
    const scopeId = scope === "sender" ? email.sender.id : email.campaignId;
    try {
      if (!(await limiter.claimAlert(email.sender.id, scope, scopeId))) {
        return;
      }
      await alerts.rateLimited({
        userId: email.userId,
        senderId: email.sender.id,
        senderEmail: email.sender.email,
        scope,
        campaignId: email.campaignId,
        campaignSubject: email.campaign.subject,
        limit,
        windowStart: decision.windowStart,
        windowEnd: decision.retryAt,
        retryAt: decision.retryAt,
      });
    } catch (error) {
      deps.logger.warn({ err: error, emailId: email.id }, "Could not enqueue rate limit alert");
    }
  };

  return async function processSendJob(job: SendJob, token?: string): Promise<SendOutcome> {
    const { emailId } = job.data;
    const log = deps.logger.child({ emailId, jobId: job.id });
    const now = clock();
    const abandonedBefore = new Date(now - config.lockDurationMs);

    const email = await store.findForDelivery(emailId);
    if (!email) {
      log.warn("Email row not found, dropping job");
      return { outcome: "skipped", reason: "not_found" };
    }
    if (isTerminalStatus(email.status)) {
      log.info({ status: email.status }, "Email already finished, skipping duplicate job");
      return { outcome: "skipped", reason: `already_${email.status}` };
    }
    if (email.status === "processing" && email.claimedAt && email.claimedAt > abandonedBefore) {
      const recheckAt = email.claimedAt.getTime() + config.lockDurationMs + 1000;
      log.warn({ recheckAt: new Date(recheckAt).toISOString() }, "Email is being processed elsewhere, rechecking later");
      return delay(job, token, recheckAt, { emailId });
    }

    if (!reservationIsUsable(job.data.reservation, now)) {
      const senderLimit = config.senderHourlyLimit;
      const campaignLimit = Math.min(email.campaign.hourlyLimit, senderLimit);
      const decision = await limiter.reserve({
        emailId: email.id,
        senderId: email.sender.id,
        campaignId: email.campaignId,
        gapMs: Math.max(config.minSendDelayMs, email.campaign.delayBetweenMs),
        senderLimit,
        campaignLimit,
        marginMs: config.slotGraceMs + SLOT_TOLERANCE_MS,
        now,
      });

      if (!decision.allowed) {
        const retryAt = decision.retryAt + orderingOffsetMs(email.sequence, config.windowMs);
        await store.markRateLimited(
          email.id,
          new Date(retryAt),
          { reason: decision.reason, windowStart: decision.windowStart },
          abandonedBefore,
        );
        log.warn(
          { reason: decision.reason, senderId: email.sender.id, retryAt: new Date(retryAt).toISOString() },
          "Rate limit reached, job rescheduled to the next window",
        );
        await notifyLimit(email, decision, decision.reason === "sender_limit" ? senderLimit : campaignLimit);
        void reindex(email.id);
        return delay(job, token, retryAt, { emailId });
      }

      if (decision.slot > now + SLOT_TOLERANCE_MS) {
        await store.reserveSlot(email.id, new Date(decision.slot), abandonedBefore);
        log.debug({ slot: new Date(decision.slot).toISOString() }, "Send slot reserved, waiting for it");
        return delay(job, token, decision.slot, { emailId, reservation: { slot: decision.slot } });
      }
    }

    const claimed = await store.claim(email.id, new Date(now), abandonedBefore);
    if (!claimed) {
      const latest = await store.findForDelivery(emailId);
      if (!latest || isTerminalStatus(latest.status)) {
        log.info("Email finished by another worker, skipping");
        return { outcome: "skipped", reason: "claimed_elsewhere" };
      }
      log.warn({ status: latest.status }, "Could not claim email, rechecking later");
      return delay(job, token, now + config.lockDurationMs + 1000, { emailId });
    }

    const attempt = job.attemptsMade + 1;
    log.info({ attempt, recipient: email.recipientEmail, senderId: email.sender.id }, "Delivery attempt started");

    try {
      const result = await mailer.send(email.sender.cacheKey, email.sender.smtp, buildMessage(email));
      const recorded = await store.markSent(email.id, {
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        completedAt: new Date(clock()),
      });
      if (!recorded) {
        log.warn("Email was sent but its row was no longer in processing state");
      }
      log.info({ messageId: result.messageId, previewUrl: result.previewUrl }, "Email sent");
      void reindex(email.id);
      return { outcome: "sent", messageId: result.messageId, previewUrl: result.previewUrl };
    } catch (error) {
      const failure = classifySmtpError(error);
      const maxAttempts = job.opts.attempts ?? 1;

      if (failure.kind === "permanent" || attempt >= maxAttempts) {
        await store.markFailed(email.id, failure.message, true);
        log.error({ err: failure, attempt, maxAttempts, kind: failure.kind }, "Email delivery failed permanently");
        void reindex(email.id);
        throw new UnrecoverableError(failure.message);
      }

      const retryAt = new Date(clock() + retryDelayMs(config.retryBackoffMs, attempt));
      await store.markRetrying(email.id, failure.message, retryAt, attempt);
      await job.updateData({ emailId });
      log.warn({ err: failure, attempt, retryAt: retryAt.toISOString() }, "Email delivery failed, retry scheduled");
      void reindex(email.id);
      throw failure;
    }
  };
}
