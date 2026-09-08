import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesInsert } from '../../types/database';

export type AssetPhoto = Tables<'asset_photos'>;

export type PickedImage = {
  uri: string;
  name: string;
  mimeType: string | null;
};

const ASSET_PHOTOS_BUCKET = 'asset-photos';
// Kept short and regenerated on demand — see getAssetPhotoUrl. Never persisted.
const SIGNED_URL_TTL_SECONDS = 300;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'photo.jpg';
}

function uniquePathSegment(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * All photos for the given asset. Filtering by `.eq('asset_id', assetId)`
 * alone is intentional — RLS (inherited via the parent asset's household,
 * same as warranties/maintenance_records) is what actually authorizes this,
 * not the filter itself.
 */
export async function listAssetPhotos(assetId: string): Promise<AssetPhoto[]> {
  const { data, error } = await supabase
    .from('asset_photos')
    .select('*')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Uploads a picked image and attaches it to an asset, same ordering as
 * uploadDocumentForAsset in documents/api.ts: upload to Storage first (fails
 * -> nothing exists anywhere), then insert the metadata row (fails -> remove
 * the just-uploaded file so nothing is left orphaned).
 *
 * `householdId` must come from a value the caller already read through RLS
 * (the asset itself) rather than being re-derived or trusted from elsewhere.
 */
export async function uploadAssetPhoto(
  householdId: string,
  assetId: string,
  file: PickedImage,
): Promise<AssetPhoto> {
  const path = `${householdId}/assets/${assetId}/${uniquePathSegment()}-${sanitizeFileName(file.name)}`;

  const response = await fetch(file.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from(ASSET_PHOTOS_BUCKET)
    .upload(path, blob, { contentType: file.mimeType ?? blob.type ?? 'image/jpeg' });
  if (uploadError) throw uploadError;

  const insert: TablesInsert<'asset_photos'> = { asset_id: assetId, storage_path: path };
  const { data, error } = await supabase.from('asset_photos').insert(insert).select().single();

  if (error) {
    const { error: cleanupError } = await supabase.storage.from(ASSET_PHOTOS_BUCKET).remove([path]);
    if (cleanupError) {
      if (__DEV__) {
        console.warn('[assetPhotos] cleanup after failed insert also failed', cleanupError);
      }
      throw new Error(
        'Unable to save this photo, and the uploaded file could not be cleaned up automatically.',
      );
    }
    throw error;
  }

  return data;
}

/**
 * Deletes the underlying Storage object first, then the asset_photos row —
 * same order and reasoning as deleteDocument() in documents/api.ts. If
 * Storage deletion fails, the row is deliberately left in place rather than
 * deleted, so the app never ends up with a metadata row pointing at nothing,
 * or the reverse (an orphaned file nothing references any more).
 */
export async function deleteAssetPhoto(photo: AssetPhoto): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(ASSET_PHOTOS_BUCKET)
    .remove([photo.storage_path]);
  if (storageError) throw storageError;

  const { error } = await supabase.from('asset_photos').delete().eq('id', photo.id);
  if (error) throw error;
}

/**
 * A short-lived signed URL for displaying/previewing a photo. Generated on
 * demand and never persisted — the bucket is private, so there is no
 * permanent public URL to hand out.
 */
export async function getAssetPhotoUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ASSET_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Removes every Storage file for an asset's photos, without touching the
 * asset_photos rows themselves. Used by deleteAsset() in assets/api.ts:
 * ON DELETE CASCADE on asset_photos.asset_id removes the *rows* when the
 * asset is deleted, but Postgres cascade cannot reach into Storage, so the
 * files must be removed explicitly first — see assets/api.ts for why this
 * happens before, not after, the asset itself is deleted.
 */
export async function deleteAssetPhotoFiles(photos: AssetPhoto[]): Promise<void> {
  if (photos.length === 0) return;
  const paths = photos.map((photo) => photo.storage_path);
  const { error } = await supabase.storage.from(ASSET_PHOTOS_BUCKET).remove(paths);
  if (error) throw error;
}
