# Implementation Strategy — Headless CMS Admin Panel

**Project:** `headless-cms-admin-panel`
**Status:** v1.5 — milestones 0–4 delivered · **Date:** 2026-08-15
**Related doc:** [`PRD.md`](./PRD.md)

---

## 1. Stack Decision

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 16 (App Router) + TypeScript** | One repo, one deploy; Route Handlers are exactly the "thin backend" the challenge asks for |
| UI | React 19, Tailwind CSS v4, hand-rolled primitives | The surface needed is a few form controls; native `<select>`/`<dialog>` give a11y for free without a Radix dependency tree |
| Forms | Plain state + Zod compiled at runtime | Validators are generated from the content schema, so validation is data-driven; for array-driven fields this is less machinery than a form library |
| Data | **Supabase Postgres** | Managed Postgres, JSONB for entry values, SQL for migrations and integrity |
| Real-time | **Supabase Realtime** | Postgres change feed straight to every client — no custom socket server to build or explain |
| Deploy | Vercel + Supabase free tiers | Reviewer can open a live URL |

**Trade-off accepted:** Supabase adds an external dependency and requires env vars in the README, in exchange for near-zero real-time infrastructure code. The alternative — SSE plus an in-memory bus — has no external setup but reinvents reconnect, fan-out and multi-instance behaviour.

## 2. Architecture

```
Browser (React client components)
  ├─ Server Components → initial schema + entry data
  ├─ Server Actions      → schema + entry mutations (validated with Zod)
  └─ Supabase Realtime   → postgres_changes subscription → invalidate + refetch
        │
Next.js Route Handlers  (/api/content/[type], /api/content/[type]/[id])
        │
Supabase Postgres  (schemas, fields, entries JSONB)
```

**Principles**

- The database is the single source of truth. Realtime events carry *what changed*, not the new state; clients invalidate and refetch. Simpler, and impossible to drift.
- All writes go through Server Actions that re-validate against the current schema server-side. The client never trusts its own cached schema for correctness.
- Schema migrations run inside a Postgres transaction via an RPC function — all-or-nothing.

## 3. Data Model

```sql
schemas (
  id uuid pk, name text, api_id text unique,      -- 'Article' / 'article'
  created_at timestamptz, updated_at timestamptz
)

fields (
  id uuid pk, schema_id uuid fk → schemas on delete cascade,
  key text,                                        -- machine name, stable across renames
  label text,
  type text check (type in ('text','number','boolean','date','reference')),
  required boolean default false,
  position int,
  target_schema_id uuid null fk → schemas,         -- reference fields only
  unique (schema_id, key)
)

entries (
  id uuid pk, schema_id uuid fk → schemas on delete cascade,
  data jsonb not null,                             -- { "<field.key>": value }
  invalid boolean default false,                   -- flagged by a migration
  updated_at timestamptz                           -- optimistic-concurrency token
)
```

**Why JSONB for values:** entries stay schema-agnostic, so a schema change is a data transform, not a DDL migration. Trade-off: no column-level DB constraints — validation lives in the Zod layer generated from `fields`. Acceptable for a thin backend; noted in the walkthrough.

**Why `key` is immutable:** renaming a field changes `label` only, unless the user explicitly renames the key — which is then handled as a JSONB key remap, preserving values (PRD D6).

## 4. Feature Approach

### Dynamic form generation

A single `FieldRenderer` registry maps `type → component`:

```ts
const RENDERERS: Record<FieldType, FC<FieldProps>> = {
  text: TextField, number: NumberField, boolean: BooleanField,
  date: DateField, reference: ReferencePicker,
};
```

`buildZodSchema(fields)` compiles the validation schema at runtime from the same `fields` rows. Adding a sixth field type = one component + one branch in the builder. No per-content-type code anywhere.

### Real-time

One subscription per open workspace:

```ts
supabase.channel('cms')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, invalidateEntries)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'fields'  }, invalidateSchema)
  .subscribe(setConnectionState)
```

Events trigger a React Query invalidation → refetch. Connection state renders as a small indicator; on `reconnect` the client refetches everything rather than replaying missed events.

**Concurrent edits:** each save sends the `updated_at` it loaded with; the Server Action rejects on mismatch and the UI offers *reload* or *overwrite*.

### Schema evolution (the differentiator)

Editing a schema builds a **change set** in client state — nothing is written until applied.

1. **Diff** — compare draft fields against saved fields → list of typed changes (`add`, `rename_key`, `delete`, `retype`, `set_required`, `retarget_reference`).
2. **Classify** — `safe` / `lossy` / `blocking`, each with a plain-language explanation shown inline.
3. **Analyze** — one server call counts affected entries per change and dry-runs the transform, returning: convertible count, unconvertible samples, entries that would violate a new `required`.
4. **Preview** — before/after table on sample rows (`"42" → 42`, `"abc" → ✕ unconvertible`).
5. **Resolve** — per change, the user picks: *set a default*, *fix rows inline*, or *flag entries invalid*.
6. **Apply** — a single Postgres RPC in one transaction: update `fields`, transform every `entries.data`, set `invalid` flags. Realtime broadcasts the result to all clients.

Transform rules live in one pure module (`lib/migrations/transform.ts`), so the dry-run and the real apply share identical logic — the preview can never lie.

### Read API

`app/api/content/[type]/route.ts` and `[id]/route.ts` — resolve `api_id` → schema, return `{ data, meta }` with `?limit`, `?offset`, `?expand=<field>` for reference hydration. Unknown type → `404` with a typed error body. Read-only, no auth, by design.

## 5. Milestones

| # | Milestone | Output |
|---|---|---|
| **0** | Foundation ✅ | Next.js + Tailwind + Supabase clients, `0001_init.sql`, idempotent seed, admin shell, health check |
| **1** | Schema Builder (PRD A) ✅ | CRUD on schemas and fields, machine-name validation, reference targets, draft/change-set model with risk gating |
| **2** | Dynamic Editor (PRD B) ✅ | Renderer registry, runtime Zod, entry list + CRUD, reference picker, optimistic concurrency |
| **3** | Read API (PRD E) ✅ | Both endpoints plus discovery, pagination, expand, typed error bodies |
| **4** | Real-time (PRD C) ✅ | One coalesced subscription, invalidate-and-refetch, connection indicator, resync on reconnect, frozen concurrency token |
| **5** | Schema Evolution (PRD D) | Diff → classify → analyze → preview → resolve → apply RPC |
| **6** | Polish & deliverables | Empty/loading/error states, README, deploy, walkthrough deck, AI session record |

Milestones 1–3 make the product real; 4 makes it feel alive; 5 is where the engineering judgement shows. If time compresses, polish in milestone 6 gives way before anything in 5.

## 6. Testing

- **Unit (Vitest)** — *(179 tests passing as of milestone 4)* — `transform.ts` conversion matrix (every type → every type, including failures), `buildZodSchema`, change classification. This is the highest-value test surface and the easiest to defend in the pairing session.
- **Integration** — Route Handlers invoked directly with the data layer (`lib/api/data`) stubbed, so status codes, shapes and pagination are covered without a live project.
- **E2E (Playwright)** — the four PRD flows, plus a two-context test asserting real-time propagation between clients.

## 7. Repository Layout

```
app/
  (admin)/schemas/…        # schema builder
  (admin)/content/[type]/… # entry list + generated editor
  api/content/[type]/…     # read API
lib/
  schema/    # zod builder, field registry
  migrations/# diff, classify, analyze, transform
  supabase/  # client, realtime
components/fields/         # one component per field type
docs/                      # PRD, this strategy, AI session record
supabase/migrations/       # SQL + apply_schema_migration RPC
```

## 8. Risks

| Risk | Mitigation |
|---|---|
| Milestone 5 overruns the timebox | Build the pipeline for the six change kinds only; no generic migration DSL |
| JSONB gives no DB-level validation | Single server-side validation path; entries flagged `invalid` rather than silently broken |
| Supabase env setup blocks the reviewer | README ships `.env.example`, a one-command SQL bootstrap and a live deployed URL |
| Realtime chattiness on large lists | Invalidate-and-refetch with React Query dedupe; subscriptions scoped to the open schema |
| Over-abstracting the form layer | Registry pattern only; stop at the five required types |

## 9. Walkthrough Outline (deliverable 3)

Architecture in one diagram → data model and the JSONB trade-off → dynamic form generation demo → real-time in two windows → schema evolution end to end (the centerpiece, ~40% of the time) → trade-offs and what would change for production.
