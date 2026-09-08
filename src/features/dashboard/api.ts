import { supabase } from '../../lib/supabase/client';
import { listRecurringExpenses, monthlyCost, annualCost } from '../finance/api';
import { groupReminders, listReminders, Reminder } from '../reminders/api';

const UPCOMING_WINDOW_DAYS = 30;
// Per-source fetch size before the Dashboard combines and sorts across all
// four Upcoming sources (see app/(tabs)/index.tsx, Task 027) — must be at
// least UPCOMING_DISPLAY_LIMIT so a single source with several genuinely
// soonest items is never pre-truncated below what the final cross-category
// top-N selection needs. The user-visible display cap itself is unchanged.
const UPCOMING_LIMIT = 5;
// Caps each Needs Attention source individually before the Dashboard
// combines them — keeps the section "compact" per the product spec even if
// a household has many overdue items. Raised from 5 to 20 in Task 031: an
// acknowledged item is filtered out of listExpiredWarranties()/
// listOverdueMaintenance() *after* this fetch, so the raw pre-filter cap
// needs enough headroom that a handful of dismissed items can't silently
// starve the final display list below its own 5-item cap.
const NEEDS_ATTENTION_LIMIT = 20;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Local calendar date, not UTC — consistent with how every plain `date`
// column elsewhere in the app is treated (see src/utils/date.ts).
function todayDateString(): string {
  return toDateString(new Date());
}

function addDaysDateString(base: string, days: number): string {
  const [year, month, day] = base.split('-').map(Number);
  // JS Date normalizes day overflow correctly (e.g. day 35 rolls into the
  // next month), so this stays correct across month/year boundaries.
  return toDateString(new Date(year, month - 1, day + days));
}

// Task 031: sources that can be dismissed from Needs Attention without
// touching the underlying record. Reminders are deliberately excluded —
// they already have their own completion flow (Mark done), which must stay
// a separate concept from this acknowledgement.
export type AttentionSourceType = 'warranty' | 'maintenance_record';

/**
 * Source ids the household has already acknowledged/dismissed, for one
 * source type. RLS (household_id-scoped, same as recurring_expenses) means
 * this can never see another household's acknowledgements.
 */
async function listAcknowledgedSourceIds(sourceType: AttentionSourceType): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('attention_acknowledgements')
    .select('source_id')
    .eq('source_type', sourceType);

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.source_id));
}

/**
 * Dismisses one Needs Attention item. This only ever writes to
 * attention_acknowledgements — never to the warranty/maintenance_record
 * itself, which is the whole point: "expired" (system state) and
 * "acknowledged" (user's seen it) are independent facts. Upsert so
 * re-acknowledging an already-acknowledged item is a harmless no-op rather
 * than a unique-constraint error.
 */
export async function acknowledgeAttentionItem(
  householdId: string,
  sourceType: AttentionSourceType,
  sourceId: string,
): Promise<void> {
  const { error } = await supabase
    .from('attention_acknowledgements')
    .upsert(
      { household_id: householdId, source_type: sourceType, source_id: sourceId },
      { onConflict: 'source_type,source_id' },
    );

  if (error) throw error;
}

/**
 * Reverses acknowledgeAttentionItem() — "Show again" / "Undo" on the
 * Dashboard. The item reappears in Needs Attention on the next load simply
 * because its row here is gone, not because anything changed on the source
 * record (which was never touched in the first place).
 */
export async function unacknowledgeAttentionItem(
  sourceType: AttentionSourceType,
  sourceId: string,
): Promise<void> {
  const { error } = await supabase
    .from('attention_acknowledgements')
    .delete()
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);

  if (error) throw error;
}

export type UpcomingWarranty = {
  id: string;
  name: string | null;
  expiryDate: string;
  assetId: string;
  assetName: string;
};

/**
 * Warranties expiring within the next 30 days, household-wide. `warranties`
 * has no household_id of its own (see supabase/migrations) — ownership is
 * inherited through the parent asset, so this embeds `assets(id, name)` for
 * both the display name and RLS (warranties_select_member already checks
 * household membership via the asset; the embedded assets(...) read is
 * independently authorized by assets_select_member). No client-side
 * household filter is added; RLS alone decides what rows are visible.
 *
 * The `.gte`/`.lte` range also does the "exclude expired" and "exclude no
 * expiry date" filtering for free: a null expiry_date fails both
 * comparisons in Postgres, so those rows are never returned.
 */
export async function listUpcomingWarranties(): Promise<UpcomingWarranty[]> {
  const today = todayDateString();
  const windowEnd = addDaysDateString(today, UPCOMING_WINDOW_DAYS);

  const { data, error } = await supabase
    .from('warranties')
    .select('id, name, expiry_date, asset_id, assets(id, name)')
    .gte('expiry_date', today)
    .lte('expiry_date', windowEnd)
    .order('expiry_date', { ascending: true })
    .limit(UPCOMING_LIMIT);

  if (error) throw error;

  return (data ?? [])
    .filter(
      (row): row is typeof row & { expiry_date: string; assets: { id: string; name: string } } =>
        row.expiry_date != null && row.assets != null,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      expiryDate: row.expiry_date,
      assetId: row.assets.id,
      assetName: row.assets.name,
    }));
}

/**
 * Warranties that already expired, household-wide, most-recently-expired
 * first (the most actionable/relevant, versus a warranty that lapsed years
 * ago). Same shape and ownership model as listUpcomingWarranties() above —
 * this is deliberately a separate query rather than widening that one's
 * date range, since "expired" has no threshold to keep consistent with
 * (unlike "expiring soon", which reuses the same 30-day window everywhere).
 */
export async function listExpiredWarranties(): Promise<UpcomingWarranty[]> {
  const today = todayDateString();

  const [{ data, error }, acknowledged] = await Promise.all([
    supabase
      .from('warranties')
      .select('id, name, expiry_date, asset_id, assets(id, name)')
      .lt('expiry_date', today)
      .order('expiry_date', { ascending: false })
      .limit(NEEDS_ATTENTION_LIMIT),
    listAcknowledgedSourceIds('warranty'),
  ]);

  if (error) throw error;

  return (data ?? [])
    .filter(
      (row): row is typeof row & { expiry_date: string; assets: { id: string; name: string } } =>
        row.expiry_date != null && row.assets != null && !acknowledged.has(row.id),
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      expiryDate: row.expiry_date,
      assetId: row.assets.id,
      assetName: row.assets.name,
    }));
}

export type UpcomingMaintenance = {
  id: string;
  name: string;
  nextDueDate: string;
  assetId: string;
  assetName: string;
};

/**
 * Maintenance records due within the next 30 days, household-wide. Same
 * asset-inherited-ownership shape as listUpcomingWarranties above —
 * maintenance_records has no household_id either.
 */
export async function listUpcomingMaintenance(): Promise<UpcomingMaintenance[]> {
  const today = todayDateString();
  const windowEnd = addDaysDateString(today, UPCOMING_WINDOW_DAYS);

  const { data, error } = await supabase
    .from('maintenance_records')
    .select('id, name, next_due_date, asset_id, assets(id, name)')
    .gte('next_due_date', today)
    .lte('next_due_date', windowEnd)
    .order('next_due_date', { ascending: true })
    .limit(UPCOMING_LIMIT);

  if (error) throw error;

  return (data ?? [])
    .filter(
      (row): row is typeof row & { next_due_date: string; assets: { id: string; name: string } } =>
        row.next_due_date != null && row.assets != null,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      nextDueDate: row.next_due_date,
      assetId: row.assets.id,
      assetName: row.assets.name,
    }));
}

/**
 * Maintenance already overdue (next_due_date before today), household-wide,
 * most-overdue first — surfacing the most-neglected item, same reasoning as
 * listExpiredWarranties() above. No threshold involved, so nothing here can
 * conflict with the 30-day "upcoming" window.
 */
export async function listOverdueMaintenance(): Promise<UpcomingMaintenance[]> {
  const today = todayDateString();

  const [{ data, error }, acknowledged] = await Promise.all([
    supabase
      .from('maintenance_records')
      .select('id, name, next_due_date, asset_id, assets(id, name)')
      .lt('next_due_date', today)
      .order('next_due_date', { ascending: true })
      .limit(NEEDS_ATTENTION_LIMIT),
    listAcknowledgedSourceIds('maintenance_record'),
  ]);

  if (error) throw error;

  return (data ?? [])
    .filter(
      (row): row is typeof row & { next_due_date: string; assets: { id: string; name: string } } =>
        row.next_due_date != null && row.assets != null && !acknowledged.has(row.id),
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      nextDueDate: row.next_due_date,
      assetId: row.assets.id,
      assetName: row.assets.name,
    }));
}

export type DashboardReminderGroups = {
  overdue: Reminder[];
  upcoming: Reminder[];
};

/**
 * Reminders split into overdue vs. due-today-or-later, each capped to a
 * small display count. Reuses groupReminders() from reminders/api.ts (the
 * same grouping the Reminders screen itself is built on) rather than
 * re-deriving "overdue"/"today" here — Dashboard and Reminders agree on
 * exactly what those mean by construction, not by convention.
 */
export async function getDashboardReminderGroups(): Promise<DashboardReminderGroups> {
  const reminders = await listReminders();
  const groups = groupReminders(reminders, new Date());

  return {
    overdue: groups.overdue.slice(0, NEEDS_ATTENTION_LIMIT),
    upcoming: [...groups.today, ...groups.upcoming].slice(0, UPCOMING_LIMIT),
  };
}

export type RecurringExpenseDueSoon = {
  id: string;
  name: string;
  nextPaymentDate: string;
};

export type DashboardFinanceSummary = {
  monthlyTotal: number;
  annualTotal: number;
  // The currency of the first expense that has one set, in the same order
  // listRecurringExpenses() returns (created_at ascending). Recurring
  // expenses don't share a single household-level currency setting, so a
  // combined total across genuinely mixed currencies has no exact display
  // — this picks a best-effort label rather than inventing a conversion.
  currency: string | null;
  // Active expenses whose next_payment_date falls within the same 30-day
  // "upcoming" window used for warranty/maintenance — computed from the
  // same fetch as the totals above rather than a second query.
  dueSoon: RecurringExpenseDueSoon[];
};

export async function getDashboardFinanceSummary(): Promise<DashboardFinanceSummary> {
  const expenses = await listRecurringExpenses();
  // Active-only, matching the Finance screen's own summary card — an
  // inactive (paused/cancelled) expense is kept for history but isn't a
  // live financial commitment, so it counts toward neither the totals nor
  // the "due soon" list.
  const activeExpenses = expenses.filter((expense) => expense.status === 'active');

  let monthlyTotal = 0;
  let annualTotal = 0;
  let currency: string | null = null;

  for (const expense of activeExpenses) {
    if (currency == null && expense.currency) {
      currency = expense.currency;
    }
    if (expense.amount == null || !expense.billing_cycle) continue;
    monthlyTotal += monthlyCost(expense.amount, expense.billing_cycle) ?? 0;
    annualTotal += annualCost(expense.amount, expense.billing_cycle) ?? 0;
  }

  const today = todayDateString();
  const windowEnd = addDaysDateString(today, UPCOMING_WINDOW_DAYS);
  const dueSoon = activeExpenses
    .filter(
      (expense): expense is typeof expense & { next_payment_date: string } =>
        expense.next_payment_date != null &&
        expense.next_payment_date >= today &&
        expense.next_payment_date <= windowEnd,
    )
    .sort((a, b) => a.next_payment_date.localeCompare(b.next_payment_date))
    .slice(0, UPCOMING_LIMIT)
    .map((expense) => ({
      id: expense.id,
      name: expense.name,
      nextPaymentDate: expense.next_payment_date,
    }));

  // Task 031: default currency is MYR — never show the Home Finance card's
  // totals as a bare, unlabeled number just because no expense has a
  // currency set.
  return { monthlyTotal, annualTotal, currency: currency || 'MYR', dueSoon };
}

// Task 031: the four major Home sections a user can reorder. "recently_added"
// intentionally does not include per-card drag/drop (out of scope) — only
// these section-level positions are customizable.
export const HOME_SECTION_KEYS = [
  'needs_attention',
  'upcoming',
  'finance',
  'recently_added',
] as const;
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number];

/**
 * A user's saved Home section order, or null if they've never customized it
 * (the caller falls back to HOME_SECTION_KEYS' own default order). Stored on
 * profiles rather than households — this is a per-user display preference,
 * not shared household data, and profiles' existing "own row only" RLS
 * already isolates it correctly.
 */
export async function getHomeSectionOrder(userId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('home_section_order')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data?.home_section_order ?? null;
}

export async function setHomeSectionOrder(userId: string, order: HomeSectionKey[]): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ home_section_order: order })
    .eq('id', userId);

  if (error) throw error;
}
