import Link from "next/link";

import { Badge, Button, Card, Notice } from "@/components/ui";
import { listSchemaSummaries } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SchemasPage() {
  const { data: schemas, error } = await listSchemaSummaries();

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Schema builder
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Content types and the fields they are made of.
          </p>
        </div>
        {error ? null : (
          <Link href="/schemas/new">
            <Button variant="primary">New content type</Button>
          </Link>
        )}
      </header>

      {error ? (
        <Notice tone="warn" title="Cannot load content types">
          See the{" "}
          <Link href="/health" className="font-medium text-accent underline">
            health check
          </Link>{" "}
          for the specific fix.
        </Notice>
      ) : schemas.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <p className="text-sm font-medium text-ink">No content types yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
            Create one to define its fields, or run{" "}
            <code className="font-mono text-xs">npm run seed</code> for two
            worked examples.
          </p>
          <Link href="/schemas/new" className="mt-4 inline-block">
            <Button variant="primary">New content type</Button>
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {schemas.map((schema) => (
            <li key={schema.id}>
              <Link
                href={`/schemas/${schema.api_id}`}
                className="block rounded-lg border border-border-subtle bg-surface p-4 transition-colors hover:border-accent"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-ink">
                    {schema.name}
                  </p>
                  <Badge tone={schema.entryCount > 0 ? "accent" : "neutral"}>
                    {schema.entryCount} entr
                    {schema.entryCount === 1 ? "y" : "ies"}
                  </Badge>
                </div>

                <code className="mt-0.5 block font-mono text-xs text-ink-muted">
                  {schema.api_id}
                </code>

                {schema.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-ink-muted">
                    {schema.description}
                  </p>
                ) : null}

                <p className="mt-3 text-xs text-ink-muted">
                  {schema.fieldCount} field
                  {schema.fieldCount === 1 ? "" : "s"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
