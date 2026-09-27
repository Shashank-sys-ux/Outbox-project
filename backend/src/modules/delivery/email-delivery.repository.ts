import type { EmailEventType, EmailStatus } from "../../generated/prisma/enums.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { SecretBox } from "../../utils/crypto.js";
import type { SmtpSettings } from "./smtp-mailer.js";

export interface DeliveryContext {
  id: string;
  status: EmailStatus;
  sequence: number;
  userId: string;
  campaignId: string;
  recipientEmail: string;
  claimedAt: Date | null;
  nextAttemptAt: Date;
  campaign: {
    subject: string;
    body: string;
    delayBetweenMs: number;
    hourlyLimit: number;
  };
  sender: {
    id: string;
    displayName: string;
    email: string;
    cacheKey: string;
    smtp: SmtpSettings;
  };
}

export interface EmailDeliveryStore {
  findForDelivery(emailId: string): Promise<DeliveryContext | null>;
  reserveSlot(emailId: string, slot: Date, abandonedBefore: Date): Promise<boolean>;
  markRateLimited(
    emailId: string,
    retryAt: Date,
    details: { reason: string; windowStart: number },
    abandonedBefore: Date,
  ): Promise<boolean>;
  claim(emailId: string, now: Date, abandonedBefore: Date): Promise<boolean>;
  markSent(emailId: string, result: { messageId: string; previewUrl: string | null; completedAt: Date }): Promise<boolean>;
  markRetrying(emailId: string, error: string, retryAt: Date, attempt: number): Promise<boolean>;
  markFailed(emailId: string, error: string, onlyFromProcessing: boolean): Promise<boolean>;
}

function pendingOrAbandoned(abandonedBefore: Date): Prisma.EmailWhereInput {
  return {
    OR: [
      { status: { in: ["scheduled", "rate_limited"] } },
      { status: "processing", OR: [{ claimedAt: null }, { claimedAt: { lt: abandonedBefore } }] },
    ],
  };
}

export class EmailDeliveryRepository implements EmailDeliveryStore {
  constructor(
    private readonly db: PrismaClient,
    private readonly secrets: SecretBox,
  ) {}

  private async transition(
    where: Prisma.EmailWhereInput,
    data: Prisma.EmailUpdateManyMutationInput,
    event: { emailId: string; type: EmailEventType; message?: string; metadata?: Prisma.InputJsonValue },
  ): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.email.updateMany({ where, data });
      if (count === 1) {
        await tx.emailEvent.create({
          data: {
            emailId: event.emailId,
            type: event.type,
            message: event.message ?? null,
            ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
          },
        });
      }
      return count === 1;
    });
  }

  async findForDelivery(emailId: string): Promise<DeliveryContext | null> {
    const email = await this.db.email.findUnique({
      where: { id: emailId },
      include: {
        campaign: { select: { subject: true, body: true, delayBetweenMs: true, hourlyLimit: true } },
        sender: true,
      },
    });
    if (!email) {
      return null;
    }
    return {
      id: email.id,
      status: email.status,
      sequence: email.sequence,
      userId: email.userId,
      campaignId: email.campaignId,
      recipientEmail: email.recipientEmail,
      claimedAt: email.claimedAt,
      nextAttemptAt: email.nextAttemptAt,
      campaign: email.campaign,
      sender: {
        id: email.sender.id,
        displayName: email.sender.displayName,
        email: email.sender.email,
        cacheKey: `${email.sender.id}@${email.sender.updatedAt.getTime()}`,
        smtp: {
          host: email.sender.smtpHost,
          port: email.sender.smtpPort,
          secure: email.sender.smtpSecure,
          user: email.sender.smtpUser,
          password: this.secrets.decrypt(email.sender.smtpPasswordEncrypted),
        },
      },
    };
  }

  async reserveSlot(emailId: string, slot: Date, abandonedBefore: Date): Promise<boolean> {
    const { count } = await this.db.email.updateMany({
      where: { id: emailId, ...pendingOrAbandoned(abandonedBefore) },
      data: { status: "scheduled", nextAttemptAt: slot, claimedAt: null },
    });
    return count === 1;
  }

  markRateLimited(
    emailId: string,
    retryAt: Date,
    details: { reason: string; windowStart: number },
    abandonedBefore: Date,
  ): Promise<boolean> {
    return this.transition(
      { id: emailId, ...pendingOrAbandoned(abandonedBefore) },
      { status: "rate_limited", nextAttemptAt: retryAt, claimedAt: null },
      {
        emailId,
        type: "rate_limited",
        message: `Hourly limit reached (${details.reason}), rescheduled to ${retryAt.toISOString()}`,
        metadata: {
          reason: details.reason,
          windowStart: new Date(details.windowStart).toISOString(),
          retryAt: retryAt.toISOString(),
        },
      },
    );
  }

  claim(emailId: string, now: Date, abandonedBefore: Date): Promise<boolean> {
    return this.transition(
      { id: emailId, ...pendingOrAbandoned(abandonedBefore) },
      { status: "processing", claimedAt: now, attempts: { increment: 1 } },
      { emailId, type: "attempt_started" },
    );
  }

  markSent(
    emailId: string,
    result: { messageId: string; previewUrl: string | null; completedAt: Date },
  ): Promise<boolean> {
    return this.transition(
      { id: emailId, status: "processing" },
      {
        status: "sent",
        completedAt: result.completedAt,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        lastError: null,
        claimedAt: null,
      },
      {
        emailId,
        type: "sent",
        metadata: { messageId: result.messageId, ...(result.previewUrl ? { previewUrl: result.previewUrl } : {}) },
      },
    );
  }

  markRetrying(emailId: string, error: string, retryAt: Date, attempt: number): Promise<boolean> {
    return this.transition(
      { id: emailId, status: "processing" },
      { status: "scheduled", nextAttemptAt: retryAt, lastError: error, claimedAt: null },
      { emailId, type: "retry_scheduled", message: error, metadata: { attempt, retryAt: retryAt.toISOString() } },
    );
  }

  markFailed(emailId: string, error: string, onlyFromProcessing: boolean): Promise<boolean> {
    return this.transition(
      onlyFromProcessing
        ? { id: emailId, status: "processing" }
        : { id: emailId, status: { in: ["scheduled", "rate_limited", "processing"] } },
      { status: "failed", completedAt: new Date(), lastError: error, claimedAt: null },
      { emailId, type: "failed", message: error },
    );
  }
}
