# Milestone 1 — Schema Builder

**Status:** Complete · **Date:** 2026-08-15
**Covers:** PRD requirements A1–A5
**Related:** [`PRD.md`](./PRD.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md) · [`MILESTONE_0_FOUNDATION.md`](./MILESTONE_0_FOUNDATION.md)

Create, edit and delete content types and their fields through the UI.

## Requirements met

| # | Requirement | How |
|---|---|---|
| A1 | Create a schema with name, API ID and ≥1 field | `/schemas/new`; API ID auto-derived from the name, editable until saved |
| A2 | Add, reorder, edit and remove fields | `/schemas/[apiId]`; up/down buttons, inline edit, remove |
| A3 | Unique, validated machine names | `snake_case` regex, per-schema uniqueness, reserved-word list — enforced in the form, the server action and the DB |
| A4 | Delete warns about entries and referrers | Confirmation dialog: incoming references block outright; deleting a type with entries needs its API ID typed |
| A5 | Reference fields target an existing schema; self-references allowed | Target picker lists all schemas including the current one |

## Architecture

**The draft/change-set model.** The editor holds a draft; nothing is written
until save. On every keystroke `diffFields(saved, draft)` produces a typed
change set, each entry classified `safe` / `lossy` / `blocking`, rendered as a
live "Unsaved changes" panel with a plain-language consequence.

This is deliberately the shape milestone 5 needs. The intended pipeline is:

```
diff → classify → [analyze → preview → resolve] → apply
```

Milestone 1 implements diff, classify and apply, and *gates* the rest: when
entries exist, any non-safe change is held back with "needs the review flow
(milestone 5)". Milestone 5 fills in the bracketed steps and lifts the gate —
`lib/schema/diff.ts` should not need rewriting.

**Why match fields by `id` and not by key.** It is what makes a rename
distinguishable from a delete-plus-create, and therefore what lets a rename
preserve data (PRD D6). A key-based diff would silently destroy the column.

**The server never trusts the draft.** `saveSchemaFields` re-reads the saved
fields, re-runs the diff against current database state and re-applies the
gate. The client's copy can be stale — once milestone 4 lands, another client
may have changed the schema a second ago.

## Files

| Area | Files |
|---|---|
| Diff engine | `lib/schema/diff.ts` — change kinds, risk classification, conversion matrix, gate |
| Validation | `lib/schema/validation.ts`, `lib/schema/constants.ts` |
| Server actions | `lib/actions/schemas.ts` — create, update meta, save fields, delete |
| Queries | `lib/queries.ts` — summaries with counts, schema by API ID, usage |
| UI primitives | `components/ui/index.tsx` |
| Builder UI | `components/schema/{schema-editor,new-schema-form,field-editor,field-row,change-summary,delete-schema-dialog}.tsx` |
| Pages | `app/(admin)/schemas/{page,new/page,[apiId]/page}.tsx` |
| Tests | `lib/schema/__tests__/{diff,validation}.test.ts` |

## Decisions

**Hand-rolled UI primitives, not shadcn/ui.** The strategy doc named shadcn;
the surface actually needed is a handful of form controls, and native elements
(`<select>`, `<dialog>`) give keyboard and screen-reader behaviour for free
without a Radix dependency tree. Strategy doc updated.

**`api_id` is immutable after creation.** It is the public read-API path;
changing it silently breaks every consumer. The field is disabled in the
editor with that reason stated inline. Renaming a *field* key is supported —
that is a data migration the diff can describe.

**Up/down reordering, not drag-and-drop.** Keyboard accessible, testable, and
adequate for the 5–15 fields a schema realistically has.

**`date → number` is classified lossy, not safe.** Epoch millis are
recoverable, so it is technically lossless — but `1843-10-01` becoming
`-3986064000000` is not what an editor expects. The bytes survive; the meaning
does not. Flagged for review rather than applied silently.

**Field saves are not yet transactional.** Supabase's REST API has no
multi-statement transaction, so a mid-flight failure could leave a partial
apply. Deletes run before writes so the `(schema_id, key)` unique constraint
is never transiently violated. Milestone 5 moves the whole apply into a
Postgres RPC, which removes the exposure.

## Verification

**Unit tests — 59 passing** (`npm test`), covering the diff engine (every
change kind, the full 5×5 type-conversion matrix, gate behaviour at zero and
non-zero entry counts) and validation (machine-name derivation including
accents and leading digits, reserved words, duplicate keys, reference-target
rules).

**The migration was executed against a real PostgreSQL 16 instance**, not just
read. That surfaced and fixed a genuine bug, and confirmed the guarantees the
builder relies on:

| Check | Result |
|---|---|
| `0001_init.sql` applies cleanly | Pass |
| Re-running it is idempotent | **Failed** — `create type` has no `IF NOT EXISTS`; fixed with a guard, then verified over three consecutive runs |
| `api_id` format constraint rejects `Bad Name`, `9lives` | Pass |
| Duplicate `api_id` rejected | Pass |
| Duplicate field key within a schema rejected; same key on another schema allowed | Pass |
| Non-reference field with a target rejected; reference without one rejected | Pass |
| Deleting a schema referenced by another is blocked (`on delete restrict`) | Pass |
| Deleting a schema that references *itself* succeeds (cascade wins) | Pass — confirms the dialog's copy |
| Deleting a schema cascades its fields and entries | Pass |
| `updated_at` triggers fire on update, not on insert | Pass |
| All three tables have `REPLICA IDENTITY FULL` and are in `supabase_realtime` | Pass |

**Static checks:** typecheck, lint and production build all clean; six routes.

**UI:** rendered in a headless browser and driven through a realistic edit —
rename a label, rename a key, retype, make a field required, delete a field,
reorder — confirming the change summary classifies all seven resulting changes
correctly and marks the three risky ones as held back.

**Not verified:** the server actions against a live Supabase project, which
needs credentials. The pure logic they delegate to is covered by unit tests,
and the DB constraints they rely on are covered above.

## Next — Milestone 2 (Dynamic Entry Editor)

Renderer registry (one component per field type), Zod validation compiled at
runtime from `fields`, entry list and full CRUD, reference picker.
