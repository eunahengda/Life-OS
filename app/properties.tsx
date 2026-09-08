import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../src/auth';
import { Button, Card, EmptyState, ErrorState, LoadingState, Screen } from '../src/components';
import { colors } from '../src/constants/colors';
import { spacing } from '../src/constants/spacing';
import { getActiveHouseholdId } from '../src/features/assets/api';
import {
  createProperty,
  deleteProperty,
  listProperties,
  Property,
  PROPERTY_TYPES,
} from '../src/features/properties/api';

type Status = 'loading' | 'loaded' | 'error';
type FormMode = 'closed' | 'add';

type Draft = {
  name: string;
  propertyType: string;
  address: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = { name: '', propertyType: '', address: '', notes: '' };

function describeProperty(property: Property): string | null {
  return property.address ?? null;
}

export default function PropertiesScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<Status>('loading');
  const [properties, setProperties] = useState<Property[]>([]);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await listProperties();
      setProperties(data);
      setStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[properties] list failed', error);
      setStatus('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const startAdd = () => {
    setDraft(EMPTY_DRAFT);
    setFormError('');
    setFormMode('add');
  };

  const cancelForm = () => {
    setDraft(EMPTY_DRAFT);
    setFormError('');
    setFormMode('closed');
  };

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    if (saving) return;

    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setFormError('Please enter a name.');
      return;
    }

    if (!user) {
      setFormError('Unable to save this home. Please try again.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const householdId = await getActiveHouseholdId(user.id);
      if (!householdId) {
        setFormError("We couldn't find your household. Please try again.");
        return;
      }

      const created = await createProperty(householdId, {
        name: trimmedName,
        property_type: draft.propertyType || null,
        address: draft.address.trim() || null,
        notes: draft.notes.trim() || null,
      });
      setProperties((current) => [created, ...current]);
      cancelForm();
    } catch (error) {
      if (__DEV__) console.warn('[properties] save failed', error);
      setFormError('Unable to save this home. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (propertyId: string) => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteProperty(propertyId);
      setProperties((current) => current.filter((p) => p.id !== propertyId));
      setConfirmDeleteId(null);
    } catch (error) {
      if (__DEV__) console.warn('[properties] delete failed', error);
      setDeleteError('Unable to delete this home. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  if (status === 'loading') {
    return (
      <Screen>
        <LoadingState message="Loading your homes…" />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen>
        <ErrorState message="Unable to load your homes." onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.back} onPress={() => router.back()}>
          ‹ Back
        </Text>
        <Text style={styles.title}>My Properties</Text>

        {properties.length === 0 && formMode === 'closed' ? (
          <EmptyState
            title="No homes added yet"
            description="Add a home to group appliances, furniture, and more."
          />
        ) : null}

        {properties.map((property) => (
          <View key={property.id} style={styles.item}>
            <Pressable onPress={() => router.push(`/property/${property.id}`)}>
              <Card style={styles.card}>
                <Text style={styles.value}>{property.name}</Text>
                {property.property_type ? (
                  <Text style={styles.label}>{property.property_type}</Text>
                ) : null}
                {describeProperty(property) ? (
                  <Text style={styles.label}>{describeProperty(property)}</Text>
                ) : null}
              </Card>
            </Pressable>
            <View style={styles.actionRow}>
              <Text style={styles.link} onPress={() => setConfirmDeleteId(property.id)}>
                Delete
              </Text>
            </View>
            {confirmDeleteId === property.id ? (
              <View style={styles.confirmRow}>
                <Text style={styles.subtitle}>Delete this home?</Text>
                <Button
                  label={deleting ? 'Deleting…' : 'Delete'}
                  variant="secondary"
                  onPress={() => handleDelete(property.id)}
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
        ))}

        {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}

        {formMode === 'add' ? (
          <View style={styles.form}>
            <Field label="Name *">
              <TextInput
                style={styles.input}
                placeholder="e.g. Home"
                placeholderTextColor={colors.textMuted}
                value={draft.name}
                onChangeText={(value) => updateDraft('name', value)}
                editable={!saving}
                autoFocus
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

            {formError ? <Text style={styles.error}>{formError}</Text> : null}

            <Button
              label={saving ? 'Saving…' : 'Save'}
              onPress={handleSave}
              disabled={saving}
              style={styles.confirmButton}
            />
            <Button label="Cancel" variant="secondary" onPress={cancelForm} disabled={saving} />
          </View>
        ) : null}

        {formMode === 'closed' ? (
          <Button label="+ Add a home" onPress={startAdd} style={styles.button} />
        ) : null}
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
    marginBottom: spacing.md,
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
});
