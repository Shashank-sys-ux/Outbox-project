import type { RequestHandler } from "express";
import { appOrigin } from "../config/env.js";
import { findUserById, toAuthenticatedUser } from "../modules/auth/auth.service.js";
import { SESSION_COOKIE, type SessionService } from "../modules/auth/session.service.js";
import { AppError } from "../utils/errors.js";

export function loadSession(sessions: SessionService): RequestHandler {
  return async (req, _res, next) => {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const session = await sessions.resolve(cookies?.[SESSION_COOKIE]);
    if (session) {
      const user = await findUserById(session.userId);
      if (user) {
        req.sessionId = session.sessionId;
        req.user = toAuthenticatedUser(user);
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  if (!req.user.isAdmin) {
    throw AppError.forbidden("Admin access is required. Add your email to ADMIN_EMAILS.");
  }
  next();
};

export const requireAuthOrRedirect: RequestHandler = (req, res, next) => {
  if (!req.user) {
    const returnTo = encodeURIComponent(req.originalUrl);
    res.redirect(`${appOrigin}/login?returnTo=${returnTo}`);
    return;
  }
  next();
};
