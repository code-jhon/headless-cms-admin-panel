"use server";

import { revalidatePath } from "next/cache";

import { getServerClient } from "@/lib/supabase/server";
import { parseEntryData } from "@/lib/schema/zod-builder";
import type { Entry, Field } from "@/types/cms";

/**
 * Server actions for entries.
 *
 * Validation is re-derived from the database's current `fields` rows, not
 * from anything the client sends. A client holding a stale schema therefore
 * cannot write a value that the live schema would reject — which matters more
 * once milestone 4 lets schemas change under an open form.
 */

export interface EntryActionResult {
  ok: boolean;
  error?: string;
  /** Per-field messages, keyed by field key. */
  fieldErrors?: Record<string, string>;
  /** Set when the caller should navigate after success. */
  entryId?: string;
  /** Set when the write was rejected because the entry moved on. */
  conflict?: boolean;
}

function fail(
  error: string,
  extra: Partial<EntryActionResult> = {},
): EntryActionResult {
  return { ok: false, error, ...extra };
}

/** Load the schema's fields — the authority for validation. */
async function loadFields(schemaId: string) {
  const { data, error } = await getServerClient()
    .from("fields")
    .select("*")
    .eq("schema_id", schemaId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Field[];
}

/**
 * Reject references pointing at entries that do not exist, or that belong to
 * the wrong content type.
 *
 * JSONB storage means the database cannot enforce this with a foreign key,
 * so it is enforced here — the one integrity check the schema gives away in
 * exchange for making schema evolution a data transform.
 */
async function validateReferences(
  fields: Field[],
  data: Record<string, unknown>,
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const toCheck = fields.filter(
    (f) => f.type === "reference" && typeof data[f.key] === "string",
  );
  if (toCheck.length === 0) return errors;

  const db = getServerClient();
  const ids = [...new Set(toCheck.map((f) => String(data[f.key])))];

  const { data: targets, error } = await db
    .from("entries")
    .select("id, schema_id")
    .in("id", ids);

  if (error) return errors; // surfaced by the write itself

  const schemaById = new Map((targets ?? []).map((e) => [e.id, e.schema_id]));

  for (const field of toCheck) {
    const id = String(data[field.key]);
    const owner = schemaById.get(id);

    if (!owner) {
      errors[field.key] = "That entry no longer exists.";
    } else if (owner !== field.target_schema_id) {
      errors[field.key] = "That entry belongs to a different content type.";
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ create */

export async function createEntry(
  schemaId: string,
  apiId: string,
  values: unknown,
): Promise<EntryActionResult> {
  let fields: Field[];
  try {
    fields = await loadFields(schemaId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not load the schema.");
  }

  if (fields.length === 0) {
    return fail("This content type has no fields yet.");
  }

  const parsed = parseEntryData(fields, values);
  if (!parsed.ok) {
    return fail("Some fields need attention.", { fieldErrors: parsed.errors });
  }

  const referenceErrors = await validateReferences(fields, parsed.data);
  if (Object.keys(referenceErrors).length > 0) {
    return fail("Some references are no longer valid.", {
      fieldErrors: referenceErrors,
    });
  }

  const { data: created, error } = await getServerClient()
    .from("entries")
    .insert({ schema_id: schemaId, data: parsed.data as Entry["data"] })
    .select("id")
    .single();

  if (error) return fail(error.message);

  revalidatePath(`/content/${apiId}`);
  revalidatePath("/", "layout");
  return { ok: true, entryId: created.id };
}

/* ------------------------------------------------------------------ update */

export async function updateEntry(
  schemaId: string,
  apiId: string,
  entryId: string,
  values: unknown,
  /**
   * The `updated_at` the form was loaded with. Acts as an optimistic
   * concurrency token (PRD C3): if the row moved on, the write is refused
   * rather than silently clobbering someone else's edit.
   */
  expectedUpdatedAt: string,
): Promise<EntryActionResult> {
  let fields: Field[];
  try {
    fields = await loadFields(schemaId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not load the schema.");
  }

  const parsed = parseEntryData(fields, values);
  if (!parsed.ok) {
    return fail("Some fields need attention.", { fieldErrors: parsed.errors });
  }

  const referenceErrors = await validateReferences(fields, parsed.data);
  if (Object.keys(referenceErrors).length > 0) {
    return fail("Some references are no longer valid.", {
      fieldErrors: referenceErrors,
    });
  }

  const db = getServerClient();

  const { data: current, error: readError } = await db
    .from("entries")
    .select("updated_at")
    .eq("id", entryId)
    .eq("schema_id", schemaId)
    .maybeSingle();

  if (readError) return fail(readError.message);
  if (!current) return fail("That entry no longer exists.");

  if (current.updated_at !== expectedUpdatedAt) {
    return fail(
      "This entry changed while you were editing it. Reload to see the current version, or save again to overwrite.",
      { conflict: true },
    );
  }

  const { error } = await db
    .from("entries")
    .update({ data: parsed.data as Entry["data"], invalid: false })
    .eq("id", entryId)
    .eq("schema_id", schemaId);

  if (error) return fail(error.message);

  revalidatePath(`/content/${apiId}`);
  revalidatePath(`/content/${apiId}/${entryId}`);
  return { ok: true, entryId };
}

/**
 * Save regardless of the concurrency token — the explicit "overwrite" path
 * offered after a conflict. Separate action so an overwrite is always a
 * deliberate second decision, never a silent retry.
 */
export async function forceUpdateEntry(
  schemaId: string,
  apiId: string,
  entryId: string,
  values: unknown,
): Promise<EntryActionResult> {
  const { data: current } = await getServerClient()
    .from("entries")
    .select("updated_at")
    .eq("id", entryId)
    .eq("schema_id", schemaId)
    .maybeSingle();

  if (!current) return fail("That entry no longer exists.");

  return updateEntry(schemaId, apiId, entryId, values, current.updated_at);
}

/* ------------------------------------------------------------------ delete */

export async function deleteEntry(
  schemaId: string,
  apiId: string,
  entryId: string,
): Promise<EntryActionResult> {
  const db = getServerClient();

  // Warn about inbound references rather than leaving dangling ids behind.
  const { data: referrers } = await db
    .from("fields")
    .select("key, schema_id")
    .eq("type", "reference")
    .eq("target_schema_id", schemaId);

  const { error } = await db
    .from("entries")
    .delete()
    .eq("id", entryId)
    .eq("schema_id", schemaId);

  if (error) return fail(error.message);

  // Flag entries whose reference now dangles, so the breakage is visible in
  // the UI instead of only showing up when someone opens the row.
  for (const referrer of referrers ?? []) {
    await db
      .from("entries")
      .update({ invalid: true })
      .eq("schema_id", referrer.schema_id)
      .eq(`data->>${referrer.key}`, entryId);
  }

  revalidatePath(`/content/${apiId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}
