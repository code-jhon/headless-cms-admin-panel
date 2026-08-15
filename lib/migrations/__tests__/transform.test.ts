import { describe, expect, it } from "vitest";

import { convertValue, transformEntry, type Resolutions } from "../transform";
import { analyzeMigration, buildMigrationPlan } from "../analyze";
import type { FieldDraft } from "@/lib/schema/validation";
import type { Entry, Field, FieldType } from "@/types/cms";

const SCHEMA_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const UUID_A = "aaaaaaaa-1111-4111-8111-111111111111";

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

function draftOf(from: Field, overrides: Partial<FieldDraft> = {}): FieldDraft {
  return {
    id: from.id,
    key: from.key,
    label: from.label,
    type: from.type,
    required: from.required,
    target_schema_id: from.target_schema_id,
    ...overrides,
  };
}

function entry(data: Record<string, unknown>, id = UUID_A): Entry {
  return {
    id,
    schema_id: SCHEMA_ID,
    data: data as Entry["data"],
    invalid: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

/* --------------------------------------------------------- convertValue */

describe("convertValue — the full matrix", () => {
  const types: FieldType[] = ["text", "number", "boolean", "date", "reference"];

  it("never throws for any type pair and any plausible value", () => {
    const samples = [null, "", "abc", "42", "true", "2026-08-15", 0, 1, 7, true, false];
    for (const from of types) {
      for (const to of types) {
        for (const value of samples) {
          expect(() => convertValue(value as never, from, to)).not.toThrow();
        }
      }
    }
  });

  it("passes empty values straight through as null", () => {
    for (const from of types) {
      for (const to of types) {
        expect(convertValue(null, from, to)).toEqual({ ok: true, value: null });
        expect(convertValue("", from, to)).toEqual({ ok: true, value: null });
      }
    }
  });

  it("is identity when the type is unchanged", () => {
    expect(convertValue("hello", "text", "text")).toEqual({ ok: true, value: "hello" });
    expect(convertValue(0, "number", "number")).toEqual({ ok: true, value: 0 });
    expect(convertValue(false, "boolean", "boolean")).toEqual({ ok: true, value: false });
  });

  it("converts anything to text", () => {
    expect(convertValue(42, "number", "text")).toEqual({ ok: true, value: "42" });
    expect(convertValue(true, "boolean", "text")).toEqual({ ok: true, value: "true" });
    expect(convertValue("2026-08-15", "date", "text")).toEqual({
      ok: true,
      value: "2026-08-15",
    });
  });

  describe("to number", () => {
    it("parses numeric text and rejects the rest", () => {
      expect(convertValue("42", "text", "number")).toEqual({ ok: true, value: 42 });
      expect(convertValue("-3.5", "text", "number")).toEqual({ ok: true, value: -3.5 });
      expect(convertValue("abc", "text", "number").ok).toBe(false);
    });

    it("maps booleans to 0 and 1", () => {
      expect(convertValue(true, "boolean", "number")).toEqual({ ok: true, value: 1 });
      expect(convertValue(false, "boolean", "number")).toEqual({ ok: true, value: 0 });
    });

    it("refuses an entry id", () => {
      expect(convertValue(UUID_A, "reference", "number").ok).toBe(false);
    });
  });

  describe("to boolean", () => {
    it("accepts only unambiguous numbers", () => {
      expect(convertValue(0, "number", "boolean")).toEqual({ ok: true, value: false });
      expect(convertValue(1, "number", "boolean")).toEqual({ ok: true, value: true });
      // 7 is not obviously true — guessing would be worse than asking.
      expect(convertValue(7, "number", "boolean").ok).toBe(false);
    });

    it("recognises common written forms, case-insensitively", () => {
      for (const truthy of ["true", "TRUE", "yes", "y", "1", "on"]) {
        expect(convertValue(truthy, "text", "boolean")).toEqual({ ok: true, value: true });
      }
      for (const falsy of ["false", "No", "n", "0", "off"]) {
        expect(convertValue(falsy, "text", "boolean")).toEqual({ ok: true, value: false });
      }
      expect(convertValue("maybe", "text", "boolean").ok).toBe(false);
    });
  });

  describe("to date", () => {
    it("accepts an ISO date", () => {
      expect(convertValue("2026-08-15", "text", "date")).toEqual({
        ok: true,
        value: "2026-08-15",
      });
    });

    it("rejects a date that is not on the calendar", () => {
      // `Date.parse("2026-02-31")` succeeds and rolls over to 3 March.
      expect(convertValue("2026-02-31", "text", "date").ok).toBe(false);
      expect(convertValue("2026-02-29", "text", "date").ok).toBe(false);
      expect(convertValue("2024-02-29", "text", "date").ok).toBe(true);
    });

    it("round-trips through epoch millis", () => {
      const toNumber = convertValue("2026-08-15", "date", "number");
      expect(toNumber.ok).toBe(true);
      if (!toNumber.ok) return;
      expect(convertValue(toNumber.value, "number", "date")).toEqual({
        ok: true,
        value: "2026-08-15",
      });
    });
  });

  describe("to reference", () => {
    it("accepts text that is a uuid and rejects text that is not", () => {
      expect(convertValue(UUID_A, "text", "reference")).toEqual({
        ok: true,
        value: UUID_A,
      });
      expect(convertValue("Ada Lovelace", "text", "reference").ok).toBe(false);
    });

    it("refuses non-text sources", () => {
      expect(convertValue(42, "number", "reference").ok).toBe(false);
      expect(convertValue(true, "boolean", "reference").ok).toBe(false);
    });
  });
});

/* -------------------------------------------------------- transformEntry */

describe("transformEntry", () => {
  it("preserves data across a rename (PRD D6)", () => {
    const saved = [field({ key: "body", label: "Body" })];
    const draft = [draftOf(saved[0], { key: "content" })];
    const result = transformEntry(entry({ body: "Hello" }), saved, draft);

    // The value moved to the new key rather than being dropped.
    expect(result.data).toEqual({ content: "Hello" });
    expect(result.problems).toHaveLength(0);
  });

  it("drops values for deleted fields", () => {
    const saved = [field({ key: "title" }), field({ key: "body" })];
    const draft = [draftOf(saved[0])];
    const result = transformEntry(entry({ title: "A", body: "B" }), saved, draft);

    expect(result.data).toEqual({ title: "A" });
  });

  it("starts a newly added field empty", () => {
    const saved = [field({ key: "title" })];
    const draft = [
      draftOf(saved[0]),
      { key: "subtitle", label: "Subtitle", type: "text" as const, required: false, target_schema_id: null },
    ];
    const result = transformEntry(entry({ title: "A" }), saved, draft);

    expect(result.data).toEqual({ title: "A", subtitle: null });
  });

  it("converts values on a retype", () => {
    const saved = [field({ key: "count", type: "text" })];
    const draft = [draftOf(saved[0], { type: "number" })];
    const result = transformEntry(entry({ count: "42" }), saved, draft);

    expect(result.data.count).toBe(42);
    expect(result.invalid).toBe(false);
  });

  it("flags an unconvertible value and leaves it empty by default", () => {
    const saved = [field({ key: "count", type: "text" })];
    const draft = [draftOf(saved[0], { type: "number" })];
    const result = transformEntry(entry({ count: "abc" }), saved, draft);

    expect(result.data.count).toBeNull();
    expect(result.invalid).toBe(true);
    expect(result.problems[0].kind).toBe("unconvertible");
    expect(result.problems[0].resolved).toBe(false);
  });

  describe("resolution strategies", () => {
    const saved = [field({ key: "count", label: "Count", type: "text" })];
    const draft = [draftOf(saved[0], { type: "number" })];
    const bad = entry({ count: "abc" });

    it("`default` substitutes a value and clears the problem entirely", () => {
      const resolutions: Resolutions = {
        count: { strategy: "default", defaultValue: 0 },
      };
      const result = transformEntry(bad, saved, draft, resolutions);

      expect(result.data.count).toBe(0);
      expect(result.problems).toHaveLength(0);
      expect(result.invalid).toBe(false);
    });

    it("`clear` drops the value WITHOUT flagging — the loss is accepted", () => {
      const result = transformEntry(bad, saved, draft, {
        count: { strategy: "clear" },
      });

      expect(result.data.count).toBeNull();
      expect(result.invalid).toBe(false);
      expect(result.problems[0].resolved).toBe(true);
      expect(result.problems[0].flags).toBe(false);
    });

    it("`flag` drops the value AND flags the row", () => {
      const result = transformEntry(bad, saved, draft, {
        count: { strategy: "flag" },
      });

      expect(result.data.count).toBeNull();
      expect(result.invalid).toBe(true);
      expect(result.problems[0].resolved).toBe(true);
    });

    it("a per-entry override beats every strategy", () => {
      const result = transformEntry(bad, saved, draft, {
        count: { strategy: "clear", overrides: { [UUID_A]: 99 } },
      });

      expect(result.data.count).toBe(99);
      expect(result.problems).toHaveLength(0);
    });
  });

  describe("newly required fields", () => {
    it("flags a row whose value is empty", () => {
      const saved = [field({ key: "title", label: "Title" })];
      const draft = [draftOf(saved[0], { required: true })];
      const result = transformEntry(entry({ title: null }), saved, draft);

      expect(result.problems[0].kind).toBe("required-empty");
      expect(result.invalid).toBe(true);
    });

    it("is satisfied by a default", () => {
      const saved = [field({ key: "title", label: "Title" })];
      const draft = [draftOf(saved[0], { required: true })];
      const result = transformEntry(entry({ title: null }), saved, draft, {
        title: { strategy: "default", defaultValue: "Untitled" },
      });

      expect(result.data.title).toBe("Untitled");
      expect(result.invalid).toBe(false);
    });

    it("cannot be resolved by clearing — empty is the problem", () => {
      const saved = [field({ key: "title", label: "Title" })];
      const draft = [draftOf(saved[0], { required: true })];
      const result = transformEntry(entry({ title: "" }), saved, draft, {
        title: { strategy: "clear" },
      });

      expect(result.invalid).toBe(true);
    });

    it("leaves rows that already have a value alone", () => {
      const saved = [field({ key: "title", label: "Title" })];
      const draft = [draftOf(saved[0], { required: true })];
      const result = transformEntry(entry({ title: "Present" }), saved, draft);

      expect(result.problems).toHaveLength(0);
      expect(result.invalid).toBe(false);
    });
  });

  it("clears a previously-set invalid flag when nothing is wrong any more", () => {
    const saved = [field({ key: "title" })];
    const draft = [draftOf(saved[0])];
    const flagged: Entry = { ...entry({ title: "Fine" }), invalid: true };
    const result = transformEntry(flagged, saved, draft);

    expect(result.invalid).toBe(false);
    expect(result.changed).toBe(true);
  });

  it("reports `changed: false` when nothing actually moves", () => {
    const saved = [field({ key: "title" })];
    const draft = [draftOf(saved[0], { label: "Renamed label only" })];
    const result = transformEntry(entry({ title: "A" }), saved, draft);

    expect(result.changed).toBe(false);
  });
});

/* ------------------------------------------------------ analyzeMigration */

describe("analyzeMigration", () => {
  const saved = [
    field({ key: "title", label: "Title", position: 0 }),
    field({ key: "count", label: "Count", type: "text", position: 1 }),
  ];
  const entries = [
    entry({ title: "A", count: "1" }, "aaaaaaaa-0001-4111-8111-111111111111"),
    entry({ title: "B", count: "2" }, "aaaaaaaa-0002-4111-8111-111111111111"),
    entry({ title: "C", count: "oops" }, "aaaaaaaa-0003-4111-8111-111111111111"),
  ];

  const retype = [draftOf(saved[0]), draftOf(saved[1], { type: "number" })];

  it("counts affected and problem entries exactly", () => {
    const analysis = analyzeMigration(saved, retype, entries);
    const impact = analysis.impacts.find((i) => i.fieldKey === "count")!;

    expect(analysis.entryCount).toBe(3);
    expect(impact.affectedCount).toBe(3);
    expect(impact.problemCount).toBe(1);
    expect(impact.needsDecision).toBe(true);
  });

  it("produces before/after rows that match the transform", () => {
    const analysis = analyzeMigration(saved, retype, entries);
    const impact = analysis.impacts.find((i) => i.fieldKey === "count")!;

    expect(impact.rows[0]).toMatchObject({ before: "1", after: 1, status: "converted" });
    expect(impact.rows[2]).toMatchObject({ before: "oops", status: "problem" });
  });

  it("stops needing a decision once one is made", () => {
    const analysis = analyzeMigration(saved, retype, entries, {
      count: { strategy: "clear" },
    });

    expect(analysis.unresolvedFieldKeys).toEqual([]);
    expect(analysis.flaggedEntryCount).toBe(0);
  });

  it("ignores changes that cannot touch stored data", () => {
    const cosmetic = [draftOf(saved[1]), draftOf(saved[0], { label: "New label" })];
    const analysis = analyzeMigration(saved, cosmetic, entries);

    // Reorder + relabel only.
    expect(analysis.impacts).toHaveLength(0);
    expect(analysis.changedEntryCount).toBe(0);
  });

  it("reports a no-op change set", () => {
    const analysis = analyzeMigration(saved, saved.map((f) => draftOf(f)), entries);
    expect(analysis.isNoop).toBe(true);
  });
});

/* ---------------------------------------------------- buildMigrationPlan */

describe("buildMigrationPlan", () => {
  const saved = [
    field({ key: "title", label: "Title", position: 0 }),
    field({ key: "count", label: "Count", type: "text", position: 1 }),
  ];
  const entries = [
    entry({ title: "A", count: "1" }, "aaaaaaaa-0001-4111-8111-111111111111"),
    entry({ title: "B", count: "2" }, "aaaaaaaa-0002-4111-8111-111111111111"),
  ];

  it("writes only entries that actually change", () => {
    // Relabel alone: no stored value moves, so no row should be rewritten —
    // otherwise every client gets woken up for nothing.
    const plan = buildMigrationPlan(
      SCHEMA_ID,
      saved,
      [draftOf(saved[0], { label: "Headline" }), draftOf(saved[1])],
      entries,
    );

    expect(plan.entries).toHaveLength(0);
    expect(plan.summary.entriesUpdated).toBe(0);
  });

  it("lists removed fields and keeps the rest in order", () => {
    const plan = buildMigrationPlan(SCHEMA_ID, saved, [draftOf(saved[1])], entries);

    expect(plan.deleteFieldIds).toEqual(["f-title"]);
    expect(plan.fields).toHaveLength(1);
    expect(plan.fields[0]).toMatchObject({ id: "f-count", position: 0 });
    expect(plan.summary.fieldsRemoved).toBe(1);
  });

  it("omits the id for a new field so the database generates one", () => {
    const plan = buildMigrationPlan(
      SCHEMA_ID,
      saved,
      [
        ...saved.map((f) => draftOf(f)),
        { key: "extra", label: "Extra", type: "text", required: false, target_schema_id: null },
      ],
      entries,
    );

    expect(plan.fields[2].id).toBeUndefined();
    expect(plan.summary.fieldsAdded).toBe(1);
  });

  it("counts changed fields without counting relabels of untouched data", () => {
    const plan = buildMigrationPlan(
      SCHEMA_ID,
      saved,
      [draftOf(saved[0]), draftOf(saved[1], { type: "number" })],
      entries,
    );

    expect(plan.summary.fieldsChanged).toBe(1);
    expect(plan.summary.entriesUpdated).toBe(2);
  });

  it("carries the reference target through", () => {
    const ref = field({ key: "author", type: "reference", target_schema_id: TARGET_ID });
    const plan = buildMigrationPlan(SCHEMA_ID, [ref], [draftOf(ref)], []);
    expect(plan.fields[0].target_schema_id).toBe(TARGET_ID);
  });
});

/* -------------------------------------------- the preview cannot lie test */

describe("preview and apply agree", () => {
  it("the analysed after-values are exactly what the plan writes", () => {
    const saved = [
      field({ key: "title", label: "Title", position: 0 }),
      field({ key: "count", label: "Count", type: "text", position: 1 }),
    ];
    const draft = [draftOf(saved[0]), draftOf(saved[1], { type: "number" })];
    const entries = [
      entry({ title: "A", count: "10" }, "aaaaaaaa-0001-4111-8111-111111111111"),
      entry({ title: "B", count: "x" }, "aaaaaaaa-0002-4111-8111-111111111111"),
    ];
    const resolutions: Resolutions = {
      count: { strategy: "default", defaultValue: -1 },
    };

    const analysis = analyzeMigration(saved, draft, entries, resolutions);
    const plan = buildMigrationPlan(SCHEMA_ID, saved, draft, entries, resolutions);

    const previewed = new Map(
      analysis.impacts
        .find((i) => i.fieldKey === "count")!
        .rows.map((r) => [r.entryId, r.after]),
    );

    // Every value the user was shown is the value that will be written.
    for (const planned of plan.entries) {
      expect(planned.data.count).toBe(previewed.get(planned.id));
    }
    expect(previewed.get("aaaaaaaa-0001-4111-8111-111111111111")).toBe(10);
    expect(previewed.get("aaaaaaaa-0002-4111-8111-111111111111")).toBe(-1);
  });
});
