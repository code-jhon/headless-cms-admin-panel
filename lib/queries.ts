import "server-only";

import { getServerClient } from "@/lib/supabase/server";
import { isEnvConfigured } from "@/lib/env";
import type { ContentSchema, Field, SchemaWithFields } from "@/types/cms";

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
