# PRD — Headless CMS Admin Panel

**Project:** `headless-cms-admin-panel`
**Source:** The Agile Monkeys — Frontend Challenge 2026 (`https://frontend-challenge-2026.theagilemonkeys.com/`)
**Status:** Draft v1 · **Date:** 2026-08-15
**Related doc:** [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md)

---

## 1. Problem & Vision

Content teams need to model their own content types without waiting on engineering. Today, adding a new type or a new field means a ticket, a migration and a deploy.

**Vision:** an admin panel where a user defines a content schema (e.g. `Car`, `Article`, `Product`) and immediately gets a working editor for it — forms generated from the schema, not hand-written per type — with changes visible to every other open client in real time, and the resulting content readable by any external app through a simple API.

## 2. Goals & Non-Goals

**Goals**

- G1 — Let users create and evolve content schemas through the UI.
- G2 — Generate the entry editor from the schema definition (zero per-type code).
- G3 — Keep every open client in sync without a manual refresh.
- G4 — Make schema changes safe: explain the risk, show what breaks, preview, then fix.
- G5 — Expose stored content over a read API so another app could consume it.

**Non-Goals (explicitly out of scope for this challenge)**

- Authentication, roles and permissions (single trusted user assumed).
- Publishing workflows, drafts vs. published, versioning history, i18n.
- Media/asset management and rich-text/WYSIWYG editing.
- Production-grade API concerns: rate limiting, caching layers, auth tokens.
- A heavy backend. The backend stays thin — store and serve, nothing more.

## 3. Users

| Persona | Needs | Success looks like |
|---|---|---|
| **Content Modeler** (tech-savvy PM / lead editor) | Define and change content types safely | Adds a field and sees the editor update, with no data lost |
| **Content Editor** | Create and maintain entries quickly | Fills a generated form, gets clear validation, saves without surprises |
| **Consumer Developer** | Read content from another app | `GET /api/content/article` returns usable JSON |

## 4. Scope — Functional Requirements

### A. Schema Builder

Create, edit, list and delete content schemas. A schema is a named content type made of named, typed fields.

Supported field types: **text**, **number**, **boolean**, **date**, **reference** (points at another schema).

Per-field attributes: display label, machine name (immutable key used in storage and API), type, required flag, and for references the target schema.

- **A1** — User can create a schema with a name, an API identifier and at least one field.
- **A2** — User can add, reorder, edit and remove fields on an existing schema.
- **A3** — Machine names are unique within a schema and validated (`snake_case`, no collisions with reserved keys).
- **A4** — Deleting a schema warns about its entries and any schema referencing it; it is blocked or cascaded only after explicit confirmation.
- **A5** — Reference fields can only target an existing schema; self-references are allowed.

### B. Dynamic Entry Editor

- **B1** — For any schema, the entry list shows entries with sortable/searchable columns derived from the schema's first text fields.
- **B2** — The create/edit form is rendered from the schema definition — one field renderer per type, no hand-written form per content type.
- **B3** — Validation is derived from the schema: required fields block save, numbers reject non-numeric input, dates use a date control, references use a picker listing entries of the target schema.
- **B4** — Full CRUD: create, read, update, delete, with confirmation on delete.
- **B5** — Adding a new field type to the system requires registering one renderer, not touching each schema.

### C. Real-time Updates

- **C1** — When a client creates, updates or deletes an entry, every other open client viewing that schema reflects the change without a page refresh.
- **C2** — Schema changes propagate the same way: a client with the editor open sees the form regenerate.
- **C3** — Concurrent edits on the same entry are detected and surfaced ("this entry changed while you were editing") rather than silently overwritten.
- **C4** — Connection state is visible; on reconnect the client resyncs rather than showing stale data.

### D. Schema Evolution

The core of the challenge. Field changes are treated as **migrations with a review step**, never as blind saves.

Changes covered: **rename**, **delete**, **retype**, **made required**, **reference target changed**.

- **D1 — Communicate the risk.** Each pending change is classified: *safe* (add optional field), *lossy* (delete field, narrow a type), *blocking* (make required while entries have empty values).
- **D2 — Surface affected entries.** Before applying, the user sees how many entries are affected and can inspect the specific ones.
- **D3 — Preview.** A before/after diff of sample affected entries shows exactly what the stored value becomes (e.g. `"42"` → `42`, `"abc"` → *unconvertible*).
- **D4 — Fix data that no longer fits.** For unconvertible or blocking rows, the user chooses a strategy per change: supply a default, edit rows inline, or leave the entry flagged as invalid.
- **D5 — Apply atomically.** The migration either fully applies or fully aborts; the user gets a summary of what changed.
- **D6 — Rename preserves data** (key remap, not delete + create).

### E. Read API

- **E1** — `GET /api/content/[type]` returns the collection for a schema, with `limit`/`offset`.
- **E2** — `GET /api/content/[type]/:id` returns a single entry, `404` when missing.
- **E3** — Responses are typed JSON shaped by the schema; references are returned as ids by default and expandable via a query flag.
- **E4** — Unknown type returns `404` with a clear error body.

## 5. Key User Flows

1. **Model a type** — New schema → name it `Article` → add `title` (text, required), `body` (text), `published_at` (date), `author` (reference → `Person`) → save → the type appears in the sidebar with an empty entry list.
2. **Author an entry** — Open `Article` → New entry → generated form → pick an author from the reference picker → save → entry appears in the list, and in a second browser window too, live.
3. **Evolve safely** — Edit `Article` → change `published_at` from date to text and make `title` required → review screen: "12 entries affected, 3 have an empty title" → preview the diff → set a default for the 3 → apply → summary confirms 12 updated.
4. **Consume externally** — `curl /api/content/article?limit=10` returns the entries just authored.

## 6. Acceptance Criteria (Definition of Done)

- The app runs locally from a clean clone with the README's steps only.
- A brand-new schema is fully usable end to end without writing code.
- Two browser windows stay in sync for both entry and schema changes.
- Every destructive schema change goes through the review → preview → apply path.
- Both read API endpoints return correct data for a schema created through the UI.
- The walkthrough covers architecture, data model, real-time, schema evolution and trade-offs.

## 7. Deliverables (per the challenge)

| # | Deliverable | Notes |
|---|---|---|
| 1 | Working application | Runs and does what it sets out to do |
| 2 | README | Install + run locally, clear enough for a cold start |
| 3 | Async walkthrough | Video < 10 min **or** deck < 15 slides — architecture, data model, real-time, schema changes, trade-offs |
| 4 | AI session record | How AI was used across the build — kept in `docs/` |

Submission goes to `hiring@theagilemonkeys.com`.

## 8. Success Metrics

- Adding a field to a live schema with existing entries: **< 60 seconds**, zero data loss.
- Change propagation between two clients: **< 1 second** perceived.
- New field type added to the codebase: **one renderer file**, no per-schema edits.

## 9. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Schema evolution scope creeps and eats the timebox | Ship the review→preview→apply loop for the five named change kinds only |
| Dynamic forms become an over-abstracted framework | Registry of field renderers; stop at the five required types |
| Real-time hides state bugs | Single source of truth on the server; clients re-fetch on event rather than patching blindly |
| Reference integrity on delete | Deleting a referenced entry surfaces referrers before confirming |

**Open questions:** should invalid entries (post-migration) be blocked from the read API or returned with a flag? Assumed for v1: returned, flagged.
