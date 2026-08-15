-- =====================================================================
-- Headless CMS Admin Panel — initial schema
-- Milestone 0: Foundation
--
-- Run this once against your Supabase project (SQL Editor → New query),
-- or via the Supabase CLI: supabase db push
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- schemas: a content type (Article, Product, Person…)
-- ---------------------------------------------------------------------
create table if not exists public.schemas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  api_id      text not null unique,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- api_id is what the read API exposes: /api/content/<api_id>
  constraint schemas_api_id_format check (api_id ~ '^[a-z][a-z0-9_]*$'),
  constraint schemas_name_not_blank check (length(trim(name)) > 0)
);

-- ---------------------------------------------------------------------
-- fields: the typed columns of a schema
-- `key` is the machine name and the JSONB key inside entries.data.
-- ---------------------------------------------------------------------
create type public.field_type as enum ('text', 'number', 'boolean', 'date', 'reference');

create table if not exists public.fields (
  id               uuid primary key default gen_random_uuid(),
  schema_id        uuid not null references public.schemas(id) on delete cascade,
  key              text not null,
  label            text not null,
  type             public.field_type not null,
  required         boolean not null default false,
  position         integer not null default 0,
  target_schema_id uuid references public.schemas(id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint fields_key_unique unique (schema_id, key),
  constraint fields_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  -- reference fields must point somewhere; other types must not
  constraint fields_reference_target check (
    (type = 'reference' and target_schema_id is not null)
    or (type <> 'reference' and target_schema_id is null)
  )
);

create index if not exists fields_schema_id_idx on public.fields (schema_id, position);
create index if not exists fields_target_schema_id_idx on public.fields (target_schema_id);

-- ---------------------------------------------------------------------
-- entries: schema-agnostic content rows.
-- data is { "<field.key>": value } — a schema change is a data transform,
-- not a DDL migration. See docs/IMPLEMENTATION_STRATEGY.md §3.
-- ---------------------------------------------------------------------
create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  schema_id  uuid not null references public.schemas(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  invalid    boolean not null default false,
  created_at timestamptz not null default now(),
  -- updated_at doubles as the optimistic-concurrency token (PRD C3)
  updated_at timestamptz not null default now()
);

create index if not exists entries_schema_id_idx on public.entries (schema_id, updated_at desc);
create index if not exists entries_data_gin_idx on public.entries using gin (data);
create index if not exists entries_invalid_idx on public.entries (schema_id) where invalid;

-- ---------------------------------------------------------------------
-- keep updated_at honest
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists schemas_touch_updated_at on public.schemas;
create trigger schemas_touch_updated_at
  before update on public.schemas
  for each row execute function public.touch_updated_at();

drop trigger if exists fields_touch_updated_at on public.fields;
create trigger fields_touch_updated_at
  before update on public.fields
  for each row execute function public.touch_updated_at();

drop trigger if exists entries_touch_updated_at on public.entries;
create trigger entries_touch_updated_at
  before update on public.entries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Realtime (PRD C): broadcast row changes to every connected client.
-- REPLICA IDENTITY FULL so DELETE events carry the old row.
-- ---------------------------------------------------------------------
alter table public.schemas replica identity full;
alter table public.fields  replica identity full;
alter table public.entries replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'schemas'
  ) then
    alter publication supabase_realtime add table public.schemas;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'fields'
  ) then
    alter publication supabase_realtime add table public.fields;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'entries'
  ) then
    alter publication supabase_realtime add table public.entries;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- RLS.
-- The challenge has no authentication (PRD §2 non-goals), so the anon
-- role is granted full access deliberately. This is NOT production
-- posture — it is the documented trade-off of a single-tenant demo.
-- ---------------------------------------------------------------------
alter table public.schemas enable row level security;
alter table public.fields  enable row level security;
alter table public.entries enable row level security;

drop policy if exists "public access" on public.schemas;
create policy "public access" on public.schemas for all using (true) with check (true);

drop policy if exists "public access" on public.fields;
create policy "public access" on public.fields for all using (true) with check (true);

drop policy if exists "public access" on public.entries;
create policy "public access" on public.entries for all using (true) with check (true);
