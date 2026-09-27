import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";
import { requireUser, routeParam } from "../../utils/http.js";
import { createCampaign, getCampaign, listCampaigns } from "./campaigns.service.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

export const createCampaignSchema = z.object({
  senderId: z.uuid(),
  subject: z.string().trim().min(1, "Subject is required").max(500),
  body: z
    .string()
    .max(100_000)
    .refine((value) => value.trim().length > 0, "Body is required"),
  recipients: z
    .array(z.string().max(320))
    .min(1, "Add at least one recipient")
    .max(env.MAX_RECIPIENTS_PER_CAMPAIGN, `At most ${env.MAX_RECIPIENTS_PER_CAMPAIGN} recipients per campaign`),
  startAt: z.iso.datetime({ offset: true }).refine((value) => {
    const time = new Date(value).getTime();
    return time <= Date.now() + 365 * 24 * 60 * 60 * 1000;
  }, "Start time must be within the next year"),
  delayBetweenMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  hourlyLimit: z
    .number()
    .int()
    .min(1)
    .max(env.MAX_EMAILS_PER_HOUR_PER_SENDER, `Hourly limit cannot exceed ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}`),
});

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function createCampaignsRouter(): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const user = requireUser(req);
    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw AppError.badRequest("A valid Idempotency-Key header (8-100 letters, digits, - or _) is required");
    }
    const input = createCampaignSchema.parse(req.body);
    const { campaign, replayed } = await createCampaign(user, idempotencyKey, input);
    if (replayed) {
      res.setHeader("Idempotent-Replayed", "true");
    }
    res.status(replayed ? 200 : 201).json({ data: campaign });
  });

  router.get("/", async (req, res) => {
    const { page, pageSize } = pageSchema.parse(req.query);
    const { items, total } = await listCampaigns(requireUser(req).id, page, pageSize);
    res.json({ data: { items, total, page, pageSize } });
  });

  router.get("/:campaignId", async (req, res) => {
    res.json({ data: await getCampaign(requireUser(req).id, routeParam(req, "campaignId")) });
  });

  return router;
}
