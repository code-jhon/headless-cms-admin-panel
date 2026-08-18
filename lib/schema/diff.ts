import type { Field, FieldType } from "@/types/cms";
import type { FieldDraft } from "./validation";

/**
 * Field diff and risk classification.
 *
 * This is the seam milestone 5 (Schema Evolution) is built on. The pipeline is
 * intended to be:
 *
 *   diff → classify → [analyze → preview → resolve] → apply
 *
 * Milestone 1 implements diff, classify and apply, and *gates* anything that
 * is not safe when entries already exist. Milestone 5 fills in the bracketed
 * steps and lifts the gate — no rewrite of this module required.
 *
 * Pure functions only: no I/O, so the same code runs in the editor for live
 * feedback and on the server as the authority.
 */

export type ChangeKind =
  | "add_field"
  | "delete_field"
  | "rename_key"
  | "rename_label"
  | "retype"
  | "set_required"
  | "unset_required"
  | "retarget_reference"
  | "reorder";

/**
 * safe     — cannot lose or invalidate data; always applicable.
 * lossy    — existing values may be dropped or become unconvertible.
 * blocking — existing entries would violate the new rule as they stand.
 */
export type RiskLevel = "safe" | "lossy" | "blocking";

export interface FieldChange {
  kind: ChangeKind;
  risk: RiskLevel;
  /** Field key after the change — the stable handle for the UI. */
  key: string;
  /** Field key before the change, when it differs. */
  previousKey?: string;
  label: string;
  /** One sentence, plain language, shown next to the change. */
  summary: string;
  /** Why it is risky. Only set when risk is not "safe". */
  consequence?: string;
  from?: string;
  to?: string;
}

/* -------------------------------------------------------------- type rules */

/**
 * Which type conversions can be attempted without inspecting data.
 *
 * "lossless" — every value of the source type maps cleanly.
 * "partial"  — some values convert, others cannot (needs per-row review).
 * "lossy"    — the stored value is effectively discarded.
 */
type Convertibility = "lossless" | "partial" | "lossy";

const CONVERSIONS: Record<FieldType, Partial<Record<FieldType, Convertibility>>> =
  {
    text: {
      number: "partial", // "42" converts, "abc" does not
      boolean: "partial", // "true"/"false" convert
      date: "partial", // parseable dates convert
      reference: "lossy", // an arbitrary string is not an entry id
    },
    number: {
      text: "lossless",
      boolean: "partial", // 0/1 convert, 7 is ambiguous
      date: "partial", // epoch millis, if the user means that
      reference: "lossy",
    },
    boolean: {
      text: "lossless",
      number: "lossless", // false → 0, true → 1
      date: "lossy",
      reference: "lossy",
    },
    date: {
      text: "lossless",
      // Epoch millis are recoverable, but "1843-10-01" becoming -3984163200000
      // is not what an editor expects to see. Flag it for review rather than
      // applying it silently: the bytes survive, the meaning does not.
      number: "partial",
      boolean: "lossy",
      reference: "lossy",
    },
    reference: {
      text: "lossless", // keeps the id as a string
      number: "lossy",
      boolean: "lossy",
      date: "lossy",
    },
  };

export function conversionRisk(from: FieldType, to: FieldType): Convertibility {
  if (from === to) return "lossless";
  return CONVERSIONS[from]?.[to] ?? "lossy";
}

/* -------------------------------------------------------------------- diff */

/**
 * Compare saved fields against the editor draft.
 *
 * Matching is by `id`: a draft row without an id is new, and a saved field
 * with no draft row carrying its id was deleted. That is what makes a rename
 * distinguishable from a delete-plus-create — and therefore what lets the
 * rename preserve data.
 */
export function diffFields(
  saved: Field[],
  draft: FieldDraft[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  const savedById = new Map(saved.map((f) => [f.id, f]));
  const draftIds = new Set(
    draft.map((f) => f.id).filter((id): id is string => Boolean(id)),
  );

  // Deletions
  for (const field of saved) {
    if (draftIds.has(field.id)) continue;
    changes.push({
      kind: "delete_field",
      risk: "lossy",
      key: field.key,
      label: field.label,
      summary: `Delete field "${field.label}"`,
      consequence: `Values stored under "${field.key}" are removed from every entry.`,
    });
  }

  // Additions and modifications
  draft.forEach((next, index) => {
    if (!next.id) {
      changes.push({
        kind: "add_field",
        risk: "safe",
        key: next.key,
        label: next.label,
        summary: `Add ${next.type} field "${next.label}"`,
        // A new required field is only blocking once entries exist; the
        // caller decides that, since it needs the entry count.
        ...(next.required
          ? {
              consequence: `Existing entries have no value for "${next.key}".`,
            }
          : {}),
      });
      return;
    }

    const prev = savedById.get(next.id);
    if (!prev) return; // draft references a field that vanished; ignore

    if (prev.key !== next.key) {
      changes.push({
        kind: "rename_key",
        risk: "lossy",
        key: next.key,
        previousKey: prev.key,
        label: next.label,
        summary: `Rename field ID "${prev.key}" to "${next.key}"`,
        consequence:
          "Stored values must be moved to the new key, and any consumer reading the old key breaks.",
        from: prev.key,
        to: next.key,
      });
    }

    if (prev.label !== next.label) {
      changes.push({
        kind: "rename_label",
        risk: "safe",
        key: next.key,
        label: next.label,
        summary: `Rename "${prev.label}" to "${next.label}"`,
        from: prev.label,
        to: next.label,
      });
    }

    if (prev.type !== next.type) {
      const convertibility = conversionRisk(prev.type, next.type);
      changes.push({
        kind: "retype",
        risk: convertibility === "lossless" ? "safe" : "lossy",
        key: next.key,
        label: next.label,
        summary: `Change "${next.label}" from ${prev.type} to ${next.type}`,
        consequence:
          convertibility === "lossless"
            ? undefined
            : convertibility === "partial"
              ? "Some stored values will not convert and need review."
              : "Stored values cannot be converted and would be discarded.",
        from: prev.type,
        to: next.type,
      });
    }

    if (!prev.required && next.required) {
      changes.push({
        kind: "set_required",
        risk: "blocking",
        key: next.key,
        label: next.label,
        summary: `Make "${next.label}" required`,
        consequence: `Entries with an empty "${next.key}" would violate this.`,
      });
    }

    if (prev.required && !next.required) {
      changes.push({
        kind: "unset_required",
        risk: "safe",
        key: next.key,
        label: next.label,
        summary: `Make "${next.label}" optional`,
      });
    }

    if (
      next.type === "reference" &&
      prev.type === "reference" &&
      prev.target_schema_id !== next.target_schema_id
    ) {
      changes.push({
        kind: "retarget_reference",
        risk: "lossy",
        key: next.key,
        label: next.label,
        summary: `Point "${next.label}" at a different content type`,
        consequence:
          "Existing references point at entries of the old type and become invalid.",
      });
    }

    if (prev.position !== index) {
      changes.push({
        kind: "reorder",
        risk: "safe",
        key: next.key,
        label: next.label,
        summary: `Move "${next.label}" to position ${index + 1}`,
        from: String(prev.position + 1),
        to: String(index + 1),
      });
    }
  });

  return changes;
}

/* --------------------------------------------------------------- gatekeeping */

export interface ChangeGate {
  /** Changes that can be applied right now. */
  applicable: FieldChange[];
  /** Changes held back because they need the milestone 5 review flow. */
  blocked: FieldChange[];
  /** True when nothing is held back. */
  canApply: boolean;
}

/**
 * Decide what may be applied given how many entries exist.
 *
 * With no entries there is nothing to lose, so every change is applicable —
 * which is exactly the case a reviewer will exercise first. Once entries
 * exist, anything non-safe waits for the review → preview → resolve flow.
 */
export function gateChanges(
  changes: FieldChange[],
  entryCount: number,
): ChangeGate {
  if (entryCount === 0) {
    return { applicable: changes, blocked: [], canApply: true };
  }

  const applicable: FieldChange[] = [];
  const blocked: FieldChange[] = [];

  for (const change of changes) {
    // A newly added required field is blocking only when entries exist.
    const effectiveRisk: RiskLevel =
      change.kind === "add_field" && change.consequence
        ? "blocking"
        : change.risk;

    (effectiveRisk === "safe" ? applicable : blocked).push(change);
  }

  return { applicable, blocked, canApply: blocked.length === 0 };
}

/** Highest risk present, for summarising a change set in one badge. */
export function peakRisk(changes: FieldChange[]): RiskLevel | null {
  if (changes.some((c) => c.risk === "blocking")) return "blocking";
  if (changes.some((c) => c.risk === "lossy")) return "lossy";
  return changes.length > 0 ? "safe" : null;
}
