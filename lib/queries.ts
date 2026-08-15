import "server-only";

import { getServerClient } from "@/lib/supabase/server";
import { isEnvConfigured } from "@/lib/env";
import { entryTitle } from "@/lib/schema/display";
import type {
  ContentSchema,
  Entry,
  Field,
  SchemaWithFields,
} from "@/types/cms";

export interface Result<T> {
  data: T;
  error: string | null;
}

const NOT_CONFIGURED = "Supabase environment is not configured.";

/**
 * Schema list for the sidebar.
 *
 * Returns a Result rather than throwing: the shell must still render when
 * Supabase is unconfigured, so a first-run user sees the health check
 * instead of a Next.js error overlay.
 */
export async function listSchemas(): Promise<Result<ContentSchema[]>> {
  if (!isEnvConfigured()) return { data: [], error: NOT_CONFIGURED };

  const { data, error } = await getServerClient()
    .from("schemas")
    .select("*")
    .order("name", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

export interface SchemaSummary extends ContentSchema {
  fieldCount: number;
  entryCount: number;
}

/** Schema list with counts, for the builder index. */
export async function listSchemaSummaries(): Promise<Result<SchemaSummary[]>> {
  if (!isEnvConfigured()) return { data: [], error: NOT_CONFIGURED };

  const db = getServerClient();
  const [schemasRes, fieldsRes, entriesRes] = await Promise.all([
    db.from("schemas").select("*").order("name", { ascending: true }),
    db.from("fields").select("schema_id"),
    db.from("entries").select("schema_id"),
  ]);

  if (schemasRes.error) return { data: [], error: schemasRes.error.message };

  const tally = (rows: { schema_id: string }[] | null) => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      counts.set(row.schema_id, (counts.get(row.schema_id) ?? 0) + 1);
    }
    return counts;
  };

  const fieldCounts = tally(fieldsRes.data);
  const entryCounts = tally(entriesRes.data);

  return {
    data: (schemasRes.data ?? []).map((schema) => ({
      ...schema,
      fieldCount: fieldCounts.get(schema.id) ?? 0,
      entryCount: entryCounts.get(schema.id) ?? 0,
    })),
    error: null,
  };
}

/** One schema with its ordered fields, looked up by its API ID. */
export async function getSchemaByApiId(
  apiId: string,
): Promise<Result<SchemaWithFields | null>> {
  if (!isEnvConfigured()) return { data: null, error: NOT_CONFIGURED };

  const db = getServerClient();
  const { data: schema, error } = await db
    .from("schemas")
    .select("*")
    .eq("api_id", apiId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!schema) return { data: null, error: null };

  const { data: fields, error: fieldsError } = await db
    .from("fields")
    .select("*")
    .eq("schema_id", schema.id)
    .order("position", { ascending: true });

  if (fieldsError) return { data: null, error: fieldsError.message };

  return { data: { ...schema, fields: fields ?? [] }, error: null };
}

export interface SchemaUsage {
  entryCount: number;
  /** Fields on other schemas (or this one) pointing at this schema. */
  referencedBy: Array<{
    schemaId: string;
    schemaName: string;
    fieldLabel: string;
    fieldKey: string;
    isSelf: boolean;
  }>;
}

/**
 * What would break if this schema were deleted.
 *
 * `fields.target_schema_id` is `on delete restrict`, so an incoming reference
 * makes the delete fail at the database. Surfacing it here means the user is
 * told which schema to fix instead of seeing a foreign-key error.
 */
export async function getSchemaUsage(
  schemaId: string,
): Promise<Result<SchemaUsage>> {
  const empty: SchemaUsage = { entryCount: 0, referencedBy: [] };
  if (!isEnvConfigured()) return { data: empty, error: NOT_CONFIGURED };

  const db = getServerClient();
  const [entriesRes, refsRes] = await Promise.all([
    db
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("schema_id", schemaId),
    db
      .from("fields")
      .select("id, key, label, schema_id")
      .eq("target_schema_id", schemaId),
  ]);

  if (entriesRes.error) return { data: empty, error: entriesRes.error.message };
  if (refsRes.error) return { data: empty, error: refsRes.error.message };

  const referrerIds = [
    ...new Set((refsRes.data ?? []).map((f) => f.schema_id)),
  ];

  let names = new Map<string, string>();
  if (referrerIds.length > 0) {
    const { data: referrers } = await db
      .from("schemas")
      .select("id, name")
      .in("id", referrerIds);
    names = new Map((referrers ?? []).map((s) => [s.id, s.name]));
  }

  return {
    data: {
      entryCount: entriesRes.count ?? 0,
      referencedBy: (refsRes.data ?? []).map((field) => ({
        schemaId: field.schema_id,
        schemaName: names.get(field.schema_id) ?? "Unknown",
        fieldLabel: field.label,
        fieldKey: field.key,
        isSelf: field.schema_id === schemaId,
      })),
    },
    error: null,
  };
}

/** Saved fields for a schema, ordered. */
export async function listFields(schemaId: string): Promise<Result<Field[]>> {
  if (!isEnvConfigured()) return { data: [], error: NOT_CONFIGURED };

  const { data, error } = await getServerClient()
    .from("fields")
    .select("*")
    .eq("schema_id", schemaId)
    .order("position", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

/* ----------------------------------------------------------------- entries */

/** Entries for a schema, newest first. */
export async function listEntries(
  schemaId: string,
): Promise<Result<Entry[]>> {
  if (!isEnvConfigured()) return { data: [], error: NOT_CONFIGURED };

  const { data, error } = await getServerClient()
    .from("entries")
    .select("*")
    .eq("schema_id", schemaId)
    .order("updated_at", { ascending: false });

  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

/** One entry, scoped to its schema so a mismatched URL 404s rather than leaks. */
export async function getEntry(
  schemaId: string,
  entryId: string,
): Promise<Result<Entry | null>> {
  if (!isEnvConfigured()) return { data: null, error: NOT_CONFIGURED };

  const { data, error } = await getServerClient()
    .from("entries")
    .select("*")
    .eq("id", entryId)
    .eq("schema_id", schemaId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  return { data: data ?? null, error: null };
}

/**
 * Options for every reference field on a schema, keyed by field key.
 *
 * Resolved server-side in one pass so the form renders complete on first
 * paint — no picker that starts empty and fills in later.
 */
export async function listReferenceOptions(
  fields: Field[],
): Promise<Record<string, Array<{ id: string; title: string }>>> {
  const referenceFields = fields.filter(
    (f) => f.type === "reference" && f.target_schema_id,
  );
  if (referenceFields.length === 0 || !isEnvConfigured()) return {};

  const db = getServerClient();
  const targetIds = [
    ...new Set(referenceFields.map((f) => f.target_schema_id!)),
  ];

  const [entriesRes, fieldsRes] = await Promise.all([
    db.from("entries").select("*").in("schema_id", targetIds),
    db
      .from("fields")
      .select("*")
      .in("schema_id", targetIds)
      .order("position", { ascending: true }),
  ]);

  const fieldsBySchema = new Map<string, Field[]>();
  for (const field of fieldsRes.data ?? []) {
    const list = fieldsBySchema.get(field.schema_id) ?? [];
    list.push(field);
    fieldsBySchema.set(field.schema_id, list);
  }

  const entriesBySchema = new Map<string, Entry[]>();
  for (const entry of entriesRes.data ?? []) {
    const list = entriesBySchema.get(entry.schema_id) ?? [];
    list.push(entry);
    entriesBySchema.set(entry.schema_id, list);
  }

  const options: Record<string, Array<{ id: string; title: string }>> = {};
  for (const field of referenceFields) {
    const targetId = field.target_schema_id!;
    const targetFields = fieldsBySchema.get(targetId) ?? [];
    options[field.key] = (entriesBySchema.get(targetId) ?? [])
      .map((entry) => ({ id: entry.id, title: entryTitle(entry, targetFields) }))
      .sort((a, b) => a.title.localeCompare(b.title, "en"));
  }

  return options;
}

/**
 * Titles for every entry referenced by this schema's reference fields,
 * so a list can show "Ada Lovelace" instead of a uuid.
 */
export async function listReferenceTitles(
  fields: Field[],
): Promise<Map<string, string>> {
  const byField = await listReferenceOptions(fields);
  const titles = new Map<string, string>();
  for (const options of Object.values(byField)) {
    for (const option of options) titles.set(option.id, option.title);
  }
  return titles;
}
