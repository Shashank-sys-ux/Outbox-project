import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Router, type RequestHandler } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { prisma } from "../../infra/prisma.js";
import { getQueues } from "../../queues/queues.js";
import { reconcilePendingEmails } from "../delivery/reconciliation.js";

export const BULL_BOARD_PATH = "/admin/queues";

export function createBullBoardHandler(): RequestHandler {
  let router: RequestHandler | undefined;
  return (req, res, next) => {
    if (!router) {
      const serverAdapter = new ExpressAdapter();
      serverAdapter.setBasePath(BULL_BOARD_PATH);
      createBullBoard({
        queues: getQueues()
          .all()
          .map((queue) => new BullMQAdapter(queue, { readOnlyMode: env.BULL_BOARD_READ_ONLY })),
        serverAdapter,
        options: { uiConfig: { boardTitle: "Outbox Queues" } },
      });
      router = serverAdapter.getRouter() as RequestHandler;
    }
    router(req, res, next);
  };
}

export function createAdminRouter(): Router {
  const router = Router();

  router.get("/queues/summary", async (_req, res) => {
    const queues = getQueues().all();
    const counts = await Promise.all(
      queues.map(async (queue) => ({
        name: queue.name,
        counts: await queue.getJobCounts("waiting", "delayed", "active", "completed", "failed"),
      })),
    );
    res.json({ data: counts });
  });

  router.post("/reconcile", async (req, res) => {
    const result = await reconcilePendingEmails({
      db: prisma,
      queue: getQueues().emailSend,
      logger: logger.child({ component: "reconciliation", triggeredBy: req.user?.id }),
    });
    res.json({ data: result });
  });

  return router;
}
