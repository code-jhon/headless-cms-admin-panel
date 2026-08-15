import Link from "next/link";

import { MILESTONES } from "@/lib/milestones";
import { listSchemas } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { data: schemas, error } = await listSchemas();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Admin Panel
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Define content schemas and manage entries through generated forms.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-border-subtle bg-warn-soft p-4">
          <p className="text-sm font-medium text-warn">Not connected yet</p>
          <p className="mt-1 text-sm text-ink-muted">
            Finish the setup steps on the{" "}
            <Link href="/health" className="font-medium text-accent underline">
              health check
            </Link>{" "}
            page.
          </p>
        </div>
      ) : (
        <section className="rounded-lg border border-border-subtle bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Content types</h2>
          {schemas.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              None yet. The Schema Builder arrives in milestone 1 — until then,
              run <code className="font-mono text-xs">npm run seed</code> to
              create two example types.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border-subtle">
              {schemas.map((schema) => (
                <li
                  key={schema.id}
                  className="flex items-baseline justify-between py-2.5"
                >
                  <div>
                    <span className="text-sm font-medium text-ink">
                      {schema.name}
                    </span>
                    {schema.description ? (
                      <span className="ml-2 text-xs text-ink-muted">
                        {schema.description}
                      </span>
                    ) : null}
                  </div>
                  <code className="font-mono text-xs text-ink-muted">
                    /api/content/{schema.api_id}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border-subtle bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Roadmap</h2>
        <ol className="mt-3 space-y-2">
          {MILESTONES.map((m) => (
            <li key={m.id} className="flex items-start gap-3">
              <span
                className={
                  m.done
                    ? "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok-soft text-[11px] font-semibold text-ok"
                    : "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-ink-muted"
                }
              >
                {m.done ? "✓" : m.id}
              </span>
              <span className="text-sm">
                <span className="font-medium text-ink">{m.label}</span>
                <span className="ml-2 text-ink-muted">{m.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
