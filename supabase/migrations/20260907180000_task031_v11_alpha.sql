-- LifeOS — Task 031: V1.1 Alpha UX Refinement
--
-- Two independent, minimal additions:
--
-- 1. profiles.home_section_order — lets a user customize the order of the
--    major Home dashboard sections (Needs Attention / Upcoming / Finance /
--    Recently Added). Stored on profiles (not households) because this is a
--    per-user display preference, not shared household data; profiles
--    already has "own row only" RLS, which is a strictly tighter isolation
--    than household-scoping would give. Nullable — a user who has never
--    reordered anything simply falls back to the app's default order.
--
-- 2. attention_acknowledgements — lets a user dismiss a Needs Attention item
--    (an expired warranty, overdue maintenance record, ...) from the Home
--    dashboard without touching the source record in any way. This is
--    deliberately a separate, dedicated table rather than an `acknowledged`
--    flag bolted onto `warranties`/`maintenance_records` — the two concepts
--    (system state vs. user acknowledgement) must stay independent, and a
--    single small polymorphic table generalizes to future attention-item
--    sources without a schema change (same pattern as document_links'
--    entity_type/entity_id and reminders' source_type/source_id elsewhere in
--    this schema).

alter table public.profiles
  add column home_section_order text[];

create table public.attention_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  source_type text not null check (source_type in ('warranty', 'maintenance_record')),
  source_id uuid not null,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index idx_attention_acknowledgements_household_id
  on public.attention_acknowledgements (household_id);

alter table public.attention_acknowledgements enable row level security;

create policy "attention_acknowledgements_select_member" on public.attention_acknowledgements
  for select using (public.is_household_member(household_id));
create policy "attention_acknowledgements_insert_member" on public.attention_acknowledgements
  for insert with check (public.is_household_member(household_id));
create policy "attention_acknowledgements_update_member" on public.attention_acknowledgements
  for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "attention_acknowledgements_delete_member" on public.attention_acknowledgements
  for delete using (public.is_household_member(household_id));
