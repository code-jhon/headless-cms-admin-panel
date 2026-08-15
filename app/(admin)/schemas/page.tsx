import Link from "next/link";

import { listSchemas } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SchemasPage() {
  const { data: schemas, error } = await listSchemas();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Schema builder
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Content types and their fields. Editing arrives in milestone 1.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-border-subtle bg-warn-soft p-4 text-sm">
          <p className="font-medium text-warn">Cannot load schemas</p>
          <p className="mt-1 text-ink-muted">
            See the{" "}
            <Link href="/health" className="font-medium text-accent underline">
              health check
            </Link>
            .
          </p>
        </div>
      ) : schemas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle bg-surface p-8 text-center">
          <p className="text-sm font-medium text-ink">No content types yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
            Run <code className="font-mono text-xs">npm run seed</code> to
            create two example types, or wait for the builder in milestone 1.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {schemas.map((schema) => (
            <li
              key={schema.id}
              className="rounded-lg border border-border-subtle bg-surface p-4"
            >
              <p className="text-sm font-medium text-ink">{schema.name}</p>
              <code className="mt-0.5 block font-mono text-xs text-ink-muted">
                {schema.api_id}
              </code>
              {schema.description ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {schema.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
