import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesUpdate } from '../../types/database';
import { deleteAssetPhotoFiles, listAssetPhotos } from '../assetPhotos/api';

export type Asset = Tables<'assets'>;
export type AssetUpdate = TablesUpdate<'assets'>;

/**
 * The fixed set of user-facing organizational categories (Task 016).
 * Deliberately not database-backed as an enum/lookup table — these seven
 * values are not user-manageable, so a plain constant list is enough; see
 * assets.user_category in supabase/migrations for why this is a separate
 * column from assets.category (Task 014's internal Vehicle-specialization
 * marker, e.g. 'vehicle' — a completely different concept from this list
 * and never exposed to the user).
 */
export const ASSET_CATEGORIES = [
  'Vehicles',
  'Electronics',
  'Appliances',
  'Furniture',
  'Tools',
  'Personal',
  'Other',
] as const;

/**
 * The household the given user belongs to, per the membership established
 * during sign-in (see src/auth/ensureUserSetup.ts). Never creates a
 * household — if a user somehow has none yet, that's a setup problem to
 * surface, not something this feature should paper over.
 */
export async function getActiveHouseholdId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.household_id ?? null;
}

export async function createAsset(
  householdId: string,
  name: string,
  category?: string | null,
  userCategory?: string | null,
  propertyId?: string | null,
): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .insert({
      household_id: householdId,
      name,
      category: category ?? null,
      user_category: userCategory ?? null,
      property_id: propertyId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * No household filter here on purpose: RLS already scopes this to assets
 * the current user's household(s) own. Reproducing that check client-side
 * would just be redundant.
 */
export async function listAssets(): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetches a single asset by id. Filtering by `.eq('id', assetId)` alone is
 * intentional: RLS is what actually decides whether the row is visible, so
 * there's no `household_id` check to duplicate here. Returns null both when
 * the row doesn't exist and when RLS hides it — the two are
 * indistinguishable from the client's point of view, which is the point.
 */
export async function getAsset(assetId: string): Promise<Asset | null> {
  const { data, error } = await supabase.from('assets').select('*').eq('id', assetId).maybeSingle();

  if (error) throw error;
  return data;
}

// Property Detail only needs a manageable list, not every asset in the
// household — kept small and bounded rather than an unlimited fetch.
const PROPERTY_ASSETS_LIMIT = 50;

/**
 * Assets belonging to the given property, newest first. RLS on `assets`
 * already scopes this to the current household; the `.eq('property_id', …)`
 * filter alone decides which of those belong to this property.
 */
export async function listAssetsByProperty(propertyId: string): Promise<Asset[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(PROPERTY_ASSETS_LIMIT);

  if (error) throw error;
  return data ?? [];
}

export async function updateAsset(assetId: string, updates: AssetUpdate): Promise<Asset> {
  const { data, error } = await supabase
    .from('assets')
    .update(updates)
    .eq('id', assetId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes an asset and everything that's actually meant to go with it.
 *
 * `warranties.asset_id`, `maintenance_records.asset_id`, and (since Task
 * 013) `asset_photos.asset_id` are real foreign keys with `on delete
 * cascade` (see supabase/migrations), so deleting the asset row alone
 * already removes those rows — nothing to do here for them. Postgres
 * cascade, however, only ever reaches rows in the database: it cannot also
 * remove the asset_photos' Storage files, so those are deleted explicitly
 * first, before anything else. If that step fails, nothing else has been
 * touched yet — the asset, its document links, and its photo rows are all
 * left fully intact, rather than deleting the asset and leaving orphaned
 * files nothing will ever clean up.
 *
 * `document_links`, meanwhile, is a polymorphic association: `entity_id` is
 * deliberately a plain uuid with no foreign key (it has to point at
 * different tables depending on `entity_type`), so Postgres has nothing to
 * cascade through when an asset is deleted either. Left alone, those link
 * rows would become permanent orphans pointing at a deleted asset id.
 * They're deleted explicitly here too, before the asset itself, for the
 * same reason.
 *
 * The underlying `documents` rows (and their Storage files) are
 * intentionally NOT touched: removing an asset's *link* to a document must
 * not delete the document itself, mirroring deleteDocument()'s own
 * documents/api.ts behavior of only ever removing what was explicitly
 * asked for.
 */
export async function deleteAsset(assetId: string): Promise<void> {
  const photos = await listAssetPhotos(assetId);
  await deleteAssetPhotoFiles(photos);

  const { error: linksError } = await supabase
    .from('document_links')
    .delete()
    .eq('entity_type', 'asset')
    .eq('entity_id', assetId);
  if (linksError) throw linksError;

  const { error } = await supabase.from('assets').delete().eq('id', assetId);
  if (error) throw error;
}
