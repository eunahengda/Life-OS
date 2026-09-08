-- LifeOS — Task 014: Vehicles
--
-- The Task 002 vehicles table has no field to record which unit
-- current_mileage is in. LifeOS initially targets Malaysia, so 'km' is the
-- sensible default, but the unit still needs to be a real per-row value —
-- not a hardcoded UI label — since a user may legitimately record mileage
-- in miles instead. Kept free-form text (no check constraint), consistent
-- with assets.category: a simple product convention, not a new type system.
--
-- Safe to add as NOT NULL DEFAULT 'km': existing rows (currently none) all
-- get the sensible default with no backfill needed.

alter table public.vehicles
  add column mileage_unit text not null default 'km';
