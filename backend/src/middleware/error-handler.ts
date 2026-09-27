import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import type { ApiErrorBody } from "../types/api.js";
import { AppError } from "../utils/errors.js";

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
}

function isHttpLikeError(error: unknown): error is HttpLikeError {
  return typeof error === "object" && error !== null && ("status" in error || "statusCode" in error);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
      details: error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return new AppError(413, "PAYLOAD_TOO_LARGE", "The uploaded file is too large");
    }
    return new AppError(400, "BAD_REQUEST", `Upload rejected: ${error.message}`);
  }

  if (isHttpLikeError(error)) {
    const status = error.status ?? error.statusCode ?? 500;
    if (error.type === "entity.parse.failed") {
      return new AppError(400, "INVALID_JSON", "Request body is not valid JSON");
    }
    if (error.type === "entity.too.large") {
      return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }
    if (status >= 400 && status < 500) {
      return new AppError(status, "BAD_REQUEST", "The request could not be processed");
    }
  }

  return new AppError(500, "INTERNAL_ERROR", "Something went wrong. Please try again later.", {
    cause: error,
  });
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const appError = toAppError(error);

  if (appError.statusCode >= 500) {
    res.err = error instanceof Error ? error : new Error(String(error));
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId: String(req.id),
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  };

  res.status(appError.statusCode).json(body);
};
