import { Router } from "express";
import { z } from "zod";
import { requireUser, routeParam } from "../../utils/http.js";
import { emailStats, getEmail, listEmails } from "./emails.service.js";

const listSchema = z.object({
  view: z.enum(["scheduled", "sent"]).default("scheduled"),
  status: z.enum(["scheduled", "processing", "rate_limited", "sent", "failed"]).optional(),
  campaignId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function createEmailsRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const query = listSchema.parse(req.query);
    const { items, total } = await listEmails(requireUser(req).id, {
      view: query.view,
      page: query.page,
      pageSize: query.pageSize,
      ...(query.status ? { status: query.status } : {}),
      ...(query.campaignId ? { campaignId: query.campaignId } : {}),
    });
    res.json({ data: { items, total, page: query.page, pageSize: query.pageSize } });
  });

  router.get("/stats", async (req, res) => {
    res.json({ data: await emailStats(requireUser(req).id) });
  });

  router.get("/:emailId", async (req, res) => {
    res.json({ data: await getEmail(requireUser(req).id, routeParam(req, "emailId")) });
  });

  return router;
}
