import { z } from "zod";

import { FIELD_TYPES } from "@/types/cms";
import { RESERVED_API_IDS, RESERVED_FIELD_KEYS } from "./constants";

/**
 * Validation shared by the client form and the server actions.
 *
 * The server re-runs every rule — the client copy exists for fast feedback,
 * not for trust. Rules here mirror the CHECK constraints in 0001_init.sql so
 * a violation surfaces as a readable message rather than a Postgres error.
 */

const MACHINE_NAME = /^[a-z][a-z0-9_]*$/;

/** `Published At!` → `published_at`. Used to prefill machine names. */
export function toMachineName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .replace(/^([0-9])/, "f_$1") // must start with a letter
    .slice(0, 48);
}

const machineName = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what} is required`)
    .max(48, `${what} must be 48 characters or fewer`)
    .regex(
      MACHINE_NAME,
      `${what} must be lowercase, start with a letter, and use only letters, numbers and underscores`,
    );

/* ------------------------------------------------------------------ Schema */

export const schemaMetaSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(60, "Name must be 60 characters or fewer"),
  api_id: machineName("API ID").refine((v) => !RESERVED_API_IDS.has(v), {
    message: "That API ID is reserved by the app — pick another",
  }),
  description: z
    .string()
    .trim()
    .max(200, "Description must be 200 characters or fewer")
    .optional()
    .or(z.literal("")),
});

export type SchemaMetaInput = z.infer<typeof schemaMetaSchema>;

/* ------------------------------------------------------------------- Field */

/**
 * A field as held in the editor's draft state. `id` is absent for fields the
 * user just added — that is how the diff tells "new" from "changed".
 */
export const fieldDraftSchema = z
  .object({
    id: z.string().uuid().optional(),
    key: machineName("Field ID").refine((v) => !RESERVED_FIELD_KEYS.has(v), {
      message:
        "That field ID is reserved by the entry envelope — pick another",
    }),
    label: z
      .string()
      .trim()
      .min(1, "Label is required")
      .max(60, "Label must be 60 characters or fewer"),
    type: z.enum(FIELD_TYPES),
    required: z.boolean(),
    target_schema_id: z.string().uuid().nullable(),
  })
  .refine((f) => f.type !== "reference" || f.target_schema_id !== null, {
    message: "Reference fields need a target content type",
    path: ["target_schema_id"],
  })
  .refine((f) => f.type === "reference" || f.target_schema_id === null, {
    message: "Only reference fields can have a target",
    path: ["target_schema_id"],
  });

export type FieldDraft = z.infer<typeof fieldDraftSchema>;

export const fieldDraftListSchema = z
  .array(fieldDraftSchema)
  .min(1, "A content type needs at least one field")
  .superRefine((fields, ctx) => {
    const seen = new Map<string, number>();
    fields.forEach((field, index) => {
      const first = seen.get(field.key);
      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate field ID "${field.key}" — also used by field ${first + 1}`,
          path: [index, "key"],
        });
        return;
      }
      seen.set(field.key, index);
    });
  });

/* ------------------------------------------------- client-side field errors */

export interface FieldErrors {
  key?: string;
  label?: string;
  target_schema_id?: string;
}

/**
 * Per-row errors for the editor. Returns a sparse array aligned with `fields`
 * so each row renders only its own problems.
 */
export function validateFieldDrafts(
  fields: FieldDraft[],
): { errors: FieldErrors[]; formError: string | null } {
  const errors: FieldErrors[] = fields.map(() => ({}));
  let formError: string | null = null;

  if (fields.length === 0) {
    return { errors, formError: "A content type needs at least one field" };
  }

  const parsed = fieldDraftListSchema.safeParse(fields);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [index, prop] = issue.path;
      if (typeof index === "number" && typeof prop === "string") {
        const slot = errors[index];
        if (slot && !slot[prop as keyof FieldErrors]) {
          slot[prop as keyof FieldErrors] = issue.message;
        }
      } else {
        formError ??= issue.message;
      }
    }
  }

  return { errors, formError };
}
