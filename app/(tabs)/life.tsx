import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { Card, EmptyState, ErrorState, LoadingState, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import { Asset, listAssets } from '../../src/features/assets/api';
import { VEHICLE_CATEGORY } from '../../src/features/vehicles/api';

type Status = 'loading' | 'loaded' | 'error';

// Vehicle specialization (assets.category) and the user's own organizational
// category (assets.user_category) are independent — see Task 016. Blends
// them into one secondary line without crowding the row: "Vehicle · Vehicles",
// just "Vehicle", just the category, or nothing at all.
function secondaryLabel(asset: Asset): string | null {
  const isVehicle = asset.category === VEHICLE_CATEGORY;
  if (isVehicle && asset.user_category) return `Vehicle · ${asset.user_category}`;
  if (isVehicle) return 'Vehicle';
  return asset.user_category ?? null;
}

export default function LifeScreen() {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await listAssets();
      setAssets(data);
      setStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[assets] list failed', error);
      setStatus('error');
    }
  }, []);

  // Refetch every time this tab regains focus (e.g. after adding a thing
  // from the Add tab), since tab screens stay mounted in the background.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (status === 'loading') {
    return (
      <Screen>
        <LoadingState message="Loading your things…" />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen>
        <ErrorState message="Unable to load your things." onRetry={load} />
      </Screen>
    );
  }

  if (assets.length === 0) {
    return (
      <Screen>
        <Text style={styles.title}>Life</Text>
        <Text style={styles.propertiesLink} onPress={() => router.push('/properties')}>
          Properties →
        </Text>
        <EmptyState
          title="Nothing added yet"
          description="Tap Add to record the first thing you own."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Life</Text>
      <Text style={styles.propertiesLink} onPress={() => router.push('/properties')}>
        Properties →
      </Text>
      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/asset/${item.id}`)}>
            <Card style={styles.card}>
              <Text style={styles.assetName}>{item.name}</Text>
              {secondaryLabel(item) ? (
                <Text style={styles.assetLabel}>{secondaryLabel(item)}</Text>
              ) : null}
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  propertiesLink: {
    color: colors.primary,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    padding: spacing.md,
  },
  assetName: {
    fontSize: 16,
    color: colors.text,
  },
  assetLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
});
