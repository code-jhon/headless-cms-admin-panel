"use server";

import { revalidatePath } from "next/cache";

import { getServerClient } from "@/lib/supabase/server";
import { diffFields, gateChanges } from "@/lib/schema/diff";
import {
  fieldDraftListSchema,
  schemaMetaSchema,
  type FieldDraft,
} from "@/lib/schema/validation";
import type { Field } from "@/types/cms";

/**
 * Server actions for the Schema Builder.
 *
 * Every rule enforced in the editor is re-run here against the *current*
 * database state. The client's copy of a schema can be stale — another client
 * may have changed it a second ago (real-time, milestone 4) — so the draft is
 * never trusted, only re-diffed.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Per-field messages, keyed by the field's position in the submitted list. */
  fieldErrors?: Record<number, string>;
  /** Set on success when the caller should navigate somewhere new. */
  redirectTo?: string;
}

function fail(error: string, fieldErrors?: Record<number, string>): ActionResult {
  return { ok: false, error, fieldErrors };
}

/** Postgres error codes worth translating into something a human can act on. */
function translate(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "That API ID is already taken by another content type.";
  }
  if (error.code === "23503") {
    return "Another content type still references this one. Remove that reference first.";
  }
  if (error.code === "23514") {
    return "A value broke a database constraint — check the field IDs and reference targets.";
  }
  return error.message;
}

/* ------------------------------------------------------------------ create */

export async function createSchema(input: {
  name: string;
  api_id: string;
  description?: string;
  fields: FieldDraft[];
}): Promise<ActionResult> {
  const meta = schemaMetaSchema.safeParse({
    name: input.name,
    api_id: input.api_id,
    description: input.description ?? "",
  });
  if (!meta.success) return fail(meta.error.issues[0].message);

  const fields = fieldDraftListSchema.safeParse(input.fields);
  if (!fields.success) {
    const issue = fields.error.issues[0];
    const index = typeof issue.path[0] === "number" ? issue.path[0] : undefined;
    return fail(
      issue.message,
      index === undefined ? undefined : { [index]: issue.message },
    );
  }

  const db = getServerClient();

  const { data: schema, error } = await db
    .from("schemas")
    .insert({
      name: meta.data.name,
      api_id: meta.data.api_id,
      description: meta.data.description || null,
    })
    .select("id, api_id")
    .single();

  if (error) return fail(translate(error));

  const { error: fieldsError } = await db.from("fields").insert(
    fields.data.map((field, position) => ({
      schema_id: schema.id,
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      position,
      target_schema_id: field.target_schema_id,
    })),
  );

  if (fieldsError) {
    // Roll back by hand — the schema row would otherwise be left fieldless.
    await db.from("schemas").delete().eq("id", schema.id);
    return fail(translate(fieldsError));
  }

  revalidatePath("/", "layout");
  return { ok: true, redirectTo: `/schemas/${schema.api_id}` };
}

/* -------------------------------------------------------------- meta update */

export async function updateSchemaMeta(
  schemaId: string,
  input: { name: string; description?: string },
): Promise<ActionResult> {
  const db = getServerClient();
  const { data: current, error: readError } = await db
    .from("schemas")
    .select("api_id")
    .eq("id", schemaId)
    .maybeSingle();

  if (readError) return fail(translate(readError));
  if (!current) return fail("That content type no longer exists.");

  // api_id is intentionally immutable: it is the public read-API path, and
  // changing it silently breaks every consumer. Deliberate, not an oversight.
  const meta = schemaMetaSchema.safeParse({
    name: input.name,
    api_id: current.api_id,
    description: input.description ?? "",
  });
  if (!meta.success) return fail(meta.error.issues[0].message);

  const { error } = await db
    .from("schemas")
    .update({
      name: meta.data.name,
      description: meta.data.description || null,
    })
    .eq("id", schemaId);

  if (error) return fail(translate(error));

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------------------------------------- save fields */

/**
 * Apply a field change set.
 *
 * Re-diffs the draft against the database, then refuses anything the gate
 * holds back. Milestone 5 replaces the refusal with the review → preview →
 * resolve flow; the diff and apply halves stay as they are.
 */
export async function saveSchemaFields(
  schemaId: string,
  draft: FieldDraft[],
): Promise<ActionResult> {
  const parsed = fieldDraftListSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const index = typeof issue.path[0] === "number" ? issue.path[0] : undefined;
    return fail(
      issue.message,
      index === undefined ? undefined : { [index]: issue.message },
    );
  }

  const db = getServerClient();

  const [savedRes, entriesRes] = await Promise.all([
    db
      .from("fields")
      .select("*")
      .eq("schema_id", schemaId)
      .order("position", { ascending: true }),
    db
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("schema_id", schemaId),
  ]);

  if (savedRes.error) return fail(translate(savedRes.error));
  if (entriesRes.error) return fail(translate(entriesRes.error));

  const saved: Field[] = savedRes.data ?? [];
  const entryCount = entriesRes.count ?? 0;

  const changes = diffFields(saved, parsed.data);
  if (changes.length === 0) return { ok: true };

  const gate = gateChanges(changes, entryCount);
  if (!gate.canApply) {
    const first = gate.blocked[0];
    return fail(
      `"${first.summary}" affects ${entryCount} existing entr${entryCount === 1 ? "y" : "ies"}, ` +
        `so it has to go through the change review rather than a plain save.`,
    );
  }

  // Apply. Not transactional — Supabase's REST API has no multi-statement
  // transaction, and milestone 5 moves this whole block into a Postgres RPC
  // so a partial apply becomes impossible. Ordered deletes-then-writes keeps
  // the unique (schema_id, key) constraint satisfied in the meantime.
  const draftIds = new Set(
    parsed.data.map((f) => f.id).filter((id): id is string => Boolean(id)),
  );
  const removed = saved.filter((f) => !draftIds.has(f.id));

  if (removed.length > 0) {
    const { error } = await db
      .from("fields")
      .delete()
      .in(
        "id",
        removed.map((f) => f.id),
      );
    if (error) return fail(translate(error));
  }

  const savedById = new Map(saved.map((f) => [f.id, f]));

  for (const [position, field] of parsed.data.entries()) {
    const row = {
      key: field.key,
      label: field.label,
      type: field.type,
      required: field.required,
      position,
      target_schema_id: field.target_schema_id,
    };

    if (!field.id) {
      const { error } = await db
        .from("fields")
        .insert({ schema_id: schemaId, ...row });
      if (error) return fail(translate(error));
      continue;
    }

    const prev = savedById.get(field.id);
    const unchanged =
      prev &&
      prev.key === row.key &&
      prev.label === row.label &&
      prev.type === row.type &&
      prev.required === row.required &&
      prev.position === row.position &&
      prev.target_schema_id === row.target_schema_id;

    if (unchanged) continue;

    const { error } = await db.from("fields").update(row).eq("id", field.id);
    if (error) return fail(translate(error));
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/* ------------------------------------------------------------------ delete */

export async function deleteSchema(
  schemaId: string,
  /** Echoed back from the confirmation dialog, so a stray call cannot delete. */
  confirmApiId: string,
): Promise<ActionResult> {
  const db = getServerClient();

  const { data: schema, error: readError } = await db
    .from("schemas")
    .select("id, api_id")
    .eq("id", schemaId)
    .maybeSingle();

  if (readError) return fail(translate(readError));
  if (!schema) return fail("That content type no longer exists.");
  if (schema.api_id !== confirmApiId) {
    return fail("Confirmation did not match. Nothing was deleted.");
  }

  // Incoming references block the delete at the database (on delete restrict).
  // Check first so the message names the offending schema.
  const { data: referrers, error: refError } = await db
    .from("fields")
    .select("label, schema_id")
    .eq("target_schema_id", schemaId)
    .neq("schema_id", schemaId);

  if (refError) return fail(translate(refError));

  if (referrers && referrers.length > 0) {
    const { data: names } = await db
      .from("schemas")
      .select("name")
      .in("id", [...new Set(referrers.map((r) => r.schema_id))]);

    const list = (names ?? []).map((n) => n.name).join(", ");
    return fail(
      `Cannot delete: ${referrers.length} reference field${
        referrers.length === 1 ? "" : "s"
      } on ${list || "another content type"} still point here. Remove ${
        referrers.length === 1 ? "it" : "them"
      } first.`,
    );
  }

  // Self-references and this schema's own fields and entries cascade.
  const { error } = await db.from("schemas").delete().eq("id", schemaId);
  if (error) return fail(translate(error));

  revalidatePath("/", "layout");
  return { ok: true, redirectTo: "/schemas" };
}
