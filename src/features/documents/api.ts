import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database';

export type Document = Tables<'documents'>;
export type DocumentLink = Tables<'document_links'>;
export type DocumentUpdate = TablesUpdate<'documents'>;

export type AssetDocument = {
  linkId: string;
  document: Document;
};

export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
};

// documents.document_type is plain free text with no check constraint — this
// list is purely a UI convenience, the same pattern as EXPENSE_CATEGORIES /
// ASSET_CATEGORIES. Not enforced by the schema.
export const DOCUMENT_TYPES = [
  'Receipt',
  'Invoice',
  'Warranty',
  'Insurance',
  'Manual',
  'Other',
] as const;

const DOCUMENTS_BUCKET = 'documents';
// Kept short and regenerated on demand — see getDocumentUrl. Never persisted.
const SIGNED_URL_TTL_SECONDS = 300;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
}

function uniquePathSegment(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * All documents for the given asset, via document_links (entity_type =
 * 'asset', entity_id = assetId) — documents has no asset_id column by
 * design (see docs/asset-information-architecture.md). Uses the existing
 * document_links -> documents foreign key for the embedded select; RLS on
 * both tables (via the linked document's household) is what actually
 * authorizes this, not the assetId filter itself.
 */
export async function listAssetDocuments(assetId: string): Promise<AssetDocument[]> {
  const { data, error } = await supabase
    .from('document_links')
    .select('id, created_at, documents(*)')
    .eq('entity_type', 'asset')
    .eq('entity_id', assetId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? [])
    .filter((row): row is typeof row & { documents: Document } => row.documents != null)
    .map((row) => ({ linkId: row.id, document: row.documents }));
}

/**
 * Every document owned by the current user's household, standalone or
 * asset-linked alike — the household Documents screen's own list. No
 * household filter here on purpose, same as every other list* function:
 * RLS already scopes this.
 */
export async function listDocuments(): Promise<Document[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function updateDocument(id: string, updates: DocumentUpdate): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createDocument(input: {
  householdId: string;
  name: string;
  filePath: string;
  mimeType: string | null;
  fileSize: number | null;
  documentType: string | null;
}): Promise<Document> {
  const insert: TablesInsert<'documents'> = {
    household_id: input.householdId,
    name: input.name,
    file_path: input.filePath,
    mime_type: input.mimeType,
    file_size: input.fileSize,
    document_type: input.documentType,
  };
  const { data, error } = await supabase.from('documents').insert(insert).select().single();
  if (error) throw error;
  return data;
}

export async function linkDocumentToAsset(
  documentId: string,
  assetId: string,
): Promise<DocumentLink> {
  const insert: TablesInsert<'document_links'> = {
    document_id: documentId,
    entity_type: 'asset',
    entity_id: assetId,
  };
  const { data, error } = await supabase.from('document_links').insert(insert).select().single();
  if (error) throw error;
  return data;
}

/**
 * Removes only the asset ↔ document relationship (one document_links row).
 * The document itself, and its underlying Storage file, are untouched — it
 * remains visible in the household's standalone Documents list. This is
 * deliberately a separate operation from deleteDocument(): unlinking is not
 * deleting.
 */
export async function unlinkDocumentFromAsset(linkId: string): Promise<void> {
  const { error } = await supabase.from('document_links').delete().eq('id', linkId);
  if (error) throw error;
}

/**
 * Uploads a picked file and creates its documents row, in the order that
 * minimizes orphaned state on failure:
 *
 *   1. upload to Storage        (fails -> nothing exists anywhere, done)
 *   2. insert documents row     (fails -> remove the just-uploaded file)
 *
 * `householdId` must come from a value the caller already read through RLS
 * (the household itself or an asset within it) rather than being re-derived
 * or trusted from elsewhere. Shared by both uploadDocument() (standalone)
 * and uploadDocumentForAsset() (asset-linked) below.
 */
async function uploadAndCreateDocument(
  householdId: string,
  file: PickedFile,
  documentType: string | null,
): Promise<Document> {
  const path = `${householdId}/${uniquePathSegment()}/${sanitizeFileName(file.name)}`;

  const response = await fetch(file.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, blob, { contentType: file.mimeType ?? blob.type ?? 'application/octet-stream' });
  if (uploadError) throw uploadError;

  try {
    return await createDocument({
      householdId,
      name: file.name,
      filePath: path,
      mimeType: file.mimeType,
      fileSize: file.size,
      documentType,
    });
  } catch (error) {
    const { error: cleanupError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
    if (cleanupError && __DEV__) {
      console.warn('[documents] cleanup after failed insert also failed', cleanupError);
    }
    throw error;
  }
}

/**
 * Uploads a standalone household document — no asset association. This is
 * the household Documents screen's own upload path.
 */
export async function uploadDocument(
  householdId: string,
  file: PickedFile,
  documentType: string | null = null,
): Promise<Document> {
  return uploadAndCreateDocument(householdId, file, documentType);
}

/**
 * Uploads a picked file and attaches it to an asset in one step. Same
 * upload+insert as uploadDocument(), plus a document_links row — if the
 * link insert fails, both the just-created document row and its Storage
 * file are cleaned up so nothing orphaned is left behind.
 */
export async function uploadDocumentForAsset(
  householdId: string,
  assetId: string,
  file: PickedFile,
  documentType: string | null = null,
): Promise<AssetDocument> {
  const document = await uploadAndCreateDocument(householdId, file, documentType);

  try {
    const link = await linkDocumentToAsset(document.id, assetId);
    return { linkId: link.id, document };
  } catch (error) {
    const [storageResult, documentResult] = await Promise.allSettled([
      supabase.storage.from(DOCUMENTS_BUCKET).remove([document.file_path]),
      supabase.from('documents').delete().eq('id', document.id),
    ]);
    if (__DEV__) {
      if (storageResult.status === 'rejected') {
        console.warn(
          '[documents] cleanup after failed link (storage) also failed',
          storageResult.reason,
        );
      }
      if (documentResult.status === 'rejected') {
        console.warn(
          '[documents] cleanup after failed link (row) also failed',
          documentResult.reason,
        );
      }
    }
    throw error;
  }
}

/**
 * Deletes the underlying Storage object first, then the documents row
 * (which cascades to remove its document_links row — see the Task 002
 * migration). If Storage deletion fails, the row is deliberately left in
 * place rather than deleted, so the app never ends up with an orphaned file
 * that no remaining record points to.
 */
export async function deleteDocument(document: Document): Promise<void> {
  const { error: storageError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([document.file_path]);
  if (storageError) throw storageError;

  const { error } = await supabase.from('documents').delete().eq('id', document.id);
  if (error) throw error;
}

/**
 * A short-lived signed URL for previewing/opening a document. Generated on
 * demand and never persisted — the bucket is private, so there is no
 * permanent public URL to hand out.
 */
export async function getDocumentUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * Saves a document back to the user's device — conceptually separate from
 * "View" (getDocumentUrl + open/preview) and "Delete" (below): this never
 * touches the row or the Storage object, only reads it. Always goes through
 * a fresh signed URL (never a public one), so the existing private-bucket
 * model is unchanged (Task 030).
 *
 * Web: fetches the file and triggers a real browser download via a
 * throwaway anchor element (Linking.openURL would just open a new tab,
 * which isn't a download).
 *
 * Native: Expo apps have no direct "Downloads folder" access without extra
 * permissions, so the standard, minimal-permission approach is to download
 * to app-private cache first, then hand it to the OS share sheet — the user
 * picks "Save to Files" (iOS) or a save target (Android) themselves. This
 * is the "most appropriate native Expo-compatible behavior" the product
 * spec allows in place of a direct filesystem download.
 */
export async function downloadDocument(document: Document): Promise<void> {
  const url = await getDocumentUrl(document.file_path);

  if (Platform.OS === 'web') {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = objectUrl;
    link.download = document.name;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    return;
  }

  const destination = new File(Paths.cache, sanitizeFileName(document.name));
  const downloaded = await File.downloadFileAsync(url, destination, { idempotent: true });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Saving files is not supported on this device.');
  }
  await Sharing.shareAsync(downloaded.uri, {
    mimeType: document.mime_type ?? undefined,
    dialogTitle: document.name,
  });
}
