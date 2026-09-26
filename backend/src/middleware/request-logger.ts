import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import { logger } from "../infra/logger.js";

const REQUEST_ID_HEADER = "x-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

function pathWithoutQuery(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
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
    ignore: (req) => pathWithoutQuery(req.url).startsWith("/api/health"),
  },
  customLogLevel(_req, res, error) {
    if (error || res.statusCode >= 500) {
      return "error";
    }
    if (res.statusCode >= 400) {
      return "warn";
    }
    return "info";
  },
  customSuccessMessage(req, res, responseTime) {
    return `${req.method} ${pathWithoutQuery(req.url)} ${res.statusCode} ${Math.round(responseTime)}ms`;
  },
  customErrorMessage(req, res) {
    return `${req.method} ${pathWithoutQuery(req.url)} ${res.statusCode} failed`;
  },
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      path: pathWithoutQuery(req.url),
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
});
