import Link from "next/link";
import { notFound } from "next/navigation";

import { SchemaEditor } from "@/components/schema/schema-editor";
import { Notice } from "@/components/ui";
import { getSchemaByApiId, getSchemaUsage, listSchemas } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SchemaDetailPage({
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

  const [{ data: allSchemas }, { data: usage }] = await Promise.all([
    listSchemas(),
    getSchemaUsage(schema.id),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/schemas" className="text-sm text-ink-muted hover:text-ink">
        ← Schema builder
      </Link>
      <SchemaEditor schema={schema} allSchemas={allSchemas} usage={usage} />
    </div>
  );
}
