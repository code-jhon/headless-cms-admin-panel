# Read API

A small, read-only HTTP API over the content managed in the admin panel.
Enough to prove another app could consume this content — not a production API
(see [Limits](#limits)).

Base path: `/api/content` · No authentication · CORS open · `Cache-Control: no-store`

---

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/content` | Every content type and its field definitions |
| `GET` | `/api/content/{type}` | A page of entries |
| `GET` | `/api/content/{type}/{id}` | One entry |
| `OPTIONS` | any of the above | CORS preflight (`204`) |

`{type}` is a content type's **API ID** — the value shown under its name in
the Schema Builder, e.g. `article`.

---

## Discovery — `GET /api/content`

Self-describing: a consumer can learn what exists without being told.

```json
{
  "data": [
    {
      "name": "Article",
      "api_id": "article",
      "description": "A piece of written content.",
      "url": "/api/content/article",
      "fields": [
        { "key": "title", "label": "Title", "type": "text", "required": true, "references": null },
        { "key": "author", "label": "Author", "type": "reference", "required": false, "references": "person" }
      ]
    }
  ],
  "meta": { "count": 1 }
}
```

`references` names the target type by its **api_id**, not its internal uuid —
so it composes directly into the next request URL.

---

## Collection — `GET /api/content/{type}`

```bash
curl "http://localhost:3000/api/content/article?limit=2&expand=author"
```

```json
{
  "data": [
    {
      "id": "9f1c…",
      "created_at": "2026-08-01T10:00:00Z",
      "updated_at": "2026-08-14T18:22:31Z",
      "invalid": false,
      "title": "Notes on the Analytical Engine",
      "read_time": 7,
      "published_at": "1843-10-01",
      "featured": true,
      "author": { "id": "3b2a…", "full_name": "Ada Lovelace", "…": "…" }
    }
  ],
  "meta": {
    "type": "article",
    "count": 1,
    "total": 12,
    "limit": 2,
    "offset": 0,
    "next": "/api/content/article?expand=author&limit=2&offset=2"
  }
}
```

### Query parameters

| Parameter | Default | Notes |
|---|---|---|
| `limit` | `20` | 1–100. Outside that range is a `400`, not a silent clamp. |
| `offset` | `0` | Must be ≥ 0. |
| `order` | most recently updated | Any field key on the type. |
| `direction` | `asc` | `asc` or `desc`. Applies when `order` is set. |
| `expand` | none | Comma-separated reference keys, or `*` for all of them. |

`meta.next` is a ready-made URL for the following page, or `null` on the last
one — it carries the other parameters forward, so paginating is "follow the
link" rather than "reconstruct the query".

---

## Single entry — `GET /api/content/{type}/{id}`

```bash
curl "http://localhost:3000/api/content/article/9f1c…?expand=*"
```

```json
{ "data": { "id": "9f1c…", "title": "…" }, "meta": { "type": "article" } }
```

An id that exists but belongs to a different content type returns `404` — from
the caller's point of view, it is not at this URL.

---

## Response shape

Entries are **flat**: envelope fields sit alongside content fields.

```json
{ "id": "…", "created_at": "…", "updated_at": "…", "invalid": false, "title": "…" }
```

`article.title` reads better than `article.fields.title`, and it is only safe
because the Schema Builder forbids a field from being named `id`,
`created_at`, `updated_at`, `invalid`, `data` or `schema_id`. The reserved-word
list and this shape are the same decision.

**The schema is the contract, not the stored row.** Every entry of a type
returns the same keys:

- a field added after an entry was written comes back as `null`
- a JSONB key left behind by a deleted field is not returned at all

So a consumer can type against a content type and trust it, even mid-migration.

**`invalid: true`** marks an entry that a schema change or a deleted reference
left unfit. Such entries are still returned — flagged rather than hidden, so a
consumer decides what to do rather than silently seeing fewer rows.

---

## Reference expansion

Unexpanded, a reference is the target's id:

```json
{ "author": "3b2a-…" }
```

With `?expand=author` it becomes the target entry, serialized the same way:

```json
{ "author": { "id": "3b2a-…", "created_at": "…", "full_name": "Ada Lovelace" } }
```

- Expansion is **one level deep**. Deeper needs cycle detection — `Person.manager → Person` is a legal schema here — and this is a simple read API, not a graph query language.
- A `null` reference stays `null`.
- A reference whose target was deleted expands to `null` and keeps its key, so the breakage is visible rather than silent.
- The whole page is resolved in **one** query regardless of size — no N+1.

---

## Errors

Every failure uses one shape, with a stable `code` to branch on:

```json
{
  "error": {
    "code": "invalid_parameter",
    "message": "One or more query parameters are invalid.",
    "details": { "limit": "limit must be 100 or fewer" }
  }
}
```

| Code | Status | When |
|---|---|---|
| `invalid_parameter` | 400 | A query parameter is malformed or out of range. `details` names each one. |
| `unknown_type` | 404 | No content type with that API ID. |
| `not_found` | 404 | No entry with that id in that type. |
| `store_unavailable` | 503 | The database is unreachable — e.g. a paused free-tier project. Retryable. |
| `not_configured` | 503 | The deployment has no Supabase credentials. |
| `internal_error` | 500 | Anything else. |

Two deliberate choices here. An unreachable database is **503, not 500** —
500 tells a consumer "your request is broken", 503 tells it "retry shortly",
and only one of those is true. And internal error messages are **never echoed**
to the caller; the detail goes to the server log.

---

## Limits

Named rather than left for a reviewer to find:

- **No authentication.** The challenge scopes it out. Anything readable in the panel is readable here.
- **Read-only.** Writes go through the admin panel's Server Actions.
- **No caching.** `no-store`, so an editor's save is visible on the next request.
- **`offset` pagination**, which can skip or repeat rows if content changes between pages. Keyset pagination would be the production answer.
- **One level of expansion.**
- **No sparse fieldsets, filtering or full-text search.** The admin panel does its own filtering client-side.

---

## Trying it

```bash
npm run dev
npm run seed                                   # if you have not already

curl "http://localhost:3000/api/content"                          # what exists
curl "http://localhost:3000/api/content/article"                  # entries
curl "http://localhost:3000/api/content/article?expand=author"    # with authors
curl "http://localhost:3000/api/content/article?limit=1"          # then follow meta.next
curl -i "http://localhost:3000/api/content/nope"                  # 404 shape
curl -i "http://localhost:3000/api/content/article?limit=999"     # 400 shape
```

Each content type's page in the admin panel also has an **API** panel with
copyable `curl` commands for that type.
