import { sha256Hex } from "../../utils/crypto.js";
import { isValidEmail, normalizeEmail } from "../leads/email-parser.js";

export interface CampaignRequest {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delayBetweenMs: number;
  hourlyLimit: number;
}

export interface RecipientCheck {
  recipients: string[];
  invalid: string[];
  duplicates: number;
}

export function planSendTimes(startAt: Date, count: number, delayBetweenMs: number): Date[] {
  const start = startAt.getTime();
  return Array.from({ length: count }, (_, index) => new Date(start + index * delayBetweenMs));
}

export function checkRecipients(values: string[]): RecipientCheck {
  const seen = new Set<string>();
  const recipients: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const value of values) {
    const email = normalizeEmail(value);
    if (!isValidEmail(email)) {
      invalid.push(value);
      continue;
    }
    if (seen.has(email)) {
      duplicates += 1;
      continue;
    }
    seen.add(email);
    recipients.push(email);
  }
  return { recipients, invalid, duplicates };
}

export function resolveStartAt(startAt: string, now: Date, pastToleranceMs: number): Date {
  const requested = new Date(startAt);
  if (requested.getTime() < now.getTime() - pastToleranceMs) {
    throw new RangeError("Start time is in the past");
  }
  return requested.getTime() < now.getTime() ? now : requested;
}

export function campaignRequestHash(request: CampaignRequest): string {
  return sha256Hex(
    JSON.stringify([
      request.senderId,
      request.subject,
      request.body,
      request.recipients.map(normalizeEmail),
      new Date(request.startAt).toISOString(),
      request.delayBetweenMs,
      request.hourlyLimit,
    ]),
  );
}
