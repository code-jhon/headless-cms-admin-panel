"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, FormField, Input, Notice, Textarea } from "@/components/ui";
import { FieldEditor, emptyDraft, useSaveState } from "./field-editor";
import { createSchema } from "@/lib/actions/schemas";
import { toMachineName, type FieldDraft } from "@/lib/schema/validation";
import type { ContentSchema } from "@/types/cms";

export function NewSchemaForm({
  existingSchemas,
}: {
  existingSchemas: ContentSchema[];
}) {
  const router = useRouter();
  const save = useSaveState();

  const [name, setName] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiIdTouched, setApiIdTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([
    { ...emptyDraft(), key: "title", label: "Title", required: true },
  ]);

  const apiIdTaken = existingSchemas.some((s) => s.api_id === apiId);

  function handleNameChange(value: string) {
    setName(value);
    if (!apiIdTouched) setApiId(toMachineName(value));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    save.run(async () => {
      const result = await createSchema({
        name,
        api_id: apiId,
        description,
        fields,
      });
      if (!result.ok) {
        save.reportError(result.error ?? "Could not create the content type.", result.fieldErrors);
        return;
      }
      router.push(result.redirectTo ?? "/schemas");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-lg border border-border-subtle bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Name"
            htmlFor="schema-name"
            hint="What editors see, e.g. Article."
          >
            <Input
              id="schema-name"
              value={name}
              placeholder="Article"
              autoFocus
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </FormField>

          <FormField
            label="API ID"
            htmlFor="schema-api-id"
            error={apiIdTaken ? "Already used by another content type" : undefined}
            hint={
              apiId ? (
                <>
                  Read API path:{" "}
                  <code className="font-mono">/api/content/{apiId}</code>
                </>
              ) : (
                "Lowercase, no spaces. Permanent once created."
              )
            }
          >
            <Input
              id="schema-api-id"
              value={apiId}
              invalid={apiIdTaken}
              placeholder="article"
              className="font-mono text-xs"
              onChange={(e) => {
                setApiIdTouched(true);
                setApiId(e.target.value);
              }}
              onBlur={(e) => setApiId(toMachineName(e.target.value))}
            />
          </FormField>
        </div>

        <div className="mt-4">
          <FormField
            label="Description"
            htmlFor="schema-description"
            hint="Optional. One line to remind everyone what this type is for."
          >
            <Textarea
              id="schema-description"
              rows={2}
              value={description}
              placeholder="A piece of written content."
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
        </div>
      </div>

      <FieldEditor
        saved={[]}
        fields={fields}
        onChange={setFields}
        referenceTargets={existingSchemas}
        entryCount={0}
        serverFieldErrors={save.fieldErrors}
      />

      {save.error ? <Notice tone="danger">{save.error}</Notice> : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={save.pending || apiIdTaken}
        >
          {save.pending ? "Creating…" : "Create content type"}
        </Button>
        <Button type="button" onClick={() => router.push("/schemas")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
