import type { Request } from "express";
import type { z } from "zod";
import { AppError } from "./errors.js";

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function requireUser(req: Request) {
  if (!req.user) {
    throw AppError.unauthenticated();
  }
  return req.user;
}

export function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw AppError.badRequest(`Missing route parameter ${name}`);
  }
  return value;
}

export function safeReturnTo(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length > 300) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}
