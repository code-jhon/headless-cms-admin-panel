import type { FieldType } from "@/types/cms";

/**
 * Machine names that would collide with the entry envelope exposed by the
 * read API (`{ id, created_at, updated_at, ... }`), or with the JSONB
 * accessors used internally. Rejected at both the form and the server action.
 */
export const RESERVED_FIELD_KEYS = new Set([
  "id",
  "data",
  "invalid",
  "schema_id",
  "created_at",
  "updated_at",
]);

/** api_id values that would shadow a route or an API path segment. */
export const RESERVED_API_IDS = new Set([
  "api",
  "content",
  "schemas",
  "health",
  "new",
  "admin",
  "_next",
]);

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Boolean",
  date: "Date",
  reference: "Reference",
};

export const FIELD_TYPE_HINTS: Record<FieldType, string> = {
  text: "Any string — titles, slugs, body copy.",
  number: "Integers or decimals.",
  boolean: "A checkbox — true or false.",
  date: "A calendar date.",
  reference: "Points at an entry of another content type.",
};
