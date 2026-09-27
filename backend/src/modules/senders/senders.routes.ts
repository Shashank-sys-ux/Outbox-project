import { Router } from "express";
import { z } from "zod";
import { requireUser, routeParam } from "../../utils/http.js";
import {
  createEtherealSender,
  createSmtpSender,
  deleteSender,
  listSenders,
  sendTestEmail,
} from "./senders.service.js";

const createSmtpSenderSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.email().max(254),
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().trim().min(1).max(254),
  smtpPassword: z.string().min(1).max(500),
});

const createEtherealSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
});

const testEmailSchema = z.object({
  to: z.email().max(254).optional(),
});

export function createSendersRouter(): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    res.json({ data: await listSenders(requireUser(req).id) });
  });

  router.post("/", async (req, res) => {
    const input = createSmtpSenderSchema.parse(req.body);
    res.status(201).json({ data: await createSmtpSender(requireUser(req).id, input) });
  });

  router.post("/ethereal", async (req, res) => {
    const input = createEtherealSchema.parse(req.body ?? {});
    res.status(201).json({ data: await createEtherealSender(requireUser(req).id, input.displayName) });
  });

  router.post("/:senderId/test", async (req, res) => {
    const user = requireUser(req);
    const input = testEmailSchema.parse(req.body ?? {});
    res.json({ data: await sendTestEmail(user.id, routeParam(req, "senderId"), input.to ?? user.email) });
  });

  router.delete("/:senderId", async (req, res) => {
    await deleteSender(requireUser(req).id, routeParam(req, "senderId"));
    res.status(204).end();
  });

  return router;
}
