import { describe, expect, it } from "vitest";

import {
  coerceInput,
  defaultValuesFor,
  isEmptyValue,
  parseEntryData,
  toFormValues,
} from "../zod-builder";
import type { Entry, Field } from "@/types/cms";

const SCHEMA_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ID = "33333333-3333-4333-8333-333333333333";

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

describe("isEmptyValue", () => {
  it("treats null, undefined and empty string as empty", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
  });

  it("does NOT treat false or 0 as empty", () => {
    // The bug this guards: `if (!value)` would wrongly reject an unchecked
    // boolean or a legitimate zero.
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
  });
});

describe("parseEntryData — required", () => {
  const fields = [field({ key: "title", label: "Title", required: true })];

  it("rejects a missing required value with a readable message", () => {
    const result = parseEntryData(fields, { title: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toBe("Title is required");
  });

  it("rejects an empty string for a required field", () => {
    const result = parseEntryData(fields, { title: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects an absent key entirely", () => {
    const result = parseEntryData(fields, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.title).toBe("Title is required");
  });

  it("accepts a filled value", () => {
    const result = parseEntryData(fields, { title: "Hello" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.title).toBe("Hello");
  });

  it("accepts a required boolean that is false", () => {
    const result = parseEntryData(
      [field({ key: "active", label: "Active", type: "boolean", required: true })],
      { active: false },
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a required number that is zero", () => {
    const result = parseEntryData(
      [field({ key: "count", label: "Count", type: "number", required: true })],
      { count: 0 },
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseEntryData — optional", () => {
  it("normalises empty optional values to null", () => {
    const fields = [
      field({ key: "body" }),
      field({ key: "count", type: "number" }),
      field({ key: "when", type: "date" }),
    ];
    const result = parseEntryData(fields, {
      body: "",
      count: null,
      when: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ body: null, count: null, when: null });
    }
  });
});

describe("parseEntryData — per type", () => {
  it("rejects a non-numeric value for a number field", () => {
    const result = parseEntryData(
      [field({ key: "count", label: "Count", type: "number" })],
      { count: "abc" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.count).toMatch(/number/i);
  });

  it("rejects NaN and Infinity", () => {
    const fields = [field({ key: "count", type: "number" })];
    expect(parseEntryData(fields, { count: Number.NaN }).ok).toBe(false);
    expect(parseEntryData(fields, { count: Number.POSITIVE_INFINITY }).ok).toBe(
      false,
    );
  });

  it("accepts a well-formed date and rejects a malformed one", () => {
    const fields = [field({ key: "when", type: "date" })];
    expect(parseEntryData(fields, { when: "2026-08-15" }).ok).toBe(true);
    expect(parseEntryData(fields, { when: "15/08/2026" }).ok).toBe(false);
    expect(parseEntryData(fields, { when: "2026-8-5" }).ok).toBe(false);
  });

  it("rejects a date that is well-formed but not real", () => {
    const result = parseEntryData([field({ key: "when", type: "date" })], {
      when: "2026-02-31",
    });
    expect(result.ok).toBe(false);
  });

  it("requires a uuid for a reference field", () => {
    const fields = [
      field({ key: "author", type: "reference", target_schema_id: TARGET_ID }),
    ];
    expect(parseEntryData(fields, { author: TARGET_ID }).ok).toBe(true);
    expect(parseEntryData(fields, { author: "not-a-uuid" }).ok).toBe(false);
  });

  it("rejects a non-boolean for a boolean field", () => {
    const result = parseEntryData(
      [field({ key: "active", type: "boolean" })],
      { active: "yes" },
    );
    expect(result.ok).toBe(false);
  });
});

describe("parseEntryData — unknown keys", () => {
  it("strips keys that are not in the schema", () => {
    // A client on a stale schema must not be able to smuggle values in.
    const result = parseEntryData([field({ key: "title" })], {
      title: "Hello",
      sneaky: "value",
      id: "spoofed",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ title: "Hello" });
      expect(result.data.sneaky).toBeUndefined();
    }
  });
});

describe("parseEntryData — multiple errors", () => {
  it("reports one message per offending field", () => {
    const fields = [
      field({ key: "title", label: "Title", required: true }),
      field({ key: "count", label: "Count", type: "number" }),
      field({ key: "ok", label: "Ok", type: "text" }),
    ];
    const result = parseEntryData(fields, {
      title: "",
      count: "abc",
      ok: "fine",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["count", "title"]);
    }
  });
});

describe("defaultValuesFor", () => {
  it("starts booleans at false and everything else at null", () => {
    const values = defaultValuesFor([
      field({ key: "title" }),
      field({ key: "active", type: "boolean" }),
      field({ key: "count", type: "number" }),
    ]);
    expect(values).toEqual({ title: null, active: false, count: null });
  });
});

describe("toFormValues", () => {
  const fields = [
    field({ key: "title" }),
    field({ key: "active", type: "boolean" }),
  ];

  function entry(data: Record<string, unknown>): Entry {
    return {
      id: ENTRY_ID,
      schema_id: SCHEMA_ID,
      data: data as Entry["data"],
      invalid: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
  }

  it("returns blank defaults with no entry", () => {
    expect(toFormValues(fields)).toEqual({ title: null, active: false });
  });

  it("fills in fields the entry predates", () => {
    // The entry was written before `active` existed.
    expect(toFormValues(fields, entry({ title: "Hi" }))).toEqual({
      title: "Hi",
      active: false,
    });
  });

  it("drops keys no longer in the schema", () => {
    const values = toFormValues(fields, entry({ title: "Hi", removed: "x" }));
    expect(values.removed).toBeUndefined();
  });

  it("never leaves a boolean as null", () => {
    // A null checkbox would make the input uncontrolled and React would warn.
    expect(toFormValues(fields, entry({ active: null })).active).toBe(false);
  });
});

describe("coerceInput", () => {
  it("turns empty input into null", () => {
    expect(coerceInput("text", "")).toBeNull();
    expect(coerceInput("number", "")).toBeNull();
    expect(coerceInput("date", "")).toBeNull();
  });

  it("parses numbers, including zero and negatives", () => {
    expect(coerceInput("number", "42")).toBe(42);
    expect(coerceInput("number", "0")).toBe(0);
    expect(coerceInput("number", "-3.5")).toBe(-3.5);
  });

  it("returns null for half-typed numbers rather than throwing", () => {
    // Mid-keystroke states must not blow up the form.
    expect(coerceInput("number", "-")).toBeNull();
    expect(coerceInput("number", "abc")).toBeNull();
  });

  it("always produces a boolean for boolean fields", () => {
    expect(coerceInput("boolean", true)).toBe(true);
    expect(coerceInput("boolean", false)).toBe(false);
  });
});

describe("calendar dates", () => {
  const fields = [field({ key: "when", type: "date" })];
  const parse = (when: string) => parseEntryData(fields, { when }).ok;

  it.each([
    ["2026-02-31", false, "February has no 31st"],
    ["2026-04-31", false, "April has 30 days"],
    ["2026-13-01", false, "there is no month 13"],
    ["2026-00-10", false, "there is no month 0"],
    ["2026-01-32", false, "no month has 32 days"],
    ["2024-02-29", true, "2024 is a leap year"],
    ["2026-02-28", true, "valid"],
    ["2026-12-31", true, "valid year end"],
  ])("%s → %s (%s)", (value, expected) => {
    expect(parse(value)).toBe(expected);
  });

  it("rejects 29 February in a non-leap year", () => {
    expect(parse("2026-02-29")).toBe(false);
    expect(parse("1900-02-29")).toBe(false); // century, not a leap year
    expect(parse("2000-02-29")).toBe(true); // divisible by 400, is one
  });
});
