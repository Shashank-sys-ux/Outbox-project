import type { RequestHandler } from "express";
import { AppError } from "../utils/errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return "invalid";
  }
}

export function originCheck(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = originOf(req.headers.origin) ?? originOf(req.headers.referer);
    if (origin !== null && !allowed.has(origin)) {
      throw AppError.forbidden("Cross-site request blocked");
    }
    next();
  };
}
