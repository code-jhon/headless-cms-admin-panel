import { describe, expect, it } from "vitest";

import {
  compareByField,
  entryMatches,
  entryTitle,
  formatValue,
  listColumns,
  searchableFields,
} from "../display";
import type { Entry, Field } from "@/types/cms";

const SCHEMA_ID = "11111111-1111-4111-8111-111111111111";

function field(overrides: Partial<Field> & { key: string }): Field {
  return {
    id: `f-${overrides.key}`,
    schema_id: SCHEMA_ID,
    label: overrides.key,
    type: "text",
    required: false,
    position: 0,
    target_schema_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function entry(data: Record<string, unknown>, id = "aaaaaaaa-1111-4111-8111-111111111111"): Entry {
  return {
    id,
    schema_id: SCHEMA_ID,
    data: data as Entry["data"],
    invalid: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("listColumns", () => {
  it("puts text fields first, then the rest in schema order", () => {
    const fields = [
      field({ key: "active", type: "boolean" }),
      field({ key: "title" }),
      field({ key: "count", type: "number" }),
      field({ key: "body" }),
    ];
    expect(listColumns(fields).map((f) => f.key)).toEqual([
      "title",
      "body",
      "active",
      "count",
    ]);
  });

  it("caps the number of columns", () => {
    const fields = Array.from({ length: 10 }, (_, i) =>
      field({ key: `f${i}` }),
    );
    expect(listColumns(fields)).toHaveLength(4);
    expect(listColumns(fields, 2)).toHaveLength(2);
  });

  it("copes with a schema that has no text fields", () => {
    const fields = [
      field({ key: "active", type: "boolean" }),
      field({ key: "count", type: "number" }),
    ];
    expect(listColumns(fields).map((f) => f.key)).toEqual(["active", "count"]);
  });
});

describe("searchableFields", () => {
  it("returns only text fields", () => {
    const fields = [
      field({ key: "title" }),
      field({ key: "count", type: "number" }),
      field({ key: "when", type: "date" }),
    ];
    expect(searchableFields(fields).map((f) => f.key)).toEqual(["title"]);
  });
});

describe("entryTitle", () => {
  const fields = [
    field({ key: "title" }),
    field({ key: "body" }),
    field({ key: "count", type: "number" }),
  ];

  it("uses the first non-empty text value", () => {
    expect(entryTitle(entry({ title: "Hello" }), fields)).toBe("Hello");
  });

  it("skips empty text fields and falls through to the next", () => {
    expect(entryTitle(entry({ title: "", body: "Fallback" }), fields)).toBe(
      "Fallback",
    );
    expect(entryTitle(entry({ title: "   ", body: "Fallback" }), fields)).toBe(
      "Fallback",
    );
  });

  it("never returns a nameless row", () => {
    const title = entryTitle(entry({ count: 5 }), fields);
    expect(title).toMatch(/^Untitled · aaaaaaaa$/);
  });

  it("truncates very long titles", () => {
    const title = entryTitle(entry({ title: "x".repeat(200) }), fields);
    expect(title).toHaveLength(80);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("formatValue", () => {
  it("renders empty values as an em dash", () => {
    const f = field({ key: "title" });
    expect(formatValue(f, null)).toBe("—");
    expect(formatValue(f, undefined)).toBe("—");
    expect(formatValue(f, "")).toBe("—");
  });

  it("renders booleans as Yes / No, including false", () => {
    const f = field({ key: "active", type: "boolean" });
    expect(formatValue(f, true)).toBe("Yes");
    // The trap: `false` must not fall into the empty branch.
    expect(formatValue(f, false)).toBe("No");
  });

  it("renders zero rather than treating it as empty", () => {
    expect(formatValue(field({ key: "n", type: "number" }), 0)).toBe("0");
  });

  it("formats a date without shifting the day", () => {
    // `new Date("2026-08-15")` parses as UTC midnight and renders as the 14th
    // west of Greenwich — this must not do that.
    expect(formatValue(field({ key: "d", type: "date" }), "2026-08-15")).toBe(
      "15 Aug 2026",
    );
    expect(formatValue(field({ key: "d", type: "date" }), "2026-01-01")).toBe(
      "1 Jan 2026",
    );
  });

  it("resolves a reference to its title when known", () => {
    const f = field({ key: "author", type: "reference" });
    const titles = new Map([["abc12345-0000-4000-8000-000000000000", "Ada"]]);
    expect(
      formatValue(f, "abc12345-0000-4000-8000-000000000000", titles),
    ).toBe("Ada");
  });

  it("makes a dangling reference visibly wrong rather than blank", () => {
    const f = field({ key: "author", type: "reference" });
    expect(formatValue(f, "abc12345-0000-4000-8000-000000000000", new Map())).toBe(
      "↗ abc12345",
    );
  });

  it("truncates very long text", () => {
    const out = formatValue(field({ key: "body" }), "y".repeat(500));
    expect(out).toHaveLength(120);
  });
});

describe("compareByField", () => {
  const textField = field({ key: "title" });
  const numberField = field({ key: "count", type: "number" });

  it("sorts numbers numerically, not lexically", () => {
    // Lexical sorting would put "10" before "9".
    const a = entry({ count: 9 });
    const b = entry({ count: 10 });
    expect(compareByField(numberField, a, b, "asc")).toBeLessThan(0);
  });

  it("reverses for descending", () => {
    const a = entry({ count: 1 });
    const b = entry({ count: 2 });
    expect(compareByField(numberField, a, b, "desc")).toBeGreaterThan(0);
  });

  it("sorts text case-insensitively", () => {
    const a = entry({ title: "apple" });
    const b = entry({ title: "Banana" });
    expect(compareByField(textField, a, b, "asc")).toBeLessThan(0);
  });

  it("sorts empty values last in BOTH directions", () => {
    const filled = entry({ title: "A" });
    const empty = entry({ title: null });
    expect(compareByField(textField, filled, empty, "asc")).toBeLessThan(0);
    expect(compareByField(textField, filled, empty, "desc")).toBeLessThan(0);
  });

  it("sorts ISO dates chronologically", () => {
    const f = field({ key: "when", type: "date" });
    const earlier = entry({ when: "2026-01-09" });
    const later = entry({ when: "2026-01-10" });
    expect(compareByField(f, earlier, later, "asc")).toBeLessThan(0);
  });
});

describe("entryMatches", () => {
  const fields = [
    field({ key: "title" }),
    field({ key: "count", type: "number" }),
  ];

  it("matches everything on an empty query", () => {
    expect(entryMatches(entry({ title: "Hi" }), fields, "")).toBe(true);
    expect(entryMatches(entry({ title: "Hi" }), fields, "   ")).toBe(true);
  });

  it("matches case-insensitively on a substring", () => {
    const e = entry({ title: "Notes on the Analytical Engine" });
    expect(entryMatches(e, fields, "analytical")).toBe(true);
    expect(entryMatches(e, fields, "ENGINE")).toBe(true);
    expect(entryMatches(e, fields, "compiler")).toBe(false);
  });

  it("ignores non-text fields", () => {
    // Searching "42" should not match a number field.
    expect(entryMatches(entry({ title: "x", count: 42 }), fields, "42")).toBe(
      false,
    );
  });
});
