"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card, Input, Notice, Select } from "@/components/ui";
import {
  analyzeSchemaMigration,
  applySchemaMigration,
  type ApplyResult,
} from "@/lib/actions/migrations";
import type { FieldImpact, MigrationAnalysis } from "@/lib/migrations/analyze";
import type {
  Resolution,
  Resolutions,
  ResolutionStrategy,
} from "@/lib/migrations/transform";
import type { FieldDraft } from "@/lib/schema/validation";
import type { FieldValue } from "@/types/cms";

/**
 * The schema-evolution review (PRD D1–D5).
 *
 * The whole point is that nothing is written until the user has seen what
 * would happen: how many entries a change touches, what each value becomes,
 * and what to do about the ones that will not convert. The preview is
 * produced by the same code that performs the write, so it cannot be wrong.
 */

function formatValue(value: FieldValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

const STRATEGY_LABELS: Record<ResolutionStrategy, string> = {
  convert: "Leave unresolved",
  default: "Set a value for them",
  clear: "Clear them",
  flag: "Keep, flag for review",
};

const STRATEGY_HINTS: Record<ResolutionStrategy, string> = {
  convert: "Affected entries are saved empty and flagged as needing attention.",
  default: "Every affected entry gets the value you type below.",
  clear: "The value is dropped. Entries are not flagged — you accept the loss.",
  flag: "The value is dropped and the entry is flagged for someone to fix.",
};

export function MigrationReview({
  schemaId,
  apiId,
  draft,
  onCancel,
  onApplied,
}: {
  schemaId: string;
  apiId: string;
  draft: FieldDraft[];
  onCancel: () => void;
  onApplied: () => void;
}) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<MigrationAnalysis | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [analyzing, startAnalyze] = useTransition();
  const [applying, startApply] = useTransition();
  const [result, setResult] = useState<ApplyResult | null>(null);

  /**
   * Re-analyse whenever a resolution changes, so the counts and the preview
   * always describe the migration as currently configured — a stale preview
   * is the one thing this screen must never show.
   *
   * Wrapped in a transition rather than a `loading` flag so nothing is set
   * synchronously from an effect.
   */
  const analyze = useCallback(
    (current: Resolutions) => {
      startAnalyze(async () => {
        const response = await analyzeSchemaMigration(schemaId, draft, current);
        if (!response.ok || !response.analysis) {
          setError(response.error ?? "Could not analyse this change.");
          setAnalysis(null);
          return;
        }
        setError(null);
        setAnalysis(response.analysis);
        setTruncated(Boolean(response.truncated));
      });
    },
    // `draft` is a fresh array each render, and the parent mounts this once
    // per review, so keying on the schema id is what we want here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaId],
  );

  useEffect(() => {
    analyze({});
  }, [analyze]);

  function setResolution(fieldKey: string, patch: Partial<Resolution>) {
    setResolutions((prev) => {
      const existing: Resolution = prev[fieldKey] ?? { strategy: "convert" };
      const next: Resolutions = { ...prev, [fieldKey]: { ...existing, ...patch } };
      analyze(next);
      return next;
    });
  }

  function handleApply() {
    setResult(null);
    startApply(async () => {
      const response = await applySchemaMigration(
        schemaId,
        apiId,
        draft,
        resolutions,
      );
      setResult(response);
      if (response.ok) {
        router.refresh();
        onApplied();
      }
    });
  }

  if (error) {
    return (
      <Notice tone="danger" title="Cannot review this change">
        <p>{error}</p>
        <Button type="button" size="sm" className="mt-2" onClick={onCancel}>
          Back to editing
        </Button>
      </Notice>
    );
  }

  if (analyzing && !analysis) {
    return (
      <Card className="p-6 text-center text-sm text-ink-muted">
        Checking what this would do to existing entries…
      </Card>
    );
  }

  if (!analysis) return null;

  if (result?.ok && result.summary) {
    const s = result.summary;
    return (
      <Notice tone="accent" title="Migration applied">
        <ul className="mt-1 space-y-0.5">
          {s.fieldsAdded > 0 ? <li>{s.fieldsAdded} field(s) added</li> : null}
          {s.fieldsChanged > 0 ? <li>{s.fieldsChanged} field(s) changed</li> : null}
          {s.fieldsRemoved > 0 ? <li>{s.fieldsRemoved} field(s) removed</li> : null}
          <li>{s.entriesUpdated} entr{s.entriesUpdated === 1 ? "y" : "ies"} rewritten</li>
          {s.entriesFlagged > 0 ? (
            <li className="text-warn">
              {s.entriesFlagged} entr{s.entriesFlagged === 1 ? "y" : "ies"} flagged
              for review
            </li>
          ) : null}
        </ul>
      </Notice>
    );
  }

  const blocking = analysis.unresolvedFieldKeys.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Review changes</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              {analysis.entryCount} existing entr
              {analysis.entryCount === 1 ? "y" : "ies"} ·{" "}
              {analysis.changedEntryCount} would be rewritten
              {analysis.flaggedEntryCount > 0
                ? ` · ${analysis.flaggedEntryCount} would be flagged`
                : ""}
            </p>
          </div>
          {analyzing ? (
            <span className="text-xs text-ink-muted">Recalculating…</span>
          ) : null}
        </div>

        <div className="divide-y divide-border-subtle">
          {analysis.impacts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">
              No stored values are affected — these changes only touch the
              schema definition.
            </p>
          ) : (
            analysis.impacts.map((impact) => (
              <ImpactSection
                key={impact.fieldKey}
                impact={impact}
                resolution={resolutions[impact.fieldKey]}
                onChange={(patch) => setResolution(impact.fieldKey, patch)}
              />
            ))
          )}
        </div>
      </Card>

      {truncated ? (
        <Notice tone="warn" title="Too many entries">
          This content type has more entries than the review can analyse in one
          pass. Applying is disabled to avoid a partial result.
        </Notice>
      ) : null}

      {blocking ? (
        <Notice tone="warn" title="Decisions needed">
          {analysis.unresolvedFieldKeys.length} field
          {analysis.unresolvedFieldKeys.length === 1 ? "" : "s"} have entries
          that will not carry over. Choose what to do with them, or apply
          anyway and they will be saved empty and flagged.
        </Notice>
      ) : null}

      {result && !result.ok ? (
        <Notice tone="danger" title="Nothing was changed">
          {result.error}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={blocking ? "danger" : "primary"}
          disabled={applying || analyzing || truncated}
          onClick={handleApply}
        >
          {applying
            ? "Applying…"
            : blocking
              ? "Apply anyway"
              : "Apply migration"}
        </Button>
        <Button type="button" disabled={applying} onClick={onCancel}>
          Back to editing
        </Button>
        <span className="text-xs text-ink-muted">
          Applied in one transaction — it either all lands or nothing does.
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- per-field block */

function ImpactSection({
  impact,
  resolution,
  onChange,
}: {
  impact: FieldImpact;
  resolution?: Resolution;
  onChange: (patch: Partial<Resolution>) => void;
}) {
  const [expanded, setExpanded] = useState(impact.problemCount > 0);
  const strategy = resolution?.strategy ?? "convert";

  return (
    <section className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{impact.fieldLabel}</p>
          <ul className="mt-1 space-y-0.5">
            {impact.changes.map((change, i) => (
              <li key={i} className="text-xs text-ink-muted">
                {change.summary}
                {change.consequence ? ` — ${change.consequence}` : ""}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={impact.problemCount > 0 ? "warn" : "ok"}>
            {impact.affectedCount} affected
          </Badge>
          {impact.problemCount > 0 ? (
            <Badge tone="danger">{impact.problemCount} need attention</Badge>
          ) : null}
        </div>
      </div>

      {impact.problemCount > 0 ? (
        <div className="mt-3 space-y-2 rounded border border-border-subtle bg-surface-muted p-3">
          <label className="block text-xs font-medium text-ink">
            What should happen to the {impact.problemCount} entr
            {impact.problemCount === 1 ? "y" : "ies"} that will not convert?
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="max-w-xs"
              value={strategy}
              onChange={(e) =>
                onChange({ strategy: e.target.value as ResolutionStrategy })
              }
            >
              {(Object.keys(STRATEGY_LABELS) as ResolutionStrategy[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {STRATEGY_LABELS[key]}
                  </option>
                ),
              )}
            </Select>

            {strategy === "default" ? (
              <Input
                className="max-w-xs"
                placeholder="Value to use"
                value={
                  resolution?.defaultValue === null ||
                  resolution?.defaultValue === undefined
                    ? ""
                    : String(resolution.defaultValue)
                }
                onChange={(e) =>
                  onChange({ defaultValue: e.target.value || null })
                }
              />
            ) : null}
          </div>
          <p className="text-xs text-ink-muted">{STRATEGY_HINTS[strategy]}</p>
        </div>
      ) : null}

      {impact.rows.length > 0 ? (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs font-medium text-accent hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide" : "Preview"} affected entries
          </button>

          {expanded ? (
            <div className="mt-2 overflow-x-auto rounded border border-border-subtle">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-muted text-left text-ink-muted">
                    <th className="px-3 py-1.5 font-medium">Entry</th>
                    <th className="px-3 py-1.5 font-medium">Before</th>
                    <th className="px-3 py-1.5 font-medium">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {impact.rows.map((row) => (
                    <tr key={row.entryId}>
                      <td className="px-3 py-1.5 text-ink">{row.title}</td>
                      <td className="px-3 py-1.5 font-mono text-ink-muted">
                        {formatValue(row.before)}
                      </td>
                      <td className="px-3 py-1.5 font-mono">
                        {row.status === "problem" ? (
                          <span className="text-danger">
                            ✕ {row.reason ?? "cannot convert"}
                          </span>
                        ) : (
                          <span className="text-ok">
                            {formatValue(row.after)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {impact.truncated ? (
                <p className="border-t border-border-subtle px-3 py-1.5 text-ink-muted">
                  Showing the first {impact.rows.length} of{" "}
                  {impact.affectedCount} affected entries.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
