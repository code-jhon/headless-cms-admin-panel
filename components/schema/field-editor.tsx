"use client";

import { useMemo, useState, useTransition } from "react";

import { Button, Notice } from "@/components/ui";
import { ChangeSummary } from "./change-summary";
import { FieldRow } from "./field-row";
import { diffFields, gateChanges } from "@/lib/schema/diff";
import {
  validateFieldDrafts,
  type FieldDraft,
} from "@/lib/schema/validation";
import type { ContentSchema, Field } from "@/types/cms";

export function fieldToDraft(field: Field): FieldDraft {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    target_schema_id: field.target_schema_id,
  };
}

export function emptyDraft(): FieldDraft {
  return {
    key: "",
    label: "",
    type: "text",
    required: false,
    target_schema_id: null,
  };
}

interface FieldEditorProps {
  /** Saved state to diff against. Empty when creating a new schema. */
  saved: Field[];
  fields: FieldDraft[];
  onChange: (fields: FieldDraft[]) => void;
  referenceTargets: ContentSchema[];
  entryCount: number;
  /** Server-reported per-index errors from the last save attempt. */
  serverFieldErrors?: Record<number, string>;
}

/**
 * The field list editor.
 *
 * Draft state lives here and nothing is written until the parent saves, which
 * is what lets the change summary explain the consequences *before* they
 * happen — the shape milestone 5 needs.
 */
export function FieldEditor({
  saved,
  fields,
  onChange,
  referenceTargets,
  entryCount,
  serverFieldErrors,
}: FieldEditorProps) {
  const { errors, formError } = useMemo(
    () => validateFieldDrafts(fields),
    [fields],
  );

  const changes = useMemo(() => diffFields(saved, fields), [saved, fields]);
  const gate = useMemo(
    () => gateChanges(changes, entryCount),
    [changes, entryCount],
  );

  function patch(index: number, values: Partial<FieldDraft>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...values } : f)));
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border-subtle bg-surface">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">Fields</h2>
          <Button
            type="button"
            size="sm"
            onClick={() => onChange([...fields, emptyDraft()])}
          >
            Add field
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            No fields yet. Add at least one.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {fields.map((field, index) => (
              <FieldRow
                key={field.id ?? `new-${index}`}
                field={field}
                index={index}
                total={fields.length}
                errors={{
                  ...errors[index],
                  ...(serverFieldErrors?.[index]
                    ? { key: serverFieldErrors[index] }
                    : {}),
                }}
                referenceTargets={referenceTargets}
                onChange={(values) => patch(index, values)}
                onMove={(direction) => move(index, direction)}
                onRemove={() => remove(index)}
              />
            ))}
          </ul>
        )}
      </div>

      {formError ? <Notice tone="danger">{formError}</Notice> : null}

      <ChangeSummary
        changes={changes}
        blocked={gate.blocked}
        entryCount={entryCount}
      />
    </div>
  );
}

/** Shared save-state helper so both pages behave identically. */
export function useSaveState() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);

  return {
    pending,
    error,
    fieldErrors,
    saved,
    run(action: () => Promise<void>) {
      setError(null);
      setFieldErrors({});
      setSaved(false);
      startTransition(async () => {
        await action();
      });
    },
    reportError(message: string, perField?: Record<number, string>) {
      setError(message);
      setFieldErrors(perField ?? {});
    },
    reportSaved() {
      setSaved(true);
    },
  };
}
