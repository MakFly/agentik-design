import { toast } from "sonner";
import { apiErrorMessage, isAppError, toAppError } from "./errors";

/** Human-readable message from any thrown API / network error. */
export { apiErrorMessage };

/** Show a sonner toast from a failed mutation or fetch. */
export function toastApiError(e: unknown, fallback = "Something went wrong") {
  const err = toAppError(e);
  const message = apiErrorMessage(e) || fallback;
  toast.error(message, err.detail ? { description: err.detail } : undefined);
}

export function toastApiSuccess(message: string) {
  toast.success(message);
}

/** React Query `onError` handler shorthand. */
export function onMutationError(fallback?: string) {
  return (e: unknown) => toastApiError(e, fallback);
}

export function isForbiddenError(e: unknown): boolean {
  return isAppError(e) && e.kind === "forbidden";
}
