-- LifeOS — Task 024: Home & Property Foundation
--
-- New household-owned `properties` table, same shape and RLS idiom as
-- every other household-owned table (assets, documents, recurring_expenses,
-- reminders): four policies keyed directly on is_household_member(household_id).
--
-- assets.property_id is a new nullable, optional link (per product spec:
-- not every Asset belongs to a Property — a laptop or a car may have none).
--
-- Cross-household integrity is enforced with a composite foreign key
-- rather than an RLS EXISTS subquery: properties gets a UNIQUE(id,
-- household_id), and assets gets FOREIGN KEY (property_id, household_id)
-- REFERENCES properties (id, household_id). With MATCH SIMPLE (Postgres's
-- default for multi-column FKs), the constraint is automatically satisfied
-- whenever property_id is null — only a non-null property_id is checked,
-- and in that case Postgres itself guarantees property_id's household_id
-- equals the asset's own household_id. No trigger is needed; this is a
-- plain declarative constraint, enforced at the database level regardless
-- of what any client sends.
--
-- `on delete set null (property_id)` — the PostgreSQL 15+ column-specific
-- form (this project runs PG 17, per supabase/config.toml) — is required
-- here, not plain `on delete set null`: a composite FK's default SET NULL
-- action nulls *every* referencing column, which would try to null
-- assets.household_id too (it's part of the FK) and fail outright, since
-- that column is NOT NULL. Naming only property_id means deleting a
-- Property clears just the relationship on any Asset that had it, without
-- ever touching household_id or deleting/orphaning the Asset itself.
--
-- Existing assets RLS (assets_select_member / _insert_member /
-- _update_member / _delete_member) is left completely untouched — the
-- composite FK is what prevents cross-household assignment, so no
-- additional RLS complexity is needed on top of the existing
-- is_household_member(household_id) checks.

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  property_type text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);

create index idx_properties_household_id on public.properties (household_id);

alter table public.properties enable row level security;

create policy "properties_select_member" on public.properties
  for select using (public.is_household_member(household_id));
create policy "properties_insert_member" on public.properties
  for insert with check (public.is_household_member(household_id));
create policy "properties_update_member" on public.properties
  for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "properties_delete_member" on public.properties
  for delete using (public.is_household_member(household_id));

create trigger set_updated_at before update on public.properties
  for each row execute function public.set_updated_at();

alter table public.assets
  add column property_id uuid;

create index idx_assets_property_id on public.assets (property_id);

alter table public.assets
  add constraint assets_property_household_fkey
  foreign key (property_id, household_id)
  references public.properties (id, household_id)
  on delete set null (property_id);
