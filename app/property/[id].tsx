import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button, Card, ErrorState, LoadingState, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import {
  Asset,
  listAssets,
  listAssetsByProperty,
  updateAsset,
} from '../../src/features/assets/api';
import {
  deleteProperty,
  getProperty,
  listProperties,
  Property,
  PROPERTY_TYPES,
  updateProperty,
} from '../../src/features/properties/api';
import { VEHICLE_CATEGORY } from '../../src/features/vehicles/api';

type LoadStatus = 'loading' | 'loaded' | 'not-found' | 'error';
type AssetsStatus = 'loading' | 'loaded' | 'error';
type Mode = 'view' | 'edit';

type Draft = {
  name: string;
  propertyType: string;
  address: string;
  notes: string;
};

function toDraft(property: Property): Draft {
  return {
    name: property.name,
    propertyType: property.property_type ?? '',
    address: property.address ?? '',
    notes: property.notes ?? '',
  };
}

// Mirrors life.tsx's secondaryLabel() — kept as its own small copy rather
// than a shared import, consistent with how each screen owns its tiny
// display helpers elsewhere in this app.
function secondaryLabel(asset: Asset): string | null {
  const isVehicle = asset.category === VEHICLE_CATEGORY;
  if (isVehicle && asset.user_category) return `Vehicle · ${asset.user_category}`;
  if (isVehicle) return 'Vehicle';
  return asset.user_category ?? null;
}

export default function PropertyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [property, setProperty] = useState<Property | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [assetsStatus, setAssetsStatus] = useState<AssetsStatus>('loading');
  const [assets, setAssets] = useState<Asset[]>([]);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // "Add Existing Things" (Task 030) — lets the user assign Assets created
  // before this Property existed, rather than only being able to set the
  // Property from the Asset's own edit form.
  const [addExistingOpen, setAddExistingOpen] = useState(false);
  const [pickerStatus, setPickerStatus] = useState<AssetsStatus>('loading');
  const [otherAssets, setOtherAssets] = useState<Asset[]>([]);
  const [propertyNames, setPropertyNames] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmMoveId, setConfirmMoveId] = useState<string | null>(null);
  const [addingExisting, setAddingExisting] = useState(false);
  const [addExistingError, setAddExistingError] = useState('');

  const loadAssets = useCallback(async (propertyId: string) => {
    setAssetsStatus('loading');
    try {
      const data = await listAssetsByProperty(propertyId);
      setAssets(data);
      setAssetsStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[properties] listAssetsByProperty failed', error);
      setAssetsStatus('error');
    }
  }, []);

  const openAddExisting = async () => {
    setAddExistingOpen(true);
    setAddExistingError('');
    setSelectedIds(new Set());
    setConfirmMoveId(null);
    setPickerStatus('loading');
    try {
      const [allAssets, allProperties] = await Promise.all([listAssets(), listProperties()]);
      setOtherAssets(allAssets.filter((a) => a.property_id !== (property?.id ?? null)));
      setPropertyNames(Object.fromEntries(allProperties.map((p) => [p.id, p.name])));
      setPickerStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[properties] load assets for picker failed', error);
      setPickerStatus('error');
    }
  };

  const closeAddExisting = () => {
    setAddExistingOpen(false);
    setSelectedIds(new Set());
    setConfirmMoveId(null);
    setAddExistingError('');
  };

  const toggleSelected = (assetId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  // Bulk-assigns every checked (unassigned) Asset to this Property — never
  // creates a new Asset row, only updates the existing one's property_id
  // (Task 030). RLS + the assets_property_household_fkey composite FK
  // (Task 024) already make cross-household assignment impossible; this
  // picker only ever shows assets the household's own RLS already returned.
  const handleAddSelected = async () => {
    if (addingExisting || !property || selectedIds.size === 0) return;
    setAddingExisting(true);
    setAddExistingError('');
    try {
      await Promise.all(
        Array.from(selectedIds).map((assetId) =>
          updateAsset(assetId, { property_id: property.id }),
        ),
      );
      closeAddExisting();
      void loadAssets(property.id);
    } catch (error) {
      if (__DEV__) console.warn('[properties] add existing things failed', error);
      setAddExistingError('Unable to add these things. Please try again.');
    } finally {
      setAddingExisting(false);
    }
  };

  // Moving a single Asset that already belongs to a different Property is
  // deliberately a separate, explicitly-confirmed action from the bulk
  // "Add selected" flow above — it's never silent (Task 030).
  const handleMoveHere = async (assetId: string) => {
    if (addingExisting || !property) return;
    setAddingExisting(true);
    setAddExistingError('');
    try {
      await updateAsset(assetId, { property_id: property.id });
      setOtherAssets((current) => current.filter((a) => a.id !== assetId));
      setConfirmMoveId(null);
      void loadAssets(property.id);
    } catch (error) {
      if (__DEV__) console.warn('[properties] move existing thing failed', error);
      setAddExistingError('Unable to move this thing. Please try again.');
    } finally {
      setAddingExisting(false);
    }
  };

  const load = useCallback(async () => {
    if (!id) return;
    setStatus('loading');
    try {
      const data = await getProperty(id);
      if (!data) {
        setStatus('not-found');
        return;
      }
      setProperty(data);
      setStatus('loaded');
      void loadAssets(data.id);
    } catch (error) {
      if (__DEV__) console.warn('[properties] getProperty failed', error);
      setStatus('error');
    }
  }, [id, loadAssets]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const startEdit = () => {
    if (!property) return;
    setDraft(toDraft(property));
    setSaveError('');
    setMode('edit');
  };

  const cancelEdit = () => {
    setDraft(null);
    setSaveError('');
    setMode('view');
  };

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSave = async () => {
    if (saving || !draft || !property) return;

    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setSaveError('Please enter a name.');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const updated = await updateProperty(property.id, {
        name: trimmedName,
        property_type: draft.propertyType || null,
        address: draft.address.trim() || null,
        notes: draft.notes.trim() || null,
      });
      setProperty(updated);
      setDraft(null);
      setMode('view');
    } catch (error) {
      if (__DEV__) console.warn('[properties] update failed', error);
      setSaveError('Unable to save these changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting || !property) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteProperty(property.id);
      router.replace('/properties');
    } catch (error) {
      if (__DEV__) console.warn('[properties] delete failed', error);
      setDeleteError('Unable to delete this home. Please try again.');
      setDeleting(false);
    }
  };

  const backLink = (
    <Text style={styles.back} onPress={() => router.back()}>
      ‹ Back
    </Text>
  );

  if (status === 'loading') {
    return (
      <Screen>
        {backLink}
        <LoadingState message="Loading this home…" />
      </Screen>
    );
  }

  if (status === 'not-found') {
    return (
      <Screen>
        {backLink}
        <ErrorState message="This home could not be found." onRetry={load} />
      </Screen>
    );
  }

  if (status === 'error' || !property) {
    return (
      <Screen>
        {backLink}
        <ErrorState message="Unable to load this home." onRetry={load} />
      </Screen>
    );
  }

  if (mode === 'edit' && draft) {
    return (
      <Screen>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {backLink}
          <Text style={styles.title}>Edit Home</Text>

          <Field label="Name *">
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(value) => updateDraft('name', value)}
              editable={!saving}
            />
          </Field>
          <Field label="Type (optional)">
            <View style={styles.typeRow}>
              <Button
                label="None"
                variant={draft.propertyType === '' ? 'primary' : 'secondary'}
                onPress={() => updateDraft('propertyType', '')}
                disabled={saving}
                style={styles.typeButton}
              />
              {PROPERTY_TYPES.map((type) => (
                <Button
                  key={type}
                  label={type}
                  variant={draft.propertyType === type ? 'primary' : 'secondary'}
                  onPress={() => updateDraft('propertyType', type)}
                  disabled={saving}
                  style={styles.typeButton}
                />
              ))}
            </View>
          </Field>
          <Field label="Address (optional)">
            <TextInput
              style={styles.input}
              value={draft.address}
              onChangeText={(value) => updateDraft('address', value)}
              editable={!saving}
            />
          </Field>
          <Field label="Notes (optional)">
            <TextInput
              style={[styles.input, styles.multiline]}
              value={draft.notes}
              onChangeText={(value) => updateDraft('notes', value)}
              multiline
              editable={!saving}
            />
          </Field>

          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          <Button
            label={saving ? 'Saving…' : 'Save'}
            onPress={handleSave}
            disabled={saving}
            style={styles.button}
          />
          <Button label="Cancel" variant="secondary" onPress={cancelEdit} disabled={saving} />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {backLink}
        <Text style={styles.title}>{property.name}</Text>
        {property.property_type ? (
          <Text style={styles.subtitle}>{property.property_type}</Text>
        ) : null}
        {property.address ? <Text style={styles.subtitle}>{property.address}</Text> : null}
        {property.notes ? <Text style={styles.notes}>{property.notes}</Text> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Things</Text>

          {assetsStatus === 'loading' ? <LoadingState message="Loading things…" /> : null}
          {assetsStatus === 'error' ? (
            <ErrorState
              message="Unable to load things for this home."
              onRetry={() => loadAssets(property.id)}
            />
          ) : null}
          {assetsStatus === 'loaded' && assets.length === 0 ? (
            <Text style={styles.emptyText}>No things added to this home yet.</Text>
          ) : null}
          {assetsStatus === 'loaded' &&
            assets.map((asset) => (
              <Pressable key={asset.id} onPress={() => router.push(`/asset/${asset.id}`)}>
                <Card style={styles.card}>
                  <Text style={styles.value}>{asset.name}</Text>
                  {secondaryLabel(asset) ? (
                    <Text style={styles.label}>{secondaryLabel(asset)}</Text>
                  ) : null}
                </Card>
              </Pressable>
            ))}

          {!addExistingOpen ? (
            <Text style={styles.addExistingLink} onPress={openAddExisting}>
              + Add Existing Things
            </Text>
          ) : (
            <View style={styles.addExistingPanel}>
              <Text style={styles.addExistingTitle}>Add Existing Things</Text>

              {pickerStatus === 'loading' ? <LoadingState message="Loading your things…" /> : null}
              {pickerStatus === 'error' ? (
                <ErrorState message="Unable to load your things." onRetry={openAddExisting} />
              ) : null}

              {pickerStatus === 'loaded' &&
              otherAssets.filter((a) => !a.property_id).length === 0 &&
              otherAssets.filter((a) => a.property_id).length === 0 ? (
                <Text style={styles.emptyText}>Everything you own is already on a home.</Text>
              ) : null}

              {pickerStatus === 'loaded' &&
                otherAssets
                  .filter((a) => !a.property_id)
                  .map((asset) => {
                    const checked = selectedIds.has(asset.id);
                    return (
                      <Pressable
                        key={asset.id}
                        style={styles.checkboxRow}
                        onPress={() => toggleSelected(asset.id)}
                      >
                        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                          {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                        </View>
                        <Text style={styles.value}>{asset.name}</Text>
                      </Pressable>
                    );
                  })}

              {pickerStatus === 'loaded' && otherAssets.some((a) => a.property_id) ? (
                <View style={styles.otherPropertySection}>
                  <Text style={styles.otherPropertyHeading}>On another home</Text>
                  {otherAssets
                    .filter((a) => a.property_id)
                    .map((asset) => (
                      <View key={asset.id} style={styles.otherPropertyRow}>
                        <View>
                          <Text style={styles.value}>{asset.name}</Text>
                          <Text style={styles.label}>
                            Currently in{' '}
                            {propertyNames[asset.property_id as string] ?? 'another home'}
                          </Text>
                        </View>
                        {confirmMoveId === asset.id ? (
                          <View style={styles.confirmRow}>
                            <Text style={styles.subtitle}>Move here?</Text>
                            <Button
                              label={addingExisting ? 'Moving…' : 'Move'}
                              variant="secondary"
                              onPress={() => handleMoveHere(asset.id)}
                              disabled={addingExisting}
                              style={styles.confirmButton}
                            />
                            <Button
                              label="Cancel"
                              variant="secondary"
                              onPress={() => setConfirmMoveId(null)}
                              disabled={addingExisting}
                            />
                          </View>
                        ) : (
                          <Text
                            style={styles.addExistingLink}
                            onPress={() => setConfirmMoveId(asset.id)}
                          >
                            Move here
                          </Text>
                        )}
                      </View>
                    ))}
                </View>
              ) : null}

              {addExistingError ? <Text style={styles.error}>{addExistingError}</Text> : null}

              <Button
                label={addingExisting ? 'Adding…' : `Add selected (${selectedIds.size})`}
                onPress={handleAddSelected}
                disabled={addingExisting || selectedIds.size === 0}
                style={styles.confirmButton}
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={closeAddExisting}
                disabled={addingExisting}
              />
            </View>
          )}
        </View>

        <Button label="Edit" onPress={startEdit} style={styles.button} />

        <View style={styles.dangerZone}>
          {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
          {confirmDelete ? (
            <View style={styles.confirmRow}>
              <Text style={styles.subtitle}>
                Delete this home? Things linked to it will be kept, without a home.
              </Text>
              <Button
                label={deleting ? 'Deleting…' : 'Delete'}
                variant="secondary"
                onPress={handleDelete}
                disabled={deleting}
                style={styles.confirmButton}
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setConfirmDelete(false)}
                disabled={deleting}
              />
            </View>
          ) : (
            <Text style={styles.deleteLink} onPress={() => setConfirmDelete(true)}>
              Delete this home
            </Text>
          )}
        </View>
      </ScrollView>
    </Screen>
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
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  back: {
    color: colors.primary,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  notes: {
    fontSize: 14,
    color: colors.text,
    marginTop: spacing.sm,
  },
  section: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
  },
  card: {
    padding: spacing.md,
    marginBottom: spacing.sm,
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
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  typeButton: {
    marginTop: 0,
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
  dangerZone: {
    marginTop: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  deleteLink: {
    color: colors.danger,
    fontSize: 14,
  },
  confirmRow: {
    gap: spacing.xs,
    width: '100%',
  },
  confirmButton: {
    marginTop: 0,
  },
  addExistingLink: {
    color: colors.primary,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  addExistingPanel: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  addExistingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxMark: {
    color: colors.primaryText,
    fontSize: 14,
    fontWeight: '700',
  },
  otherPropertySection: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  otherPropertyHeading: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  otherPropertyRow: {
    gap: spacing.xs / 2,
    paddingVertical: spacing.xs,
  },
});
