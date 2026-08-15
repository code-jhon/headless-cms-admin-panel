# Milestone 0 — Foundation

**Status:** Complete · **Date:** 2026-08-15
**Related:** [`PRD.md`](./PRD.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md)

Goal: a runnable skeleton with the database in place and a way to *prove* the
plumbing works, before any feature code is written.

## What was built

| Area | Files | Notes |
|---|---|---|
| App scaffold | `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx` | Next.js 16 App Router, React 19, TypeScript, Tailwind v4 |
| Theme | `app/globals.css` | CSS-first Tailwind v4 `@theme` — no `tailwind.config.js` |
| Database | `supabase/migrations/0001_init.sql` | Tables, enum, triggers, Realtime publication, RLS |
| Types | `types/cms.ts` | Domain types + `Database` type for the typed client |
| Env | `lib/env.ts`, `.env.example` | Zod-validated, fails with an actionable message |
| Clients | `lib/supabase/client.ts`, `lib/supabase/server.ts` | Browser (Realtime) and server (reads/writes) |
| Shell | `app/(admin)/layout.tsx`, `components/layout/sidebar.tsx` | Sidebar lists content types dynamically |
| Dashboard | `app/(admin)/page.tsx` | Content types + roadmap |
| Health check | `app/(admin)/health/*`, `lib/health.ts` | Per-table checks with a fix for each failure, plus a browser Realtime probe |
| Seed | `scripts/seed.ts` | Idempotent; `Person` + `Article` with a reference field between them |
| Docs | `README.md` | Setup, scripts, layout, data-model rationale |

## Decisions made during the build

**Next.js 16, not 15.** `create-next-app@latest` now installs 16.3.1. Nothing
in the plan depends on 15-specific behaviour, so the newer major was kept and
`IMPLEMENTATION_STRATEGY.md` updated to match.

**Row types are `type` aliases, not `interface`s.** TypeScript gives implicit
index signatures to type aliases but not to interfaces, so an `interface` Row
fails postgrest-js's `Record<string, unknown>` constraint. The failure is
silent on reads (`never[]` is assignable to anything) and only surfaces on
`.insert()`. Worth knowing before milestone 1 writes its first insert.

**`Database` needs a `Relationships` key per table.** Without it the schema
generic resolves to `never` and every typed query degrades quietly.

**The health page renders instead of throwing.** `listSchemas()` returns
`{ data, error }` rather than throwing, so a first-run user with no `.env.local`
sees the setup steps rather than a Next.js error overlay.

**The Realtime probe is deliberate.** Realtime is the riskiest external
dependency in the plan (PRD C, milestone 4). Proving the websocket subscribes
now means milestone 4 debugs its own logic, not its transport.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npm run build` | Compiles; 4 routes |
| Runtime, misconfigured env | `/`, `/health`, `/schemas` all return 200 and render the setup guidance instead of crashing |
| Health page failure states | Each failing check renders its specific fix |

Not yet verified against a live Supabase project — that requires the user's
credentials. The health page is the acceptance test for that step.

## Next — Milestone 1 (Schema Builder)

Create, edit and delete schemas and their fields, with machine-name validation,
field reordering, reference targets, and guards on deleting a schema that
other schemas point at.
