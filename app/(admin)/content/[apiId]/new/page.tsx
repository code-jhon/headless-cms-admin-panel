import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EntryForm } from "@/components/entry/entry-form";
import { Notice } from "@/components/ui";
import { getSchemaByApiId, listReferenceOptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewEntryPage({
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
  // Nothing to render a form from — send them where they can fix that.
  if (schema.fields.length === 0) redirect(`/schemas/${schema.api_id}`);

  const referenceOptions = await listReferenceOptions(schema.fields);

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/content/${schema.api_id}`}
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← {schema.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          New {schema.name.toLowerCase()}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          This form is generated from the schema&apos;s {schema.fields.length}{" "}
          field{schema.fields.length === 1 ? "" : "s"} — nothing here is
          written per content type.
        </p>
      </header>

      <EntryForm schema={schema} referenceOptions={referenceOptions} />
    </div>
  );
}
