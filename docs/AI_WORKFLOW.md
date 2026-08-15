# Working with AI on this project

**Project:** Headless CMS Admin Panel — Agile Monkeys Frontend Challenge 2026
**Date:** 2026-08-15
**Related:** [`PRD.md`](./PRD.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md) · the `MILESTONE_*.md` records

The brief said: *"Please, use AI. We do too. Just own every line you send us."*

This is the record of how. It is deliberately specific about what the AI got
**wrong**, because that is the part that shows whether the second half of that
sentence was taken seriously.

---

## 1. The operating model

I treated the AI as a fast implementer with no judgement about *this* product,
and kept three things for myself: **what to build, what "done" means, and
whether the result is actually true.**

| I owned | The AI owned |
|---|---|
| Scope and priorities (the milestone order) | Turning a decided approach into code |
| Architectural decisions and their trade-offs | Boilerplate: types, forms, table markup, SQL scaffolding |
| What counts as verified | Writing tests for cases I named, then finding more |
| Accepting or rejecting every diff | Documenting decisions once made |

The rule I held to: **no code merged on the basis that it looked right.**
Everything either had a test, was executed against a real dependency, or was
driven in a browser. Where that was not possible, the milestone document says
so explicitly instead of implying coverage that does not exist.

---

## 2. The loop

Work went milestone by milestone. Each one ran the same cycle:

```
Decide scope  →  Clarify open questions  →  Implement  →  Verify for real
     ↑                                                          │
     └──────────  Record the decision + what broke  ←────────────┘
```

**Decide scope.** `PRD.md` came first and stayed the contract. Every milestone
maps to numbered requirements (A1–A5, B1–B5, C1–C4, D1–D6, E1–E4), so "done"
was never a matter of opinion.

**Clarify before building.** Ambiguous choices were settled *before* code
existed, not renegotiated afterwards — stack, real-time transport, whether to
use a component library, how schema editing should behave when entries already
exist. Three or four questions up front removed most of the rework.

**Implement.** The AI is genuinely fast at the layer between a decided design
and working code. That is where it earned its place.

**Verify for real.** Described below — the part that mattered most.

**Record.** Each milestone produced a `MILESTONE_N_*.md` covering what was
built, the decisions taken, and *how it was verified*. When a decision changed,
`IMPLEMENTATION_STRATEGY.md` was updated rather than left to rot. Three
decisions in that document were reversed mid-build; the document says so.

---

## 3. What "verified" had to mean

AI-written code is confidently wrong in a way that reads well. The
counter-measure was to stop reviewing by eye and start executing.

**Run the SQL against a real database.** The migrations were applied to a real
PostgreSQL 16 instance, not just read. That immediately caught a migration that
was not idempotent despite the README promising it was, and later proved the
rollback, the rename-swap and every guard clause in the migration function.

**Call the API over HTTP.** Unit tests passed while the endpoints were leaking
internal error strings to consumers and returning `500` for a database that was
merely unreachable. Both only showed up by running `curl` against the running
server.

**Drive the UI in a real browser.** Components were rendered headless and
exercised — submit an empty form, search, sort, change a field type — rather
than trusted to look correct.

**Simulate the dependency you cannot reach.** With no live Supabase project
available for real-time, I had the AI read the Phoenix wire format out of
`@supabase/realtime-js` and build a stub server speaking it, so the app's
*actual* subscription could be exercised. That is how the burst-coalescing
behaviour was confirmed rather than assumed.

**Write tests for the nasty cases first.** Not coverage for its own sake — the
specific inputs where a plausible implementation is wrong. Those tests found
three real bugs (below).

**Current state:** 219 tests across 7 files, ~2,300 lines of test against
~8,200 lines of source. Typecheck, lint and production build clean.

---

## 4. What the AI got wrong

The honest section. Every one of these was in code that looked correct, passed
review by eye, and would have shipped.

| # | Defect | How it was caught | Why it mattered |
|---|---|---|---|
| 1 | Migration was **not idempotent** — `create type` has no `IF NOT EXISTS` | Ran the script twice against real Postgres | The README claimed idempotency; a second run would have failed for anyone following the setup guide |
| 2 | `Date.parse("2026-02-31")` **does not fail** — it rolls over to 3 March | Test written specifically for impossible dates | Invalid dates were being accepted as valid |
| 3 | `2026-02-29` was **silently becoming `2026-03-01`** | The same test class, on the migration engine | A wrong-but-plausible conversion — the exact failure the schema-evolution feature exists to prevent |
| 4 | Reordering fields would have **rewritten every entry** | Test asserting a cosmetic change writes nothing | `JSON.stringify` equality is key-order sensitive; a pure reorder would have bumped every row and woken every connected client |
| 5 | Real-time **silently defeated the concurrency check** | Reasoning through the interaction before writing the code | `router.refresh()` re-renders with a new `updated_at`; a token tracking the prop would adopt a colleague's save as its baseline and overwrite their work **while reporting success** |
| 6 | Internal error text **leaked to API consumers** | `curl`-ing a failing endpoint | Returned `TypeError: fetch failed` verbatim — useless to a caller, more than an attacker should get |
| 7 | Unreachable database returned **500 instead of 503** | Same | Tells a consumer "your request is broken" when the truth is "retry shortly" |
| 8 | Typed Supabase client silently resolved to `never` | First `.insert()` failing to compile | Row types must be `type` aliases, not `interface`s, and every table needs `Relationships`. Reads typecheck fine either way, so it hides |
| 9 | Two React correctness violations | ESLint | `setState` inside an effect body, and writing a ref during render |

**The pattern:** the AI is reliable at structure and weak at edge semantics. It
produces a well-organised date validator that accepts 31 February. Almost every
defect above sits at a boundary — an impossible value, a failure path, a second
run, two things happening at once.

Number 5 is the one I would raise in a pairing session, because no test would
have caught it. It only surfaces by asking *"what does the feature I just built
do to the feature I built two milestones ago?"* — which is a question about the
system, not about the code in front of you.

---

## 5. Where I overrode the AI

Accepting output uncritically is the failure mode. Four cases where I did not:

**Dropped shadcn/ui.** It was in the plan; the surface actually needed was a
handful of form controls. Native `<select>` and `<dialog>` give keyboard and
screen-reader behaviour for free without a Radix dependency tree.

**Dropped React Hook Form.** For a form whose fields are values in an array, a
single state object plus the runtime-compiled schema is less machinery than a
`Controller` per dynamic field — and it keeps the whole codebase written one
way.

**Reclassified `date → number` as lossy.** The AI called it safe because epoch
millis are recoverable. Technically true; `1843-10-01` becoming
`-3986064000000` is not what an editor expects. The bytes survive, the meaning
does not, so it now asks.

**Kept the transform out of SQL.** The tempting way to get atomic migrations is
to do the conversion in PL/pgSQL. That means two implementations of the same
rules, and any drift produces a preview that lies. Instead the transform stays
in one TypeScript module and the database only *writes* what was already
computed — so the preview and the migration cannot disagree. A test asserts
that property directly.

---

## 6. What this cost, and what it bought

**Bought:** breadth. Five milestones, a real-time layer, an HTTP API, an atomic
migration engine and ~2,300 lines of tests in a single working session. Writing
the boilerplate by hand would have meant cutting scope, and the schema-evolution
work — the part the brief actually cares about — is where the saved time went.

**Cost:** verification is not optional and it is not free. Roughly a third of
the effort went into proving things rather than writing them: standing up a
local Postgres, building a websocket stub, driving a headless browser. That is
the real price of using AI at this speed, and skipping it would have produced
something that demos well and breaks on contact with real data.

**What I would change:** I would run the "what does this break that already
works?" pass at the *start* of each milestone rather than mid-way. Defect 5 was
found by luck of sequencing, not by process.

---

## 7. How to audit this

Nothing above requires taking my word for it:

- **`docs/MILESTONE_*.md`** — each has a *Verification* section listing what was checked and what was **not**. Milestones 1–5 all name something left unverified.
- **`npm test`** — 219 tests. The bug-specific ones carry comments naming the trap: search `lib/schema/__tests__/zod-builder.test.ts` for `2026-02-31`, and `lib/migrations/__tests__/transform.test.ts` for `2026-02-29` and `preview and apply agree`.
- **`docs/IMPLEMENTATION_STRATEGY.md`** — version-stamped; reversed decisions are visible in the milestone records that overrode them.
- **Code comments explain *why*, not *what*.** Where a line exists because of a specific failure, the comment says which one — see `lib/migrations/transform.ts` on the date fallback, and `components/entry/entry-form.tsx` on the frozen concurrency token.

---

## 8. In one paragraph

I used AI to write most of the lines and none of the decisions. It was fastest
where the design was already settled and least trustworthy at edges — empty
values, failure paths, second runs, concurrency. So the process was built around
executing things rather than reading them: real Postgres, real HTTP, a real
browser, a stubbed websocket server. That caught nine defects that all looked
fine on the page. The judgement calls — what to build, what to refuse, what
"verified" means, and which four AI suggestions to throw away — stayed mine, and
so does responsibility for every line in this repository.
