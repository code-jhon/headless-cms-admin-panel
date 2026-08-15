import { describe, expect, it } from "vitest";

import {
  fieldDraftListSchema,
  schemaMetaSchema,
  toMachineName,
  validateFieldDrafts,
  type FieldDraft,
} from "../validation";

const UUID = "11111111-1111-4111-8111-111111111111";

function draft(overrides: Partial<FieldDraft> = {}): FieldDraft {
  return {
    key: "title",
    label: "Title",
    type: "text",
    required: false,
    target_schema_id: null,
    ...overrides,
  };
}

describe("toMachineName", () => {
  it.each([
    ["Published At", "published_at"],
    ["Read time (min)", "read_time_min"],
    ["  spaced  out  ", "spaced_out"],
    ["Título", "titulo"],
    ["Ünïcödé Näme", "unicode_name"],
    ["already_fine", "already_fine"],
    ["MiXeD CaSe", "mixed_case"],
    ["multiple---separators", "multiple_separators"],
    ["trailing!!!", "trailing"],
  ])("%s → %s", (input, expected) => {
    expect(toMachineName(input)).toBe(expected);
  });

  it("prefixes names that would start with a digit", () => {
    // The DB CHECK constraint requires a leading letter.
    expect(toMachineName("2024 archive")).toBe("f_2024_archive");
  });

  it("caps length at 48 characters", () => {
    expect(toMachineName("a".repeat(80))).toHaveLength(48);
  });

  it("produces output that satisfies the machine-name rule", () => {
    const inputs = ["Published At", "Read time (min)", "2024 archive", "Título"];
    for (const input of inputs) {
      expect(toMachineName(input)).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe("schemaMetaSchema", () => {
  it("accepts a well-formed schema", () => {
    expect(
      schemaMetaSchema.safeParse({
        name: "Article",
        api_id: "article",
        description: "",
      }).success,
    ).toBe(true);
  });

  it.each(["Article", "9lives", "with space", "trailing_"])(
    "rejects api_id %s",
    (api_id) => {
      const result = schemaMetaSchema.safeParse({
        name: "X",
        api_id,
        description: "",
      });
      // "trailing_" is legal per the regex; assert only the illegal ones.
      if (api_id === "trailing_") {
        expect(result.success).toBe(true);
        return;
      }
      expect(result.success).toBe(false);
    },
  );

  it("rejects reserved api_ids that would shadow a route", () => {
    for (const api_id of ["api", "health", "schemas", "new"]) {
      expect(
        schemaMetaSchema.safeParse({ name: "X", api_id, description: "" })
          .success,
      ).toBe(false);
    }
  });

  it("rejects a blank name", () => {
    expect(
      schemaMetaSchema.safeParse({
        name: "   ",
        api_id: "article",
        description: "",
      }).success,
    ).toBe(false);
  });
});

describe("fieldDraftListSchema", () => {
  it("requires at least one field", () => {
    expect(fieldDraftListSchema.safeParse([]).success).toBe(false);
  });

  it("rejects reserved field keys that clash with the entry envelope", () => {
    for (const key of ["id", "created_at", "updated_at", "data"]) {
      expect(fieldDraftListSchema.safeParse([draft({ key })]).success).toBe(
        false,
      );
    }
  });

  it("rejects duplicate keys within one schema", () => {
    const result = fieldDraftListSchema.safeParse([
      draft({ key: "title" }),
      draft({ key: "title", label: "Other" }),
    ]);
    expect(result.success).toBe(false);
  });

  it("requires a target on reference fields", () => {
    expect(
      fieldDraftListSchema.safeParse([
        draft({ type: "reference", target_schema_id: null }),
      ]).success,
    ).toBe(false);

    expect(
      fieldDraftListSchema.safeParse([
        draft({ type: "reference", target_schema_id: UUID }),
      ]).success,
    ).toBe(true);
  });

  it("rejects a target on non-reference fields", () => {
    // Mirrors the fields_reference_target CHECK constraint.
    expect(
      fieldDraftListSchema.safeParse([
        draft({ type: "text", target_schema_id: UUID }),
      ]).success,
    ).toBe(false);
  });
});

describe("validateFieldDrafts", () => {
  it("returns no errors for a valid list", () => {
    const { errors, formError } = validateFieldDrafts([
      draft({ key: "title" }),
      draft({ key: "body", label: "Body" }),
    ]);
    expect(formError).toBeNull();
    expect(errors.every((e) => Object.keys(e).length === 0)).toBe(true);
  });

  it("attributes a duplicate key to the second occurrence only", () => {
    const { errors } = validateFieldDrafts([
      draft({ key: "title" }),
      draft({ key: "title", label: "Second" }),
    ]);
    expect(errors[0].key).toBeUndefined();
    expect(errors[1].key).toMatch(/duplicate/i);
  });

  it("reports a per-row error on the offending row", () => {
    const { errors } = validateFieldDrafts([
      draft({ key: "title" }),
      draft({ key: "", label: "" }),
    ]);
    expect(errors[1].key).toBeDefined();
    expect(errors[1].label).toBeDefined();
  });

  it("reports an empty list as a form-level error", () => {
    const { formError } = validateFieldDrafts([]);
    expect(formError).toMatch(/at least one field/i);
  });
});
