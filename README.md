# Headless CMS — Admin Panel

Define content schemas through the UI, then create and edit entries in forms
generated from those schemas. Changes propagate to every open client in real
time, and the stored content is readable over a simple HTTP API.

Built for the [Agile Monkeys Frontend Challenge 2026](https://frontend-challenge-2026.theagilemonkeys.com/).

> **Status: milestone 0 (Foundation).** The stack, database schema, seed data
> and app shell are in place, verified by a health check page. The Schema
> Builder, entry editor, read API, real-time sync and schema-evolution flow
> land in milestones 1–5 — see [`docs/IMPLEMENTATION_STRATEGY.md`](docs/IMPLEMENTATION_STRATEGY.md).

---

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript |
| Styling | Tailwind CSS v4 (CSS-first theme, no config file) |
| Data | Supabase Postgres — `schemas`, `fields`, `entries` (JSONB) |
| Real-time | Supabase Realtime (`postgres_changes`) |
| Forms | React Hook Form + Zod compiled at runtime from the schema |

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

**3. Configure the environment**

```bash
cp .env.example .env.local
```

Fill both values from **Supabase → Settings → API**:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |

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
| `npm run seed` | Insert example schemas and entries (`-- --reset` to recreate) |

## Project layout

```
app/
  (admin)/           # admin shell — sidebar + content area
    page.tsx         # dashboard, lists content types and roadmap
    schemas/         # schema builder            (milestone 1)
    health/          # connection + realtime health check
  api/content/       # read API                  (milestone 3)
components/
  layout/            # shell chrome
  fields/            # one renderer per field type (milestone 2)
lib/
  env.ts             # validated environment
  supabase/          # browser + server clients
  queries.ts         # server-side reads
  health.ts          # health check logic
  schema/            # runtime Zod builder       (milestone 2)
  migrations/        # diff · classify · preview · apply (milestone 5)
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

## Security note

There is no authentication: the challenge scopes it out, so the `anon` role has
full read/write access through deliberately permissive RLS policies. This is a
single-tenant demo posture, not a production one.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — scope, requirements, acceptance criteria
- [`docs/IMPLEMENTATION_STRATEGY.md`](docs/IMPLEMENTATION_STRATEGY.md) — architecture, data model, milestones, risks
