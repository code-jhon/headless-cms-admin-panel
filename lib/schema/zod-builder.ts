import { z } from "zod";

import type { Entry, Field, FieldType, FieldValue } from "@/types/cms";

/**
 * Runtime validation, compiled from field rows.
 *
 * This is what makes the entry editor generic: there is no hand-written form
 * or hand-written validator per content type. The same `fields` rows that
 * render the form also produce the schema that validates it — in the browser
 * for immediate feedback, and again on the server, which is the authority.
 *
 * Adding a sixth field type touches exactly two places: `VALIDATORS` here and
 * the renderer registry in `components/fields`. That is PRD B5.
 */

/** `YYYY-MM-DD` — how dates are stored in JSONB. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for dates that exist on the calendar.
 *
 * `Date.parse("2026-02-31")` does NOT fail — JavaScript rolls it over to
 * 3 March. Round-tripping the parsed date back to its parts is the only
 * reliable way to catch that, and leap years come out right for free.
 */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Per-type validators. Each returns the schema for a *filled in* value; the
 * required/optional wrapper is applied by `fieldValidator` so the empty-value
 * rule stays in one place.
 */
const VALIDATORS: Record<FieldType, (field: Field) => z.ZodTypeAny> = {
  text: () => z.string().min(1, "This field cannot be empty"),

  number: () =>
    z
      .number({ message: "Enter a number" })
      .finite("Enter a finite number"),

  boolean: () => z.boolean(),

  date: () =>
    z
      .string()
      .regex(ISO_DATE, "Enter a date as YYYY-MM-DD")
      .refine(isRealCalendarDate, { message: "That is not a real date" }),

  reference: () => z.string().uuid("Pick an entry"),
};

/**
 * Whether a value counts as "not filled in".
 *
 * `false` is a real boolean value, and `0` is a real number — neither is
 * empty. Only null, undefined and the empty string are.
 */
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Wrap a per-type validator with the required/optional rule.
 *
 * Written as an explicit `superRefine` rather than `.nullable().optional()`
 * so the *empty* case reports "Title is required" instead of a type error
 * about `null`, which is what an editor actually needs to read.
 */
function fieldValidator(field: Field): z.ZodTypeAny {
  const base = VALIDATORS[field.type](field);

  const checked = z.any().superRefine((value, ctx) => {
    if (isEmptyValue(value)) {
      if (field.required) {
        ctx.addIssue({
          code: "custom",
          message: `${field.label} is required`,
        });
      }
      return;
    }

    const result = base.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message });
      }
    }
  });

  // Empty optional values normalise to null, so stored JSON stays consistent
  // and the read API never has to distinguish "" from absent from undefined.
  return checked.transform((value) =>
    isEmptyValue(value) ? null : (value as FieldValue),
  );
}

/** Compile a validation schema for one content type's entry data. */
export function buildEntrySchema(fields: Field[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = fieldValidator(field);
  }
  // Unknown keys are dropped rather than rejected: a client running a stale
  // schema should not be able to smuggle values into storage.
  return z.object(shape).strip();
}

export type EntryFormValues = Record<string, FieldValue>;

/* ------------------------------------------------------------- form values */

/** The blank value a field starts at in a new-entry form. */
export function emptyValueFor(field: Field): FieldValue {
  return field.type === "boolean" ? false : null;
}

/** Default values for a new entry. */
export function defaultValuesFor(fields: Field[]): EntryFormValues {
  const values: EntryFormValues = {};
  for (const field of fields) {
    values[field.key] = emptyValueFor(field);
  }
  return values;
}

/**
 * Stored entry data → form values.
 *
 * Fills in any field the entry predates (added after it was written) and
 * drops keys no longer in the schema, so the form always matches the schema
 * rather than the row.
 */
export function toFormValues(
  fields: Field[],
  entry?: Entry | null,
): EntryFormValues {
  const values = defaultValuesFor(fields);
  if (!entry) return values;

  for (const field of fields) {
    const stored = entry.data?.[field.key];
    if (stored === undefined) continue;

    // A boolean field must never hold null in the form, or the checkbox
    // becomes uncontrolled.
    values[field.key] =
      field.type === "boolean" ? Boolean(stored) : (stored as FieldValue);
  }

  return values;
}

/**
 * Form values → the object stored in `entries.data`.
 *
 * Runs the values through the compiled schema, so what is written is exactly
 * what validated. Returns either the clean data or per-field messages.
 */
export function parseEntryData(
  fields: Field[],
  values: unknown,
):
  | { ok: true; data: EntryFormValues }
  | { ok: false; errors: Record<string, string> } {
  const result = buildEntrySchema(fields).safeParse(values);

  if (result.success) {
    return { ok: true, data: result.data as EntryFormValues };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !errors[key]) {
      errors[key] = issue.message;
    }
  }
  return { ok: false, errors };
}

/* ------------------------------------------------------ coercion from input */

/**
 * Raw DOM input → a typed value.
 *
 * `<input>` always hands back a string; this is where that becomes the shape
 * the validator expects. Kept separate from validation so a half-typed
 * number ("-", "1.") does not blow up mid-keystroke — it becomes null and the
 * required check reports it, if it matters.
 */
export function coerceInput(type: FieldType, raw: string | boolean): FieldValue {
  if (type === "boolean") return Boolean(raw);

  const value = String(raw);
  if (value === "") return null;

  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return value;
}
