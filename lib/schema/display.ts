import type { Entry, Field, FieldValue } from "@/types/cms";

/**
 * How entries are described in lists, pickers and page titles.
 *
 * All derived from the schema — nothing per content type is hard-coded.
 */

/** Fields that make sense as list columns, in schema order. */
export function listColumns(fields: Field[], limit = 4): Field[] {
  // Text first (they read best as a row's identity), then the rest in order.
  const text = fields.filter((f) => f.type === "text");
  const others = fields.filter((f) => f.type !== "text");
  return [...text, ...others].slice(0, limit);
}

/** Fields worth searching — only the ones holding free text. */
export function searchableFields(fields: Field[]): Field[] {
  return fields.filter((f) => f.type === "text");
}

/**
 * A short human label for an entry: its first non-empty text value,
 * falling back to a shortened id so a row is never nameless.
 */
export function entryTitle(entry: Entry, fields: Field[]): string {
  for (const field of fields) {
    if (field.type !== "text") continue;
    const value = entry.data?.[field.key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.length > 80 ? `${value.slice(0, 79)}…` : value;
    }
  }
  return `Untitled · ${entry.id.slice(0, 8)}`;
}

/**
 * Format a stored value for read-only display.
 *
 * References render as the target entry's title when a lookup is supplied,
 * and fall back to a short id when it is missing — a dangling reference
 * should look obviously wrong rather than silently blank.
 */
export function formatValue(
  field: Field,
  value: FieldValue | undefined,
  referenceTitles?: Map<string, string>,
): string {
  if (value === null || value === undefined || value === "") return "—";

  switch (field.type) {
    case "boolean":
      return value ? "Yes" : "No";

    case "number":
      return typeof value === "number" ? value.toLocaleString("en-US") : String(value);

    case "date":
      return typeof value === "string" ? formatDate(value) : String(value);

    case "reference": {
      const id = String(value);
      return referenceTitles?.get(id) ?? `↗ ${id.slice(0, 8)}`;
    }

    default: {
      const text = String(value);
      return text.length > 120 ? `${text.slice(0, 119)}…` : text;
    }
  }
}

/**
 * `2026-08-15` → `15 Aug 2026`.
 *
 * Built from the parts rather than `new Date(value)`, which would parse the
 * string as UTC midnight and render as the previous day west of Greenwich.
 */
function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${day} ${months[month - 1] ?? month} ${year}`;
}

/**
 * Compare two entries by one field, for client-side sorting.
 * Empty values always sort last, whichever direction is applied.
 */
export function compareByField(
  field: Field,
  a: Entry,
  b: Entry,
  direction: "asc" | "desc",
): number {
  const left = a.data?.[field.key];
  const right = b.data?.[field.key];

  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  let result: number;
  if (field.type === "number") {
    result = Number(left) - Number(right);
  } else if (field.type === "boolean") {
    result = Number(left) - Number(right);
  } else {
    // ISO dates sort correctly as strings, so dates and text share this path.
    result = String(left).localeCompare(String(right), "en", {
      sensitivity: "base",
      numeric: true,
    });
  }

  return direction === "asc" ? result : -result;
}

/** Does any searchable field of this entry contain the query? */
export function entryMatches(
  entry: Entry,
  fields: Field[],
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  return searchableFields(fields).some((field) => {
    const value = entry.data?.[field.key];
    return typeof value === "string" && value.toLowerCase().includes(needle);
  });
}
