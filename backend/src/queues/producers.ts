import { logger } from "../infra/logger.js";
import { JOB_NAMES, type RateLimitAlertJobData } from "./queue.types.js";
import { getQueues } from "./queues.js";

const BULK_CHUNK_SIZE = 500;

export interface SchedulableEmail {
  id: string;
  nextAttemptAt: Date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function sendJobDelay(nextAttemptAt: Date, now = Date.now()): number {
  return Math.max(0, nextAttemptAt.getTime() - now);
}

export async function enqueueEmailSends(emails: SchedulableEmail[]): Promise<void> {
  const queue = getQueues().emailSend;
  for (const batch of chunk(emails, BULK_CHUNK_SIZE)) {
    const now = Date.now();
    await queue.addBulk(
      batch.map((email) => ({
        name: JOB_NAMES.sendEmail,
        data: { emailId: email.id },
        opts: { jobId: email.id, delay: sendJobDelay(email.nextAttemptAt, now) },
      })),
    );
  }
}

export async function enqueueSearchIndex(emailIds: string[]): Promise<void> {
  if (emailIds.length === 0) {
    return;
  }
  try {
    const queue = getQueues().searchIndex;
    for (const batch of chunk(emailIds, BULK_CHUNK_SIZE)) {
      await queue.addBulk(batch.map((emailId) => ({ name: JOB_NAMES.indexEmail, data: { emailId } })));
    }
  } catch (error) {
    logger.warn({ err: error, count: emailIds.length }, "Could not enqueue search indexing, run the reindex script later");
  }
}

export async function enqueueRateLimitAlert(data: RateLimitAlertJobData): Promise<void> {
  const jobId = `rate-limit.${data.scope}.${data.scope === "sender" ? data.senderId : data.campaignId}.${data.windowStart}`;
  await getQueues().notifications.add(JOB_NAMES.rateLimitAlert, data, { jobId });
}
