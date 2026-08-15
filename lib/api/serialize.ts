import type { Entry, Field, FieldValue } from "@/types/cms";

/**
 * Entry → public JSON.
 *
 * The response is flat — `{ id, created_at, updated_at, ...fields }` — rather
 * than nesting values under a `fields` key, because that is nicer to consume:
 * `article.title`, not `article.fields.title`.
 *
 * That flattening is only safe because `RESERVED_FIELD_KEYS` forbids a field
 * from being called `id`, `created_at`, `updated_at` or `invalid` in the first
 * place. The reserved list and this shape are the same decision.
 */

export interface SerializedEntry {
  id: string;
  created_at: string;
  updated_at: string;
  /** True when a schema change or a deleted reference left this row unfit. */
  invalid: boolean;
  [fieldKey: string]: unknown;
}

/**
 * The schema is the contract, not the stored row.
 *
 * A field added after an entry was written appears as `null`; a JSONB key
 * left behind by a deleted field is dropped. A consumer therefore sees the
 * same keys for every entry of a type, which is what makes the response
 * predictable enough to type against.
 */
export function serializeEntry(
  entry: Entry,
  fields: Field[],
  /** Expanded reference targets, keyed by entry id. */
  expanded?: Map<string, SerializedEntry>,
  expandKeys: string[] = [],
): SerializedEntry {
  const output: SerializedEntry = {
    id: entry.id,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    invalid: entry.invalid,
  };

  for (const field of fields) {
    const raw = entry.data?.[field.key];
    const value: FieldValue = raw === undefined ? null : raw;

    if (
      field.type === "reference" &&
      expandKeys.includes(field.key) &&
      typeof value === "string"
    ) {
      // A reference whose target was deleted expands to null rather than
      // vanishing, so the breakage is visible to the consumer.
      output[field.key] = expanded?.get(value) ?? null;
      continue;
    }

    output[field.key] = value;
  }

  return output;
}

export interface ListMeta {
  type: string;
  /** Rows returned in this response. */
  count: number;
  /** Rows in the collection, ignoring limit/offset. */
  total: number;
  limit: number;
  offset: number;
  /** Ready-made query string for the next page, or null on the last one. */
  next: string | null;
}

export function buildListMeta(args: {
  type: string;
  count: number;
  total: number;
  limit: number;
  offset: number;
  query: URLSearchParams;
}): ListMeta {
  const { type, count, total, limit, offset, query } = args;
  const nextOffset = offset + limit;

  let next: string | null = null;
  if (nextOffset < total) {
    const params = new URLSearchParams(query);
    params.set("limit", String(limit));
    params.set("offset", String(nextOffset));
    next = `/api/content/${type}?${params.toString()}`;
  }

  return { type, count, total, limit, offset, next };
}

/** Public description of a content type, for the discovery endpoint. */
export interface SerializedSchema {
  name: string;
  api_id: string;
  description: string | null;
  url: string;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    required: boolean;
    /** api_id of the referenced type, for reference fields. */
    references: string | null;
  }>;
}

export function serializeSchema(
  schema: { name: string; api_id: string; description: string | null },
  fields: Field[],
  /** schema id → api_id, so references are described by their public name. */
  apiIdById: Map<string, string>,
): SerializedSchema {
  return {
    name: schema.name,
    api_id: schema.api_id,
    description: schema.description,
    url: `/api/content/${schema.api_id}`,
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      references: field.target_schema_id
        ? (apiIdById.get(field.target_schema_id) ?? null)
        : null,
    })),
  };
}
