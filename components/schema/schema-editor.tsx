"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button, FormField, Input, Notice, Textarea } from "@/components/ui";
import { DeleteSchemaDialog } from "./delete-schema-dialog";
import { FieldEditor, fieldToDraft, useSaveState } from "./field-editor";
import { MigrationReview } from "./migration-review";
import { diffFields, gateChanges } from "@/lib/schema/diff";
import { saveSchemaFields, updateSchemaMeta } from "@/lib/actions/schemas";
import type { SchemaUsage } from "@/lib/queries";
import type { FieldDraft } from "@/lib/schema/validation";
import type { ContentSchema, SchemaWithFields } from "@/types/cms";

export function SchemaEditor({
  schema,
  allSchemas,
  usage,
}: {
  schema: SchemaWithFields;
  allSchemas: ContentSchema[];
  usage: SchemaUsage;
}) {
  const router = useRouter();
  const save = useSaveState();

  const [name, setName] = useState(schema.name);
  const [description, setDescription] = useState(schema.description ?? "");
  const [fields, setFields] = useState<FieldDraft[]>(
    schema.fields.map(fieldToDraft),
  );
  const [reviewing, setReviewing] = useState(false);

  const metaChanged =
    name !== schema.name || description !== (schema.description ?? "");

  /**
   * Which save path applies.
   *
   * With no entries there is nothing to migrate, so changes go straight
   * through the plain save. Once entries exist, anything non-safe goes
   * through the review flow instead of being refused — that is the gate
   * milestone 1 put in place and milestone 5 lifts.
   */
  const changes = useMemo(
    () => diffFields(schema.fields, fields),
    [schema.fields, fields],
  );
  const gate = useMemo(
    () => gateChanges(changes, usage.entryCount),
    [changes, usage.entryCount],
  );
  const needsMigration = changes.length > 0 && !gate.canApply;

  function handleSave() {
    save.run(async () => {
      if (metaChanged) {
        const meta = await updateSchemaMeta(schema.id, { name, description });
        if (!meta.ok) {
          save.reportError(meta.error ?? "Could not update the content type.");
          return;
        }
      }

      const result = await saveSchemaFields(schema.id, fields);
      if (!result.ok) {
        save.reportError(
          result.error ?? "Could not save the fields.",
          result.fieldErrors,
        );
        return;
      }

      save.reportSaved();
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
            {schema.name}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            /api/content/{schema.api_id}
          </p>
        </div>
        <DeleteSchemaDialog
          schemaId={schema.id}
          schemaName={schema.name}
          apiId={schema.api_id}
          usage={usage}
        />
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" htmlFor="schema-name">
            <Input
              id="schema-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>

          <FormField
            label="API ID"
            htmlFor="schema-api-id"
            hint="Permanent — changing it would break every consumer reading this path."
          >
            <Input
              id="schema-api-id"
              value={schema.api_id}
              readOnly
              disabled
              className="font-mono text-xs"
            />
          </FormField>
        </div>

        <div className="mt-4">
          <FormField label="Description" htmlFor="schema-description">
            <Textarea
              id="schema-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
        </div>
      </div>

      {reviewing ? (
        <MigrationReview
          schemaId={schema.id}
          apiId={schema.api_id}
          draft={fields}
          onCancel={() => setReviewing(false)}
          onApplied={() => setReviewing(false)}
        />
      ) : (
        <FieldEditor
          saved={schema.fields}
          fields={fields}
          onChange={setFields}
          referenceTargets={allSchemas}
          entryCount={usage.entryCount}
          serverFieldErrors={save.fieldErrors}
        />
      )}

      {save.error ? <Notice tone="danger">{save.error}</Notice> : null}

      {save.saved ? (
        <Notice tone="accent" title="Saved">
          The content type is up to date.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {needsMigration ? (
          <Button
            type="button"
            variant="primary"
            disabled={save.pending}
            onClick={() => setReviewing(true)}
          >
            Review {changes.length} change{changes.length === 1 ? "" : "s"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            disabled={save.pending}
            onClick={handleSave}
          >
            {save.pending ? "Saving…" : "Save changes"}
          </Button>
        )}
        <Button
          type="button"
          disabled={save.pending}
          onClick={() => {
            setName(schema.name);
            setDescription(schema.description ?? "");
            setFields(schema.fields.map(fieldToDraft));
          }}
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
