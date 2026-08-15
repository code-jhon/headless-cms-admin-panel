"use server";

import { revalidatePath } from "next/cache";

import { getServerClient } from "@/lib/supabase/server";
import {
  analyzeMigration,
  buildMigrationPlan,
  type MigrationAnalysis,
} from "@/lib/migrations/analyze";
import type { Resolutions } from "@/lib/migrations/transform";
import { fieldDraftListSchema, type FieldDraft } from "@/lib/schema/validation";
import type { Entry, Field, Json } from "@/types/cms";

/**
 * Server actions for schema evolution (PRD D).
 *
 * Both the dry run and the apply re-read the saved fields and entries from
 * the database and re-run the same pure functions. The client's draft is an
 * input, never a source of truth — which matters more here than anywhere
 * else, since a stale draft could otherwise describe a migration against a
 * schema that has since moved.
 */

/**
 * Entries are loaded in full so the affected counts are exact rather than
 * estimated (PRD D2). Fine for the scale this challenge targets; a
 * production version would count in SQL and stream the preview rows.
 */
const MAX_ANALYZED_ENTRIES = 5000;

export interface AnalysisResult {
  ok: boolean;
  error?: string;
  analysis?: MigrationAnalysis;
  /** True when more entries exist than were analysed. */
  truncated?: boolean;
}

async function loadSchemaState(schemaId: string): Promise<{
  fields: Field[];
  entries: Entry[];
  total: number;
}> {
  const db = getServerClient();

  const [fieldsRes, entriesRes] = await Promise.all([
    db
      .from("fields")
      .select("*")
      .eq("schema_id", schemaId)
      .order("position", { ascending: true }),
    db
      .from("entries")
      .select("*", { count: "exact" })
      .eq("schema_id", schemaId)
      .order("created_at", { ascending: true })
      .range(0, MAX_ANALYZED_ENTRIES - 1),
  ]);

  if (fieldsRes.error) throw new Error(fieldsRes.error.message);
  if (entriesRes.error) throw new Error(entriesRes.error.message);

  return {
    fields: fieldsRes.data ?? [],
    entries: entriesRes.data ?? [],
    total: entriesRes.count ?? 0,
  };
}

/** Dry run: what would this change do to the data that exists? */
export async function analyzeSchemaMigration(
  schemaId: string,
  draft: FieldDraft[],
  resolutions: Resolutions = {},
): Promise<AnalysisResult> {
  const parsed = fieldDraftListSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const { fields, entries, total } = await loadSchemaState(schemaId);
    const analysis = analyzeMigration(fields, parsed.data, entries, resolutions);

    return {
      ok: true,
      analysis,
      truncated: total > entries.length,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not analyse this change.",
    };
  }
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  summary?: {
    fieldsAdded: number;
    fieldsRemoved: number;
    fieldsChanged: number;
    entriesUpdated: number;
    entriesFlagged: number;
  };
}

/**
 * Apply the migration atomically.
 *
 * The transformed values are computed here, in the same pure code that
 * produced the preview, and handed to a Postgres function that writes them
 * in one transaction. The database never re-derives them, so what the user
 * approved is exactly what lands (PRD D5).
 */
export async function applySchemaMigration(
  schemaId: string,
  apiId: string,
  draft: FieldDraft[],
  resolutions: Resolutions = {},
): Promise<ApplyResult> {
  const parsed = fieldDraftListSchema.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  try {
    const { fields, entries, total } = await loadSchemaState(schemaId);

    if (total > entries.length) {
      return {
        ok: false,
        error: `This content type has ${total} entries, more than the ${MAX_ANALYZED_ENTRIES} this migration tool handles in one pass.`,
      };
    }

    const plan = buildMigrationPlan(
      schemaId,
      fields,
      parsed.data,
      entries,
      resolutions,
    );

    const { error } = await getServerClient().rpc("apply_schema_migration", {
      p_schema_id: plan.schemaId,
      p_delete_field_ids: plan.deleteFieldIds,
      // Cast to Json: these are plain data objects, but TypeScript will not
      // structurally match a named interface to an index-signature type.
      p_fields: plan.fields as unknown as Json,
      p_entries: plan.entries as unknown as Json,
    });

    if (error) return { ok: false, error: translateRpcError(error.message) };

    revalidatePath("/", "layout");
    revalidatePath(`/schemas/${apiId}`);
    revalidatePath(`/content/${apiId}`);

    return { ok: true, summary: plan.summary };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not apply this migration.",
    };
  }
}

/** Turn the RPC's own errors into something an editor can act on. */
function translateRpcError(message: string): string {
  if (/could not find the function|schema cache/i.test(message)) {
    return "The migration function is missing. Run supabase/migrations/0002_apply_schema_migration.sql in your Supabase project's SQL Editor.";
  }
  if (/field list is incomplete/i.test(message)) {
    return "The schema changed while you were reviewing. Reload and start the review again.";
  }
  if (/at least one field/i.test(message)) {
    return "A content type must keep at least one field.";
  }
  if (/duplicate key|fields_key_unique/i.test(message)) {
    return "Two fields would end up with the same ID. Nothing was changed.";
  }
  if (/does not belong/i.test(message)) {
    return "A field in the change set belongs to a different content type. Nothing was changed.";
  }
  return `${message} Nothing was changed.`;
}
