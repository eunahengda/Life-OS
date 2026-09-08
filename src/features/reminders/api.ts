import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesUpdate } from '../../types/database';

export type Reminder = Tables<'reminders'>;
export type ReminderUpdate = TablesUpdate<'reminders'>;

/**
 * All reminders for the current user's household. No household filter here
 * on purpose — same as listAssets(): RLS already scopes this, so there's
 * nothing to reproduce client-side. Ordered by due date, soonest first;
 * reminders with no due date sort last (Postgres's default NULLS LAST for
 * ascending order — exactly the behavior wanted here).
 */
export async function listReminders(): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .order('due_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function insertReminder(
  householdId: string,
  fields: {
    title: string;
    due_at: string | null;
    source_type: string | null;
    source_id: string | null;
  },
): Promise<Reminder> {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      household_id: householdId,
      title: fields.title,
      due_at: fields.due_at,
      source_type: fields.source_type,
      source_id: fields.source_id,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Creates a manual reminder. `source_type` is hard-coded to 'manual' and
 * `source_id` to null — this is the Reminders screen's own create action,
 * unrelated to any Warranty/Maintenance record.
 */
export async function createReminder(
  householdId: string,
  fields: { title: string; due_at: string | null },
): Promise<Reminder> {
  return insertReminder(householdId, { ...fields, source_type: 'manual', source_id: null });
}

/**
 * Creates a reminder referencing an existing Warranty, Maintenance, or
 * Recurring Expense record — the "+ Add reminder" action on Asset Detail
 * (Warranty/Maintenance) and Finance (Recurring Expense). This is a one-shot
 * manual action: nothing here schedules notifications, syncs back to the
 * source record on later edits, or ever creates a reminder automatically.
 * reminders.SOURCE_LABELS on the Reminders screen already knows how to
 * display these once created.
 */
export async function createSourcedReminder(
  householdId: string,
  fields: {
    title: string;
    due_at: string | null;
    source_type: 'warranty' | 'maintenance_record' | 'recurring_expense';
    source_id: string;
  },
): Promise<Reminder> {
  return insertReminder(householdId, fields);
}

/**
 * Deletes every reminder sourced from a given Warranty/Maintenance/Recurring
 * Expense record. Called before deleting the source record itself, so a
 * deleted Warranty (etc.) never leaves a sourced reminder pointing at a
 * record that no longer exists — reminders.source_id is a plain uuid with no
 * foreign key (a constrained polymorphic reference, not a generic entity
 * framework), so this explicit delete is the cleanup a real FK would
 * otherwise provide. RLS (reminders_delete_member) already scopes this to
 * the caller's own household; no household_id filter is needed here.
 */
export async function deleteSourcedReminders(
  sourceType: 'warranty' | 'maintenance_record' | 'recurring_expense',
  sourceId: string,
): Promise<void> {
  const { error } = await supabase
    .from('reminders')
    .delete()
    .eq('source_type', sourceType)
    .eq('source_id', sourceId);

  if (error) throw error;
}

/**
 * Converts a plain YYYY-MM-DD date into a local-midnight ISO timestamp, for
 * handing a date-only source field (a warranty's expiry_date, a maintenance
 * record's next_due_date, a recurring expense's next_payment_date) to
 * reminders' timestamptz due_at. Shared by every "+ Add reminder" call site.
 */
export function dateStringToIsoMidnight(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day).toISOString();
}

export async function updateReminder(
  reminderId: string,
  updates: ReminderUpdate,
): Promise<Reminder> {
  const { data, error } = await supabase
    .from('reminders')
    .update(updates)
    .eq('id', reminderId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteReminder(reminderId: string): Promise<void> {
  const { error } = await supabase.from('reminders').delete().eq('id', reminderId);
  if (error) throw error;
}

/**
 * Toggles completion. Setting is_completed also sets/clears completed_at —
 * there's no trigger for it (unlike updated_at), so the client sets it
 * explicitly, same moment as the flag itself.
 */
export async function completeReminder(
  reminderId: string,
  isCompleted: boolean,
): Promise<Reminder> {
  return updateReminder(reminderId, {
    is_completed: isCompleted,
    completed_at: isCompleted ? new Date().toISOString() : null,
  });
}

// A reminder is overdue only while it's still active — once completed,
// "overdue" no longer means anything urgent, so it never applies. Moved
// here (from app/(tabs)/reminders.tsx) so the Dashboard can reuse the exact
// same definition instead of introducing a second one.
export function isReminderOverdue(reminder: Reminder, now: Date): boolean {
  if (reminder.is_completed || !reminder.due_at) return false;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(reminder.due_at) < todayStart;
}

export type ReminderGroups = {
  overdue: Reminder[];
  today: Reminder[];
  upcoming: Reminder[];
  completed: Reminder[];
};

/**
 * Buckets reminders into overdue / due today / upcoming / completed.
 * listReminders() already orders by due_at ascending (nulls last), so a
 * single stable pass preserves "soonest first" within each bucket — no
 * re-sorting needed. Shared by the Reminders screen and the Dashboard so
 * both agree on exactly what "overdue" and "today" mean.
 */
export function groupReminders(reminders: Reminder[], now: Date): ReminderGroups {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(
    todayStart.getFullYear(),
    todayStart.getMonth(),
    todayStart.getDate() + 1,
  );

  const groups: ReminderGroups = { overdue: [], today: [], upcoming: [], completed: [] };

  for (const reminder of reminders) {
    if (reminder.is_completed) {
      groups.completed.push(reminder);
      continue;
    }
    if (!reminder.due_at) {
      groups.upcoming.push(reminder);
      continue;
    }
    const due = new Date(reminder.due_at);
    if (due < todayStart) {
      groups.overdue.push(reminder);
    } else if (due < tomorrowStart) {
      groups.today.push(reminder);
    } else {
      groups.upcoming.push(reminder);
    }
  }

  return groups;
}
