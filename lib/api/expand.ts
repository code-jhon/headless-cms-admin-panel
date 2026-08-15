import { findExpansionTargets } from "./data";
import { serializeEntry, type SerializedEntry } from "./serialize";
import type { Entry, Field } from "@/types/cms";

/**
 * Resolve reference expansion for a set of entries in one round trip.
 *
 * Collecting every referenced id across the whole page first means one query
 * regardless of page size — the alternative is a lookup per entry per
 * reference field, which is the classic N+1.
 *
 * Expansion is one level deep. Going deeper needs cycle detection, since
 * `Person.manager → Person` is a legal schema here, and the challenge asks
 * for a simple read API rather than a graph query language.
 */
export async function expandReferences(
  entries: Entry[],
  fields: Field[],
  expandKeys: string[],
): Promise<Map<string, SerializedEntry> | undefined> {
  if (expandKeys.length === 0) return undefined;

  const referenceFields = fields.filter(
    (f) => f.type === "reference" && expandKeys.includes(f.key),
  );
  if (referenceFields.length === 0) return new Map();

  const ids = new Set<string>();
  const targetSchemaIds = new Set<string>();

  for (const entry of entries) {
    for (const field of referenceFields) {
      const value = entry.data?.[field.key];
      if (typeof value === "string" && value !== "") {
        ids.add(value);
        if (field.target_schema_id) targetSchemaIds.add(field.target_schema_id);
      }
    }
  }

  if (ids.size === 0) return new Map();

  const { entries: targets, fieldsBySchema } = await findExpansionTargets(
    [...ids],
    [...targetSchemaIds],
  );

  const expanded = new Map<string, SerializedEntry>();
  for (const target of targets) {
    const targetFields = fieldsBySchema.get(target.schema_id) ?? [];
    // No expand keys passed down — this is the depth limit.
    expanded.set(target.id, serializeEntry(target, targetFields));
  }

  return expanded;
}
