-- LifeOS — Task 030: Alpha UX Refinement — Warranty Name optional
--
-- A warranty only ever belongs to one asset (asset_id not null, on delete
-- cascade — see the Task 002 migration), and the Asset Detail screen already
-- shows the asset's own name as the page context. Requiring a *second*,
-- separate "Warranty Name" (added not-null in Task 007) forces the user to
-- invent a redundant label just to satisfy the form — e.g. typing "Samsung
-- S26 Ultra" again for a phone that already has that name as its own Asset.
--
-- This is a pure constraint relaxation: existing rows are untouched (every
-- current warranty already has a name, satisfying the old constraint, so
-- there is nothing to backfill), and the column, its data, and every other
-- constraint on the table are unchanged. Application code decides what to
-- display when name is null (falls back to "Warranty" — see
-- app/asset/[id].tsx, dashboard/api.ts, search/api.ts).

alter table public.warranties
  alter column name drop not null;
