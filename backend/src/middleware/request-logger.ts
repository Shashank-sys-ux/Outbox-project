import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { pinoHttp } from "pino-http";
import { logger, serializeError } from "../infra/logger.js";

const REQUEST_ID_HEADER = "x-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function pathWithoutQuery(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
}

function fullPath(req: IncomingMessage): string {
  return pathWithoutQuery((req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url);
}

export const requestLogger = pinoHttp({
  logger,
  genReqId(req, res) {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);
    return requestId;
  },
  autoLogging: {
    ignore: (req) => fullPath(req).startsWith("/api/health"),
  },
  customLogLevel(req, res, error) {
    if (error || res.statusCode >= 500) {
      return "error";
    }
    if (res.statusCode >= 400) {
      return "warn";
    }
    return READ_METHODS.has(req.method ?? "") ? "debug" : "info";
  },
  customSuccessMessage(req, res, responseTime) {
    return `${req.method} ${fullPath(req)} ${res.statusCode} ${Math.round(responseTime)}ms`;
  },
  customErrorMessage(req, res) {
    return `${req.method} ${fullPath(req)} ${res.statusCode} failed`;
  },
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      path: pathWithoutQuery(req.url),
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    err: serializeError,
  },
});
