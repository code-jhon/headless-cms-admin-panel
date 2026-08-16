import type { Field } from "@/types/cms";

/**
 * Query-parameter parsing for the read API.
 *
 * Every parameter is validated rather than coerced silently: `?limit=abc`
 * is a mistake in the caller's code, and returning 20 results as if nothing
 * happened hides it. Pure functions so they are testable without a request.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export interface ListParams {
  limit: number;
  offset: number;
  /** Field keys to expand, or "*" for every reference field. */
  expand: string[];
  /** Field key to order by. Null means the default (most recently updated). */
  orderBy: string | null;
  direction: "asc" | "desc";
}

export type ParamResult =
  | { ok: true; params: ListParams }
  | { ok: false; details: Record<string, string> };

/**
 * Parse an integer parameter, rejecting anything that is not a clean whole
 * number. `Number("12abc")` is NaN, but `parseInt` would return 12 — the
 * stricter reading is the right one for an API contract.
 */
function parseInteger(
  raw: string | null,
  fallback: number,
): { value: number; error?: string } {
  if (raw === null || raw === "") return { value: fallback };

  if (!/^-?\d+$/.test(raw.trim())) {
    return { value: fallback, error: "must be a whole number" };
  }

  return { value: Number(raw) };
}

export function parseListParams(
  searchParams: URLSearchParams,
  fields: Field[],
): ParamResult {
  const details: Record<string, string> = {};

  const limitResult = parseInteger(searchParams.get("limit"), DEFAULT_LIMIT);
  if (limitResult.error) {
    details.limit = `limit ${limitResult.error}`;
  } else if (limitResult.value < 1) {
    details.limit = "limit must be at least 1";
  } else if (limitResult.value > MAX_LIMIT) {
    details.limit = `limit must be ${MAX_LIMIT} or fewer`;
  }

  const offsetResult = parseInteger(searchParams.get("offset"), 0);
  if (offsetResult.error) {
    details.offset = `offset ${offsetResult.error}`;
  } else if (offsetResult.value < 0) {
    details.offset = "offset cannot be negative";
  }

  // expand
  const expandRaw = searchParams.get("expand");
  const referenceKeys = fields
    .filter((f) => f.type === "reference")
    .map((f) => f.key);

  let expand: string[] = [];
  if (expandRaw === "*") {
    expand = referenceKeys;
  } else if (expandRaw) {
    const requested = expandRaw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const unknown = requested.filter((k) => !referenceKeys.includes(k));
    if (unknown.length > 0) {
      details.expand =
        referenceKeys.length === 0
          ? "this content type has no reference fields to expand"
          : `unknown reference field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Available: ${referenceKeys.join(", ")}`;
    }
    expand = requested.filter((k) => referenceKeys.includes(k));
  }

  // order
  const orderRaw = searchParams.get("order");
  let orderBy: string | null = null;
  if (orderRaw) {
    const known = fields.some((f) => f.key === orderRaw);
    if (!known) {
      details.order = `unknown field "${orderRaw}". Available: ${fields.map((f) => f.key).join(", ")}`;
    } else {
      orderBy = orderRaw;
    }
  }

  const directionRaw = searchParams.get("direction");
  if (directionRaw && directionRaw !== "asc" && directionRaw !== "desc") {
    details.direction = 'direction must be "asc" or "desc"';
  }

  if (Object.keys(details).length > 0) return { ok: false, details };

  return {
    ok: true,
    params: {
      limit: limitResult.value,
      offset: offsetResult.value,
      expand,
      orderBy,
      direction: directionRaw === "desc" ? "desc" : "asc",
    },
  };
}
