import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteEntryButton } from "@/components/entry/delete-entry-button";
import { EntryForm } from "@/components/entry/entry-form";
import { Notice } from "@/components/ui";
import { entryTitle } from "@/lib/schema/display";
import {
  getEntry,
  getSchemaByApiId,
  listReferenceOptions,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ apiId: string; entryId: string }>;
}) {
  const { apiId, entryId } = await params;
  const { data: schema, error } = await getSchemaByApiId(apiId);

  if (error) {
    return (
      <Notice tone="warn" title="Cannot load this content type">
        See the{" "}
        <Link href="/health" className="font-medium text-accent underline">
          health check
        </Link>
        .
      </Notice>
    );
  }

  if (!schema) notFound();

  const [{ data: entry }, referenceOptions] = await Promise.all([
    getEntry(schema.id, entryId),
    listReferenceOptions(schema.fields),
  ]);

  if (!entry) notFound();

  const title = entryTitle(entry, schema.fields);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/content/${schema.api_id}`}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← {schema.name}
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-muted">{entry.id}</p>
        </div>
        <DeleteEntryButton
          schemaId={schema.id}
          apiId={schema.api_id}
          entryId={entry.id}
          title={title}
        />
      </header>

      <EntryForm
        schema={schema}
        entry={entry}
        referenceOptions={referenceOptions}
      />
    </div>
  );
}
