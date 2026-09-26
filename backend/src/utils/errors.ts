export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, "BAD_REQUEST", message, { details });
  }

  static unauthenticated(message = "Authentication required"): AppError {
    return new AppError(401, "UNAUTHENTICATED", message);
  }

  static forbidden(message = "You do not have access to this resource"): AppError {
    return new AppError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found"): AppError {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, "CONFLICT", message, { details });
  }

  static serviceUnavailable(message = "Service temporarily unavailable", cause?: unknown): AppError {
    return new AppError(503, "SERVICE_UNAVAILABLE", message, { cause });
  }
}
