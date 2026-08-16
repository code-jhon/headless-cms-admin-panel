# Headless CMS — Admin Panel

Define content schemas through the UI, then create and edit entries in forms
generated from those schemas. Changes propagate to every open client in real
time, and the stored content is readable over a simple HTTP API.

Built for the [Agile Monkeys Frontend Challenge 2026](https://frontend-challenge-2026.theagilemonkeys.com/).

> **Status: milestone 5 — feature complete.** Content types are manageable
> through the UI, entries are edited through forms generated from the schema,
> the content is readable over HTTP at `/api/content`, every open client stays
> in sync, and schema changes go through a review that shows exactly what will
> happen to existing data before anything is written. Remaining work is polish
> and the written deliverables — see
> [`docs/IMPLEMENTATION_STRATEGY.md`](docs/IMPLEMENTATION_STRATEGY.md).

---

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript |
| Styling | Tailwind CSS v4 (CSS-first theme, no config file) · light + dark |
| Data | Supabase Postgres — `schemas`, `fields`, `entries` (JSONB) |
| Real-time | Supabase Realtime (`postgres_changes`) |
| Forms | Zod compiled at runtime from the schema; one renderer per field type |

## Prerequisites

- Node.js 20.9+ (developed on 22)
- A free [Supabase](https://supabase.com) project — no Docker required

## Setup

**1. Install**

```bash
npm install
```

**2. Create the database**

In your Supabase project, open **SQL Editor → New query**, paste the whole of
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and
run it. It creates the three tables, the `field_type` enum, the `updated_at`
triggers, the Realtime publication and the RLS policies.

Then run [`supabase/migrations/0002_apply_schema_migration.sql`](supabase/migrations/0002_apply_schema_migration.sql)
the same way. It adds the function that applies schema migrations atomically.

**3. Configure the environment**

```bash
cp .env.example .env.local
```

Fill both values from your Supabase dashboard:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Settings → API Keys → publishable key (`sb_publishable_…`) |

Step-by-step walkthrough, including how to verify each step and what to do
when one fails: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md).

**4. Run**

```bash
npm run dev
```

Open <http://localhost:3000/health>. Every check should be green. If one is
not, the page tells you the exact fix.

**5. Seed example content** (optional but recommended)

```bash
npm run seed
```

Creates two related content types — `Person` and `Article`, the latter with a
reference field pointing at the former — plus a few entries. The script is
idempotent; `npm run seed -- --reset` wipes and recreates them.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) |
| `npm run seed` | Insert example schemas and entries (`-- --reset` to recreate) |

## Project layout

```
app/
  (admin)/           # admin shell — sidebar + content area
    page.tsx         # dashboard, lists content types and roadmap
    schemas/         # schema builder: list, new, [apiId] editor
    content/         # entry list + generated editor per content type
    health/          # connection + realtime health check
  api/content/       # read API: discovery, collection, single entry
components/
  layout/            # shell chrome
  realtime/          # connection indicator
  fields/            # one renderer per field type — the registry
  entry/             # entry list, generated form, delete
  schema/            # schema builder UI
lib/
  env.ts             # validated environment
  supabase/          # browser + server clients
  queries.ts         # server-side reads
  health.ts          # health check logic
  actions/           # server actions (all writes)
  api/               # read-API data access, serialization, params, errors
  realtime/          # subscription provider + pure sync policy
  theme/             # theme preference: pure rules, store, pre-paint script
  schema/            # validation, diff engine, runtime Zod, display helpers
  migrations/        # conversion, dry run, write plan — schema evolution
scripts/seed.ts      # idempotent seed
supabase/migrations/ # SQL, run against your project
types/cms.ts         # domain + Database types
docs/                # PRD and implementation strategy
```

## Data model in one paragraph

A `schema` is a content type. Its `fields` are typed columns — `text`,
`number`, `boolean`, `date` or `reference` — where `key` is the machine name
and `label` is what editors see. An `entry` stores its values in a single
JSONB column keyed by those field keys. That choice is what makes schema
evolution a **data transform** rather than a DDL migration: renaming a field
remaps a JSONB key, retyping one converts values in place, and both can be
previewed before they are applied. The trade-off is that the database enforces
no per-field constraints — validation lives in a Zod schema compiled at runtime
from the `fields` rows, on the server, on every write.

## Read API

Content is readable over HTTP without auth:

```bash
curl "http://localhost:3000/api/content"                        # content types
curl "http://localhost:3000/api/content/article?expand=author"  # entries
```

Full reference — parameters, response shape, error codes and limits — in
[`docs/API.md`](docs/API.md). Each content type's page in the panel also shows
its live endpoint with copyable `curl` commands.

## Real-time

Open the panel in two windows. Editing an entry in one updates the other's
list without a refresh, and editing the *same* entry in both surfaces a
conflict instead of letting the second save overwrite the first. Connection
state is always visible in the sidebar; click it to refetch on demand.

## Theme

Light, dark, or follow the OS — the control sits in the sidebar footer. The
choice persists, syncs across open tabs, and is applied before the first paint,
so there is no flash on reload. Nothing was recoloured to add it: every colour
in the app was already a semantic token, so the theme redefines variables
rather than components. Details, including the two defects verification found:
[`docs/THEME.md`](docs/THEME.md).

## Schema evolution

Changing a field on a content type that already has entries opens a review
rather than saving straight away. It shows how many entries each change
affects, what every value becomes, and which values will not convert — and
lets you decide what happens to those: set a default, clear them, or flag them
for someone to fix. Applying runs as a single transaction: it all lands or
none of it does.

The conversion logic lives in one place (`lib/migrations/transform.ts`) and is
used by both the preview and the write, so the two cannot disagree.

## Security note

There is no authentication: the challenge scopes it out, so the `anon` role has
full read/write access through deliberately permissive RLS policies. This is a
single-tenant demo posture, not a production one.

## Documentation

- [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md) — Supabase project setup, step by step
- [`docs/MILESTONE_1_SCHEMA_BUILDER.md`](docs/MILESTONE_1_SCHEMA_BUILDER.md) — what milestone 1 built, and how it was verified
- [`docs/MILESTONE_2_ENTRY_EDITOR.md`](docs/MILESTONE_2_ENTRY_EDITOR.md) — the generated entry editor
- [`docs/API.md`](docs/API.md) — read API reference: endpoints, parameters, response shape, errors
- [`docs/MILESTONE_3_READ_API.md`](docs/MILESTONE_3_READ_API.md) — what milestone 3 built, and how it was verified
- [`docs/MILESTONE_4_REALTIME.md`](docs/MILESTONE_4_REALTIME.md) — real-time sync and concurrent-edit handling
- [`docs/MILESTONE_5_SCHEMA_EVOLUTION.md`](docs/MILESTONE_5_SCHEMA_EVOLUTION.md) — the review → preview → resolve → apply flow
- [`docs/THEME.md`](docs/THEME.md) — the dark/light theme: token strategy, no-flash script, contrast results
- [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md) — how AI was used, and the nine defects it produced that verification caught
- [`docs/PRD.md`](docs/PRD.md) — scope, requirements, acceptance criteria
- [`docs/IMPLEMENTATION_STRATEGY.md`](docs/IMPLEMENTATION_STRATEGY.md) — architecture, data model, milestones, risks
