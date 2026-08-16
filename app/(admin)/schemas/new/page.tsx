import Link from "next/link";

import { NewSchemaForm } from "@/components/schema/new-schema-form";
import { Notice } from "@/components/ui";
import { listSchemas } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewSchemaPage() {
  const { data: schemas, error } = await listSchemas();

  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/schemas"
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Schema builder
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          New content type
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Name it, then describe its fields. The entry editor is generated from
          this definition.
        </p>
      </header>

      {error ? (
        <Notice tone="warn" title="Cannot reach the database">
          See the{" "}
          <Link href="/health" className="font-medium text-accent underline">
            health check
          </Link>
          .
        </Notice>
      ) : (
        <NewSchemaForm existingSchemas={schemas} />
      )}
    </div>
  );
}
