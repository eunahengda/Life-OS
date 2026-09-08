-- LifeOS — Task 013: Asset Photos
--
-- Minimal, asset-owned photo metadata table plus a dedicated private Storage
-- bucket. Follows the same shape as warranties/maintenance_records (a real
-- asset_id FK with cascade, ownership inherited through the parent asset —
-- no household_id column of its own) and the same Storage-policy pattern as
-- the "documents" bucket from Task 006 (household_id as the first path
-- segment, checked via the existing public.is_household_member() helper).

create table public.asset_photos (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index idx_asset_photos_asset_id on public.asset_photos (asset_id);

alter table public.asset_photos enable row level security;

create policy "asset_photos_select_member" on public.asset_photos
  for select using (
    exists (
      select 1 from public.assets a
      where a.id = asset_photos.asset_id and public.is_household_member(a.household_id)
    )
  );

create policy "asset_photos_insert_member" on public.asset_photos
  for insert with check (
    exists (
      select 1 from public.assets a
      where a.id = asset_photos.asset_id and public.is_household_member(a.household_id)
    )
  );

create policy "asset_photos_delete_member" on public.asset_photos
  for delete using (
    exists (
      select 1 from public.assets a
      where a.id = asset_photos.asset_id and public.is_household_member(a.household_id)
    )
  );

-- No update policy: a photo row is immutable once created — replacing a
-- photo means deleting it and uploading a new one, not editing this row.

-- ============================================================================
-- Storage: a dedicated "asset-photos" bucket, separate from "documents".
-- Object paths are "<household_id>/assets/<asset_id>/<unique-file>"; the
-- policies below only ever check the household_id folder segment, exactly
-- like the documents bucket's policies.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-photos',
  'asset-photos',
  false,
  10485760, -- 10 MB per file, same MVP limit as the documents bucket
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy "asset_photos_bucket_select_member" on storage.objects
  for select using (
    bucket_id = 'asset-photos'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

create policy "asset_photos_bucket_insert_member" on storage.objects
  for insert with check (
    bucket_id = 'asset-photos'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

create policy "asset_photos_bucket_delete_member" on storage.objects
  for delete using (
    bucket_id = 'asset-photos'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );
