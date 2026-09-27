import { pino } from "pino";
import { env } from "../config/env.js";

const MAX_ERROR_DEPTH = 3;
const MAX_AGGREGATED_ERRORS = 5;

interface SerializedError {
  type: string;
  message: string;
  stack?: string;
  code?: string | number;
  statusCode?: number;
  cause?: SerializedError | string;
  errors?: Array<SerializedError | string>;
}

export function serializeError(value: unknown, depth = 0): SerializedError | string {
  if (typeof value !== "object" || value === null) {
    return String(value);
  }

  const source = value as Record<string, unknown>;
  const type =
    value instanceof Error ? value.constructor.name : typeof source.type === "string" ? source.type : "Error";
  const serialized: SerializedError = {
    type,
    message: typeof source.message === "string" ? source.message : "",
  };

  if (typeof source.stack === "string") {
    serialized.stack = source.stack;
  }
  if (typeof source.code === "string" || typeof source.code === "number") {
    serialized.code = source.code;
  }
  if (typeof source.statusCode === "number") {
    serialized.statusCode = source.statusCode;
  }
  if (depth < MAX_ERROR_DEPTH && source.cause !== undefined) {
    serialized.cause = serializeError(source.cause, depth + 1);
  }
  if (depth < MAX_ERROR_DEPTH && Array.isArray(source.errors)) {
    serialized.errors = source.errors
      .slice(0, MAX_AGGREGATED_ERRORS)
      .map((nested) => serializeError(nested, depth + 1));
  }

  return serialized;
}

export const logger = pino({
  level: env.LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: serializeError,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.idToken",
      "*.clientSecret",
      "*.webhookUrl",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});
