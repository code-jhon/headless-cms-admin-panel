# Supabase Setup

Everything needed to get the admin panel talking to a database. Takes about
ten minutes, all of it in the browser plus two files on disk. No Docker, no
Supabase CLI.

**Related:** [`../README.md`](../README.md) · [`IMPLEMENTATION_STRATEGY.md`](./IMPLEMENTATION_STRATEGY.md) · [`MILESTONE_0_FOUNDATION.md`](./MILESTONE_0_FOUNDATION.md)

---

## What you are setting up

| Piece | Why the project needs it |
|---|---|
| A Postgres database | Stores `schemas`, `fields` and `entries` |
| The Realtime publication | Pushes row changes to every open client (PRD C) |
| RLS policies | Supabase blocks all access by default; the policies open it up |
| Two environment variables | How the app finds and authenticates to the project |

---

## Step 1 — Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. **New project**. Pick any organization.
3. Fill in:
   - **Name** — `headless-cms-admin-panel`
   - **Database Password** — generate one. You will *not* need it for this
     project (the app connects over the REST API, not raw Postgres), but save
     it anyway; it cannot be shown again.
   - **Region** — closest to you. This is the single biggest factor in how
     snappy the app feels locally.
4. **Create new project**, then wait. Provisioning takes 1–2 minutes.

> **Free tier note:** projects pause after 7 days of inactivity. A paused
> project makes every health check fail with a network error. Un-pause it from
> the dashboard — nothing is lost.

---

## Step 2 — Run the database migration

1. In the left sidebar, open **SQL Editor**.
2. Click **New query**.
3. Open [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql)
   in your editor, copy the **entire** file, paste it into the query box.
4. **Run** (or `Ctrl/Cmd + Enter`).

You should see `Success. No rows returned`. The script is idempotent — it uses
`create table if not exists` and `drop policy if exists`, so re-running it is
safe.

**What it created:**

| Object | Purpose |
|---|---|
| `schemas`, `fields`, `entries` | The three tables (see the data model in the README) |
| `field_type` enum | `text · number · boolean · date · reference` |
| `touch_updated_at` triggers | Keeps `updated_at` honest — it doubles as the optimistic-concurrency token |
| `replica identity full` | Makes DELETE events carry the old row, so clients know *what* was deleted |
| `supabase_realtime` publication entries | Turns on the change feed for all three tables |
| RLS policies | Permissive `anon` access — see the security note below |

**Verify it:** open **Table Editor** in the sidebar. You should see `schemas`,
`fields` and `entries`, all empty.

---

## Step 3 — Copy the credentials

Supabase replaced the old JWT `anon` key with a **publishable key**
(`sb_publishable_…`). Legacy keys still work but are deprecated at the end of
2026, so use the publishable key.

**Project URL** — Dashboard → **Settings** → **Data API** → *Project URL*.
Looks like `https://abcdefghijklmnop.supabase.co`.

**Publishable key** — Dashboard → **Settings** → **API Keys**. Copy the one
starting with `sb_publishable_`.

> If your project only shows the legacy `anon` / `service_role` JWT keys, use
> the `anon` one and set `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead. The app
> accepts either and the health check will flag the legacy key with a warning.

**Never copy the secret key** (`sb_secret_…` or `service_role`). It bypasses
row-level security entirely, and anything in a `NEXT_PUBLIC_*` variable is
shipped to the browser. This project never needs it.

---

## Step 4 — Configure the app

From the project root:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxx
```

Two things that catch people out:

- **No quotes, no trailing slash** on the URL.
- **Restart the dev server** after editing. `NEXT_PUBLIC_*` variables are
  inlined at build time; a running server will not pick up the change.

`.env.local` is gitignored. `.env.example` is committed on purpose.

---

## Step 5 — Verify

```bash
npm install   # if you have not already
npm run dev
```

Open **<http://localhost:3000/health>**. The target state:

| Check | Expected |
|---|---|
| Environment | ✅ Project URL and publishable key are set |
| Table: schemas | ✅ Readable — 0 rows |
| Table: fields | ✅ Readable — 0 rows |
| Table: entries | ✅ Readable — 0 rows |
| Seed data | ⚠️ No content types yet *(expected until step 6)* |
| Realtime (browser) | ✅ Connected |

Every failing check on that page prints the specific fix for its own failure,
so it is the fastest way to diagnose a bad setup.

---

## Step 6 — Seed example content

```bash
npm run seed
```

Creates two related content types — `Person` (3 entries) and `Article`
(2 entries, with an `author` reference field pointing at `Person`) — so there
is something to look at before the Schema Builder exists.

```
  create: schema person
  create: schema article
  create: 3 fields for person
  create: 6 fields for article
  create: 3 entries for person
  create: 2 entries for article

  Seed complete.
```

The script is idempotent: run it twice and the second run skips everything.
`npm run seed -- --reset` deletes the two demo types and recreates them.

**Confirm it worked:** reload `/health` — *Seed data* turns green. The sidebar
now lists **Person** and **Article**.

**Bonus — see Realtime actually fire.** Leave `/health` open in one window and
run `npm run seed -- --reset` in a terminal. The Realtime panel's event
counter ticks up as rows change, with no page refresh. That is the mechanism
milestone 4 is built on.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Supabase environment is not configured` | No `.env.local`, or the dev server was not restarted | Recreate the file, restart `npm run dev` |
| `TypeError: fetch failed` on every table | Wrong URL, or the project is paused | Re-copy the Project URL; un-pause in the dashboard |
| `relation "public.schemas" does not exist` | Step 2 did not run, or ran against a different project | Re-run `0001_init.sql`, check you are in the right project |
| `Invalid API key` / 401 | Truncated key, or a secret key used by mistake | Re-copy the publishable key in full |
| Tables exist but every read returns 0 rows and no error | RLS policies missing | Re-run the policy block at the end of `0001_init.sql` |
| Realtime shows **Failed** | Tables not in the `supabase_realtime` publication | Re-run the publication block in `0001_init.sql`; check **Database → Replication** |
| Realtime stuck on **Connecting** | Websocket blocked by a proxy/VPN | Try another network — REST works, Realtime does not, in this case |
| Seed says `already exist` but nothing is visible | Seeded a different project earlier | `npm run seed -- --reset` |

---

## Security note

`0001_init.sql` grants the `anon` role full read/write on all three tables.
That is deliberate: the challenge scopes authentication out (PRD §2), so there
is no user context to write policies against, and a permissive policy is more
honest than disabling RLS entirely.

It is not production posture. In production the same tables would carry
per-role policies and the admin surface would sit behind Supabase Auth. Worth
saying out loud in the walkthrough rather than leaving for the reviewer to
find.

---

## Optional — deploy

The app runs on Vercel's free tier against the same Supabase project:

1. Push to GitHub, import the repo in Vercel.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   as environment variables.
3. Deploy, then open `/health` on the deployed URL to confirm.

A live URL is worth having for the submission — it lets a reviewer see the
real-time behaviour in two browser windows without cloning anything.

---

## Sources

- [Understanding API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/api-keys)
- [Migrating to publishable and secret API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
