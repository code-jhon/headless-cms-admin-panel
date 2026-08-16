"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge, Button, Card, Input } from "@/components/ui";
import { DeleteEntryButton } from "./delete-entry-button";
import {
  compareByField,
  entryMatches,
  formatValue,
  listColumns,
  searchableFields,
} from "@/lib/schema/display";
import type { Entry, SchemaWithFields } from "@/types/cms";

/**
 * Entry list (PRD B1).
 *
 * Columns are derived from the schema — text fields first, since they read
 * as a row's identity — so a new content type gets a usable table with no
 * configuration. Search and sort run client-side: entry counts in this app
 * are small, and it keeps every keystroke instant.
 */
export function EntryTable({
  schema,
  entries,
  referenceTitles,
}: {
  schema: SchemaWithFields;
  entries: Entry[];
  referenceTitles: Record<string, string>;
}) {
  const columns = useMemo(() => listColumns(schema.fields), [schema.fields]);
  const canSearch = searchableFields(schema.fields).length > 0;

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const titles = useMemo(
    () => new Map(Object.entries(referenceTitles)),
    [referenceTitles],
  );

  const visible = useMemo(() => {
    const filtered = entries.filter((e) =>
      entryMatches(e, schema.fields, query),
    );
    const sortField = schema.fields.find((f) => f.key === sortKey);
    if (!sortField) return filtered;

    return [...filtered].sort((a, b) =>
      compareByField(sortField, a, b, direction),
    );
  }, [entries, schema.fields, query, sortKey, direction]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setDirection("asc");
  }

  if (entries.length === 0) {
    return (
      <Card className="border-dashed p-8 text-center">
        <p className="text-sm font-medium text-ink">No entries yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          The form is generated from this content type&apos;s{" "}
          {schema.fields.length} field
          {schema.fields.length === 1 ? "" : "s"}.
        </p>
        <Link href={`/content/${schema.api_id}/new`} className="mt-4 inline-block">
          <Button variant="primary">New entry</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {canSearch ? (
        <div className="flex items-center gap-3">
          <Input
            type="search"
            value={query}
            placeholder={`Search ${searchableFields(schema.fields)
              .map((f) => f.label.toLowerCase())
              .join(", ")}…`}
            className="max-w-sm"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <span className="text-xs text-ink-muted">
              {visible.length} of {entries.length}
            </span>
          ) : null}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-muted text-left">
                {columns.map((field) => (
                  <th key={field.id} className="px-4 py-2.5 font-medium">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
                      onClick={() => toggleSort(field.key)}
                      aria-label={`Sort by ${field.label}`}
                    >
                      {field.label}
                      <span aria-hidden className="text-[10px]">
                        {sortKey === field.key
                          ? direction === "asc"
                            ? "▲"
                            : "▼"
                          : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="w-px px-4 py-2.5" />
              </tr>
            </thead>

            <tbody className="divide-y divide-border-subtle">
              {visible.map((entry) => (
                <tr key={entry.id} className="hover:bg-surface-muted">
                  {columns.map((field, index) => (
                    <td key={field.id} className="px-4 py-2.5 align-top">
                      {index === 0 ? (
                        <span className="flex items-center gap-2">
                          <Link
                            href={`/content/${schema.api_id}/${entry.id}`}
                            className="font-medium text-ink hover:text-accent hover:underline"
                          >
                            {formatValue(field, entry.data?.[field.key], titles)}
                          </Link>
                          {entry.invalid ? (
                            <Badge tone="warn">Needs attention</Badge>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-ink-muted">
                          {formatValue(field, entry.data?.[field.key], titles)}
                        </span>
                      )}
                    </td>
                  ))}

                  <td className="px-4 py-2.5 text-right align-top">
                    <span className="inline-flex gap-1">
                      <Link href={`/content/${schema.api_id}/${entry.id}`}>
                        <Button size="sm" variant="ghost">
                          Edit
                        </Button>
                      </Link>
                      <DeleteEntryButton
                        schemaId={schema.id}
                        apiId={schema.api_id}
                        entryId={entry.id}
                        title={formatValue(
                          columns[0],
                          entry.data?.[columns[0].key],
                          titles,
                        )}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            Nothing matches “{query}”.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
