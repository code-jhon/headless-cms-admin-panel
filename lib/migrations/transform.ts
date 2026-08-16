import { isEmptyValue } from "@/lib/schema/zod-builder";
import type { Entry, Field, FieldType, FieldValue } from "@/types/cms";
import type { FieldDraft } from "@/lib/schema/validation";

/**
 * Value conversion and per-entry transformation — pure, no I/O.
 *
 * **This module is the reason the preview cannot lie.** The dry-run that
 * produces the before/after table and the write that is actually applied both
 * call `transformEntry`; there is no second implementation in SQL. The
 * database RPC receives values this module already computed and is
 * responsible only for writing them atomically.
 *
 * That is the whole architectural trade: doing the transform in SQL would
 * have meant two implementations of the same rules, and any drift between
 * them would show up as a preview that promised one thing and a migration
 * that did another — the exact failure this feature exists to prevent.
 */

export type ConversionResult =
  | { ok: true; value: FieldValue }
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Calendar-real check — `Date.parse` accepts 31 February and rolls it over. */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function toIsoDate(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

const TRUEY = new Set(["true", "yes", "y", "1", "on"]);
const FALSEY = new Set(["false", "no", "n", "0", "off"]);

/**
 * Convert one stored value between field types.
 *
 * Rules are deliberately conservative: anything ambiguous fails rather than
 * guessing, because a wrong-but-plausible conversion is worse than one the
 * user is asked to resolve. `7 → boolean` fails for that reason, while
 * `0`/`1` succeed.
 */
export function convertValue(
  value: FieldValue,
  from: FieldType,
  to: FieldType,
): ConversionResult {
  // Empty stays empty regardless of types — there is nothing to convert.
  if (isEmptyValue(value)) return { ok: true, value: null };
  if (from === to) return { ok: true, value };

  switch (to) {
    case "text":
      // Everything has a faithful string form.
      return { ok: true, value: String(value) };

    case "number": {
      if (from === "boolean") return { ok: true, value: value ? 1 : 0 };
      if (from === "date") {
        const ms = Date.parse(`${String(value)}T00:00:00Z`);
        return Number.isNaN(ms)
          ? { ok: false, reason: "not a parseable date" }
          : { ok: true, value: ms };
      }
      if (from === "reference") {
        return { ok: false, reason: "an entry id is not a number" };
      }
      const parsed = Number(String(value).trim());
      return Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, reason: "not a number" };
    }

    case "boolean": {
      if (from === "number") {
        if (value === 0) return { ok: true, value: false };
        if (value === 1) return { ok: true, value: true };
        return { ok: false, reason: "only 0 and 1 convert unambiguously" };
      }
      if (from === "text") {
        const text = String(value).trim().toLowerCase();
        if (TRUEY.has(text)) return { ok: true, value: true };
        if (FALSEY.has(text)) return { ok: true, value: false };
        return { ok: false, reason: "not a recognisable true/false value" };
      }
      return { ok: false, reason: `cannot read a ${from} as true/false` };
    }

    case "date": {
      if (from === "number") {
        const iso = toIsoDate(Number(value));
        return iso
          ? { ok: true, value: iso }
          : { ok: false, reason: "not a valid timestamp" };
      }
      if (from === "text") {
        const text = String(value).trim();
        if (isRealDate(text)) return { ok: true, value: text };

        // A value already shaped like YYYY-MM-DD but not on the calendar is
        // rejected outright. Falling through to the lenient parse below would
        // roll 2026-02-29 over to 2026-03-01 and call it a success — silently
        // storing a date the editor never wrote.
        if (ISO_DATE.test(text)) {
          return { ok: false, reason: "that date does not exist" };
        }

        // Other shapes (a full timestamp, "15 Aug 2026") may still parse.
        const ms = Date.parse(text);
        if (!Number.isNaN(ms)) {
          const iso = toIsoDate(ms);
          if (iso && isRealDate(iso)) return { ok: true, value: iso };
        }
        return { ok: false, reason: "not a date the system can read" };
      }
      return { ok: false, reason: `cannot read a ${from} as a date` };
    }

    case "reference": {
      // A reference must be an entry id. A string that happens to be a uuid
      // is allowed through; whether it points at a real entry of the right
      // type is checked server-side on write.
      const text = String(value).trim();
      if (from === "text" && UUID.test(text)) return { ok: true, value: text };
      return { ok: false, reason: "not an entry id" };
    }

    default:
      return { ok: false, reason: "unsupported conversion" };
  }
}

/* ------------------------------------------------------------ resolutions */

/**
 * What to do with values a change cannot carry over.
 *
 * `convert` alone is enough when everything converts; the others exist for
 * the rows that do not (PRD D4).
 */
export type ResolutionStrategy =
  | "convert"
  | "default"
  | "clear"
  | "flag";

export interface Resolution {
  strategy: ResolutionStrategy;
  /** Used by `default`, and as the fill for a newly-required field. */
  defaultValue?: FieldValue;
  /** Per-entry values typed by the user — highest precedence. */
  overrides?: Record<string, FieldValue>;
}

/** Keyed by the field's key in the *draft* (its name after the change). */
export type Resolutions = Record<string, Resolution>;

export type ProblemKind = "unconvertible" | "required-empty";

export interface Problem {
  fieldKey: string;
  fieldLabel: string;
  kind: ProblemKind;
  reason: string;
  /** The value that could not be carried over. */
  before: FieldValue;
  /** The user has made a decision about this field. */
  resolved: boolean;
  /** This problem leaves the row marked `invalid`. */
  flags: boolean;
}

export interface TransformedEntry {
  id: string;
  data: Record<string, FieldValue>;
  invalid: boolean;
  problems: Problem[];
  /** True when the transformed data differs from what is stored. */
  changed: boolean;
}

/**
 * Apply a whole field change set to one entry.
 *
 * Values are pulled by the *saved* field key and written under the *draft*
 * key, which is what makes a rename preserve data (PRD D6) — a key-based
 * diff would have dropped the column and created an empty one.
 */
export function transformEntry(
  entry: Entry,
  saved: Field[],
  draft: FieldDraft[],
  resolutions: Resolutions = {},
): TransformedEntry {
  const savedById = new Map(saved.map((f) => [f.id, f]));
  const data: Record<string, FieldValue> = {};
  const problems: Problem[] = [];

  for (const field of draft) {
    const previous = field.id ? savedById.get(field.id) : undefined;
    const resolution = resolutions[field.key];
    const override = resolution?.overrides?.[entry.id];

    // An inline edit wins over everything else.
    if (override !== undefined) {
      data[field.key] = override;
      continue;
    }

    // A field that did not exist before starts empty (or at its default).
    if (!previous) {
      const seeded = resolution?.defaultValue ?? null;
      data[field.key] = seeded;
      if (field.required && isEmptyValue(seeded)) {
        problems.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          kind: "required-empty",
          reason: "new required field has no value",
          before: null,
          resolved: resolution?.strategy === "flag",
          flags: true,
        });
      }
      continue;
    }

    const before = entry.data?.[previous.key] ?? null;
    const converted = convertValue(before, previous.type, field.type);
    const strategy = resolution?.strategy ?? "convert";
    const hasDefault =
      strategy === "default" && !isEmptyValue(resolution?.defaultValue);

    if (!converted.ok) {
      if (hasDefault) {
        // Fully resolved: the user supplied a replacement, so this is no
        // longer a problem at all.
        data[field.key] = resolution!.defaultValue!;
        continue;
      }

      data[field.key] = emptyFor(field.type);
      problems.push({
        fieldKey: field.key,
        fieldLabel: field.label,
        kind: "unconvertible",
        reason: converted.reason,
        before,
        // `clear` is a deliberate acceptance of the loss, so the row stays
        // clean. An undecided change, or an explicit `flag`, does not.
        resolved: strategy === "clear" || strategy === "flag",
        flags: strategy !== "clear",
      });
      continue;
    }

    let value = converted.value;

    // A field that just became required, on a row that has nothing in it.
    if (field.required && isEmptyValue(value)) {
      if (hasDefault) {
        value = resolution!.defaultValue!;
      } else {
        problems.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          kind: "required-empty",
          reason: "value is empty but the field is now required",
          before,
          // Clearing cannot resolve "this must not be empty", so unlike an
          // unconvertible value there is no non-flagging way out here.
          resolved: strategy === "flag",
          flags: true,
        });
      }
    }

    data[field.key] = value;
  }

  // Start from a clean slate: a migration that fixes every problem on a row
  // should clear a flag set by an earlier one.
  const invalid = problems.some((p) => p.flags);

  return {
    id: entry.id,
    data,
    invalid,
    problems,
    changed: invalid !== entry.invalid || !sameData(data, entry.data ?? {}),
  };
}

/**
 * Compare two stored-value maps, ignoring key order.
 *
 * `JSON.stringify` would report a difference purely because the draft
 * rebuilds the object in field order — so reordering fields would rewrite
 * every entry, bump every `updated_at`, and wake every connected client for
 * a change that touched no data at all. jsonb does not preserve key order
 * either, so order genuinely carries no meaning here.
 */
function sameData(
  a: Record<string, FieldValue>,
  b: Record<string, FieldValue>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key] ?? null;
    const right = b[key] ?? null;
    if (left !== right) return false;
  }
  return true;
}

/** The empty value for a type — booleans have no null state in the form. */
function emptyFor(type: FieldType): FieldValue {
  return type === "boolean" ? false : null;
}
