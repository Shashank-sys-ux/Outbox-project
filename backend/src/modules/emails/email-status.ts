import type { EmailStatus } from "../../generated/prisma/enums.js";

const ALLOWED_TRANSITIONS: Readonly<Record<EmailStatus, readonly EmailStatus[]>> = {
  scheduled: ["processing", "rate_limited"],
  rate_limited: ["processing", "scheduled"],
  processing: ["sent", "failed", "scheduled", "rate_limited"],
  sent: [],
  failed: [],
};

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS) as EmailStatus[];

export const CLAIMABLE_STATUSES: readonly EmailStatus[] = ALL_STATUSES.filter(
  (status) => status !== "processing" && ALLOWED_TRANSITIONS[status].includes("processing"),
);

export const PENDING_STATUSES: readonly EmailStatus[] = ["scheduled", "rate_limited", "processing"];

export const SCHEDULED_VIEW_STATUSES: readonly EmailStatus[] = ["scheduled", "processing", "rate_limited"];

export const SENT_VIEW_STATUSES: readonly EmailStatus[] = ["sent", "failed"];

export class InvalidStatusTransitionError extends Error {
  constructor(
    readonly from: EmailStatus,
    readonly to: EmailStatus,
  ) {
    super(`Email status cannot change from ${from} to ${to}`);
    this.name = "InvalidStatusTransitionError";
  }
}

export function canTransition(from: EmailStatus, to: EmailStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: EmailStatus, to: EmailStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

export function isTerminalStatus(status: EmailStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
