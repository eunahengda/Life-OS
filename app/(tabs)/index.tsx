import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/auth';
import {
  Button,
  Card,
  ErrorState,
  formatTime12Hour,
  LoadingState,
  Screen,
} from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import { Asset, getActiveHouseholdId, listAssets } from '../../src/features/assets/api';
import {
  acknowledgeAttentionItem,
  AttentionSourceType,
  DashboardFinanceSummary,
  DashboardReminderGroups,
  getDashboardFinanceSummary,
  getDashboardReminderGroups,
  getHomeSectionOrder,
  HOME_SECTION_KEYS,
  HomeSectionKey,
  listExpiredWarranties,
  listOverdueMaintenance,
  listUpcomingMaintenance,
  listUpcomingWarranties,
  setHomeSectionOrder,
  unacknowledgeAttentionItem,
  UpcomingMaintenance,
  UpcomingWarranty,
} from '../../src/features/dashboard/api';
import { VEHICLE_CATEGORY } from '../../src/features/vehicles/api';
import { formatDisplayDate } from '../../src/utils/date';

const HOME_SECTION_LABELS: Record<HomeSectionKey, string> = {
  needs_attention: 'Needs Attention',
  upcoming: 'Upcoming',
  finance: 'Finance',
  recently_added: 'Recently Added',
};

// Falls back to the app's own default order if a stored value is missing,
// unrecognized, or from a future version with sections this build doesn't
// know about — never crashes on a malformed/partial preference, and any
// section this build knows about that's missing from a stored order (e.g. a
// new section added after the user last saved one) is appended rather than
// silently dropped.
function validateSectionOrder(stored: string[] | null): HomeSectionKey[] {
  if (!stored) return [...HOME_SECTION_KEYS];
  const known = stored.filter((key): key is HomeSectionKey =>
    (HOME_SECTION_KEYS as readonly string[]).includes(key),
  );
  const missing = HOME_SECTION_KEYS.filter((key) => !known.includes(key));
  return [...known, ...missing];
}

// How many combined items each section shows at most, regardless of how
// many each individual source contributed — the API layer already caps
// each source on its own; this is the final display-level cap.
const ATTENTION_DISPLAY_LIMIT = 5;
const UPCOMING_DISPLAY_LIMIT = 5;
const RECENT_ASSETS_LIMIT = 5;

const EMPTY_REMINDER_GROUPS: DashboardReminderGroups = { overdue: [], upcoming: [] };

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatMoney(amount: number, currency: string | null): string {
  const value = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  // Task 031: MYR is the app's default currency — never an unlabeled number.
  return `${currency || 'MYR'} ${value}`;
}

// due_at is a timestamptz; the date portion reuses the shared plain-date
// formatter, with only the optional time-of-day suffix handled locally —
// same split the Reminders screen makes, just without that screen's input
// parsing/validation, which the Dashboard (read-only) never needs.
function formatReminderDue(iso: string): string {
  const date = new Date(iso);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateLabel = formatDisplayDate(`${y}-${m}-${d}`);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (hours === 0 && minutes === 0) return dateLabel;
  const time24 = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return `${dateLabel}, ${formatTime12Hour(time24)}`;
}

// Whole calendar days between a plain YYYY-MM-DD date and today. Positive
// means the date is in the future, negative means it's in the past — same
// "ignore time of day" convention as reminders.tsx's own daysOverdue().
function daysFromToday(dateString: string): number {
  const [y, m, d] = dateString.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then.getTime() - todayStart.getTime()) / 86400000);
}

function reminderDaysOverdue(iso: string): number {
  const due = new Date(iso);
  const dueDayStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((todayStart.getTime() - dueDayStart.getTime()) / 86400000);
}

// "today" / "tomorrow" / "in N days" — the short, calm phrasing the product
// spec's own examples use ("Internet bill due tomorrow").
function inDaysLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function overdueByLabel(days: number): string {
  const wholeDays = Math.max(days, 1);
  return `overdue by ${wholeDays} day${wholeDays === 1 ? '' : 's'}`;
}

// Local-midnight timestamp for a plain YYYY-MM-DD date — comparable against
// a reminder's real due_at timestamp, consistent with how every plain date
// on this screen (daysFromToday, reminderDaysOverdue) is already parsed as
// a local calendar date, not UTC.
function dateStringToMs(dateString: string): number {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

type SortableItem = { key: string; sortMs: number; sourcePriority: number };

// Task 027: both Dashboard sections must sort their combined candidates by
// actual urgency before slicing to the display cap, not concatenate by
// category and slice — otherwise an earlier category can push out a
// genuinely more urgent item from a later one. `sourcePriority` (each
// section's original per-category push order) and `key` are deterministic
// tie-breakers only, never the primary ordering.
function compareAscending(a: SortableItem, b: SortableItem): number {
  return a.sortMs - b.sortMs || a.sourcePriority - b.sourcePriority || a.key.localeCompare(b.key);
}

function compareDescending(a: SortableItem, b: SortableItem): number {
  return b.sortMs - a.sortMs || a.sourcePriority - b.sourcePriority || a.key.localeCompare(b.key);
}

type AttentionItem = {
  key: string;
  title: string;
  detail: string;
  onPress: () => void;
  sortMs: number;
  sourcePriority: number;
  // Present only for sources that support acknowledgement (Task 031) —
  // reminders are excluded on purpose, since they already have their own
  // separate completion flow.
  acknowledge?: { sourceType: AttentionSourceType; sourceId: string };
};

type UpcomingItem = {
  key: string;
  title: string;
  detail: string;
  onPress: () => void;
  sortMs: number;
  sourcePriority: number;
};

// The five Quick Add destinations, in the order they stack above the FAB.
// Thing/Vehicle skip straight into their creation mode on the existing Add
// screen via `mode`; Document/Expense/Reminder reuse the exact same
// `autoAdd` deep-link each already supported before this task (see
// app/(tabs)/documents.tsx, finance.tsx, reminders.tsx) — no new navigation
// concept, no duplicate Add flow (Task 030).
const QUICK_ADD_OPTIONS: {
  key: string;
  label: string;
  go: (router: ReturnType<typeof useRouter>) => void;
}[] = [
  {
    key: 'thing',
    label: 'Thing',
    go: (router) => router.push({ pathname: '/add', params: { mode: 'thing' } }),
  },
  {
    key: 'vehicle',
    label: 'Vehicle',
    go: (router) => router.push({ pathname: '/add', params: { mode: 'vehicle' } }),
  },
  {
    key: 'document',
    label: 'Document',
    go: (router) => router.push({ pathname: '/documents', params: { autoAdd: '1' } }),
  },
  {
    key: 'expense',
    label: 'Expense',
    go: (router) => router.push({ pathname: '/finance', params: { autoAdd: '1' } }),
  },
  {
    key: 'reminder',
    label: 'Reminder',
    go: (router) => router.push({ pathname: '/reminders', params: { autoAdd: '1' } }),
  },
];

export default function HomeScreen() {
  const { signOut, user } = useAuth();
  const router = useRouter();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // One clean loading state for the very first load — after that, each
  // section keeps its own error flag so a single failing query never blocks
  // or hides the rest of the Dashboard (each retry re-fetches only its own
  // section, same resilience the current per-section pattern already had).
  const [initializing, setInitializing] = useState(true);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsError, setAssetsError] = useState(false);

  const [financeSummary, setFinanceSummary] = useState<DashboardFinanceSummary | null>(null);
  const [financeError, setFinanceError] = useState(false);

  const [reminderGroups, setReminderGroups] =
    useState<DashboardReminderGroups>(EMPTY_REMINDER_GROUPS);
  const [remindersError, setRemindersError] = useState(false);

  const [expiredWarranties, setExpiredWarranties] = useState<UpcomingWarranty[]>([]);
  const [expiringWarranties, setExpiringWarranties] = useState<UpcomingWarranty[]>([]);
  const [warrantiesError, setWarrantiesError] = useState(false);

  const [overdueMaintenance, setOverdueMaintenance] = useState<UpcomingMaintenance[]>([]);
  const [upcomingMaintenance, setUpcomingMaintenance] = useState<UpcomingMaintenance[]>([]);
  const [maintenanceError, setMaintenanceError] = useState(false);

  // Task 031: Needs Attention dismiss/acknowledge. `dismissingKey` guards
  // against double-taps; `lastDismissed` powers the one-item "Undo" affordance
  // — reversing it deletes the acknowledgement row, never touching the
  // source record either way.
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);
  const [dismissError, setDismissError] = useState(false);
  const [lastDismissed, setLastDismissed] = useState<{
    sourceType: AttentionSourceType;
    sourceId: string;
    title: string;
  } | null>(null);

  // Task 031: Home section order. Loaded from the user's profile; edited in
  // a small "Edit Home" mode via Up/Down moves rather than pointer-drag (see
  // final report — a deliberate simplicity trade-off, not an oversight).
  const [sectionOrder, setSectionOrder] = useState<HomeSectionKey[]>([...HOME_SECTION_KEYS]);
  const savedSectionOrderRef = useRef<HomeSectionKey[]>([...HOME_SECTION_KEYS]);
  const [editingHome, setEditingHome] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderSaveError, setOrderSaveError] = useState(false);

  const loadAssets = useCallback(async () => {
    setAssetsError(false);
    try {
      const data = await listAssets();
      setAssets(data);
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] listAssets failed', error);
      setAssetsError(true);
    }
  }, []);

  const loadFinance = useCallback(async () => {
    setFinanceError(false);
    try {
      const data = await getDashboardFinanceSummary();
      setFinanceSummary(data);
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] getDashboardFinanceSummary failed', error);
      setFinanceError(true);
    }
  }, []);

  const loadReminders = useCallback(async () => {
    setRemindersError(false);
    try {
      const data = await getDashboardReminderGroups();
      setReminderGroups(data);
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] getDashboardReminderGroups failed', error);
      setRemindersError(true);
    }
  }, []);

  const loadWarranties = useCallback(async () => {
    setWarrantiesError(false);
    try {
      const [expired, expiring] = await Promise.all([
        listExpiredWarranties(),
        listUpcomingWarranties(),
      ]);
      setExpiredWarranties(expired);
      setExpiringWarranties(expiring);
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] warranty load failed', error);
      setWarrantiesError(true);
    }
  }, []);

  const loadMaintenance = useCallback(async () => {
    setMaintenanceError(false);
    try {
      const [overdue, upcoming] = await Promise.all([
        listOverdueMaintenance(),
        listUpcomingMaintenance(),
      ]);
      setOverdueMaintenance(overdue);
      setUpcomingMaintenance(upcoming);
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] maintenance load failed', error);
      setMaintenanceError(true);
    }
  }, []);

  const loadSectionOrder = useCallback(async () => {
    if (!user) return;
    try {
      const stored = await getHomeSectionOrder(user.id);
      const validated = validateSectionOrder(stored);
      setSectionOrder(validated);
      savedSectionOrderRef.current = validated;
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] load section order failed', error);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        await Promise.allSettled([
          loadAssets(),
          loadFinance(),
          loadReminders(),
          loadWarranties(),
          loadMaintenance(),
          loadSectionOrder(),
        ]);
        // Only ever transitions true -> false: refocusing the tab refreshes
        // data quietly in the background rather than re-showing the
        // full-screen spinner every time.
        if (!cancelled) setInitializing(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [loadAssets, loadFinance, loadReminders, loadWarranties, loadMaintenance, loadSectionOrder]),
  );

  const handleAcknowledge = async (item: AttentionItem) => {
    if (!item.acknowledge || dismissingKey || !user) return;
    const { sourceType, sourceId } = item.acknowledge;
    setDismissingKey(item.key);
    setDismissError(false);
    try {
      const householdId = await getActiveHouseholdId(user.id);
      if (!householdId) throw new Error('No household found for the signed-in user.');
      await acknowledgeAttentionItem(householdId, sourceType, sourceId);
      setLastDismissed({ sourceType, sourceId, title: item.title });
      // Acknowledgement filtering happens server-side in
      // listExpiredWarranties()/listOverdueMaintenance() — refetching is
      // what makes the item actually disappear from this screen.
      await (sourceType === 'warranty' ? loadWarranties() : loadMaintenance());
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] acknowledge failed', error);
      setDismissError(true);
    } finally {
      setDismissingKey(null);
    }
  };

  const handleUndoAcknowledge = async () => {
    if (!lastDismissed) return;
    const { sourceType, sourceId } = lastDismissed;
    try {
      await unacknowledgeAttentionItem(sourceType, sourceId);
      setLastDismissed(null);
      await (sourceType === 'warranty' ? loadWarranties() : loadMaintenance());
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] unacknowledge failed', error);
    }
  };

  const moveSection = (from: number, to: number) => {
    setSectionOrder((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const handleSaveOrder = async () => {
    if (!user || savingOrder) return;
    setSavingOrder(true);
    setOrderSaveError(false);
    try {
      await setHomeSectionOrder(user.id, sectionOrder);
      savedSectionOrderRef.current = sectionOrder;
      setEditingHome(false);
    } catch (error) {
      if (__DEV__) console.warn('[dashboard] save section order failed', error);
      setOrderSaveError(true);
    } finally {
      setSavingOrder(false);
    }
  };

  const handleCancelEditOrder = () => {
    setSectionOrder(savedSectionOrderRef.current);
    setEditingHome(false);
    setOrderSaveError(false);
  };

  if (initializing) {
    return (
      <Screen>
        <LoadingState message="Loading your LifeOS…" />
      </Screen>
    );
  }

  const attentionItems: AttentionItem[] = [];

  for (const reminder of reminderGroups.overdue) {
    const days = reminder.due_at ? reminderDaysOverdue(reminder.due_at) : 0;
    attentionItems.push({
      key: `reminder-${reminder.id}`,
      title: reminder.title,
      detail: `Overdue · ${days} day${days === 1 ? '' : 's'}`,
      onPress: () => router.push('/reminders'),
      sortMs: reminder.due_at ? new Date(reminder.due_at).getTime() : 0,
      sourcePriority: 0,
    });
  }
  for (const record of overdueMaintenance) {
    attentionItems.push({
      key: `maintenance-${record.id}`,
      title: `${record.assetName} · ${record.name}`,
      detail: `Maintenance ${overdueByLabel(-daysFromToday(record.nextDueDate))}`,
      onPress: () => router.push(`/asset/${record.assetId}`),
      sortMs: dateStringToMs(record.nextDueDate),
      sourcePriority: 1,
      acknowledge: { sourceType: 'maintenance_record', sourceId: record.id },
    });
  }
  for (const warranty of expiredWarranties) {
    const days = -daysFromToday(warranty.expiryDate);
    attentionItems.push({
      key: `warranty-${warranty.id}`,
      title: `${warranty.assetName} · ${warranty.name ?? 'Warranty'}`,
      detail: `Warranty expired ${days} day${days === 1 ? '' : 's'} ago`,
      onPress: () => router.push(`/asset/${warranty.assetId}`),
      sortMs: dateStringToMs(warranty.expiryDate),
      sourcePriority: 2,
      acknowledge: { sourceType: 'warranty', sourceId: warranty.id },
    });
  }

  // Sort before slicing (Task 027): most-recently-occurred first across ALL
  // sources, not "earliest-pushed category wins" — matches the ordering
  // rationale already documented on listExpiredWarranties() in
  // dashboard/api.ts (a problem that just happened is more actionable than
  // one that's been sitting for months), applied consistently everywhere.
  attentionItems.sort(compareDescending);
  const visibleAttentionItems = attentionItems.slice(0, ATTENTION_DISPLAY_LIMIT);

  const upcomingItems: UpcomingItem[] = [];

  for (const reminder of reminderGroups.upcoming) {
    upcomingItems.push({
      key: `reminder-${reminder.id}`,
      title: reminder.title,
      detail: reminder.due_at ? formatReminderDue(reminder.due_at) : 'No due date',
      onPress: () => router.push('/reminders'),
      // No due date is never treated as urgent — it sorts after every
      // dated item, never artificially promoted (Task 027).
      sortMs: reminder.due_at ? new Date(reminder.due_at).getTime() : Number.POSITIVE_INFINITY,
      sourcePriority: 0,
    });
  }
  for (const warranty of expiringWarranties) {
    upcomingItems.push({
      key: `warranty-${warranty.id}`,
      title: `${warranty.assetName} · ${warranty.name ?? 'Warranty'}`,
      detail: `Warranty expires ${inDaysLabel(daysFromToday(warranty.expiryDate))}`,
      onPress: () => router.push(`/asset/${warranty.assetId}`),
      sortMs: dateStringToMs(warranty.expiryDate),
      sourcePriority: 1,
    });
  }
  for (const record of upcomingMaintenance) {
    upcomingItems.push({
      key: `maintenance-${record.id}`,
      title: `${record.assetName} · ${record.name}`,
      detail: `Due ${inDaysLabel(daysFromToday(record.nextDueDate))}`,
      onPress: () => router.push(`/asset/${record.assetId}`),
      sortMs: dateStringToMs(record.nextDueDate),
      sourcePriority: 2,
    });
  }
  for (const expense of financeSummary?.dueSoon ?? []) {
    upcomingItems.push({
      key: `expense-${expense.id}`,
      title: expense.name,
      detail: `Due ${inDaysLabel(daysFromToday(expense.nextPaymentDate))}`,
      onPress: () => router.push('/finance'),
      sortMs: dateStringToMs(expense.nextPaymentDate),
      sourcePriority: 3,
    });
  }

  // Sort before slicing (Task 027): genuinely soonest-due item first across
  // ALL sources, not "earliest-pushed category wins".
  upcomingItems.sort(compareAscending);
  const visibleUpcomingItems = upcomingItems.slice(0, UPCOMING_DISPLAY_LIMIT);

  const recentAssets = assets.slice(0, RECENT_ASSETS_LIMIT);
  const hasAnySectionError =
    assetsError || financeError || remindersError || warrantiesError || maintenanceError;

  const sectionRenderers: Record<HomeSectionKey, () => React.ReactNode> = {
    needs_attention: () => (
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Needs Attention</Text>
        {remindersError || maintenanceError || warrantiesError ? (
          <ErrorState
            message="Unable to load everything that needs attention."
            onRetry={() => {
              void loadReminders();
              void loadMaintenance();
              void loadWarranties();
            }}
          />
        ) : visibleAttentionItems.length === 0 ? (
          <Text style={styles.calmText}>You&rsquo;re all caught up.</Text>
        ) : (
          <>
            {visibleAttentionItems.map((item) => (
              <View key={item.key} style={styles.attentionRow}>
                <Pressable style={styles.attentionMain} onPress={item.onPress}>
                  <Text style={styles.value}>{item.title}</Text>
                  <Text style={styles.attentionDetail}>{item.detail}</Text>
                </Pressable>
                {item.acknowledge ? (
                  <Text
                    style={styles.dismissLink}
                    onPress={dismissingKey ? undefined : () => void handleAcknowledge(item)}
                  >
                    {dismissingKey === item.key ? 'Dismissing…' : 'Dismiss'}
                  </Text>
                ) : null}
              </View>
            ))}
            {lastDismissed ? (
              <Pressable onPress={() => void handleUndoAcknowledge()}>
                <Text style={styles.undoText}>
                  Dismissed &ldquo;{lastDismissed.title}&rdquo;. Undo
                </Text>
              </Pressable>
            ) : null}
            {dismissError ? (
              <Text style={styles.error}>Unable to dismiss. Please try again.</Text>
            ) : null}
          </>
        )}
      </Card>
    ),
    upcoming: () => (
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Upcoming</Text>
        {remindersError || maintenanceError || warrantiesError || financeError ? (
          <ErrorState
            message="Unable to load upcoming items."
            onRetry={() => {
              void loadReminders();
              void loadMaintenance();
              void loadWarranties();
              void loadFinance();
            }}
          />
        ) : visibleUpcomingItems.length === 0 ? (
          <Text style={styles.calmText}>Nothing upcoming.</Text>
        ) : (
          <>
            {visibleUpcomingItems.map((item) => (
              <Pressable key={item.key} onPress={item.onPress}>
                <View style={styles.row}>
                  <Text style={styles.value}>{item.title}</Text>
                  <Text style={styles.label}>{item.detail}</Text>
                </View>
              </Pressable>
            ))}
            {upcomingItems.length > visibleUpcomingItems.length ? (
              <Text style={styles.viewAll} onPress={() => router.push('/reminders')}>
                View all →
              </Text>
            ) : null}
          </>
        )}
      </Card>
    ),
    finance: () => (
      <Pressable onPress={() => router.push('/finance')}>
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Finance</Text>
          {financeError ? (
            <ErrorState message="Unable to load your finances." onRetry={loadFinance} />
          ) : null}
          {!financeError && financeSummary ? (
            <>
              <Text style={styles.bigValue}>
                {formatMoney(financeSummary.monthlyTotal, financeSummary.currency)} / month
              </Text>
              <Text style={styles.secondaryValue}>
                {formatMoney(financeSummary.annualTotal, financeSummary.currency)} / year
              </Text>
              <Text style={styles.viewAll}>View finance →</Text>
            </>
          ) : null}
        </Card>
      </Pressable>
    ),
    recently_added: () => (
      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Recently Added</Text>
        {assetsError ? (
          <ErrorState message="Unable to load your things." onRetry={loadAssets} />
        ) : null}
        {!assetsError && assets.length === 0 ? (
          <>
            <Text style={styles.calmText}>Nothing added yet.</Text>
            <Button
              label="Add your first thing"
              variant="secondary"
              onPress={() => router.push('/add')}
              style={styles.addFirstButton}
            />
          </>
        ) : null}
        {!assetsError &&
          recentAssets.map((asset) => {
            const subtitle = asset.category === VEHICLE_CATEGORY ? 'Vehicle' : asset.user_category;
            return (
              <Pressable key={asset.id} onPress={() => router.push(`/asset/${asset.id}`)}>
                <View style={styles.row}>
                  <Text style={styles.value}>{asset.name}</Text>
                  {subtitle ? <Text style={styles.label}>{subtitle}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        {!assetsError && assets.length > 0 ? (
          <Text style={styles.viewAll} onPress={() => router.push('/life')}>
            View all →
          </Text>
        ) : null}
      </Card>
    ),
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.appName}>Your LifeOS</Text>
          </View>
          {!editingHome ? (
            <Text style={styles.editHomeLink} onPress={() => setEditingHome(true)}>
              Edit Home
            </Text>
          ) : null}
        </View>

        <Pressable
          style={styles.searchBar}
          onPress={() => router.push('/search')}
          accessibilityRole="search"
          accessibilityLabel="Search LifeOS"
        >
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchPlaceholder}>Search LifeOS</Text>
        </Pressable>

        {editingHome ? (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Reorder sections</Text>
            {sectionOrder.map((key, index) => (
              <View key={key} style={styles.reorderRow}>
                <Text style={styles.value}>{HOME_SECTION_LABELS[key]}</Text>
                <View style={styles.reorderArrows}>
                  <Text
                    style={[styles.reorderArrow, index === 0 && styles.reorderArrowDisabled]}
                    onPress={index === 0 ? undefined : () => moveSection(index, index - 1)}
                  >
                    ↑
                  </Text>
                  <Text
                    style={[
                      styles.reorderArrow,
                      index === sectionOrder.length - 1 && styles.reorderArrowDisabled,
                    ]}
                    onPress={
                      index === sectionOrder.length - 1
                        ? undefined
                        : () => moveSection(index, index + 1)
                    }
                  >
                    ↓
                  </Text>
                </View>
              </View>
            ))}
            {orderSaveError ? (
              <Text style={styles.error}>Unable to save this order. Please try again.</Text>
            ) : null}
            <Button
              label={savingOrder ? 'Saving…' : 'Save order'}
              onPress={handleSaveOrder}
              disabled={savingOrder}
              style={styles.confirmButton}
            />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={handleCancelEditOrder}
              disabled={savingOrder}
            />
          </Card>
        ) : (
          sectionOrder.map((key) => <View key={key}>{sectionRenderers[key]()}</View>)
        )}

        {hasAnySectionError ? (
          <Text style={styles.footerNote}>
            Some parts of your Dashboard couldn&rsquo;t load. Pull down or retry above.
          </Text>
        ) : null}

        <Button
          label="Sign Out"
          variant="secondary"
          onPress={() => {
            signOut().catch((error: unknown) => {
              if (__DEV__) console.warn('[auth] sign out failed', error);
            });
          }}
          style={styles.signOut}
        />
      </ScrollView>

      {quickAddOpen ? (
        <Pressable
          style={styles.fabBackdrop}
          onPress={() => setQuickAddOpen(false)}
          accessibilityLabel="Close quick add menu"
        />
      ) : null}

      {quickAddOpen ? (
        <View style={styles.fabMenu}>
          {QUICK_ADD_OPTIONS.map((option) => (
            <Pressable
              key={option.key}
              style={styles.fabMenuItem}
              onPress={() => {
                setQuickAddOpen(false);
                option.go(router);
              }}
            >
              <Text style={styles.fabMenuLabel}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Pressable
        style={styles.fab}
        onPress={() => setQuickAddOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={quickAddOpen ? 'Close quick add menu' : 'Quick add'}
      >
        <Text style={styles.fabIcon}>{quickAddOpen ? '×' : '+'}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  appName: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
    marginBottom: spacing.lg,
  },
  card: {
    padding: spacing.md,
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
  bigValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  secondaryValue: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  viewAll: {
    color: colors.primary,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  calmText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  row: {
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
  attentionDetail: {
    fontSize: 13,
    color: colors.danger,
    marginTop: spacing.xs / 2,
  },
  attentionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  attentionMain: {
    flex: 1,
  },
  dismissLink: {
    color: colors.primary,
    fontSize: 13,
  },
  undoText: {
    color: colors.primary,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  editHomeLink: {
    color: colors.primary,
    fontSize: 14,
    marginTop: spacing.xs / 2,
  },
  reorderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reorderArrows: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  reorderArrow: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '700',
  },
  reorderArrowDisabled: {
    color: colors.border,
  },
  confirmButton: {
    marginTop: spacing.sm,
  },
  addFirstButton: {
    marginTop: spacing.sm,
  },
  footerNote: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  signOut: {
    marginTop: spacing.sm,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    marginBottom: spacing.lg,
  },
  searchIcon: {
    fontSize: 18,
    color: colors.textMuted,
  },
  searchPlaceholder: {
    fontSize: 16,
    color: colors.textMuted,
  },
  fab: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabIcon: {
    color: colors.primaryText,
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 32,
  },
  fabBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fabMenu: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md + 56 + spacing.sm,
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  fabMenuItem: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  fabMenuLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
