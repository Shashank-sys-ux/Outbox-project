import { Router } from "express";
import { appOrigin } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { requireAuth, requireAuthOrRedirect } from "../../middleware/authenticate.js";
import { AppError } from "../../utils/errors.js";
import { queryString, requireUser } from "../../utils/http.js";
import type { OAuthStateStore } from "../auth/oauth-state.store.js";
import { SlackApiError } from "./slack.client.js";
import {
  completeSlackInstall,
  disconnectSlack,
  getSlackStatus,
  sendSlackTestMessage,
  slackOAuth,
  startSlackInstall,
} from "./slack.service.js";

export function createSlackRouter(states: OAuthStateStore): Router {
  const router = Router();
  const settingsUrl = (result: string) => `${appOrigin}/settings?slack=${encodeURIComponent(result)}`;

  router.get("/status", requireAuth, async (req, res) => {
    res.json({ data: await getSlackStatus(requireUser(req).id) });
  });

  router.get("/install", requireAuthOrRedirect, async (req, res) => {
    if (!slackOAuth) {
      res.redirect(settingsUrl("not_configured"));
      return;
    }
    res.redirect(await startSlackInstall(states, requireUser(req).id));
  });

  router.get("/callback", async (req, res) => {
    const providerError = queryString(req, "error");
    const code = queryString(req, "code");
    const state = queryString(req, "state");
    if (providerError || !code || !state) {
      logger.warn({ providerError }, "Slack authorization was cancelled or incomplete");
      res.redirect(settingsUrl(providerError === "access_denied" ? "denied" : "error"));
      return;
    }
    try {
      await completeSlackInstall(states, { state, code, sessionUserId: req.user?.id });
      res.redirect(settingsUrl("connected"));
    } catch (error) {
      const reason = error instanceof SlackApiError ? error.slackError : error instanceof AppError ? error.code : "error";
      logger.error({ err: error, reason }, "Slack connection failed");
      res.redirect(settingsUrl("error"));
    }
  });

  router.post("/test", requireAuth, async (req, res) => {
    await sendSlackTestMessage(requireUser(req).id);
    res.json({ data: { sent: true } });
  });

  router.delete("/connection", requireAuth, async (req, res) => {
    await disconnectSlack(requireUser(req).id);
    res.status(204).end();
  });

  return router;
}
