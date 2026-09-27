import { Router } from "express";
import { z } from "zod";
import { logger } from "../../infra/logger.js";
import { AppError } from "../../utils/errors.js";
import { requireUser } from "../../utils/http.js";
import { statusesForView } from "../emails/emails.service.js";
import { SearchUnavailableError, type EmailSearchIndex } from "./email-search.index.js";

const searchSchema = z.object({
  q: z.string().max(200).default(""),
  view: z.enum(["scheduled", "sent", "all"]).default("all"),
  status: z.enum(["scheduled", "processing", "rate_limited", "sent", "failed"]).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function createSearchRouter(index: EmailSearchIndex): Router {
  const router = Router();

  router.get("/emails", async (req, res) => {
    const user = requireUser(req);
    const params = searchSchema.parse(req.query);
    const statuses =
      params.view === "all" ? (params.status ? [params.status] : []) : statusesForView(params.view, params.status);
    try {
      const result = await index.search({
        userId: user.id,
        query: params.q,
        statuses,
        page: params.page,
        pageSize: params.pageSize,
      });
      res.json({ data: { ...result, page: params.page, pageSize: params.pageSize, source: "elasticsearch" } });
    } catch (error) {
      if (error instanceof SearchUnavailableError) {
        logger.warn({ err: error.cause }, "Search request failed because Elasticsearch is unavailable");
        throw AppError.serviceUnavailable("Search is temporarily unavailable. Your emails are still being delivered.");
      }
      throw error;
    }
  });

  return router;
}
