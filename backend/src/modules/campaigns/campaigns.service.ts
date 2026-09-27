import { Prisma, type Campaign } from "../../generated/prisma/client.js";
import type { EmailStatus } from "../../generated/prisma/enums.js";
import { logger } from "../../infra/logger.js";
import { prisma } from "../../infra/prisma.js";
import { enqueueEmailSends, enqueueSearchIndex, type SchedulableEmail } from "../../queues/producers.js";
import { AppError } from "../../utils/errors.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { getOwnedSender } from "../senders/senders.service.js";
import {
  campaignRequestHash,
  checkRecipients,
  planSendTimes,
  resolveStartAt,
  type CampaignRequest,
} from "./scheduling.js";

const INSERT_CHUNK_SIZE = 1000;
const START_TIME_PAST_TOLERANCE_MS = 5 * 60 * 1000;

export type StatusCounts = Record<EmailStatus, number>;

export interface CampaignView {
  id: string;
  subject: string;
  sender: { id: string; email: string; displayName: string };
  startAt: string;
  delayBetweenMs: number;
  hourlyLimit: number;
  totalRecipients: number;
  createdAt: string;
  counts: StatusCounts;
}

function emptyCounts(): StatusCounts {
  return { scheduled: 0, processing: 0, rate_limited: 0, sent: 0, failed: 0 };
}

async function countsByCampaign(campaignIds: string[]): Promise<Map<string, StatusCounts>> {
  const rows = await prisma.email.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });
  const result = new Map<string, StatusCounts>();
  for (const row of rows) {
    const counts = result.get(row.campaignId) ?? emptyCounts();
    counts[row.status] = row._count._all;
    result.set(row.campaignId, counts);
  }
  return result;
}

type CampaignWithSender = Campaign & { sender: { id: string; email: string; displayName: string } };

function toView(campaign: CampaignWithSender, counts: StatusCounts): CampaignView {
  return {
    id: campaign.id,
    subject: campaign.subject,
    sender: campaign.sender,
    startAt: campaign.startAt.toISOString(),
    delayBetweenMs: campaign.delayBetweenMs,
    hourlyLimit: campaign.hourlyLimit,
    totalRecipients: campaign.totalRecipients,
    createdAt: campaign.createdAt.toISOString(),
    counts,
  };
}

const senderSelect = { sender: { select: { id: true, email: true, displayName: true } } } as const;

export async function getCampaign(userId: string, campaignId: string): Promise<CampaignView> {
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, userId }, include: senderSelect });
  if (!campaign) {
    throw AppError.notFound("Campaign not found");
  }
  const counts = await countsByCampaign([campaign.id]);
  return toView(campaign, counts.get(campaign.id) ?? emptyCounts());
}

export async function listCampaigns(
  userId: string,
  page: number,
  pageSize: number,
): Promise<{ items: CampaignView[]; total: number }> {
  const [total, campaigns] = await Promise.all([
    prisma.campaign.count({ where: { userId } }),
    prisma.campaign.findMany({
      where: { userId },
      include: senderSelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  const counts = await countsByCampaign(campaigns.map((campaign) => campaign.id));
  return { items: campaigns.map((campaign) => toView(campaign, counts.get(campaign.id) ?? emptyCounts())), total };
}

async function replay(existing: Campaign, requestHash: string, userId: string) {
  if (existing.requestHash !== requestHash) {
    throw AppError.conflict("This Idempotency-Key was already used for a different request");
  }
  return { campaign: await getCampaign(userId, existing.id), replayed: true };
}

function findByKey(userId: string, idempotencyKey: string) {
  return prisma.campaign.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
}

export async function createCampaign(
  user: AuthenticatedUser,
  idempotencyKey: string,
  request: CampaignRequest,
): Promise<{ campaign: CampaignView; replayed: boolean }> {
  const requestHash = campaignRequestHash(request);
  const existing = await findByKey(user.id, idempotencyKey);
  if (existing) {
    return replay(existing, requestHash, user.id);
  }

  const sender = await getOwnedSender(user.id, request.senderId);
  const { recipients, invalid, duplicates } = checkRecipients(request.recipients);
  if (invalid.length > 0) {
    throw new AppError(400, "VALIDATION_ERROR", `${invalid.length} recipient addresses are invalid`, {
      details: { invalid: invalid.slice(0, 20) },
    });
  }

  let startAt: Date;
  try {
    startAt = resolveStartAt(request.startAt, new Date(), START_TIME_PAST_TOLERANCE_MS);
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Start time cannot be in the past", {
      details: [{ path: "startAt", message: "Start time cannot be in the past" }],
    });
  }
  const sendTimes = planSendTimes(startAt, recipients.length, request.delayBetweenMs);

  let created: { campaign: Campaign; emails: SchedulableEmail[] };
  try {
    created = await prisma.$transaction(
      async (tx) => {
        const campaign = await tx.campaign.create({
          data: {
            userId: user.id,
            senderId: sender.id,
            idempotencyKey,
            requestHash,
            subject: request.subject,
            body: request.body,
            startAt,
            delayBetweenMs: request.delayBetweenMs,
            hourlyLimit: request.hourlyLimit,
            totalRecipients: recipients.length,
          },
        });

        const emails: SchedulableEmail[] = [];
        for (let offset = 0; offset < recipients.length; offset += INSERT_CHUNK_SIZE) {
          const rows = await tx.email.createManyAndReturn({
            data: recipients.slice(offset, offset + INSERT_CHUNK_SIZE).map((recipientEmail, index) => {
              const sendAt = sendTimes[offset + index] ?? startAt;
              return {
                campaignId: campaign.id,
                userId: user.id,
                senderId: sender.id,
                recipientEmail,
                sequence: offset + index,
                scheduledAt: sendAt,
                nextAttemptAt: sendAt,
              };
            }),
            select: { id: true, nextAttemptAt: true },
          });
          await tx.emailEvent.createMany({
            data: rows.map((row) => ({
              emailId: row.id,
              type: "scheduled" as const,
              metadata: { scheduledAt: row.nextAttemptAt.toISOString() },
            })),
          });
          emails.push(...rows);
        }
        return { campaign, emails };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await findByKey(user.id, idempotencyKey);
      if (winner) {
        return replay(winner, requestHash, user.id);
      }
    }
    throw error;
  }

  logger.info(
    {
      userId: user.id,
      campaignId: created.campaign.id,
      senderId: sender.id,
      recipients: recipients.length,
      duplicatesRemoved: duplicates,
      startAt: startAt.toISOString(),
      delayBetweenMs: request.delayBetweenMs,
      hourlyLimit: request.hourlyLimit,
    },
    "Emails scheduled",
  );

  try {
    await enqueueEmailSends(created.emails);
  } catch (error) {
    logger.error(
      { err: error, campaignId: created.campaign.id },
      "Emails saved but queueing failed, the worker reconciliation will enqueue them",
    );
  }
  await enqueueSearchIndex(created.emails.map((email) => email.id));

  return { campaign: await getCampaign(user.id, created.campaign.id), replayed: false };
}
