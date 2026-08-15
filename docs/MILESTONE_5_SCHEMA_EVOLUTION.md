# Milestone 5 — Schema Evolution

**Status:** Complete · **Date:** 2026-08-15
**Covers:** PRD requirements D1–D6 — the centre of the challenge
**Related:** [`PRD.md`](./PRD.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md) · [`MILESTONE_1_SCHEMA_BUILDER.md`](./MILESTONE_1_SCHEMA_BUILDER.md)

> *"When a field is renamed, deleted, retyped, made required, or a reference
> changes target, entries may already exist. Show how you communicate the
> risk, surface the affected entries, preview before applying, and let people
> fix data that no longer fits."*

## Requirements met

| # | Requirement | How |
|---|---|---|
| D1 | Communicate the risk | Every change classified `safe` / `lossy` / `blocking` with a plain-language consequence (built in milestone 1) |
| D2 | Surface affected entries | Exact per-field counts — every row is analysed, not sampled |
| D3 | Preview | Before/after table per field, showing the real converted value or the reason it fails |
| D4 | Fix data that no longer fits | Four strategies per field: set a default, clear, keep-and-flag, or leave unresolved — plus per-entry overrides |
| D5 | Apply atomically | One Postgres function, one transaction, then a summary of what changed |
| D6 | Rename preserves data | Values are read by the *saved* key and written under the *draft* key |

## The architectural decision

The strategy doc promised two things that pull against each other:

- **The preview cannot lie** — what the user approves must be what lands.
- **The apply must be atomic** — all of it or none of it.

The obvious way to get atomicity is to do the transformation in SQL. That
would mean two implementations of the same conversion rules — one in
TypeScript for the preview, one in PL/pgSQL for the write — and any drift
between them shows up as a preview that promised one thing and a migration
that did another. Which is the precise failure this feature exists to prevent.

**So the transform stays in one place and the database only writes.**
`lib/migrations/transform.ts` computes every new value; the RPC receives them
already resolved and is responsible solely for writing them in one
transaction. There is no business logic in SQL to drift.

The cost is a larger payload — every changed row travels to the database as
JSON — which is why the tool caps at 5,000 entries per migration and says so
rather than silently truncating.

A test asserts the property directly: the values shown in the preview are
compared to the values the plan writes, and they must be identical.

## The rename-swap problem

Renaming `body` → `content` while `content` → `body` is legal at the end of
the batch but violates the `(schema_id, key)` unique constraint half way
through it. `0002` therefore redefines that constraint as `DEFERRABLE` and the
function defers it for the duration, so the whole set of renames lands
together. Verified against real Postgres: the swap succeeds and both values
end up under the right keys.

## Files

| Area | Files |
|---|---|
| Conversion + per-entry transform | `lib/migrations/transform.ts` |
| Dry run and write plan | `lib/migrations/analyze.ts` |
| Atomic apply | `supabase/migrations/0002_apply_schema_migration.sql` |
| Server actions | `lib/actions/migrations.ts` |
| Review UI | `components/schema/migration-review.tsx` |
| Entry point | `components/schema/schema-editor.tsx` |
| Tests | `lib/migrations/__tests__/transform.test.ts` |

## Decisions

**Ambiguous conversions fail rather than guess.** `7 → boolean` is rejected
while `0`/`1` succeed; `"maybe" → boolean` is rejected while `"yes"` is not. A
wrong-but-plausible conversion is worse than one the user is asked about,
because nobody reviews a migration that appears to have worked.

**`clear` and `flag` are different answers.** Both drop the value; `clear`
means "I accept this loss" and leaves the row clean, `flag` means "someone
should fix this" and marks it. Collapsing them would have made the flag
meaningless.

**A default fully resolves a problem.** If the user supplies a value, the row
is not flagged — there is nothing left wrong with it.

**Clearing cannot satisfy a newly-required field.** Empty *is* the problem, so
that path always flags. The UI does not offer a resolution that silently
fails.

**Re-analysis runs on every resolution change.** Changing a strategy
recomputes the counts and the preview from the server. A stale preview is the
one thing this screen must never show.

**Only changed rows are written.** A migration that touches one field should
not rewrite every row's `updated_at` and wake every connected client
(milestone 4) for nothing.

## Verification

**219 unit tests** (40 new), including the full 5×5 conversion matrix, every
resolution strategy, rename preservation, newly-required handling, and the
preview-matches-plan property.

**Two real bugs found by those tests, both the kind this feature exists to
prevent:**

1. **`2026-02-29` was silently becoming `2026-03-01`.** An ISO-shaped but
   impossible date failed the calendar check, then fell through to a lenient
   `Date.parse` that rolls over — and reported success. Exactly the
   wrong-but-plausible conversion the design forbids. Now rejected outright.

2. **Reordering fields would have rewritten every entry.** The "did this row
   change?" check used `JSON.stringify`, which is key-order sensitive, and the
   draft rebuilds the object in field order. A pure reorder would have bumped
   every `updated_at` and woken every connected client for a change that
   touched no data. Now compared order-insensitively — which is also correct,
   since jsonb does not preserve key order anyway.

**Run against real PostgreSQL 16**, not just reasoned about:

| Check | Result |
|---|---|
| `0002` applies, and is idempotent | Pass |
| The unique constraint becomes `DEFERRABLE` | Pass |
| **Rename swap** (`title`↔`body` in one call) | Pass — both values land under the right keys |
| **Rollback**: a failure mid-migration | Pass — the field delete *and* the entry rewrite were both undone |
| Incomplete field list refused | Pass |
| Deleting the last field refused | Pass |
| A field from another content type refused | Pass |
| **Full pipeline**: TypeScript plan → RPC → stored rows | Pass — **0 mismatches** against the preview |

**Static checks:** typecheck, lint and production build all clean.

**Not verified:** the review UI against a live Supabase project. The engine
beneath it is unit-tested and the RPC is verified against real Postgres.

## Try it

1. `npm run seed` for the `Article` type with entries.
2. Run `supabase/migrations/0002_apply_schema_migration.sql` in your Supabase SQL Editor.
3. Open the schema, change **Read time (min)** from number to text, save, add a
   non-numeric value to one entry, then change it back to number.
4. **Review changes** now shows: how many entries are affected, what each value
   becomes, and which one will not convert. Choose what to do with it, watch
   the counts update, then apply.

## Remaining — Milestone 6

Empty/loading/error-state polish, the README pass, deployment, and the two
narrative deliverables: the async walkthrough and the AI session record.
