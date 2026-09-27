import type { Request, RequestHandler } from "express";
import type { Redis } from "ioredis";
import { logger } from "../infra/logger.js";
import { AppError } from "../utils/errors.js";

export interface RateLimitOptions {
  redis: Redis;
  name: string;
  limit: number;
  windowSeconds: number;
  identify?: (req: Request) => string;
}

function defaultIdentity(req: Request): string {
  return req.user ? `user:${req.user.id}` : `ip:${req.ip ?? "unknown"}`;
}

export function rateLimit({ redis, name, limit, windowSeconds, identify = defaultIdentity }: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const windowIndex = Math.floor(Date.now() / 1000 / windowSeconds);
    const resetAt = (windowIndex + 1) * windowSeconds;
    const key = `api_rl:${name}:${identify(req)}:${windowIndex}`;

    let count: number;
    try {
      const results = await redis.multi().incr(key).expire(key, windowSeconds + 1).exec();
      count = Number(results?.[0]?.[1] ?? 0);
    } catch (error) {
      logger.warn({ err: error, limiter: name }, "Rate limiter unavailable, allowing request");
      next();
      return;
    }

    const remaining = Math.max(0, limit - count);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.max(0, resetAt - Math.floor(Date.now() / 1000))));

    if (count > limit) {
      res.setHeader("Retry-After", String(Math.max(1, resetAt - Math.floor(Date.now() / 1000))));
      throw new AppError(429, "RATE_LIMITED", "Too many requests, please slow down");
    }
    next();
  };
}
