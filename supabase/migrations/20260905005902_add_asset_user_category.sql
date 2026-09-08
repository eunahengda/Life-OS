-- LifeOS — Task 016: Asset Categories
--
-- assets.category is already in use as Task 014's internal Vehicle
-- specialization marker (the literal value 'vehicle') — see vehicles/api.ts
-- and supabase/migrations/20260904192459_add_asset_photos.sql's sibling
-- convention. It must NOT be repurposed or renamed: a Vehicle asset needs
-- to hold the specialization marker AND an independent user-chosen
-- organizational category at the same time (e.g. "Toyota Camry" is both
-- specialization='vehicle' and category='Vehicles'), which one column
-- cannot represent.
--
-- This adds a second, genuinely separate column for the user-facing
-- category. Plain nullable text, no check constraint: the seven default
-- categories are a fixed, non-manageable UI-level list (see
-- src/features/assets/api.ts), the same convention already used for
-- recurring_expenses.category and vehicles.mileage_unit — not a new type
-- system, and not worth a lookup table for values nothing ever renames.
--
-- No RLS change needed: this is a new column on an existing table that
-- already has full row-level select/insert/update/delete policies keyed on
-- household membership — those apply to every column, including this one.

alter table public.assets
  add column user_category text;
