"use client";

import { Badge } from "@/components/ui";
import type { FieldChange, RiskLevel } from "@/lib/schema/diff";

const RISK_TONE: Record<RiskLevel, "ok" | "warn" | "danger"> = {
  safe: "ok",
  lossy: "warn",
  blocking: "danger",
};

const RISK_LABEL: Record<RiskLevel, string> = {
  safe: "Safe",
  lossy: "Lossy",
  blocking: "Blocking",
};

/**
 * Unsaved changes, each labelled with its risk.
 *
 * This is the surface milestone 5 grows into: today it explains *what* would
 * happen, then the affected-entry counts, per-row preview and fix-up controls
 * attach to these same rows.
 */
export function ChangeSummary({
  changes,
  blocked,
  entryCount,
}: {
  changes: FieldChange[];
  blocked: FieldChange[];
  entryCount: number;
}) {
  if (changes.length === 0) return null;

  const blockedKinds = new Set(blocked.map((c) => `${c.kind}:${c.key}`));

  return (
    <div className="rounded-lg border border-border-subtle bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
        <h3 className="text-sm font-semibold text-ink">
          Unsaved changes
          <span className="ml-2 font-normal text-ink-muted">
            {changes.length}
          </span>
        </h3>
        {entryCount > 0 ? (
          <span className="text-xs text-ink-muted">
            {entryCount} existing entr{entryCount === 1 ? "y" : "ies"}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">No entries yet</span>
        )}
      </div>

      <ul className="divide-y divide-border-subtle">
        {changes.map((change, i) => {
          const isBlocked = blockedKinds.has(`${change.kind}:${change.key}`);
          return (
            <li key={`${change.kind}-${change.key}-${i}`} className="px-4 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{change.summary}</p>
                  {change.consequence ? (
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {change.consequence}
                    </p>
                  ) : null}
                  {isBlocked ? (
                    <p className="mt-1 text-xs font-medium text-warn">
                      Needs review before it can be applied.
                    </p>
                  ) : null}
                </div>
                <Badge tone={RISK_TONE[change.risk]}>
                  {RISK_LABEL[change.risk]}
                </Badge>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
