import { diffFields, type FieldChange } from "@/lib/schema/diff";
import { entryTitle } from "@/lib/schema/display";
import type { FieldDraft } from "@/lib/schema/validation";
import { transformEntry, type Problem, type Resolutions } from "./transform";
import type { Entry, Field, FieldValue } from "@/types/cms";

/**
 * Dry-run a schema change against real entries (PRD D2, D3).
 *
 * Runs the *same* `transformEntry` the apply will run, so the counts and the
 * before/after rows shown to the user are exactly what will be written. The
 * only difference between analysing and applying is whether the result is
 * persisted.
 */

/** How many sample rows to carry into the UI per field. */
export const PREVIEW_ROW_LIMIT = 25;

export interface PreviewRow {
  entryId: string;
  title: string;
  before: FieldValue;
  after: FieldValue;
  status: "converted" | "unchanged" | "problem";
  reason?: string;
}

export interface FieldImpact {
  fieldKey: string;
  fieldLabel: string;
  /** Changes from the diff that touch this field. */
  changes: FieldChange[];
  /** Entries whose value for this field changes at all. */
  affectedCount: number;
  /** Entries this field leaves in a bad state without a decision. */
  problemCount: number;
  /** True while the user still has to choose what to do. */
  needsDecision: boolean;
  /** Capped sample for the preview table. */
  rows: PreviewRow[];
  /** True when there are more affected rows than the sample shows. */
  truncated: boolean;
}

export interface MigrationAnalysis {
  changes: FieldChange[];
  /** One entry per field that the migration touches problematically or at all. */
  impacts: FieldImpact[];
  entryCount: number;
  /** Entries whose stored data changes. */
  changedEntryCount: number;
  /** Entries that would end up flagged `invalid`. */
  flaggedEntryCount: number;
  /** Fields still awaiting a decision. */
  unresolvedFieldKeys: string[];
  /** Nothing to do. */
  isNoop: boolean;
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  return a === b || (a === null && b === undefined) || (a === undefined && b === null);
}

/**
 * Analyse a draft change set against the current entries.
 *
 * `entries` is every row of the schema — the counts must be exact (PRD D2),
 * so this deliberately does not sample. Only the *preview rows* are capped.
 */
export function analyzeMigration(
  saved: Field[],
  draft: FieldDraft[],
  entries: Entry[],
  resolutions: Resolutions = {},
): MigrationAnalysis {
  const changes = diffFields(saved, draft);
  const savedById = new Map(saved.map((f) => [f.id, f]));

  const impactsByField = new Map<string, FieldImpact>();
  const ensureImpact = (key: string, label: string): FieldImpact => {
    const existing = impactsByField.get(key);
    if (existing) return existing;
    const created: FieldImpact = {
      fieldKey: key,
      fieldLabel: label,
      changes: [],
      affectedCount: 0,
      problemCount: 0,
      needsDecision: false,
      rows: [],
      truncated: false,
    };
    impactsByField.set(key, created);
    return created;
  };

  // Attach changes to the field they belong to, ignoring the purely cosmetic
  // ones — a reorder or a relabel never touches stored data.
  for (const change of changes) {
    if (change.kind === "reorder" || change.kind === "rename_label") continue;
    ensureImpact(change.key, change.label).changes.push(change);
  }

  let changedEntryCount = 0;
  let flaggedEntryCount = 0;

  for (const entry of entries) {
    const result = transformEntry(entry, saved, draft, resolutions);
    if (result.changed) changedEntryCount += 1;
    if (result.invalid) flaggedEntryCount += 1;

    const problemsByField = new Map<string, Problem>(
      result.problems.map((p) => [p.fieldKey, p]),
    );

    for (const field of draft) {
      const impact = impactsByField.get(field.key);
      if (!impact) continue;

      const previous = field.id ? savedById.get(field.id) : undefined;
      const before = previous ? (entry.data?.[previous.key] ?? null) : null;
      const after = result.data[field.key] ?? null;
      const problem = problemsByField.get(field.key);

      if (!problem && sameValue(before, after)) continue;

      impact.affectedCount += 1;
      if (problem) {
        impact.problemCount += 1;
        if (!problem.resolved) impact.needsDecision = true;
      }

      if (impact.rows.length < PREVIEW_ROW_LIMIT) {
        impact.rows.push({
          entryId: entry.id,
          title: entryTitle(entry, saved),
          before,
          after,
          status: problem ? "problem" : "converted",
          reason: problem?.reason,
        });
      } else {
        impact.truncated = true;
      }
    }
  }

  const impacts = [...impactsByField.values()];

  return {
    changes,
    impacts,
    entryCount: entries.length,
    changedEntryCount,
    flaggedEntryCount,
    unresolvedFieldKeys: impacts
      .filter((i) => i.needsDecision)
      .map((i) => i.fieldKey),
    isNoop: changes.length === 0,
  };
}

/* ------------------------------------------------------------------- plan */

export interface PlannedField {
  /** Absent for a field being created. */
  id?: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  position: number;
  target_schema_id: string | null;
}

export interface PlannedEntry {
  id: string;
  data: Record<string, FieldValue>;
  invalid: boolean;
}

export interface MigrationPlan {
  schemaId: string;
  /** Field rows to remove, by id. */
  deleteFieldIds: string[];
  /** The complete desired field set, in order. */
  fields: PlannedField[];
  /** Only entries whose stored row actually changes. */
  entries: PlannedEntry[];
  summary: {
    fieldsAdded: number;
    fieldsRemoved: number;
    fieldsChanged: number;
    entriesUpdated: number;
    entriesFlagged: number;
  };
}

/**
 * Turn an analysed change set into the exact writes to perform.
 *
 * Entries whose data is unchanged are left out entirely: a migration that
 * touches one field should not rewrite every row's `updated_at` and wake up
 * every connected client (milestone 4) for no reason.
 */
export function buildMigrationPlan(
  schemaId: string,
  saved: Field[],
  draft: FieldDraft[],
  entries: Entry[],
  resolutions: Resolutions = {},
): MigrationPlan {
  const draftIds = new Set(
    draft.map((f) => f.id).filter((id): id is string => Boolean(id)),
  );
  const deleteFieldIds = saved
    .filter((f) => !draftIds.has(f.id))
    .map((f) => f.id);

  const fields: PlannedField[] = draft.map((field, position) => ({
    ...(field.id ? { id: field.id } : {}),
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    position,
    target_schema_id: field.target_schema_id,
  }));

  const plannedEntries: PlannedEntry[] = [];
  let entriesFlagged = 0;

  for (const entry of entries) {
    const result = transformEntry(entry, saved, draft, resolutions);
    if (result.invalid) entriesFlagged += 1;
    if (!result.changed) continue;
    plannedEntries.push({
      id: result.id,
      data: result.data,
      invalid: result.invalid,
    });
  }

  const savedById = new Map(saved.map((f) => [f.id, f]));
  const fieldsChanged = draft.filter((field) => {
    if (!field.id) return false;
    const previous = savedById.get(field.id);
    if (!previous) return false;
    return (
      previous.key !== field.key ||
      previous.label !== field.label ||
      previous.type !== field.type ||
      previous.required !== field.required ||
      previous.target_schema_id !== field.target_schema_id
    );
  }).length;

  return {
    schemaId,
    deleteFieldIds,
    fields,
    entries: plannedEntries,
    summary: {
      fieldsAdded: draft.filter((f) => !f.id).length,
      fieldsRemoved: deleteFieldIds.length,
      fieldsChanged,
      entriesUpdated: plannedEntries.length,
      entriesFlagged,
    },
  };
}
