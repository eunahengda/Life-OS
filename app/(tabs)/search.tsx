import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, EmptyState, ErrorState, LoadingState, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import {
  AssetSearchResult,
  DocumentSearchResult,
  ReminderSearchResult,
  search,
  SearchResults,
} from '../../src/features/search/api';

type Status = 'loading' | 'loaded' | 'error';

const DEBOUNCE_MS = 300;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function assetLabel(asset: AssetSearchResult): string | null {
  if (asset.isVehicle) {
    const details = [asset.vehicleMake, asset.vehicleModel].filter(Boolean).join(' ');
    return details ? `Vehicle · ${details}` : 'Vehicle';
  }
  return asset.userCategory;
}

// Mirrors describeDocument() in app/asset/[id].tsx — the documents bucket
// only ever accepts PDF/JPEG/PNG/WebP, so "not a PDF" reliably means image.
function describeDocument(document: DocumentSearchResult): string {
  return document.mimeType === 'application/pdf' ? 'PDF' : 'Image';
}

// A compact, date-only rendering of a reminder's due_at for a search result
// row — this screen has no need for the Reminders screen's own overdue/
// time-of-day handling, just a quick "is this the one I meant" cue.
function formatReminderDue(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function reminderLabel(reminder: ReminderSearchResult): string | null {
  return reminder.due_at ? `Due ${formatReminderDue(reminder.due_at)}` : null;
}

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('loaded');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const requestIdRef = useRef(0);

  const isIdle = query.trim().length === 0;

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      // Invalidate any in-flight search so a stale response can't land
      // after the user has already cleared the box. Nothing to set here —
      // `isIdle` (derived straight from `query`) is what the render below
      // actually keys off, so there's no status/results to reset in sync.
      requestIdRef.current += 1;
      return;
    }

    const requestId = ++requestIdRef.current;
    const timeoutId = setTimeout(() => {
      setStatus('loading');
      search(trimmed)
        .then((data) => {
          if (requestIdRef.current !== requestId) return;
          setResults(data);
          setStatus('loaded');
        })
        .catch((error) => {
          if (requestIdRef.current !== requestId) return;
          if (__DEV__) console.warn('[search] search failed', error);
          setResults(null);
          setStatus('error');
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [query, retryToken]);

  const hasNoResults =
    !isIdle &&
    status === 'loaded' &&
    results !== null &&
    results.assets.length === 0 &&
    results.documents.length === 0 &&
    results.warranties.length === 0 &&
    results.maintenance.length === 0 &&
    results.properties.length === 0 &&
    results.reminders.length === 0 &&
    results.expenses.length === 0;

  return (
    <Screen>
      <Text style={styles.title}>Search</Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Search LifeOS"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
        />
        {query.length > 0 ? (
          <Text style={styles.clearButton} onPress={() => setQuery('')}>
            ✕
          </Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {isIdle ? (
          <EmptyState
            title="Search your LifeOS"
            description="Find things, vehicles, documents and more."
          />
        ) : null}

        {!isIdle && status === 'loading' ? <LoadingState message="Searching…" /> : null}

        {!isIdle && status === 'error' ? (
          <ErrorState
            message="Something went wrong. Please try again."
            onRetry={() => setRetryToken((t) => t + 1)}
          />
        ) : null}

        {hasNoResults ? (
          <View style={styles.noResults}>
            <Text style={styles.noResultsTitle}>No results found</Text>
            <Text style={styles.noResultsSubtitle}>Try a different search.</Text>
          </View>
        ) : null}

        {!isIdle && status === 'loaded' && results && results.assets.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Things</Text>
            {results.assets.map((asset) => (
              <Pressable key={asset.id} onPress={() => router.push(`/asset/${asset.id}`)}>
                <Card style={styles.card}>
                  <Text style={styles.value}>{asset.name}</Text>
                  {assetLabel(asset) ? <Text style={styles.label}>{assetLabel(asset)}</Text> : null}
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isIdle && status === 'loaded' && results && results.documents.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Documents</Text>
            {results.documents.map((document) => (
              <Pressable
                key={document.id}
                onPress={() => {
                  if (document.assetId) router.push(`/asset/${document.assetId}`);
                }}
              >
                <Card style={styles.card}>
                  <Text style={styles.value}>{document.name}</Text>
                  <Text style={styles.label}>{describeDocument(document)}</Text>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isIdle && status === 'loaded' && results && results.warranties.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Warranty</Text>
            {results.warranties.map((warranty) => (
              <Pressable
                key={warranty.id}
                onPress={() => router.push(`/asset/${warranty.assetId}`)}
              >
                <Card style={styles.card}>
                  <Text style={styles.value}>{warranty.name ?? 'Warranty'}</Text>
                  <Text style={styles.label}>
                    {warranty.assetName}
                    {warranty.provider ? ` · ${warranty.provider}` : ''}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isIdle && status === 'loaded' && results && results.maintenance.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Maintenance</Text>
            {results.maintenance.map((record) => (
              <Pressable key={record.id} onPress={() => router.push(`/asset/${record.assetId}`)}>
                <Card style={styles.card}>
                  <Text style={styles.value}>{record.name}</Text>
                  <Text style={styles.label}>
                    {record.assetName}
                    {record.provider ? ` · ${record.provider}` : ''}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isIdle && status === 'loaded' && results && results.properties.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Properties</Text>
            {results.properties.map((property) => (
              <Pressable key={property.id} onPress={() => router.push(`/property/${property.id}`)}>
                <Card style={styles.card}>
                  <Text style={styles.value}>Property · {property.name}</Text>
                  {property.address ? <Text style={styles.label}>{property.address}</Text> : null}
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isIdle && status === 'loaded' && results && results.reminders.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reminders</Text>
            {results.reminders.map((reminder) => (
              <Pressable key={reminder.id} onPress={() => router.push('/reminders')}>
                <Card style={styles.card}>
                  <Text style={styles.value}>Reminder · {reminder.title}</Text>
                  {reminderLabel(reminder) ? (
                    <Text style={styles.label}>{reminderLabel(reminder)}</Text>
                  ) : null}
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isIdle && status === 'loaded' && results && results.expenses.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Expenses</Text>
            {results.expenses.map((expense) => (
              <Pressable key={expense.id} onPress={() => router.push('/finance')}>
                <Card style={styles.card}>
                  <Text style={styles.value}>Expense · {expense.name}</Text>
                  {expense.category ? <Text style={styles.label}>{expense.category}</Text> : null}
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm + 4,
    fontSize: 16,
    color: colors.text,
  },
  clearButton: {
    fontSize: 16,
    color: colors.textMuted,
    paddingLeft: spacing.sm,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
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
  noResults: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  noResultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  noResultsSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
});
