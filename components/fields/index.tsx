"use client";

import { Checkbox, Input, Select, Textarea } from "@/components/ui";
import { coerceInput } from "@/lib/schema/zod-builder";
import type { Field, FieldType, FieldValue } from "@/types/cms";

/**
 * The field renderer registry — the heart of the dynamic entry editor.
 *
 * One component per field type. The entry form walks a schema's `fields` rows
 * and looks each type up here; it never knows what a "Person" or an "Article"
 * is. Adding a sixth type means adding one component and one entry to
 * `FIELD_RENDERERS` (plus its validator in `lib/schema/zod-builder.ts`) — no
 * per-content-type code anywhere. That is PRD B5.
 */

export interface ReferenceOption {
  id: string;
  title: string;
}

export interface FieldRendererProps {
  field: Field;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  error?: string;
  disabled?: boolean;
  /** Entries of the target schema. Only used by the reference renderer. */
  options?: ReferenceOption[];
  inputId: string;
}

export type FieldRenderer = (props: FieldRendererProps) => React.ReactElement;

/* -------------------------------------------------------------------- text */

/**
 * Long values get a textarea, short ones a single line.
 *
 * The schema has one `text` type by design — the challenge asks for five
 * types, not five widgets — so the heuristic is the stored length rather
 * than a separate "long text" type.
 */
const TextField: FieldRenderer = ({
  field, value, onChange, error, disabled, inputId,
}) => {
  const text = value === null || value === undefined ? "" : String(value);
  const multiline = text.length > 80 || text.includes("\n");

  const props = {
    id: inputId,
    value: text,
    disabled,
    "aria-invalid": Boolean(error) || undefined,
    placeholder: field.label,
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(coerceInput("text", e.target.value)),
  };

  return multiline ? <Textarea rows={5} {...props} /> : <Input {...props} />;
};

/* ------------------------------------------------------------------ number */

const NumberField: FieldRenderer = ({
  value, onChange, error, disabled, inputId,
}) => (
  <Input
    id={inputId}
    type="number"
    step="any"
    inputMode="decimal"
    disabled={disabled}
    invalid={Boolean(error)}
    value={value === null || value === undefined ? "" : String(value)}
    onChange={(e) => onChange(coerceInput("number", e.target.value))}
  />
);

/* ----------------------------------------------------------------- boolean */

const BooleanField: FieldRenderer = ({
  field, value, onChange, disabled, inputId,
}) => (
  <label className="inline-flex items-center gap-2 text-sm text-ink">
    <Checkbox
      id={inputId}
      disabled={disabled}
      checked={Boolean(value)}
      onChange={(e) => onChange(e.target.checked)}
    />
    {field.label}
  </label>
);

/* -------------------------------------------------------------------- date */

const DateField: FieldRenderer = ({
  value, onChange, error, disabled, inputId,
}) => (
  <Input
    id={inputId}
    type="date"
    disabled={disabled}
    invalid={Boolean(error)}
    value={typeof value === "string" ? value : ""}
    onChange={(e) => onChange(coerceInput("date", e.target.value))}
  />
);

/* --------------------------------------------------------------- reference */

const ReferenceField: FieldRenderer = ({
  value, onChange, error, disabled, options = [], inputId,
}) => {
  const current = value === null || value === undefined ? "" : String(value);
  // A reference to an entry that no longer exists must stay visible rather
  // than silently resetting the select to "None".
  const dangling = current !== "" && !options.some((o) => o.id === current);

  return (
    <div className="space-y-1">
      <Select
        id={inputId}
        disabled={disabled || options.length === 0}
        invalid={Boolean(error) || dangling}
        value={current}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">None</option>
        {dangling ? (
          <option value={current}>
            Missing entry · {current.slice(0, 8)}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </Select>

      {options.length === 0 ? (
        <p className="text-xs text-ink-muted">
          The target content type has no entries yet.
        </p>
      ) : dangling ? (
        <p className="text-xs text-danger">
          This points at an entry that no longer exists.
        </p>
      ) : null}
    </div>
  );
};

/* ---------------------------------------------------------------- registry */

export const FIELD_RENDERERS: Record<FieldType, FieldRenderer> = {
  text: TextField,
  number: NumberField,
  boolean: BooleanField,
  date: DateField,
  reference: ReferenceField,
};

export function rendererFor(type: FieldType): FieldRenderer {
  return FIELD_RENDERERS[type] ?? TextField;
}
