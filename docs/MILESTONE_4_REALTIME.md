# Milestone 4 — Real-time

**Status:** Complete · **Date:** 2026-08-15
**Covers:** PRD requirements C1–C4
**Related:** [`PRD.md`](./PRD.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md) · [`MILESTONE_2_ENTRY_EDITOR.md`](./MILESTONE_2_ENTRY_EDITOR.md)

Every open client stays in sync, and concurrent edits are surfaced rather
than silently resolved.

## Requirements met

| # | Requirement | How |
|---|---|---|
| C1 | Entry changes reflect in every other open client, no refresh | One `postgres_changes` subscription → coalesced `router.refresh()` |
| C2 | Schema changes propagate; an open editor sees the form regenerate | Field/schema events raise a "the content type changed" banner with a reload action |
| C3 | Concurrent edits detected and surfaced, not silently overwritten | Frozen `updated_at` token + a live "changed by someone else" banner |
| C4 | Connection state visible; resync on reconnect | Sidebar indicator with four states; a reconnection triggers a full refetch |

## Architecture

**Events say what changed; the server says what it now is.** An event never
carries new state into client memory — it triggers `router.refresh()`, which
refetches the Server Components. Slightly chattier than applying diffs
locally, and it removes the entire class of bug where a client's copy drifts
from the database. `router.refresh()` preserves client state, so an open form
keeps its values while the data behind it updates.

**One subscription for the whole panel.** `RealtimeProvider` sits in the admin
layout and holds a single channel bound to `schemas`, `fields` and `entries`.
Components that need raw events subscribe through `useRealtimeEvents`; nothing
else opens a socket.

**The policy is pure, the plumbing is thin.** Subscribing is unavoidably
stateful, but deciding *what an event means* is not — so that lives in
`lib/schema`-style pure functions in `lib/realtime/sync-policy.ts` and is
tested directly. The component is then short enough to read in one pass.

## The bug worth the whole milestone

Milestone 2 shipped optimistic concurrency: the form sends the `updated_at` it
loaded with, and the server refuses the write if the row has moved on.

Real-time quietly breaks that. `router.refresh()` re-renders the edit page
with a **new** `entry` prop — so if the token tracked the prop, a colleague's
save would silently become this client's baseline, and the next save here
would overwrite their work *while reporting success*. Conflict detection would
still look like it worked, and would in fact be dead.

The fix is one line of intent: the token is captured into state at mount and
never follows the prop.

```ts
const [baselineUpdatedAt, setBaselineUpdatedAt] = useState(entry?.updated_at ?? "");
```

It only moves when *this* client completes a write, which is why
`updateEntry` now returns the new `updated_at`.

**Self-echo suppression falls out of the same token.** A client's own save
arrives back through its own subscription. Warning someone that "another user
changed this" about their own edit would destroy trust in the warning, so an
event whose `updated_at` equals the current baseline is ignored. Directly
tested, including the second-save case.

## Other decisions

**Reconnect resyncs rather than replays.** Coming back from a gap means events
were missed. Refetching everything is simpler than replaying and impossible to
get subtly wrong — the database is the single source of truth. Notably, this
fires on `reconnecting → live` but *not* on `connecting → live`, since the page
was just server-rendered and a refetch would be wasted.

**`reconnecting` is distinct from `offline`.** supabase-js retries on its own,
so a channel error is usually transient; telling someone they are disconnected
would be alarmist. `offline` is reserved for a closed channel or a browser
offline event.

**Refreshes are coalesced over 250 ms.** A schema migration touches every entry
of a type — without coalescing that is one refetch per row. The delay is below
perception.

**The "Updated" flash is a keyed CSS animation, not timer state.** Remounting
via `key={lastSyncedAt}` restarts a one-shot animation: no effect, no
`setTimeout`, nothing to clean up. This replaced a first version that ESLint's
`react-hooks/set-state-in-effect` correctly rejected.

## Files

| Area | Files |
|---|---|
| Policy (pure) | `lib/realtime/sync-policy.ts` |
| Subscription | `lib/realtime/provider.tsx` |
| Connection UI | `components/realtime/connection-indicator.tsx` |
| Conflict + schema banners | `components/entry/entry-form.tsx` |
| Token return | `lib/actions/entries.ts` |
| Mount point | `app/(admin)/layout.tsx`, `components/layout/sidebar.tsx` |
| Tests | `lib/realtime/__tests__/sync-policy.test.ts` |

## Verification

**179 unit tests** (25 new), covering the connection state machine, the
resync-on-recovery rule, refresh triggers, and open-entry classification —
including self-echo, a delete of the open entry, an update with no timestamp,
and a full disconnect/reconnect cycle asserting **exactly one** resync.

**Driven end to end in a headless browser against a stub Realtime server.**
With no live Supabase project available, I wrote a minimal server speaking the
Phoenix protocol that supabase-js expects — reading the exact wire format out
of `@supabase/realtime-js` rather than guessing — so the app's *real*
subscription could be exercised:

| Check | Result |
|---|---|
| Channel joins with all three table bindings | Pass — `schemas,fields,entries` |
| Indicator reaches "Live" | Pass |
| One entry event triggers a refetch | Pass |
| **A burst of 12 events** | **Same refetch count as one event — coalescing confirmed** |
| A field/schema event triggers a refetch (C2) | Pass |
| Client-side errors during the run | None |
| Indicator with an unreachable host | Stays "Connecting", no errors |

**Not observed live:** the intermediate `reconnecting` state — supabase-js
reconnected to the stub faster than the test could sample it. The transition
logic and its exactly-one-resync guarantee are covered by unit tests, and the
`offline` path is covered by the unreachable-host run.

**Static checks:** typecheck, lint and production build clean; twelve routes.

## Try it

Open the panel in two browser windows side by side. Edit an entry in one — the
other's list updates without a refresh. Open the *same* entry in both, save in
one, then try to save in the other: the second sees "Changed by someone else"
and must choose to load their version or overwrite deliberately.

## Next — Milestone 5 (Schema Evolution)

Lift the gate built in milestone 1: analyze affected entries, preview the
before/after per row, let the user fix what does not convert, and apply the
whole migration in one Postgres transaction.
