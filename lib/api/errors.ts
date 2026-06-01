/**
 * Normalized error model (docs/03 §7.6). Every failure becomes one shape so the
 * UI can branch on `kind` uniformly (toast vs inline vs banner vs boundary).
 */

export type AppErrorKind =
  | "network"
  | "auth"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limit"
  | "provider"
  | "conflict"
  | "server"
  | "budget_exceeded"
  | "unknown";

export interface AppErrorShape {
  kind: AppErrorKind;
  status?: number;
  message: string;
  detail?: string;
  fields?: Record<string, string>;
  retryable: boolean;
  retryAfterMs?: number;
  traceId?: string;
}

export class AppError extends Error implements AppErrorShape {
  kind: AppErrorKind;
  status?: number;
  detail?: string;
  fields?: Record<string, string>;
  retryable: boolean;
  retryAfterMs?: number;
  traceId?: string;

  constructor(shape: AppErrorShape) {
    super(shape.message);
    this.name = "AppError";
    this.kind = shape.kind;
    this.status = shape.status;
    this.detail = shape.detail;
    this.fields = shape.fields;
    this.retryable = shape.retryable;
    this.retryAfterMs = shape.retryAfterMs;
    this.traceId = shape.traceId;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

const STATUS_TO_KIND: Record<number, AppErrorKind> = {
  400: "validation",
  401: "auth",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limit",
  500: "server",
  502: "provider",
  503: "provider",
  504: "provider",
};

const DEFAULT_MESSAGES: Record<AppErrorKind, string> = {
  network: "Network error — check your connection.",
  auth: "Your session has expired. Please sign in again.",
  forbidden: "You don't have permission to do that.",
  not_found: "This resource doesn't exist or was deleted.",
  validation: "Some fields need attention.",
  rate_limit: "Too many requests — please slow down.",
  provider: "An upstream model/tool provider is unavailable.",
  conflict: "This was updated by someone else. Reload to see the latest.",
  server: "Something went wrong on our side.",
  budget_exceeded: "This run hit its cost cap.",
  unknown: "An unexpected error occurred.",
};

const RETRYABLE: ReadonlySet<AppErrorKind> = new Set([
  "network",
  "rate_limit",
  "provider",
  "server",
]);

/** Build an AppError from a failed Response (used by the api client). */
export async function normalizeResponse(res: Response): Promise<AppError> {
  const kind = STATUS_TO_KIND[res.status] ?? (res.status >= 500 ? "server" : "unknown");
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  const retryAfter = res.headers.get("retry-after");
  return new AppError({
    kind,
    status: res.status,
    message: (body.message as string) ?? DEFAULT_MESSAGES[kind],
    detail: body.detail as string | undefined,
    fields: body.fields as Record<string, string> | undefined,
    retryable: RETRYABLE.has(kind),
    retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
    traceId: (body.traceId as string) ?? res.headers.get("x-trace-id") ?? undefined,
  });
}

/** Coerce any thrown value (network error, AppError, unknown) into an AppError. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof DOMException && e.name === "AbortError") {
    return new AppError({ kind: "network", message: "Request was cancelled.", retryable: false });
  }
  if (e instanceof TypeError) {
    return new AppError({ kind: "network", message: DEFAULT_MESSAGES.network, retryable: true });
  }
  return new AppError({
    kind: "unknown",
    message: e instanceof Error ? e.message : DEFAULT_MESSAGES.unknown,
    retryable: false,
  });
}
