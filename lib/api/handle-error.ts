import { ApiUnavailableError } from "./data";
import { apiError } from "./errors";

/**
 * The single failure path for every read-API route.
 *
 * Two rules, both learned by actually calling the endpoints with the
 * database unreachable:
 *
 * 1. **Never echo an internal error message to a consumer.** The first
 *    version returned `"TypeError: fetch failed"`, which tells a caller
 *    nothing useful and tells an attacker something about the stack. The
 *    detail goes to the server log; the caller gets a stable sentence.
 *
 * 2. **A database we cannot reach is 503, not 500.** 500 says "this request
 *    was broken"; 503 says "try again shortly", which is the truth when the
 *    content store is down or a free-tier project has paused. It is also the
 *    difference between a consumer retrying and a consumer giving up.
 */
export function handleApiError(error: unknown, context: string) {
  if (error instanceof ApiUnavailableError) {
    return apiError("not_configured", error.message);
  }

  const message = error instanceof Error ? error.message : String(error);

  if (isUpstreamOutage(message)) {
    console.error(`[api] ${context}: content store unreachable —`, message);
    return apiError(
      "store_unavailable",
      "The content store is temporarily unreachable. Try again shortly.",
    );
  }

  console.error(`[api] ${context}:`, error);
  return apiError(
    "internal_error",
    "Something went wrong handling this request.",
  );
}

/** Network-level failures reaching Postgres/PostgREST. */
function isUpstreamOutage(message: string): boolean {
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(
    message,
  );
}
