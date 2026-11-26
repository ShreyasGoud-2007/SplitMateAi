-- SplitMate AI persistence schema.
-- Safe to review and run manually in the Supabase SQL Editor.
-- This file creates tables/functions only; it does not drop existing data.

create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  restaurant_name text,
  currency text not null check (currency in ('INR', 'USD', 'EUR', 'GBP')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, client_id)
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  client_id text not null,
  name text not null check (char_length(btrim(name)) > 0),
  is_current_user boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (group_id, client_id),
  unique (group_id, name)
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  client_id text not null,
  restaurant_name text,
  source text not null check (source in ('ocr', 'manual', 'demo')),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  currency text not null check (currency in ('INR', 'USD', 'EUR', 'GBP')),
  image_metadata jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (group_id, client_id)
);

create table if not exists public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  client_id text not null,
  name text not null check (char_length(btrim(name)) > 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  created_at timestamptz not null default now(),
  unique (bill_id, client_id)
);

create table if not exists public.item_assignments (
  id uuid primary key default gen_random_uuid(),
  bill_item_id uuid not null references public.bill_items(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  assigned_quantity numeric(12, 3),
  assigned_amount_paise bigint not null check (assigned_amount_paise > 0),
  assignment_method text not null check (assignment_method in ('quantity', 'shared', 'single')),
  created_at timestamptz not null default now(),
  unique (bill_item_id, participant_id),
  check (assigned_quantity is null or assigned_quantity > 0)
);

create index if not exists groups_owner_created_idx
  on public.groups (owner_id, created_at desc);
create index if not exists participants_group_idx
  on public.participants (group_id);
create index if not exists bills_group_created_idx
  on public.bills (group_id, created_at desc);
create index if not exists bill_items_bill_idx
  on public.bill_items (bill_id);
create index if not exists item_assignments_item_idx
  on public.item_assignments (bill_item_id);
create index if not exists item_assignments_participant_idx
  on public.item_assignments (participant_id);

alter table public.groups enable row level security;
alter table public.participants enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.item_assignments enable row level security;

grant select, insert, update, delete on public.groups to authenticated;
grant select, insert, delete on public.participants to authenticated;
grant select, insert, delete on public.bills to authenticated;
grant select, insert, delete on public.bill_items to authenticated;
grant select, insert, delete on public.item_assignments to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'groups' and policyname = 'groups_select_owner') then
    create policy groups_select_owner on public.groups for select to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'groups' and policyname = 'groups_insert_owner') then
    create policy groups_insert_owner on public.groups for insert to authenticated with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'groups' and policyname = 'groups_update_owner') then
    create policy groups_update_owner on public.groups for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'groups' and policyname = 'groups_delete_owner') then
    create policy groups_delete_owner on public.groups for delete to authenticated using (owner_id = (select auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'participants' and policyname = 'participants_owner_access') then
    create policy participants_owner_access on public.participants for all to authenticated
      using (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid())))
      with check (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bills' and policyname = 'bills_owner_access') then
    create policy bills_owner_access on public.bills for all to authenticated
      using (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid())))
      with check (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bill_items' and policyname = 'bill_items_owner_access') then
    create policy bill_items_owner_access on public.bill_items for all to authenticated
      using (exists (
        select 1 from public.bills b join public.groups g on g.id = b.group_id
        where b.id = bill_id and g.owner_id = (select auth.uid())
      ))
      with check (exists (
        select 1 from public.bills b join public.groups g on g.id = b.group_id
        where b.id = bill_id and g.owner_id = (select auth.uid())
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'item_assignments' and policyname = 'item_assignments_owner_access') then
    create policy item_assignments_owner_access on public.item_assignments for all to authenticated
      using (exists (
        select 1
        from public.bill_items bi
        join public.bills b on b.id = bi.bill_id
        join public.groups g on g.id = b.group_id
        where bi.id = bill_item_id and g.owner_id = (select auth.uid())
      ))
      with check (
        exists (
          select 1
          from public.bill_items bi
          join public.bills b on b.id = bi.bill_id
          join public.groups g on g.id = b.group_id
          where bi.id = bill_item_id and g.owner_id = (select auth.uid())
        )
        and exists (
          select 1
          from public.participants p
          join public.bill_items bi on bi.id = bill_item_id
          join public.bills b on b.id = bi.bill_id
          join public.groups g on g.id = b.group_id
          where p.id = participant_id
            and p.group_id = b.group_id
            and g.owner_id = (select auth.uid())
        )
      );
  end if;
end
$$;

create or replace function public.save_split_session(payload jsonb)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid := auth.uid();
  v_group_id uuid;
  v_bill_id uuid;
  v_item_id uuid;
  v_participant_id uuid;
  v_row jsonb;
  v_item jsonb;
  v_assignment jsonb;
  v_subtotal bigint;
  v_tax bigint;
  v_total bigint;
begin
  if v_owner_id is null then
    raise exception 'Sign-in is required to save split sessions.';
  end if;
  if payload is null or jsonb_typeof(payload->'group') <> 'object'
    or jsonb_typeof(payload->'participants') <> 'array'
    or jsonb_typeof(payload->'bill') <> 'object'
    or jsonb_typeof(payload->'bill'->'items') <> 'array' then
    raise exception 'Split session payload is incomplete.';
  end if;
  if jsonb_array_length(payload->'participants') = 0 then
    raise exception 'A split session requires at least one participant.';
  end if;

  insert into public.groups (client_id, owner_id, name, restaurant_name, currency, created_at, updated_at)
  values (
    payload->'group'->>'client_id',
    v_owner_id,
    btrim(payload->'group'->>'name'),
    nullif(btrim(payload->'group'->>'restaurant_name'), ''),
    payload->'group'->>'currency',
    coalesce((payload->'group'->>'created_at')::timestamptz, now()),
    now()
  )
  on conflict (owner_id, client_id) do update set
    name = excluded.name,
    restaurant_name = excluded.restaurant_name,
    currency = excluded.currency,
    updated_at = now()
  returning id into v_group_id;

  -- Replace this group's single-bill snapshot within the same transaction.
  delete from public.bills where group_id = v_group_id;
  delete from public.participants where group_id = v_group_id;

  for v_row in select value from jsonb_array_elements(payload->'participants') as entries(value) loop
    insert into public.participants (group_id, client_id, name, is_current_user, sort_order)
    values (
      v_group_id,
      v_row->>'client_id',
      btrim(v_row->>'name'),
      coalesce((v_row->>'is_current_user')::boolean, false),
      coalesce((v_row->>'sort_order')::integer, 0)
    );
  end loop;

  v_subtotal := (payload->'bill'->>'subtotal_paise')::bigint;
  v_tax := (payload->'bill'->>'tax_paise')::bigint;
  v_total := (payload->'bill'->>'total_paise')::bigint;
  if v_subtotal < 0 or v_tax < 0 or v_total < 0 then
    raise exception 'Bill amounts must be non-negative integer paise.';
  end if;

  insert into public.bills (
    group_id, client_id, restaurant_name, source, subtotal_paise,
    tax_paise, total_paise, currency, image_metadata, metadata, created_at
  )
  values (
    v_group_id,
    payload->'bill'->>'client_id',
    nullif(btrim(payload->'bill'->>'restaurant_name'), ''),
    payload->'bill'->>'source',
    v_subtotal,
    v_tax,
    v_total,
    payload->'bill'->>'currency',
    payload->'bill'->'image_metadata',
    coalesce(payload->'bill'->'metadata', '{}'::jsonb),
    coalesce((payload->'bill'->>'created_at')::timestamptz, now())
  )
  returning id into v_bill_id;

  for v_item in select value from jsonb_array_elements(payload->'bill'->'items') as entries(value) loop
    insert into public.bill_items (
      bill_id, client_id, name, quantity, unit_price_paise, total_paise
    )
    values (
      v_bill_id,
      v_item->>'client_id',
      btrim(v_item->>'name'),
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price_paise')::bigint,
      (v_item->>'total_paise')::bigint
    )
    returning id into v_item_id;

    for v_assignment in
      select value from jsonb_array_elements(coalesce(v_item->'assignments', '[]'::jsonb)) as entries(value)
    loop
      select id into v_participant_id
      from public.participants
      where group_id = v_group_id and client_id = v_assignment->>'participant_client_id';
      if v_participant_id is null then
        raise exception 'Assignment references a participant outside this split.';
      end if;

      insert into public.item_assignments (
        bill_item_id, participant_id, assigned_quantity,
        assigned_amount_paise, assignment_method
      )
      values (
        v_item_id,
        v_participant_id,
        nullif(v_assignment->>'assigned_quantity', '')::numeric,
        (v_assignment->>'assigned_amount_paise')::bigint,
        v_assignment->>'assignment_method'
      );
    end loop;
  end loop;

  return v_group_id;
end;
$$;

revoke all on function public.save_split_session(jsonb) from public, anon;
grant execute on function public.save_split_session(jsonb) to authenticated;
