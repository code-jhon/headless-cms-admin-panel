# Milestone 2 — Dynamic Entry Editor

**Status:** Complete · **Date:** 2026-08-15
**Covers:** PRD requirements B1–B5
**Related:** [`PRD.md`](./PRD.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md) · [`MILESTONE_1_SCHEMA_BUILDER.md`](./MILESTONE_1_SCHEMA_BUILDER.md)

Full CRUD on entries, through a form generated from the schema rather than
written per content type.

## Requirements met

| # | Requirement | How |
|---|---|---|
| B1 | Entry list with sortable, searchable derived columns | `/content/[apiId]`; columns from `listColumns` (text fields first), click a header to sort, search across text fields |
| B2 | Form generated from the schema, not hand-written per type | `EntryForm` walks `schema.fields` and looks up `FIELD_RENDERERS[field.type]` |
| B3 | Validation derived from the schema | `buildEntrySchema(fields)` compiles a Zod schema at runtime; the reference picker lists target entries |
| B4 | Full CRUD with delete confirmation | Create, edit, delete; native `<dialog>` confirmation |
| B5 | New field type = one renderer | Adding a type touches `FIELD_RENDERERS` and `VALIDATORS`. Nothing else. |

## Architecture

**One schema definition, three consumers.** The `fields` rows drive the form
layout, the validation schema and the list columns. There is no per-content-type
code anywhere in the app — creating `Recipe` in the builder yields a working
editor with zero lines written.

**Validation is compiled twice, trusted once.** The browser compiles
`buildEntrySchema(fields)` for immediate feedback; the server recompiles it
from *its own* read of the `fields` table before every write. A client on a
stale schema therefore cannot write a value the live schema would reject —
which matters once milestone 4 lets schemas change under an open form.

**Unknown keys are stripped, not rejected.** `z.object().strip()` means a
stale or malicious client cannot smuggle extra keys into JSONB storage.

**Reference integrity is enforced in the action.** JSONB storage gives up
foreign keys, so `validateReferences` checks that each referenced entry exists
*and* belongs to the field's target schema. This is the one integrity check
the data model trades away in exchange for making schema evolution a data
transform — worth naming out loud rather than leaving implicit.

**Optimistic concurrency is in place early.** `updateEntry` takes the
`updated_at` the form loaded with and refuses the write if the row moved on,
offering an explicit "Overwrite anyway" as a separate action. That is PRD C3,
built now because milestone 4 makes concurrent edits likely rather than
theoretical.

## Files

| Area | Files |
|---|---|
| Runtime validation | `lib/schema/zod-builder.ts` — validator per type, required/optional wrapper, coercion, form-value mapping |
| Display logic | `lib/schema/display.ts` — column selection, entry titles, value formatting, sort, search |
| Renderer registry | `components/fields/index.tsx` — one component per field type |
| Server actions | `lib/actions/entries.ts` — create, update, force-update, delete |
| Queries | `lib/queries.ts` — `listEntries`, `getEntry`, `listReferenceOptions`, `listReferenceTitles` |
| UI | `components/entry/{entry-form,entry-table,delete-entry-button}.tsx` |
| Pages | `app/(admin)/content/[apiId]/{page,new/page,[entryId]/page}.tsx` |
| Progress | `lib/milestones.ts` — single source for the roadmap and sidebar |
| Tests | `lib/schema/__tests__/{zod-builder,display}.test.ts` |

## Decisions

**Plain state, not React Hook Form.** The strategy doc named RHF. For a form
whose fields are values in an array, a single `Record<key, value>` state object
plus the compiled Zod schema is less machinery than `Controller` per dynamic
field, and it keeps milestones 1 and 2 written the same way. RHF is still a
dependency for now; it comes out in cleanup if nothing else needs it.

**`false` and `0` are values, not emptiness.** `isEmptyValue` exists precisely
so nothing in the codebase writes `if (!value)` — an unchecked box and a
legitimate zero would both be misread as missing. Directly tested.

**Long text gets a textarea by heuristic, not by type.** The challenge asks for
five field types, not five widgets, so `text` renders as a textarea when the
value is long or contains newlines rather than adding a "long text" type.

**Dangling references stay visible.** A reference to a deleted entry keeps its
option in the picker, marked "Missing entry", instead of silently resetting to
"None" and quietly discarding the link. Deleting an entry also flags rows that
referenced it as `invalid`, so breakage surfaces in the list.

**Dates are formatted from their parts.** `new Date("2026-08-15")` parses as
UTC midnight and renders as the 14th anywhere west of Greenwich. Both the
formatter and the validator work on the `YYYY-MM-DD` parts directly.

## Verification

**117 unit tests passing** (`npm test`), up from 59.

A test caught a real bug during the build: `Date.parse("2026-02-31")` does
**not** fail — JavaScript rolls it over to 3 March, so the original date
validator accepted impossible dates. Replaced with a round-trip check, and
covered with cases for 31 February, month 13, and 29 February across leap
years, century years and 2000.

**Driven in a headless browser** against a preview harness:

| Check | Result |
|---|---|
| Submitting an empty form | Reports both required fields by label, not by key |
| `read_time = 0` | Accepted — zero is not emptiness |
| Search for "compil" | Filters 3 rows to 1 |
| Sort by Read time | `0, 7, 10` — numeric, not the lexical `0, 10, 7` |
| Entry flagged `invalid` | Renders a "Needs attention" badge |
| Empty values in the table | Render as `—` |

**Static checks:** typecheck, lint, production build all clean; nine routes.

**Not verified:** the server actions against a live Supabase project, which
needs credentials. Their validation logic is unit-tested and their SQL-level
guarantees were checked against real Postgres in milestone 1.

## Next — Milestone 3 (Read API)

`GET /api/content/[type]` and `/[type]/:id`, with `limit`/`offset`,
`?expand=` for reference hydration, and typed error bodies.
