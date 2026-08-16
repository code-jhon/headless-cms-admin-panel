-- =====================================================================
-- Milestone 5 — atomic schema migrations
--
-- Run this once against your Supabase project, after 0001_init.sql.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Make the per-schema key uniqueness deferrable.
--
-- Renaming two fields so they swap keys (`body` → `content` while
-- `content` → `body`) is legal at the end of the statement batch but
-- violates uniqueness half way through it. Deferring the check to COMMIT
-- lets the whole set of renames land together, which is exactly the
-- all-or-nothing semantics this feature promises.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where c.conname = 'fields_key_unique'
      and t.relname = 'fields'
      and n.nspname = 'public'
      and not c.condeferrable
  ) then
    alter table public.fields drop constraint fields_key_unique;
    alter table public.fields
      add constraint fields_key_unique unique (schema_id, key)
      deferrable initially immediate;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- apply_schema_migration
--
-- Applies a complete schema change — field removals, field upserts and
-- the transformed entry rows — inside one transaction. A plpgsql function
-- runs in a single transaction, so any error rolls the whole thing back
-- and the schema is never left half-migrated (PRD D5).
--
-- The transformed entry values are computed in TypeScript
-- (`lib/migrations/transform.ts`) and passed in already resolved. That is
-- deliberate: the preview the user approved is produced by the same code,
-- so this function cannot disagree with what they were shown. Its job is
-- atomicity, not business rules.
--
-- Arguments
--   p_schema_id        the content type being migrated
--   p_delete_field_ids field ids to remove
--   p_fields           jsonb array of the complete desired field set:
--                        [{id?, key, label, type, required, position,
--                          target_schema_id}]
--   p_entries          jsonb array of rows to rewrite:
--                        [{id, data, invalid}]
--
-- Returns a jsonb summary of what it did.
-- ---------------------------------------------------------------------
create or replace function public.apply_schema_migration(
  p_schema_id        uuid,
  p_delete_field_ids uuid[],
  p_fields           jsonb,
  p_entries          jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_exists        boolean;
  v_deleted       integer := 0;
  v_inserted      integer := 0;
  v_updated       integer := 0;
  v_entries       integer := 0;
  v_flagged       integer := 0;
  v_field         jsonb;
  v_entry         jsonb;
  v_field_id      uuid;
  v_touched_ids   uuid[] := '{}';
begin
  select exists (select 1 from public.schemas where id = p_schema_id)
    into v_exists;

  if not v_exists then
    raise exception 'No content type with id %', p_schema_id
      using errcode = 'no_data_found';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'p_fields must be a jsonb array';
  end if;

  if jsonb_array_length(p_fields) = 0 then
    raise exception 'A content type must keep at least one field'
      using errcode = 'check_violation';
  end if;

  -- Let renames that swap keys pass through the middle of the batch.
  set constraints public.fields_key_unique deferred;

  -- 1. Removals first, so their keys are free for anything reusing them.
  if p_delete_field_ids is not null
     and array_length(p_delete_field_ids, 1) is not null then
    delete from public.fields
     where schema_id = p_schema_id
       and id = any (p_delete_field_ids);
    get diagnostics v_deleted = row_count;
  end if;

  -- 2. Field upserts, in the order given.
  for v_field in select * from jsonb_array_elements(p_fields)
  loop
    v_field_id := nullif(v_field ->> 'id', '')::uuid;

    if v_field_id is null then
      insert into public.fields
        (schema_id, key, label, type, required, position, target_schema_id)
      values (
        p_schema_id,
        v_field ->> 'key',
        v_field ->> 'label',
        (v_field ->> 'type')::public.field_type,
        coalesce((v_field ->> 'required')::boolean, false),
        coalesce((v_field ->> 'position')::integer, 0),
        nullif(v_field ->> 'target_schema_id', '')::uuid
      )
      returning id into v_field_id;

      v_inserted := v_inserted + 1;
    else
      update public.fields
         set key              = v_field ->> 'key',
             label            = v_field ->> 'label',
             type             = (v_field ->> 'type')::public.field_type,
             required         = coalesce((v_field ->> 'required')::boolean, false),
             position         = coalesce((v_field ->> 'position')::integer, 0),
             target_schema_id = nullif(v_field ->> 'target_schema_id', '')::uuid
       where id = v_field_id
         and schema_id = p_schema_id;

      if not found then
        raise exception 'Field % does not belong to content type %',
          v_field_id, p_schema_id
          using errcode = 'foreign_key_violation';
      end if;

      v_updated := v_updated + 1;
    end if;

    v_touched_ids := v_touched_ids || v_field_id;
  end loop;

  -- 3. Any field left neither deleted nor listed would be an orphan the
  --    caller did not account for. Refuse rather than guess.
  if exists (
    select 1 from public.fields
     where schema_id = p_schema_id
       and not (id = any (v_touched_ids))
  ) then
    raise exception 'The field list is incomplete for content type %', p_schema_id
      using errcode = 'check_violation';
  end if;

  -- 4. Transformed entries. Scoped by schema_id so a caller cannot reach
  --    into another content type's rows.
  if p_entries is not null and jsonb_typeof(p_entries) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_entries)
    loop
      update public.entries
         set data    = coalesce(v_entry -> 'data', '{}'::jsonb),
             invalid = coalesce((v_entry ->> 'invalid')::boolean, false)
       where id = (v_entry ->> 'id')::uuid
         and schema_id = p_schema_id;

      if found then
        v_entries := v_entries + 1;
        if coalesce((v_entry ->> 'invalid')::boolean, false) then
          v_flagged := v_flagged + 1;
        end if;
      end if;
    end loop;
  end if;

  -- Surface a constraint violation here rather than at COMMIT, so the
  -- caller gets the error from this function instead of an opaque failure.
  set constraints public.fields_key_unique immediate;

  update public.schemas set updated_at = now() where id = p_schema_id;

  return jsonb_build_object(
    'fields_deleted',  v_deleted,
    'fields_inserted', v_inserted,
    'fields_updated',  v_updated,
    'entries_updated', v_entries,
    'entries_flagged', v_flagged
  );
end;
$$;

comment on function public.apply_schema_migration is
  'Applies a schema change and its transformed entries atomically. Values are computed by lib/migrations/transform.ts so the preview and the write can never disagree.';
