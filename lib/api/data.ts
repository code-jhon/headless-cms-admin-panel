import "server-only";

import { isEnvConfigured } from "@/lib/env";
import { getServerClient } from "@/lib/supabase/server";
import type { ContentSchema, Entry, Field } from "@/types/cms";

/**
 * Every database read the API performs, in one module.
 *
 * Isolated deliberately: the route handlers depend on this and nothing else
 * from the data layer, so they can be exercised against a stub in tests
 * without a live Supabase project.
 */

export class ApiUnavailableError extends Error {}

function db() {
  if (!isEnvConfigured()) {
    throw new ApiUnavailableError(
      "The content store is not configured on this deployment.",
    );
  }
  return getServerClient();
}

export interface ApiSchema {
  schema: ContentSchema;
  fields: Field[];
}

/** Resolve a public `api_id` to its schema and ordered fields. */
export async function findSchema(apiId: string): Promise<ApiSchema | null> {
  const client = db();

  const { data: schema, error } = await client
    .from("schemas")
    .select("*")
    .eq("api_id", apiId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!schema) return null;

  const { data: fields, error: fieldsError } = await client
    .from("fields")
    .select("*")
    .eq("schema_id", schema.id)
    .order("position", { ascending: true });

  if (fieldsError) throw new Error(fieldsError.message);

  return { schema, fields: fields ?? [] };
}

export interface EntryPage {
  entries: Entry[];
  total: number;
}

/**
 * A page of entries.
 *
 * Ordering by a schema field uses PostgREST's JSONB path syntax, so the sort
 * happens in Postgres rather than after pagination — otherwise page 2 would
 * be sorted independently of page 1.
 */
export async function findEntries(
  schemaId: string,
  options: {
    limit: number;
    offset: number;
    orderBy: string | null;
    direction: "asc" | "desc";
  },
): Promise<EntryPage> {
  const client = db();

  let query = client
    .from("entries")
    .select("*", { count: "exact" })
    .eq("schema_id", schemaId);

  query = options.orderBy
    ? query.order(`data->>${options.orderBy}`, {
        ascending: options.direction === "asc",
        nullsFirst: false,
      })
    : query.order("updated_at", { ascending: false });

  const { data, error, count } = await query.range(
    options.offset,
    options.offset + options.limit - 1,
  );

  if (error) throw new Error(error.message);
  return { entries: data ?? [], total: count ?? 0 };
}

/** One entry, scoped to its schema. */
export async function findEntry(
  schemaId: string,
  entryId: string,
): Promise<Entry | null> {
  const client = db();

  const { data, error } = await client
    .from("entries")
    .select("*")
    .eq("id", entryId)
    .eq("schema_id", schemaId)
    .maybeSingle();

  // A malformed uuid makes Postgres reject the comparison; that is a
  // "no such entry" from the caller's point of view, not a server fault.
  if (error) {
    if (/invalid input syntax/i.test(error.message)) return null;
    throw new Error(error.message);
  }

  return data ?? null;
}

export interface ExpansionSource {
  entries: Entry[];
  fieldsBySchema: Map<string, Field[]>;
}

/**
 * Fetch the targets of the reference values being expanded.
 *
 * Expansion is one level deep only. Deeper expansion would need cycle
 * detection — `Person.manager → Person` is legal in this schema — and the
 * challenge asks for a simple read API, not a graph query language.
 */
export async function findExpansionTargets(
  ids: string[],
  targetSchemaIds: string[],
): Promise<ExpansionSource> {
  if (ids.length === 0) {
    return { entries: [], fieldsBySchema: new Map() };
  }

  const client = db();

  const [entriesRes, fieldsRes] = await Promise.all([
    client.from("entries").select("*").in("id", ids),
    client
      .from("fields")
      .select("*")
      .in("schema_id", targetSchemaIds)
      .order("position", { ascending: true }),
  ]);

  if (entriesRes.error) throw new Error(entriesRes.error.message);
  if (fieldsRes.error) throw new Error(fieldsRes.error.message);

  const fieldsBySchema = new Map<string, Field[]>();
  for (const field of fieldsRes.data ?? []) {
    const list = fieldsBySchema.get(field.schema_id) ?? [];
    list.push(field);
    fieldsBySchema.set(field.schema_id, list);
  }

  return { entries: entriesRes.data ?? [], fieldsBySchema };
}

/** Every content type, for the discovery endpoint. */
export async function findAllSchemas(): Promise<{
  schemas: ContentSchema[];
  fieldsBySchema: Map<string, Field[]>;
}> {
  const client = db();

  const [schemasRes, fieldsRes] = await Promise.all([
    client.from("schemas").select("*").order("name", { ascending: true }),
    client.from("fields").select("*").order("position", { ascending: true }),
  ]);

  if (schemasRes.error) throw new Error(schemasRes.error.message);
  if (fieldsRes.error) throw new Error(fieldsRes.error.message);

  const fieldsBySchema = new Map<string, Field[]>();
  for (const field of fieldsRes.data ?? []) {
    const list = fieldsBySchema.get(field.schema_id) ?? [];
    list.push(field);
    fieldsBySchema.set(field.schema_id, list);
  }

  return { schemas: schemasRes.data ?? [], fieldsBySchema };
}
