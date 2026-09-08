import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../src/auth';
import { Button, Card, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import {
  ASSET_CATEGORIES,
  createAsset,
  deleteAsset,
  getActiveHouseholdId,
} from '../../src/features/assets/api';
import { listProperties, Property } from '../../src/features/properties/api';
import { createVehicle, MILEAGE_UNITS, VEHICLE_CATEGORY } from '../../src/features/vehicles/api';

type Status = 'idle' | 'submitting' | 'success' | 'error';
// 'menu' is the launcher itself; 'thing'/'vehicle' are the two creation
// flows that live directly on this screen (see the module comment below for
// why Document/Expense/Reminder are handled differently).
type Mode = 'menu' | 'thing' | 'vehicle';

const GENERIC_SAVE_ERROR = 'Unable to save this item. Please try again.';

type VehicleDraft = {
  make: string;
  model: string;
  year: string;
  licensePlate: string;
  vin: string;
  currentMileage: string;
  mileageUnit: string;
};

const EMPTY_VEHICLE_DRAFT: VehicleDraft = {
  make: '',
  model: '',
  year: '',
  licensePlate: '',
  vin: '',
  currentMileage: '',
  mileageUnit: 'km',
};

type AddOption = {
  key: 'thing' | 'vehicle' | 'document' | 'expense' | 'reminder';
  label: string;
  description: string;
};

// Thing and Vehicle are handled right here (they already were, before this
// task — see below). Document, Expense, and Reminder already have their own
// complete, working creation flows on their own tabs; this screen is just
// the entry point that sends the user there with that tab's own "add" form
// already open — see the autoAdd param each of those screens reads.
const ADD_OPTIONS: AddOption[] = [
  {
    key: 'thing',
    label: 'Thing',
    description: 'Something you own — an appliance, gadget, or item.',
  },
  { key: 'vehicle', label: 'Vehicle', description: 'A car, motorcycle, or other vehicle.' },
  {
    key: 'document',
    label: 'Document',
    description: 'A receipt, warranty, manual, or other file.',
  },
  {
    key: 'expense',
    label: 'Expense',
    description: 'A subscription, bill, or other recurring payment.',
  },
  {
    key: 'reminder',
    label: 'Reminder',
    description: 'Something to remember, with an optional date.',
  },
];

export default function AddScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { mode: initialMode } = useLocalSearchParams<{ mode?: string }>();

  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [userCategory, setUserCategory] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [vehicleDraft, setVehicleDraft] = useState<VehicleDraft>(EMPTY_VEHICLE_DRAFT);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [savedName, setSavedName] = useState('');
  const [savedAssetId, setSavedAssetId] = useState('');

  const isSubmitting = status === 'submitting';

  // Fetched once on mount rather than per-mode-switch — the list is small
  // and this screen has no other data-loading effect to piggyback on.
  useEffect(() => {
    listProperties()
      .then(setProperties)
      .catch((error) => {
        if (__DEV__) console.warn('[properties] list failed', error);
      });
  }, []);

  // Lets the Home FAB's Quick Add menu open this screen straight into the
  // Thing/Vehicle form, skipping the menu tap. Expo Router keeps this tab
  // screen mounted across FAB navigations (e.g. Thing then, later, Vehicle),
  // so the guard tracks the last *value* it applied rather than a one-shot
  // boolean — otherwise a second FAB tap with a different mode would be
  // silently ignored because the screen was never remounted.
  const appliedInitialMode = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      initialMode &&
      initialMode !== appliedInitialMode.current &&
      (initialMode === 'thing' || initialMode === 'vehicle')
    ) {
      appliedInitialMode.current = initialMode;
      setMode(initialMode);
    }
  }, [initialMode]);

  const reset = () => {
    setMode('menu');
    setName('');
    setUserCategory(null);
    setPropertyId(null);
    setVehicleDraft(EMPTY_VEHICLE_DRAFT);
    setStatus('idle');
    setErrorMessage('');
    setSavedName('');
    setSavedAssetId('');
  };

  const backToMenu = () => {
    setMode('menu');
    setName('');
    setUserCategory(null);
    setPropertyId(null);
    setVehicleDraft(EMPTY_VEHICLE_DRAFT);
    setStatus('idle');
    setErrorMessage('');
  };

  const updateVehicleDraft = (field: keyof VehicleDraft, value: string) => {
    setVehicleDraft((current) => ({ ...current, [field]: value }));
  };

  const handleDone = () => {
    reset();
    router.push('/');
  };

  const handleAddDetails = () => {
    const assetId = savedAssetId;
    reset();
    router.push(`/asset/${assetId}`);
  };

  const handleSelectOption = (key: AddOption['key']) => {
    if (key === 'thing' || key === 'vehicle') {
      setMode(key);
      return;
    }
    // Document/Expense/Reminder already have complete creation flows on
    // their own tabs — this just opens that tab with its own "add" form
    // already showing, instead of duplicating any of that logic here.
    const destination =
      key === 'document' ? '/documents' : key === 'expense' ? '/finance' : '/reminders';
    router.push({ pathname: destination, params: { autoAdd: '1' } });
  };

  const handleSave = async () => {
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus('error');
      setErrorMessage('Please enter a name.');
      return;
    }

    let year: number | null = null;
    let currentMileage: number | null = null;

    if (mode === 'vehicle') {
      const trimmedYear = vehicleDraft.year.trim();
      if (trimmedYear) {
        year = Number(trimmedYear);
        const currentYear = new Date().getFullYear();
        if (!Number.isInteger(year) || year < 1900 || year > currentYear + 1) {
          setStatus('error');
          setErrorMessage('Please enter a valid year.');
          return;
        }
      }

      const trimmedMileage = vehicleDraft.currentMileage.trim();
      if (trimmedMileage) {
        currentMileage = Number(trimmedMileage);
        if (!Number.isFinite(currentMileage) || currentMileage < 0) {
          setStatus('error');
          setErrorMessage('Please enter a valid mileage.');
          return;
        }
      }
    }

    if (!user) {
      // The (tabs) route group is only reachable while signed in, so this
      // should not happen in practice.
      setStatus('error');
      setErrorMessage(GENERIC_SAVE_ERROR);
      return;
    }

    setStatus('submitting');
    try {
      const householdId = await getActiveHouseholdId(user.id);
      if (!householdId) {
        setStatus('error');
        setErrorMessage("We couldn't find your household. Please try again.");
        return;
      }

      const asset = await createAsset(
        householdId,
        trimmedName,
        mode === 'vehicle' ? VEHICLE_CATEGORY : null,
        userCategory,
        propertyId,
      );

      if (mode === 'vehicle') {
        try {
          await createVehicle(asset.id, {
            make: vehicleDraft.make.trim() || null,
            model: vehicleDraft.model.trim() || null,
            year,
            license_plate: vehicleDraft.licensePlate.trim() || null,
            vin: vehicleDraft.vin.trim() || null,
            current_mileage: currentMileage,
            mileage_unit: vehicleDraft.mileageUnit,
          });
        } catch (vehicleError) {
          if (__DEV__) console.warn('[vehicles] create failed', vehicleError);
          try {
            await deleteAsset(asset.id);
          } catch (cleanupError) {
            if (__DEV__) {
              console.warn('[vehicles] compensating asset cleanup also failed', cleanupError);
            }
            setStatus('error');
            setErrorMessage(
              'Unable to save this vehicle, and the partially created item could not be cleaned up automatically. Please check Life and remove it manually if it appears.',
            );
            return;
          }
          setStatus('error');
          setErrorMessage('Unable to save this vehicle. Please try again.');
          return;
        }
      }

      setSavedName(asset.name);
      setSavedAssetId(asset.id);
      setStatus('success');
    } catch (error) {
      if (__DEV__) console.warn('[assets] create failed', error);
      setStatus('error');
      setErrorMessage(GENERIC_SAVE_ERROR);
    }
  };

  if (status === 'success') {
    return (
      <Screen style={styles.container}>
        <Text style={styles.title}>&ldquo;{savedName}&rdquo; added</Text>
        <Text style={styles.subtitle}>Want to add more details?</Text>
        <Button label="Add details" onPress={handleAddDetails} style={styles.button} />
        <Button label="Done" variant="secondary" onPress={handleDone} />
      </Screen>
    );
  }

  if (mode === 'menu') {
    return (
      <Screen>
        <Text style={styles.title}>Add</Text>
        <Text style={styles.subtitle}>What would you like to add?</Text>

        {ADD_OPTIONS.map((option) => (
          <Pressable key={option.key} onPress={() => handleSelectOption(option.key)}>
            <Card style={styles.optionCard}>
              <Text style={styles.optionLabel}>{option.label}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </Card>
          </Pressable>
        ))}
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      <Text style={styles.back} onPress={backToMenu}>
        ‹ Back
      </Text>
      <Text style={styles.title}>{mode === 'vehicle' ? 'Add Vehicle' : 'Add Thing'}</Text>
      <Text style={styles.subtitle}>Keep it simple. You can add more details later.</Text>

      <TextInput
        style={styles.input}
        placeholder={mode === 'vehicle' ? 'e.g. Toyota Camry' : 'e.g. Samsung Washing Machine'}
        placeholderTextColor={colors.textMuted}
        value={name}
        onChangeText={setName}
        editable={!isSubmitting}
        autoFocus
      />

      {mode === 'vehicle' ? (
        <View style={styles.vehicleFields}>
          <TextInput
            style={styles.input}
            placeholder="Make (optional)"
            placeholderTextColor={colors.textMuted}
            value={vehicleDraft.make}
            onChangeText={(value) => updateVehicleDraft('make', value)}
            editable={!isSubmitting}
          />
          <TextInput
            style={styles.input}
            placeholder="Model (optional)"
            placeholderTextColor={colors.textMuted}
            value={vehicleDraft.model}
            onChangeText={(value) => updateVehicleDraft('model', value)}
            editable={!isSubmitting}
          />
          <TextInput
            style={styles.input}
            placeholder="Year (optional)"
            placeholderTextColor={colors.textMuted}
            value={vehicleDraft.year}
            onChangeText={(value) => updateVehicleDraft('year', value)}
            keyboardType="number-pad"
            editable={!isSubmitting}
          />
          <TextInput
            style={styles.input}
            placeholder="Plate Number (optional)"
            placeholderTextColor={colors.textMuted}
            value={vehicleDraft.licensePlate}
            onChangeText={(value) => updateVehicleDraft('licensePlate', value)}
            autoCapitalize="characters"
            editable={!isSubmitting}
          />
          <TextInput
            style={styles.input}
            placeholder="VIN (optional)"
            placeholderTextColor={colors.textMuted}
            value={vehicleDraft.vin}
            onChangeText={(value) => updateVehicleDraft('vin', value)}
            autoCapitalize="characters"
            editable={!isSubmitting}
          />
          <TextInput
            style={styles.input}
            placeholder="Current Mileage (optional)"
            placeholderTextColor={colors.textMuted}
            value={vehicleDraft.currentMileage}
            onChangeText={(value) => updateVehicleDraft('currentMileage', value)}
            keyboardType="decimal-pad"
            editable={!isSubmitting}
          />
          <View style={styles.mileageUnitRow}>
            {MILEAGE_UNITS.map((unit) => (
              <Button
                key={unit}
                label={unit}
                variant={vehicleDraft.mileageUnit === unit ? 'primary' : 'secondary'}
                onPress={() => updateVehicleDraft('mileageUnit', unit)}
                disabled={isSubmitting}
                style={styles.mileageUnitButton}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.categorySection}>
        <Text style={styles.fieldLabel}>Category (optional)</Text>
        <View style={styles.categoryRow}>
          <Button
            label="None"
            variant={userCategory === null ? 'primary' : 'secondary'}
            onPress={() => setUserCategory(null)}
            disabled={isSubmitting}
            style={styles.categoryButton}
          />
          {ASSET_CATEGORIES.map((category) => (
            <Button
              key={category}
              label={category}
              variant={userCategory === category ? 'primary' : 'secondary'}
              onPress={() => setUserCategory(category)}
              disabled={isSubmitting}
              style={styles.categoryButton}
            />
          ))}
        </View>
      </View>

      {properties.length > 0 ? (
        <View style={styles.categorySection}>
          <Text style={styles.fieldLabel}>Property (optional)</Text>
          <View style={styles.categoryRow}>
            <Button
              label="None"
              variant={propertyId === null ? 'primary' : 'secondary'}
              onPress={() => setPropertyId(null)}
              disabled={isSubmitting}
              style={styles.categoryButton}
            />
            {properties.map((property) => (
              <Button
                key={property.id}
                label={property.name}
                variant={propertyId === property.id ? 'primary' : 'secondary'}
                onPress={() => setPropertyId(property.id)}
                disabled={isSubmitting}
                style={styles.categoryButton}
              />
            ))}
          </View>
        </View>
      ) : null}

      {status === 'error' ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Button
        label={isSubmitting ? 'Saving…' : 'Save'}
        onPress={handleSave}
        disabled={isSubmitting}
        style={styles.button}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  back: {
    color: colors.primary,
    fontSize: 16,
    textAlign: 'left',
    marginBottom: spacing.sm,
  },
  optionCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  optionDescription: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  vehicleFields: {
    gap: spacing.sm,
  },
  mileageUnitRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  mileageUnitButton: {
    flex: 1,
    marginTop: 0,
  },
  categorySection: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  categoryButton: {
    marginTop: 0,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.xs,
  },
});
