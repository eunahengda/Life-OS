-- LifeOS — Task 002: Supabase Database Foundation
-- Ownership model: auth.users -> profiles -> households -> household_members -> household-owned records.

-- ============================================================================
-- Extensions
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  category text,
  description text,
  purchase_date date,
  purchase_price numeric,
  currency text,
  merchant text,
  serial_number text,
  model_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null unique references public.assets (id) on delete cascade,
  make text,
  model text,
  year integer,
  license_plate text,
  vin text,
  current_mileage numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  file_path text not null,
  mime_type text,
  file_size bigint,
  document_type text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Polymorphic association: entity_type/entity_id intentionally has no FK
-- (would require a generic entity framework the product spec rules out).
create table public.document_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  entity_type text not null check (
    entity_type in ('asset', 'vehicle', 'warranty', 'maintenance_record', 'recurring_expense')
  ),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique (document_id, entity_type, entity_id)
);

create table public.warranties (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  provider text,
  warranty_number text,
  start_date date,
  expiry_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  name text not null,
  performed_at date,
  cost numeric,
  currency text,
  provider text,
  next_due_date date,
  next_due_mileage numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  amount numeric,
  currency text,
  billing_cycle text check (
    billing_cycle in ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')
  ),
  next_payment_date date,
  category text,
  notes text,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Polymorphic association: source_type/source_id intentionally has no FK, per spec.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  due_at timestamptz,
  reminder_type text,
  source_type text check (
    source_type in ('warranty', 'maintenance_record', 'recurring_expense', 'manual')
  ),
  source_id uuid,
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- updated_at trigger
-- ============================================================================

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.households
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.assets
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.warranties
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.maintenance_records
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

create trigger set_updated_at before update on public.reminders
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Auth -> profile bridge
-- Minimal, safe: creates an (initially empty) profile row when a new
-- auth.users row is created, so the app never has to worry about a missing
-- profile for a signed-in user. No product logic lives here.
-- ============================================================================

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Indexes
-- Only indexes not already provided by a primary key or unique constraint.
-- (vehicles.asset_id and document_links.document_id are covered by their
-- existing unique constraints, so no separate index is added for those.)
-- ============================================================================

create index idx_household_members_user_id on public.household_members (user_id);
create index idx_household_members_household_id on public.household_members (household_id);

create index idx_assets_household_id on public.assets (household_id);
create index idx_assets_name on public.assets (name);

create index idx_documents_household_id on public.documents (household_id);
create index idx_document_links_entity on public.document_links (entity_type, entity_id);

create index idx_warranties_asset_id on public.warranties (asset_id);
create index idx_warranties_expiry_date on public.warranties (expiry_date);

create index idx_maintenance_records_asset_id on public.maintenance_records (asset_id);
create index idx_maintenance_records_next_due_date on public.maintenance_records (next_due_date);

create index idx_recurring_expenses_household_id on public.recurring_expenses (household_id);
create index idx_recurring_expenses_next_payment_date on public.recurring_expenses (next_payment_date);

create index idx_reminders_household_id on public.reminders (household_id);
create index idx_reminders_due_at on public.reminders (due_at);
create index idx_reminders_source on public.reminders (source_type, source_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.assets enable row level security;
alter table public.vehicles enable row level security;
alter table public.documents enable row level security;
alter table public.document_links enable row level security;
alter table public.warranties enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.reminders enable row level security;

-- Security-definer helper: checks whether the current user belongs to a
-- household, bypassing RLS internally to avoid recursive policy evaluation
-- on household_members. This is the single source of truth for ownership
-- checks below.
create function public.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

-- Creates a household and the calling user's membership row in one
-- bypass-RLS step (see note on households/household_members policies above).
-- This is the only way to create a household; there is no invitation system
-- yet, so every household starts with exactly one owner: its creator.
create function public.create_household(household_name text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.households (name) values (household_name)
    returning * into new_household;

  insert into public.household_members (household_id, user_id)
    values (new_household.id, auth.uid());

  return new_household;
end;
$$;

grant execute on function public.create_household(text) to authenticated;

-- ---- profiles: a user may only see/manage their own profile row ----------

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---- households: visible/mutable only to members -------------------------

create policy "households_select_member" on public.households
  for select using (public.is_household_member(id));

-- Deliberately no direct INSERT policy: a brand-new household has no
-- household_members row yet, so a plain `insert ... returning` would always
-- fail the SELECT policy above on the row it tries to return (PostgREST/
-- supabase-js always request the row back). Household creation instead goes
-- through the create_household() function below, which creates the
-- household and the creator's membership atomically as one bypass-RLS unit.

create policy "households_update_member" on public.households
  for update using (public.is_household_member(id)) with check (public.is_household_member(id));

create policy "households_delete_member" on public.households
  for delete using (public.is_household_member(id));

-- ---- household_members -----------------------------------------------
-- No roles/permissions system yet: any member can view the roster. There is
-- deliberately no direct INSERT policy — membership rows are only ever
-- created by create_household() below, so a user can't add themselves (or
-- claim ownership of) an arbitrary existing household_id they happen to
-- know. A member may still remove themselves (leave a household).

create policy "household_members_select_member" on public.household_members
  for select using (public.is_household_member(household_id));

create policy "household_members_delete_self" on public.household_members
  for delete using (user_id = auth.uid());

-- ---- household-owned tables: assets, documents, recurring_expenses, reminders ----

create policy "assets_select_member" on public.assets
  for select using (public.is_household_member(household_id));
create policy "assets_insert_member" on public.assets
  for insert with check (public.is_household_member(household_id));
create policy "assets_update_member" on public.assets
  for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "assets_delete_member" on public.assets
  for delete using (public.is_household_member(household_id));

create policy "documents_select_member" on public.documents
  for select using (public.is_household_member(household_id));
create policy "documents_insert_member" on public.documents
  for insert with check (public.is_household_member(household_id));
create policy "documents_update_member" on public.documents
  for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "documents_delete_member" on public.documents
  for delete using (public.is_household_member(household_id));

create policy "recurring_expenses_select_member" on public.recurring_expenses
  for select using (public.is_household_member(household_id));
create policy "recurring_expenses_insert_member" on public.recurring_expenses
  for insert with check (public.is_household_member(household_id));
create policy "recurring_expenses_update_member" on public.recurring_expenses
  for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "recurring_expenses_delete_member" on public.recurring_expenses
  for delete using (public.is_household_member(household_id));

create policy "reminders_select_member" on public.reminders
  for select using (public.is_household_member(household_id));
create policy "reminders_insert_member" on public.reminders
  for insert with check (public.is_household_member(household_id));
create policy "reminders_update_member" on public.reminders
  for update using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "reminders_delete_member" on public.reminders
  for delete using (public.is_household_member(household_id));

-- ---- asset-owned tables: vehicles, warranties, maintenance_records --------
-- Ownership is inherited through the parent asset's household.

create policy "vehicles_select_member" on public.vehicles
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = vehicles.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "vehicles_insert_member" on public.vehicles
  for insert with check (
    exists (
      select 1 from public.assets a
      where a.id = vehicles.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "vehicles_update_member" on public.vehicles
  for update using (
    exists (
      select 1 from public.assets a
      where a.id = vehicles.asset_id and public.is_household_member(a.household_id)
    )
  ) with check (
    exists (
      select 1 from public.assets a
      where a.id = vehicles.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "vehicles_delete_member" on public.vehicles
  for delete using (
    exists (
      select 1 from public.assets a
      where a.id = vehicles.asset_id and public.is_household_member(a.household_id)
    )
  );

create policy "warranties_select_member" on public.warranties
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = warranties.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "warranties_insert_member" on public.warranties
  for insert with check (
    exists (
      select 1 from public.assets a
      where a.id = warranties.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "warranties_update_member" on public.warranties
  for update using (
    exists (
      select 1 from public.assets a
      where a.id = warranties.asset_id and public.is_household_member(a.household_id)
    )
  ) with check (
    exists (
      select 1 from public.assets a
      where a.id = warranties.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "warranties_delete_member" on public.warranties
  for delete using (
    exists (
      select 1 from public.assets a
      where a.id = warranties.asset_id and public.is_household_member(a.household_id)
    )
  );

create policy "maintenance_records_select_member" on public.maintenance_records
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = maintenance_records.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "maintenance_records_insert_member" on public.maintenance_records
  for insert with check (
    exists (
      select 1 from public.assets a
      where a.id = maintenance_records.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "maintenance_records_update_member" on public.maintenance_records
  for update using (
    exists (
      select 1 from public.assets a
      where a.id = maintenance_records.asset_id and public.is_household_member(a.household_id)
    )
  ) with check (
    exists (
      select 1 from public.assets a
      where a.id = maintenance_records.asset_id and public.is_household_member(a.household_id)
    )
  );
create policy "maintenance_records_delete_member" on public.maintenance_records
  for delete using (
    exists (
      select 1 from public.assets a
      where a.id = maintenance_records.asset_id and public.is_household_member(a.household_id)
    )
  );

-- ---- document_links: ownership inherited through the linked document -----

create policy "document_links_select_member" on public.document_links
  for select using (
    exists (
      select 1 from public.documents d
      where d.id = document_links.document_id and public.is_household_member(d.household_id)
    )
  );
create policy "document_links_insert_member" on public.document_links
  for insert with check (
    exists (
      select 1 from public.documents d
      where d.id = document_links.document_id and public.is_household_member(d.household_id)
    )
  );
create policy "document_links_delete_member" on public.document_links
  for delete using (
    exists (
      select 1 from public.documents d
      where d.id = document_links.document_id and public.is_household_member(d.household_id)
    )
  );
