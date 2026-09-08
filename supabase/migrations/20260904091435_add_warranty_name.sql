-- LifeOS — Task 007: Warranty Foundation
--
-- The Task 002 warranties table has no field that can hold a required,
-- freeform label for a warranty entry (an asset can have several —
-- manufacturer, seller, extended — and the user needs to tell them apart).
-- `provider` means "who provides the warranty" and `warranty_number` is a
-- policy/serial number; neither is a name. This adds the missing column,
-- mirroring assets.name and documents.name: a plain required text field,
-- nothing else about the table changes.
--
-- Safe to run as a straight NOT NULL add: the table is currently empty, so
-- there is no existing data to backfill or violate the constraint.

alter table public.warranties
  add column name text not null;
