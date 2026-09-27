import { Router } from "express";
import multer from "multer";
import { extname } from "node:path";
import { z } from "zod";
import { env } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { AppError } from "../../utils/errors.js";
import { requireUser } from "../../utils/http.js";
import { looksLikeText, parseEmailList } from "./email-parser.js";

const ALLOWED_EXTENSIONS = new Set([".csv", ".txt"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_EXTENSIONS.has(extname(file.originalname).toLowerCase())) {
      callback(AppError.badRequest("Only .csv and .txt files are supported"));
      return;
    }
    callback(null, true);
  },
});

const pastedTextSchema = z.object({
  text: z.string().max(env.UPLOAD_MAX_BYTES),
});

export function createLeadsRouter(): Router {
  const router = Router();

  router.post("/parse", upload.single("file"), (req, res) => {
    const user = requireUser(req);
    let text: string;
    let source: string;

    if (req.file) {
      if (req.file.size === 0) {
        throw AppError.badRequest("The uploaded file is empty");
      }
      if (!looksLikeText(req.file.buffer)) {
        throw AppError.badRequest("The uploaded file does not look like CSV or plain text");
      }
      text = new TextDecoder("utf-8").decode(req.file.buffer);
      source = req.file.originalname;
    } else {
      text = pastedTextSchema.parse(req.body).text;
      source = "pasted text";
    }

    const result = parseEmailList(text, env.MAX_RECIPIENTS_PER_CAMPAIGN);
    if (result.emails.length === 0) {
      throw AppError.badRequest("No valid email addresses were found", {
        stats: result.stats,
        invalidSamples: result.invalidSamples,
      });
    }

    logger.info({ userId: user.id, source, ...result.stats }, "Recipient list parsed");
    res.json({ data: { ...result, maxRecipients: env.MAX_RECIPIENTS_PER_CAMPAIGN } });
  });

  return router;
}
