import type { Prisma } from "../../generated/prisma/client.js";
import type { EmailStatus } from "../../generated/prisma/enums.js";
import { prisma } from "../../infra/prisma.js";
import { AppError } from "../../utils/errors.js";
import { SCHEDULED_VIEW_STATUSES, SENT_VIEW_STATUSES } from "./email-status.js";

export type EmailView = "scheduled" | "sent";

export interface EmailListItem {
  id: string;
  campaignId: string;
  recipientEmail: string;
  subject: string;
  snippet: string;
  status: EmailStatus;
  scheduledAt: string;
  nextAttemptAt: string;
  completedAt: string | null;
  attempts: number;
  lastError: string | null;
  previewUrl: string | null;
  sender: { id: string; email: string; displayName: string };
}

export interface EmailEventItem {
  id: string;
  type: string;
  message: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface EmailDetail extends EmailListItem {
  body: string;
  messageId: string | null;
  events: EmailEventItem[];
}

const SNIPPET_LENGTH = 160;

export function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH - 1)}…` : flat;
}

const emailSelect = {
  id: true,
  campaignId: true,
  recipientEmail: true,
  status: true,
  scheduledAt: true,
  nextAttemptAt: true,
  completedAt: true,
  attempts: true,
  lastError: true,
  previewUrl: true,
  sender: { select: { id: true, email: true, displayName: true } },
} satisfies Prisma.EmailSelect;

type SelectedEmail = Prisma.EmailGetPayload<{ select: typeof emailSelect }>;

function toListItem(email: SelectedEmail, campaign: { subject: string; body: string }): EmailListItem {
  return {
    id: email.id,
    campaignId: email.campaignId,
    recipientEmail: email.recipientEmail,
    subject: campaign.subject,
    snippet: snippetOf(campaign.body),
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    nextAttemptAt: email.nextAttemptAt.toISOString(),
    completedAt: email.completedAt?.toISOString() ?? null,
    attempts: email.attempts,
    lastError: email.lastError,
    previewUrl: email.previewUrl,
    sender: email.sender,
  };
}

async function campaignsById(ids: string[]) {
  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, subject: true, body: true },
  });
  return new Map(campaigns.map((campaign) => [campaign.id, campaign]));
}

export function statusesForView(view: EmailView, status?: EmailStatus): EmailStatus[] {
  const allowed = view === "scheduled" ? SCHEDULED_VIEW_STATUSES : SENT_VIEW_STATUSES;
  if (status) {
    if (!allowed.includes(status)) {
      throw AppError.badRequest(`Status ${status} is not part of the ${view} view`);
    }
    return [status];
  }
  return [...allowed];
}

export async function listEmails(
  userId: string,
  options: { view: EmailView; status?: EmailStatus; campaignId?: string; page: number; pageSize: number },
): Promise<{ items: EmailListItem[]; total: number }> {
  const where: Prisma.EmailWhereInput = {
    userId,
    status: { in: statusesForView(options.view, options.status) },
    ...(options.campaignId ? { campaignId: options.campaignId } : {}),
  };
  const orderBy: Prisma.EmailOrderByWithRelationInput[] =
    options.view === "scheduled"
      ? [{ nextAttemptAt: "asc" }, { sequence: "asc" }]
      : [{ completedAt: "desc" }, { id: "desc" }];

  const [total, emails] = await Promise.all([
    prisma.email.count({ where }),
    prisma.email.findMany({
      where,
      select: emailSelect,
      orderBy,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
  ]);
  const campaigns = await campaignsById(emails.map((email) => email.campaignId));
  const items = emails.map((email) =>
    toListItem(email, campaigns.get(email.campaignId) ?? { subject: "", body: "" }),
  );
  return { items, total };
}

export async function getEmail(userId: string, emailId: string): Promise<EmailDetail> {
  const email = await prisma.email.findFirst({
    where: { id: emailId, userId },
    select: {
      ...emailSelect,
      messageId: true,
      campaign: { select: { subject: true, body: true } },
      events: { orderBy: { createdAt: "asc" }, take: 200 },
    },
  });
  if (!email) {
    throw AppError.notFound("Email not found");
  }
  return {
    ...toListItem(email, email.campaign),
    body: email.campaign.body,
    messageId: email.messageId,
    events: email.events.map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function emailStats(userId: string) {
  const rows = await prisma.email.groupBy({
    by: ["status"],
    where: { userId },
    _count: { _all: true },
  });
  const byStatus: Record<EmailStatus, number> = { scheduled: 0, processing: 0, rate_limited: 0, sent: 0, failed: 0 };
  for (const row of rows) {
    byStatus[row.status] = row._count._all;
  }
  return {
    scheduled: byStatus.scheduled + byStatus.processing + byStatus.rate_limited,
    sent: byStatus.sent + byStatus.failed,
    byStatus,
  };
}
