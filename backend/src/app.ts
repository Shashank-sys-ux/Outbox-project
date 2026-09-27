import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { appOrigin, env, features } from "./config/env.js";
import { redis } from "./infra/redis.js";
import { emailSearchIndex } from "./infra/search.js";
import { loadSession, requireAdmin, requireAuth, requireAuthOrRedirect } from "./middleware/authenticate.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { originCheck } from "./middleware/origin-check.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/request-logger.js";
import { BULL_BOARD_PATH, createAdminRouter, createBullBoardHandler } from "./modules/admin/admin.routes.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { OAuthStateStore } from "./modules/auth/oauth-state.store.js";
import { SessionService } from "./modules/auth/session.service.js";
import { createCampaignsRouter } from "./modules/campaigns/campaigns.routes.js";
import { createEmailsRouter } from "./modules/emails/emails.routes.js";
import { createHealthRouter } from "./modules/health/health.routes.js";
import type { HealthCheck } from "./modules/health/health.service.js";
import { createLeadsRouter } from "./modules/leads/leads.routes.js";
import { createSearchRouter } from "./modules/search/search.routes.js";
import { createSendersRouter } from "./modules/senders/senders.routes.js";
import { createSlackRouter } from "./modules/slack/slack.routes.js";

export interface AppDependencies {
  healthChecks: HealthCheck[];
}

export function createApp({ healthChecks }: AppDependencies): Express {
  const app = express();
  const sessions = new SessionService(redis, {
    secret: env.SESSION_SECRET,
    ttlSeconds: env.SESSION_TTL_SECONDS,
    secureCookie: env.COOKIE_SECURE,
  });
  const oauthStates = new OAuthStateStore(redis);
  const ipIdentity = (req: express.Request) => `ip:${req.ip ?? "unknown"}`;

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(requestLogger);
  app.use("/api/health", helmet(), createHealthRouter(healthChecks));

  app.use(cors({ origin: [appOrigin], credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(loadSession(sessions));

  app.use(
    BULL_BOARD_PATH,
    helmet({ contentSecurityPolicy: false }),
    originCheck([appOrigin]),
    requireAuthOrRedirect,
    requireAdmin,
    createBullBoardHandler(),
  );

  app.use(
    "/api",
    helmet(),
    originCheck([appOrigin]),
    rateLimit({ redis, name: "api", limit: env.API_RATE_LIMIT_PER_MINUTE, windowSeconds: 60 }),
  );

  app.get("/api/config", (_req, res) => {
    res.json({
      data: {
        googleAuth: features.googleAuth,
        slack: features.slack,
        limits: {
          minSendDelayMs: env.MIN_SEND_DELAY_MS,
          maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
          rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
          maxRecipientsPerCampaign: env.MAX_RECIPIENTS_PER_CAMPAIGN,
          uploadMaxBytes: env.UPLOAD_MAX_BYTES,
        },
      },
    });
  });

  app.use(
    "/api/auth",
    rateLimit({ redis, name: "auth", limit: env.AUTH_RATE_LIMIT_PER_MINUTE, windowSeconds: 60, identify: ipIdentity }),
    createAuthRouter({ sessions, oauthStates }),
  );
  app.use("/api/senders", requireAuth, createSendersRouter());
  app.use(
    "/api/leads",
    requireAuth,
    rateLimit({ redis, name: "leads", limit: 30, windowSeconds: 60 }),
    createLeadsRouter(),
  );
  app.use("/api/campaigns", requireAuth, createCampaignsRouter());
  app.use("/api/emails", requireAuth, createEmailsRouter());
  app.use("/api/search", requireAuth, createSearchRouter(emailSearchIndex));
  app.use("/api/slack", createSlackRouter(oauthStates));
  app.use("/api/admin", requireAdmin, createAdminRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
