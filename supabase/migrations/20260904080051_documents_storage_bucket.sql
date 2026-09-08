-- LifeOS — Task 006: Documents / Receipt Foundation
-- Storage-only migration: creates the private "documents" bucket and its
-- RLS policies. Does NOT touch public.documents, public.document_links, or
-- any other application table — those already fully support this feature.
--
-- Ownership model: every object's path starts with "<household_id>/...".
-- Policies check membership of that household segment via the existing
-- public.is_household_member() helper (from the Task 002 migration) — the
-- same single source of truth already used for every other table's RLS.
-- This intentionally does NOT need to reference public.documents at all:
-- the household_id folder segment alone is enough to authorize access.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760, -- 10 MB per file: a reasonable MVP limit, not a hard product requirement
  array['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf']
)
on conflict (id) do nothing;

create policy "documents_bucket_select_member" on storage.objects
  for select using (
    bucket_id = 'documents'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

create policy "documents_bucket_insert_member" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

create policy "documents_bucket_delete_member" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );
