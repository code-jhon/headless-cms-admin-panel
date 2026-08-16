# Milestone 3 — Read API

**Status:** Complete · **Date:** 2026-08-15
**Covers:** PRD requirements E1–E4
**Related:** [`API.md`](./API.md) · [`PRD.md`](./PRD.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md)

A read-only HTTP API over the managed content — proof that another app could
consume what the panel produces.

## Requirements met

| # | Requirement | How |
|---|---|---|
| E1 | `GET /api/content/[type]` with limit/offset | Validated `limit` (1–100) and `offset`, plus `order`/`direction`, and a ready-made `meta.next` link |
| E2 | `GET /api/content/[type]/:id`, 404 when missing | Scoped to the schema, so a foreign id is also a 404 |
| E3 | Typed JSON shaped by the schema; references as ids, expandable | Flat entry shape; `?expand=key` or `?expand=*` |
| E4 | Unknown type → 404 with a clear error body | `{ error: { code, message, details? } }` with a stable machine-readable code |

Plus one addition: `GET /api/content` lists every content type and its fields,
so the API is self-describing rather than needing out-of-band documentation.

## Architecture

**The schema is the contract, not the stored row.** `serializeEntry` walks the
`fields` rows, not the JSONB keys: a field added after an entry was written
returns `null`, and a key left behind by a deleted field is dropped. Every
entry of a type therefore returns the same keys, which is what lets a consumer
type against it — including mid-migration, which matters for milestone 5.

**The flat response shape is paid for by the reserved-word list.** Returning
`{ id, created_at, updated_at, invalid, ...fields }` reads better than nesting
under `fields`, and it is only safe because the Schema Builder forbids those
names as field keys. Milestone 1's `RESERVED_FIELD_KEYS` and this shape are one
decision, made in two places.

**The data layer is isolated so the routes are testable.** Every database call
lives in `lib/api/data.ts` and nothing else in the API imports Supabase. That
made it possible to invoke the real route handlers in tests with only that
module stubbed — 39 tests covering status codes, response shape, pagination
arithmetic and expansion, with no live project.

**Expansion resolves a page in one query.** Ids are collected across the whole
page first, then fetched together. The obvious implementation — look up each
reference as you serialize — is an N+1, and there is a test asserting exactly
one call.

## Files

| Area | Files |
|---|---|
| Routes | `app/api/content/route.ts`, `app/api/content/[apiId]/route.ts`, `app/api/content/[apiId]/[entryId]/route.ts` |
| Data access | `lib/api/data.ts` — the only module touching Supabase |
| Serialization | `lib/api/serialize.ts` — entry, list meta, schema description |
| Expansion | `lib/api/expand.ts` |
| Parameters | `lib/api/params.ts` |
| Errors | `lib/api/errors.ts`, `lib/api/handle-error.ts` |
| UI | `components/api/endpoint-panel.tsx` — live endpoint + copyable curl per type |
| Docs | `docs/API.md` |
| Tests | `lib/api/__tests__/routes.test.ts` |

## Decisions

**Bad parameters are a 400, not a silent clamp.** `?limit=999` returns an error
naming the limit rather than quietly returning 100. A caller passing 999 has a
bug, and clamping hides it. Same for unknown `order` and `expand` keys — and
the error names the available keys, so the fix is in the response.

**Expansion is one level deep.** `Person.manager → Person` is a legal schema
here, so deeper expansion needs cycle detection. Out of scope for "nothing
production-grade, just proof".

**Invalid entries are returned, flagged.** This settles the open question left
in the PRD: `invalid: true` travels in the response rather than the row being
hidden, so a consumer decides what to do instead of silently seeing fewer rows.

**CORS is open and responses are `no-store`.** The API is public and read-only
by design, and a browser-based consumer needs CORS. `no-store` because content
changes the moment an editor saves — a cached read would make milestone 4's
real-time work look broken.

## Verification

**39 route tests** (154 total across the project). These import and invoke the
**real handlers** with only `lib/api/data` stubbed, covering: response shape,
schema-shaped serialization, all six error codes, pagination arithmetic and
`meta.next` construction, eight bad-parameter cases, expansion (named, `*`,
null, dangling, one-level, single-query), and the discovery endpoint.

**Two real bugs found by calling the endpoints over HTTP** rather than trusting
the tests:

1. **Internal error messages were leaking to consumers.** A failure returned
   `"TypeError: fetch failed"` verbatim — useless to a caller and more than an
   attacker should get. Now the detail goes to the server log and the caller
   gets a stable sentence. Covered by a test asserting a fake secret in an
   error message never reaches the response body.

2. **An unreachable database returned 500.** That tells a consumer "your
   request is broken" when the truth is "retry shortly" — which is exactly what
   a paused free-tier Supabase project does. Now classified as `503
   store_unavailable`.

**Confirmed live over HTTP:** CORS preflight returns `204` with the expected
headers, and an unreachable store now returns `503 store_unavailable` with a
clean message.

**Static checks:** typecheck, lint and production build clean; twelve routes.

**Not verified:** responses against a live Supabase project with real rows.
The serialization and error paths are covered by tests; the queries themselves
are thin, and the SQL guarantees were checked against real Postgres in
milestone 1.

## Next — Milestone 4 (Real-time)

Supabase Realtime subscriptions, invalidate-and-refetch, a connection
indicator, and surfacing the concurrent-edit conflict already implemented in
milestone 2.
