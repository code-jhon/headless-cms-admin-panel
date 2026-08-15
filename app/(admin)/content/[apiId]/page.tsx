import Link from "next/link";
import { notFound } from "next/navigation";

import { EntryTable } from "@/components/entry/entry-table";
import { Button, Card, Notice } from "@/components/ui";
import {
  getSchemaByApiId,
  listEntries,
  listReferenceTitles,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ContentListPage({
  params,
}: {
  params: Promise<{ apiId: string }>;
}) {
  const { apiId } = await params;
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

  const [{ data: entries }, referenceTitles] = await Promise.all([
    listEntries(schema.id),
    listReferenceTitles(schema.fields),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
            {schema.name}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {schema.description ??
              `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/schemas/${schema.api_id}`}>
            <Button>Edit schema</Button>
          </Link>
          {schema.fields.length > 0 ? (
            <Link href={`/content/${schema.api_id}/new`}>
              <Button variant="primary">New entry</Button>
            </Link>
          ) : null}
        </div>
      </header>

      {schema.fields.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <p className="text-sm font-medium text-ink">
            This content type has no fields
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
            The entry form is generated from the field definitions, so add at
            least one field first.
          </p>
          <Link
            href={`/schemas/${schema.api_id}`}
            className="mt-4 inline-block"
          >
            <Button variant="primary">Add fields</Button>
          </Link>
        </Card>
      ) : (
        <EntryTable
          schema={schema}
          entries={entries}
          referenceTitles={Object.fromEntries(referenceTitles)}
        />
      )}
    </div>
  );
}
