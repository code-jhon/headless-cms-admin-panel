"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Badge, Button, Card, Notice } from "@/components/ui";
import { rendererFor, type ReferenceOption } from "@/components/fields";
import { FIELD_TYPE_LABELS } from "@/lib/schema/constants";
import { parseEntryData, toFormValues } from "@/lib/schema/zod-builder";
import {
  createEntry,
  forceUpdateEntry,
  updateEntry,
} from "@/lib/actions/entries";
import type { Entry, FieldValue, SchemaWithFields } from "@/types/cms";

interface EntryFormProps {
  schema: SchemaWithFields;
  /** Absent when creating. */
  entry?: Entry | null;
  referenceOptions: Record<string, ReferenceOption[]>;
}

/**
 * The generated entry form (PRD B2, B3).
 *
 * There is no per-content-type markup here: it walks `schema.fields`, asks
 * the renderer registry for a component per type, and validates against a
 * Zod schema compiled from those same rows. A brand-new content type gets a
 * working editor with no code written.
 */
export function EntryForm({ schema, entry, referenceOptions }: EntryFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const initial = useMemo(
    () => toFormValues(schema.fields, entry),
    [schema.fields, entry],
  );

  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const isEditing = Boolean(entry);
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initial),
    [values, initial],
  );

  function setValue(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear a field's error as soon as it is touched; re-validated on submit.
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function handleSubmit(event: React.FormEvent, force = false) {
    event.preventDefault();
    setFormError(null);
    setConflict(false);

    // Validate locally first for instant feedback; the server re-validates
    // against the live schema regardless.
    const parsed = parseEntryData(schema.fields, values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setFormError("Some fields need attention.");
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = entry
        ? force
          ? await forceUpdateEntry(schema.id, schema.api_id, entry.id, values)
          : await updateEntry(
              schema.id,
              schema.api_id,
              entry.id,
              values,
              entry.updated_at,
            )
        : await createEntry(schema.id, schema.api_id, values);

      if (!result.ok) {
        setFormError(result.error ?? "Could not save this entry.");
        setErrors(result.fieldErrors ?? {});
        setConflict(Boolean(result.conflict));
        return;
      }

      router.push(`/content/${schema.api_id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={(e) => handleSubmit(e)} className="space-y-5">
      {entry?.invalid ? (
        <Notice tone="warn" title="This entry needs attention">
          It was flagged when the schema or a referenced entry changed. Saving
          it again clears the flag.
        </Notice>
      ) : null}

      <Card className="divide-y divide-border-subtle">
        {schema.fields.map((field) => {
          const Renderer = rendererFor(field.type);
          const inputId = `field-${field.key}`;
          const error = errors[field.key];

          return (
            <div key={field.id} className="px-5 py-4">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                {/* The boolean renderer carries its own label next to the
                    checkbox, so avoid printing it twice. */}
                <label
                  htmlFor={inputId}
                  className={
                    field.type === "boolean"
                      ? "sr-only"
                      : "block text-sm font-medium text-ink"
                  }
                >
                  {field.label}
                  {field.required ? (
                    <span className="ml-1 text-danger" aria-hidden>
                      *
                    </span>
                  ) : null}
                </label>
                <span className="shrink-0 text-[11px] text-ink-muted">
                  {FIELD_TYPE_LABELS[field.type]}
                  {field.required ? " · required" : ""}
                </span>
              </div>

              <Renderer
                field={field}
                value={values[field.key] ?? null}
                onChange={(value) => setValue(field.key, value)}
                error={error}
                disabled={pending}
                options={referenceOptions[field.key]}
                inputId={inputId}
              />

              {error ? (
                <p className="mt-1.5 text-xs text-danger">{error}</p>
              ) : (
                <p className="mt-1.5 font-mono text-[11px] text-ink-muted">
                  {field.key}
                </p>
              )}
            </div>
          );
        })}
      </Card>

      {formError ? (
        <Notice tone={conflict ? "warn" : "danger"} title={conflict ? "Edit conflict" : undefined}>
          {formError}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? "Saving…"
            : isEditing
              ? "Save changes"
              : "Create entry"}
        </Button>

        {conflict ? (
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={(e) => handleSubmit(e, true)}
          >
            Overwrite anyway
          </Button>
        ) : null}

        <Button
          type="button"
          disabled={pending}
          onClick={() => router.push(`/content/${schema.api_id}`)}
        >
          Cancel
        </Button>

        {dirty ? <Badge tone="accent">Unsaved changes</Badge> : null}
      </div>
    </form>
  );
}
