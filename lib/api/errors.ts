import { NextResponse } from "next/server";

/**
 * Error bodies for the read API.
 *
 * One shape for every failure, with a stable machine-readable `code` so a
 * consumer can branch on it without string-matching the message (PRD E4).
 */

export type ApiErrorCode =
  | "not_configured"
  | "store_unavailable"
  | "unknown_type"
  | "not_found"
  | "invalid_parameter"
  | "internal_error";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Present when the failure is about specific inputs. */
    details?: Record<string, string>;
  };
}

const STATUS: Record<ApiErrorCode, number> = {
  not_configured: 503,
  store_unavailable: 503,
  unknown_type: 404,
  not_found: 404,
  invalid_parameter: 400,
  internal_error: 500,
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS[code], headers: CORS_HEADERS },
  );
}

/**
 * The API is public and read-only by design — the challenge asks for proof
 * that another app could consume this content, and a browser-based consumer
 * needs CORS to do that.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // Content changes the moment an editor saves; a stale read would make the
  // real-time work in milestone 4 look broken.
  "Cache-Control": "no-store",
};

export function apiJson<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

/** Shared preflight/OPTIONS response. */
export function apiPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
