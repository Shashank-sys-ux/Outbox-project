import type { ErrorCode } from "../utils/errors.js";

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}
