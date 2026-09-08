import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../src/auth';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import { Asset, getActiveHouseholdId, listAssets } from '../../src/features/assets/api';
import {
  deleteDocument,
  Document,
  DOCUMENT_TYPES,
  downloadDocument,
  getDocumentUrl,
  listDocuments,
  PickedFile,
  updateDocument,
  uploadDocument,
  uploadDocumentForAsset,
} from '../../src/features/documents/api';

type Status = 'loading' | 'loaded' | 'error';
type FormMode = 'closed' | 'add' | string; // string = editing that document's id

type Draft = {
  name: string;
  documentType: string;
  assetId: string;
};

const EMPTY_DRAFT: Draft = { name: '', documentType: '', assetId: '' };

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Mirrors describeDocument() in app/asset/[id].tsx — kept as a separate,
// small copy rather than a shared import, consistent with how each screen
// in this app owns its own tiny display helpers.
function describeDocument(document: Document): string {
  const kind = document.mime_type === 'application/pdf' ? 'PDF' : 'Image';
  const size = formatFileSize(document.file_size);
  const base = size ? `${kind} · ${size}` : kind;
  return document.document_type ? `${document.document_type} · ${base}` : base;
}

function isImage(document: Document): boolean {
  return Boolean(document.mime_type?.startsWith('image/'));
}

export default function DocumentsScreen() {
  const { user } = useAuth();
  const { autoAdd } = useLocalSearchParams<{ autoAdd?: string }>();

  const [status, setStatus] = useState<Status>('loading');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<PickedFile | null>(null);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [previewError, setPreviewError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [docs, assetList] = await Promise.all([listDocuments(), listAssets()]);
      setDocuments(docs);
      setAssets(assetList);
      setStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[documents] load failed', error);
      setStatus('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Lets the Add launcher open this screen with the "choose a file" picker
  // already showing, instead of the user having to tap "+ Add document"
  // themselves. The ref guard means this only fires once per navigation
  // here with the param present, not on every refocus of the tab.
  const autoAddHandled = useRef(false);
  useEffect(() => {
    if (autoAdd && !autoAddHandled.current) {
      autoAddHandled.current = true;
      setPickerOpen(true);
    }
  }, [autoAdd]);

  const cancelForm = () => {
    setDraft(null);
    setFormError('');
    setFormMode('closed');
    setPendingFile(null);
  };

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const startEdit = (document: Document) => {
    setDraft({ name: document.name, documentType: document.document_type ?? '', assetId: '' });
    setFormError('');
    setFormMode(document.id);
  };

  const stageFile = (file: PickedFile) => {
    setPendingFile(file);
    setDraft({ ...EMPTY_DRAFT, name: file.name });
    setFormError('');
    setFormMode('add');
    setPickerOpen(false);
  };

  const handleChoosePhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    const picked = result.canceled ? null : result.assets[0];
    if (!picked) {
      setPickerOpen(false);
      return;
    }
    stageFile({
      uri: picked.uri,
      name: picked.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: picked.mimeType ?? 'image/jpeg',
      size: picked.fileSize ?? null,
    });
  };

  const handleChooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'] });
    const picked = result.canceled ? null : result.assets[0];
    if (!picked) {
      setPickerOpen(false);
      return;
    }
    stageFile({
      uri: picked.uri,
      name: picked.name,
      mimeType: picked.mimeType ?? 'application/octet-stream',
      size: picked.size ?? null,
    });
  };

  const handleSave = async () => {
    if (saving || !draft || formMode === 'closed') return;

    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setFormError('Please enter a name.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      if (formMode === 'add') {
        if (!pendingFile || !user) {
          setFormError('Unable to save this document. Please try again.');
          return;
        }
        const householdId = await getActiveHouseholdId(user.id);
        if (!householdId) {
          setFormError("We couldn't find your household. Please try again.");
          return;
        }
        const documentType = draft.documentType || null;
        const namedFile: PickedFile = { ...pendingFile, name: trimmedName };
        if (draft.assetId) {
          const { document } = await uploadDocumentForAsset(
            householdId,
            draft.assetId,
            namedFile,
            documentType,
          );
          setDocuments((current) => [document, ...current]);
        } else {
          const document = await uploadDocument(householdId, namedFile, documentType);
          setDocuments((current) => [document, ...current]);
        }
      } else {
        const updated = await updateDocument(formMode, {
          name: trimmedName,
          document_type: draft.documentType || null,
        });
        setDocuments((current) => current.map((d) => (d.id === updated.id ? updated : d)));
      }
      cancelForm();
    } catch (error) {
      if (__DEV__) console.warn('[documents] save failed', error);
      setFormError('Unable to save this document. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (document: Document) => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteDocument(document);
      setDocuments((current) => current.filter((d) => d.id !== document.id));
      setConfirmDeleteId(null);
    } catch (error) {
      if (__DEV__) console.warn('[documents] delete failed', error);
      setDeleteError('Unable to delete this document. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async (document: Document) => {
    if (downloadingId) return;
    setDownloadingId(document.id);
    setDownloadError('');
    try {
      await downloadDocument(document);
    } catch (error) {
      if (__DEV__) console.warn('[documents] download failed', error);
      setDownloadError('Unable to download this document. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const openDocument = async (document: Document) => {
    setPreviewError('');
    try {
      const url = await getDocumentUrl(document.file_path);
      if (isImage(document)) {
        setPreview({ url, name: document.name });
      } else {
        await Linking.openURL(url);
      }
    } catch (error) {
      if (__DEV__) console.warn('[documents] open failed', error);
      setPreviewError('Unable to open this document. Please try again.');
    }
  };

  if (preview) {
    return (
      <Screen>
        <Text style={styles.back} onPress={() => setPreview(null)}>
          ‹ Close
        </Text>
        <Text style={styles.title}>{preview.name}</Text>
        <Image source={{ uri: preview.url }} style={styles.previewImage} resizeMode="contain" />
      </Screen>
    );
  }

  if (status === 'loading') {
    return (
      <Screen>
        <LoadingState message="Loading documents…" />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen>
        <ErrorState message="Unable to load documents." onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Documents</Text>
        <Text style={styles.sectionHint}>PDF · Receipt · Invoice · Manual</Text>

        {documents.length === 0 && formMode === 'closed' ? (
          <EmptyState
            title="No documents yet"
            description="Store receipts, invoices, warranties, and more."
          />
        ) : null}

        {documents.map((document) =>
          formMode === document.id && draft ? (
            <DocumentForm
              key={document.id}
              draft={draft}
              saving={saving}
              error={formError}
              isNew={false}
              assets={assets}
              onChange={updateDraft}
              onSave={handleSave}
              onCancel={cancelForm}
            />
          ) : (
            <View key={document.id} style={styles.item}>
              <Card style={styles.card}>
                <Text style={styles.value} onPress={() => startEdit(document)}>
                  {document.name}
                </Text>
                <Text style={styles.label}>{describeDocument(document)}</Text>
              </Card>
              <View style={styles.actionRow}>
                <Text style={styles.link} onPress={() => openDocument(document)}>
                  View
                </Text>
                <Text
                  style={styles.link}
                  onPress={
                    downloadingId === document.id ? undefined : () => handleDownload(document)
                  }
                >
                  {downloadingId === document.id ? 'Downloading…' : 'Download'}
                </Text>
                <Text style={styles.link} onPress={() => setConfirmDeleteId(document.id)}>
                  Delete
                </Text>
              </View>
              {confirmDeleteId === document.id ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.subtitle}>Delete this document?</Text>
                  <Button
                    label={deleting ? 'Deleting…' : 'Delete'}
                    variant="secondary"
                    onPress={() => handleDelete(document)}
                    disabled={deleting}
                    style={styles.confirmButton}
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setConfirmDeleteId(null)}
                    disabled={deleting}
                  />
                </View>
              ) : null}
            </View>
          ),
        )}

        {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
        {downloadError ? <Text style={styles.error}>{downloadError}</Text> : null}
        {previewError ? <Text style={styles.error}>{previewError}</Text> : null}

        {formMode === 'add' && draft ? (
          <DocumentForm
            draft={draft}
            saving={saving}
            error={formError}
            isNew
            assets={assets}
            onChange={updateDraft}
            onSave={handleSave}
            onCancel={cancelForm}
          />
        ) : null}

        {formMode === 'closed' && pickerOpen ? (
          <View style={styles.pickerRow}>
            <Button label="Choose Photo" onPress={handleChoosePhoto} style={styles.confirmButton} />
            <Button label="Choose File" onPress={handleChooseFile} style={styles.confirmButton} />
            <Text style={styles.link} onPress={() => setPickerOpen(false)}>
              Cancel
            </Text>
          </View>
        ) : null}

        {formMode === 'closed' && !pickerOpen ? (
          <Button
            label="+ Add document"
            onPress={() => setPickerOpen(true)}
            style={styles.button}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function DocumentForm({
  draft,
  saving,
  error,
  isNew,
  assets,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  saving: boolean;
  error: string;
  isNew: boolean;
  assets: Asset[];
  onChange: (field: keyof Draft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.form}>
      <Field label="Name *">
        <TextInput
          style={styles.input}
          value={draft.name}
          onChangeText={(value) => onChange('name', value)}
          editable={!saving}
        />
      </Field>
      <Field label="Type">
        <View style={styles.typeRow}>
          <Button
            label="None"
            variant={draft.documentType === '' ? 'primary' : 'secondary'}
            onPress={() => onChange('documentType', '')}
            disabled={saving}
            style={styles.typeButton}
          />
          {DOCUMENT_TYPES.map((type) => (
            <Button
              key={type}
              label={type}
              variant={draft.documentType === type ? 'primary' : 'secondary'}
              onPress={() => onChange('documentType', type)}
              disabled={saving}
              style={styles.typeButton}
            />
          ))}
        </View>
      </Field>
      {isNew && assets.length > 0 ? (
        <Field label="Link to Asset (optional)">
          <View style={styles.typeRow}>
            <Button
              label="None"
              variant={draft.assetId === '' ? 'primary' : 'secondary'}
              onPress={() => onChange('assetId', '')}
              disabled={saving}
              style={styles.typeButton}
            />
            {assets.map((asset) => (
              <Button
                key={asset.id}
                label={asset.name}
                variant={draft.assetId === asset.id ? 'primary' : 'secondary'}
                onPress={() => onChange('assetId', asset.id)}
                disabled={saving}
                style={styles.typeButton}
              />
            ))}
          </View>
        </Field>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={saving ? 'Saving…' : 'Save'}
        onPress={onSave}
        disabled={saving}
        style={styles.confirmButton}
      />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  sectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  item: {
    marginBottom: spacing.sm,
  },
  card: {
    padding: spacing.md,
  },
  value: {
    fontSize: 16,
    color: colors.text,
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  link: {
    color: colors.primary,
    fontSize: 13,
  },
  confirmRow: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  confirmButton: {
    marginTop: 0,
  },
  form: {
    marginBottom: spacing.sm,
  },
  field: {
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xs / 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  typeButton: {
    marginTop: 0,
  },
  pickerRow: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  button: {
    marginTop: spacing.lg,
  },
  back: {
    color: colors.primary,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  previewImage: {
    flex: 1,
    width: '100%',
  },
});
