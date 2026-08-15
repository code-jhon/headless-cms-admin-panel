import { describe, expect, it } from "vitest";

import {
  conversionRisk,
  diffFields,
  gateChanges,
  peakRisk,
} from "../diff";
import type { FieldDraft } from "../validation";
import type { Field, FieldType } from "@/types/cms";

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

function draft(from: Field, overrides: Partial<FieldDraft> = {}): FieldDraft {
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

describe("diffFields", () => {
  it("reports nothing when the draft matches the saved state", () => {
    const saved = [field({ key: "title" })];
    expect(diffFields(saved, [draft(saved[0])])).toEqual([]);
  });

  it("detects an added field as safe", () => {
    const changes = diffFields(
      [],
      [
        {
          key: "title",
          label: "Title",
          type: "text",
          required: false,
          target_schema_id: null,
        },
      ],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("add_field");
    expect(changes[0].risk).toBe("safe");
  });

  it("flags a new required field so the gate can block it", () => {
    const changes = diffFields(
      [],
      [
        {
          key: "title",
          label: "Title",
          type: "text",
          required: true,
          target_schema_id: null,
        },
      ],
    );

    // Still "safe" in isolation — riskiness depends on the entry count,
    // which only gateChanges knows.
    expect(changes[0].risk).toBe("safe");
    expect(changes[0].consequence).toBeDefined();
  });

  it("treats a removed field as a lossy delete", () => {
    const saved = [field({ key: "title" }), field({ key: "body" })];
    const changes = diffFields(saved, [draft(saved[0])]);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("delete_field");
    expect(changes[0].risk).toBe("lossy");
    expect(changes[0].key).toBe("body");
  });

  it("distinguishes a rename from a delete-plus-add", () => {
    const saved = [field({ key: "body" })];
    const changes = diffFields(saved, [draft(saved[0], { key: "content" })]);

    expect(changes.map((c) => c.kind)).toEqual(["rename_key"]);
    expect(changes[0].previousKey).toBe("body");
    expect(changes[0].key).toBe("content");
  });

  it("treats a label change alone as safe", () => {
    const saved = [field({ key: "body", label: "Body" })];
    const changes = diffFields(saved, [draft(saved[0], { label: "Content" })]);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("rename_label");
    expect(changes[0].risk).toBe("safe");
  });

  it("classifies a lossless retype as safe and a partial one as lossy", () => {
    const numberField = field({ key: "count", type: "number" });
    const lossless = diffFields(
      [numberField],
      [draft(numberField, { type: "text" })],
    );
    expect(lossless[0].kind).toBe("retype");
    expect(lossless[0].risk).toBe("safe");

    const textField = field({ key: "count", type: "text" });
    const partial = diffFields(
      [textField],
      [draft(textField, { type: "number" })],
    );
    expect(partial[0].risk).toBe("lossy");
    expect(partial[0].consequence).toMatch(/not convert/i);
  });

  it("marks making a field required as blocking, and optional as safe", () => {
    const optional = field({ key: "title" });
    const madeRequired = diffFields(
      [optional],
      [draft(optional, { required: true })],
    );
    expect(madeRequired[0].kind).toBe("set_required");
    expect(madeRequired[0].risk).toBe("blocking");

    const required = field({ key: "title", required: true });
    const madeOptional = diffFields(
      [required],
      [draft(required, { required: false })],
    );
    expect(madeOptional[0].kind).toBe("unset_required");
    expect(madeOptional[0].risk).toBe("safe");
  });

  it("detects a reference retarget", () => {
    const ref = field({
      key: "author",
      type: "reference",
      target_schema_id: "22222222-2222-4222-8222-222222222222",
    });
    const changes = diffFields(
      [ref],
      [
        draft(ref, {
          target_schema_id: "33333333-3333-4333-8333-333333333333",
        }),
      ],
    );

    expect(changes[0].kind).toBe("retarget_reference");
    expect(changes[0].risk).toBe("lossy");
  });

  it("detects reordering as safe", () => {
    const a = field({ key: "a", position: 0 });
    const b = field({ key: "b", position: 1 });
    const changes = diffFields([a, b], [draft(b), draft(a)]);

    expect(changes.every((c) => c.kind === "reorder")).toBe(true);
    expect(changes.every((c) => c.risk === "safe")).toBe(true);
    expect(changes).toHaveLength(2);
  });

  it("reports several independent changes on one field", () => {
    const saved = [field({ key: "body", label: "Body", type: "text" })];
    const changes = diffFields(
      [saved[0]],
      [
        draft(saved[0], {
          key: "content",
          label: "Content",
          type: "number",
          required: true,
        }),
      ],
    );

    expect(new Set(changes.map((c) => c.kind))).toEqual(
      new Set(["rename_key", "rename_label", "retype", "set_required"]),
    );
  });
});

describe("conversionRisk", () => {
  const cases: Array<[FieldType, FieldType, string]> = [
    ["text", "text", "lossless"],
    ["number", "text", "lossless"],
    ["boolean", "number", "lossless"],
    ["date", "text", "lossless"],
    ["date", "number", "partial"],
    ["reference", "text", "lossless"],
    ["text", "number", "partial"],
    ["text", "date", "partial"],
    ["number", "boolean", "partial"],
    ["date", "boolean", "lossy"],
    ["text", "reference", "lossy"],
    ["number", "reference", "lossy"],
  ];

  it.each(cases)("%s → %s is %s", (from, to, expected) => {
    expect(conversionRisk(from, to)).toBe(expected);
  });

  it("covers every type pair", () => {
    const types: FieldType[] = [
      "text",
      "number",
      "boolean",
      "date",
      "reference",
    ];
    for (const from of types) {
      for (const to of types) {
        expect(["lossless", "partial", "lossy"]).toContain(
          conversionRisk(from, to),
        );
      }
    }
  });
});

describe("gateChanges", () => {
  const saved = [field({ key: "title" })];
  const deleteChange = diffFields(saved, []);

  it("allows everything when there are no entries", () => {
    const gate = gateChanges(deleteChange, 0);
    expect(gate.canApply).toBe(true);
    expect(gate.blocked).toHaveLength(0);
  });

  it("holds back lossy changes once entries exist", () => {
    const gate = gateChanges(deleteChange, 3);
    expect(gate.canApply).toBe(false);
    expect(gate.blocked).toHaveLength(1);
    expect(gate.applicable).toHaveLength(0);
  });

  it("still allows safe changes when entries exist", () => {
    const renameLabel = diffFields(saved, [
      draft(saved[0], { label: "Headline" }),
    ]);
    const gate = gateChanges(renameLabel, 10);
    expect(gate.canApply).toBe(true);
    expect(gate.applicable).toHaveLength(1);
  });

  it("blocks a newly added required field only when entries exist", () => {
    const added = diffFields(
      [],
      [
        {
          key: "slug",
          label: "Slug",
          type: "text",
          required: true,
          target_schema_id: null,
        },
      ],
    );

    expect(gateChanges(added, 0).canApply).toBe(true);
    expect(gateChanges(added, 5).canApply).toBe(false);
  });

  it("does not block a newly added optional field", () => {
    const added = diffFields(
      [],
      [
        {
          key: "slug",
          label: "Slug",
          type: "text",
          required: false,
          target_schema_id: null,
        },
      ],
    );

    expect(gateChanges(added, 5).canApply).toBe(true);
  });
});

describe("peakRisk", () => {
  it("returns null for an empty change set", () => {
    expect(peakRisk([])).toBeNull();
  });

  it("reports the highest risk present", () => {
    const saved = [field({ key: "title" }), field({ key: "body" })];
    const changes = diffFields(saved, [
      draft(saved[0], { label: "Headline", required: true }),
    ]);
    expect(peakRisk(changes)).toBe("blocking");
  });
});
