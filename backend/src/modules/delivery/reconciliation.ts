import type { Queue } from "bullmq";
import type { Logger } from "pino";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { enqueueEmailSends, type SchedulableEmail } from "../../queues/producers.js";
import type { SendEmailJobData } from "../../queues/queue.types.js";
import { PENDING_STATUSES } from "../emails/email-status.js";

export interface ReconciliationResult {
  checked: number;
  requeued: number;
  replaced: number;
}

export async function reconcilePendingEmails(options: {
  db: PrismaClient;
  queue: Queue<SendEmailJobData>;
  logger: Logger;
  batchSize?: number;
}): Promise<ReconciliationResult> {
  const { db, queue, logger } = options;
  const batchSize = options.batchSize ?? 500;
  const result: ReconciliationResult = { checked: 0, requeued: 0, replaced: 0 };
  let cursor: string | undefined;

  for (;;) {
    const rows = await db.email.findMany({
      where: { status: { in: [...PENDING_STATUSES] } },
      select: { id: true, nextAttemptAt: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) {
      break;
    }
    cursor = rows[rows.length - 1]?.id;
    result.checked += rows.length;

    const missing: SchedulableEmail[] = [];
    await Promise.all(
      rows.map(async (row) => {
        const job = await queue.getJob(row.id);
        if (!job) {
          missing.push(row);
          return;
        }
        const state = await job.getState();
        if (state === "completed" || state === "failed" || state === "unknown") {
          await job.remove();
          result.replaced += 1;
          missing.push(row);
        }
      }),
    );

    if (missing.length > 0) {
      await enqueueEmailSends(missing);
      result.requeued += missing.length;
    }
  }

  if (result.requeued > 0) {
    logger.warn(result, "Reconciliation re-queued emails that had no live job");
  } else {
    logger.info(result, "Reconciliation found every pending email already queued");
  }
  return result;
}
