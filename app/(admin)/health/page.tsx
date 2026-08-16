import { runHealthChecks, type CheckStatus } from "@/lib/health";
import { RealtimeProbe } from "./realtime-probe";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const checks = await runHealthChecks();
  const failing = checks.filter((c) => c.status === "fail").length;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Health check
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Verifies that the app can reach Supabase and that every table from{" "}
          <code className="font-mono text-xs">0001_init.sql</code> exists.
        </p>
      </header>

      <section className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Server checks</h2>
          <span className="text-xs text-ink-muted">
            {failing === 0
              ? "All passing"
              : `${failing} failing`}
          </span>
        </div>

        <ul className="divide-y divide-border-subtle">
          {checks.map((check) => (
            <li key={check.name} className="flex gap-3 px-5 py-3.5">
              <StatusDot status={check.status} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{check.name}</p>
                <p className="mt-0.5 text-sm text-ink-muted">{check.detail}</p>
                {check.fix ? (
                  <p className="mt-1.5 rounded bg-surface-muted px-2 py-1 text-xs text-ink-muted">
                    {check.fix}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <RealtimeProbe />

      <section className="rounded-lg border border-border-subtle bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink">Setup steps</h2>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink-muted">
          <li>Create a project at supabase.com (free tier is enough).</li>
          <li>
            Open SQL Editor → New query, paste{" "}
            <code className="font-mono text-xs">
              supabase/migrations/0001_init.sql
            </code>
            , run it.
          </li>
          <li>
            Copy <code className="font-mono text-xs">.env.example</code> to{" "}
            <code className="font-mono text-xs">.env.local</code>, then fill in
            the Project URL (Settings → Data API) and the publishable key
            (Settings → API Keys).
          </li>
          <li>
            Restart the dev server, then run{" "}
            <code className="font-mono text-xs">npm run seed</code>.
          </li>
        </ol>
      </section>
    </div>
  );
}

function StatusDot({ status }: { status: CheckStatus }) {
  const styles: Record<CheckStatus, string> = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    fail: "bg-danger-soft text-danger",
  };
  const glyph: Record<CheckStatus, string> = { ok: "✓", warn: "!", fail: "✕" };

  return (
    <span
      aria-label={status}
      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${styles[status]}`}
    >
      {glyph[status]}
    </span>
  );
}
