import type { ApiErrorPayload } from "../types/api";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, payload: Partial<ApiErrorPayload>) {
    super(payload.message ?? "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code ?? "UNKNOWN";
    this.details = payload.details;
    this.requestId = payload.requestId;
  }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => undefined;

export function setUnauthorizedHandler(handler: Unauthorized): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (options.body !== undefined && !isForm) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.body === undefined
        ? {}
        : { body: isForm ? (options.body as FormData) : JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "Cannot reach the server. Check your connection." });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json().catch(() => null)) as { data?: T; error?: ApiErrorPayload } | null;
  if (!response.ok) {
    if (response.status === 401) {
      onUnauthorized();
    }
    throw new ApiError(response.status, payload?.error ?? { message: `Request failed with status ${response.status}` });
  }
  return payload?.data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong";
}
