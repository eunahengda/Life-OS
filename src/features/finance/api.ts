import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesUpdate } from '../../types/database';
import { deleteSourcedReminders } from '../reminders/api';

export type RecurringExpense = Tables<'recurring_expenses'>;
export type RecurringExpenseUpdate = TablesUpdate<'recurring_expenses'>;

// The database's own check constraint (recurring_expenses_billing_cycle_check)
// is authoritative; this list exists only for the UI to iterate over, and
// must stay in sync with it. Note this includes 'half_yearly', which the
// original task brief didn't mention but the live schema does support.
export const BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

// recurring_expenses.category is plain free text with no check constraint
// (unlike billing_cycle/status below), so this list is purely a UI
// convenience — the same pattern as ASSET_CATEGORIES in assets/api.ts. Not
// enforced by the schema; just the fixed set the Add/Edit UI offers.
export const EXPENSE_CATEGORIES = [
  'Subscription',
  'Insurance',
  'Membership',
  'Bill',
  'Other',
] as const;

// 'cancelled' is a third value the schema allows but this task's UI never
// writes — only 'active' and 'paused' are exposed as the Active/Inactive
// toggle. A future task could use 'cancelled' for real cancellation
// semantics without any change here.
export type RecurringExpenseStatus = 'active' | 'paused';

/**
 * All recurring expenses for the current user's household. No household
 * filter here on purpose — same as listAssets()/listReminders(): RLS
 * already scopes this, so there's nothing to reproduce client-side.
 * Ordered by next payment date, soonest first, undated expenses sorting
 * last — `nullsFirst: false` is passed explicitly because PostgREST
 * defaults ascending order to NULLS FIRST (the opposite of plain Postgres
 * SQL's own default), which would otherwise put undated expenses at the
 * top. The "upcoming payments" view is just this list in this order, not a
 * separate one.
 */
export async function listRecurringExpenses(): Promise<RecurringExpense[]> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select('*')
    .order('next_payment_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createRecurringExpense(
  householdId: string,
  fields: {
    name: string;
    amount: number | null;
    currency: string | null;
    billing_cycle: string | null;
    next_payment_date: string | null;
    category: string | null;
    notes: string | null;
  },
): Promise<RecurringExpense> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .insert({ ...fields, household_id: householdId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateRecurringExpense(
  id: string,
  updates: RecurringExpenseUpdate,
): Promise<RecurringExpense> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deactivating/reactivating a recurring expense is deliberately a separate
 * action from editing it (matching the task's own "Edit" vs "Active /
 * Inactive" split) — same shape as completeReminder() in reminders/api.ts, a
 * thin wrapper over the generic update.
 */
export async function setRecurringExpenseStatus(
  id: string,
  status: RecurringExpenseStatus,
): Promise<RecurringExpense> {
  return updateRecurringExpense(id, { status });
}

/**
 * Deletes any reminder sourced from this recurring expense first — same
 * reasoning and ordering as deleteWarranty() in warranties/api.ts.
 */
export async function deleteRecurringExpense(id: string): Promise<void> {
  await deleteSourcedReminders('recurring_expense', id);

  const { error } = await supabase.from('recurring_expenses').delete().eq('id', id);
  if (error) throw error;
}

// Occurrences per year for each billing cycle — the single source of truth
// both cost helpers below normalize through.
const CYCLES_PER_YEAR: Record<string, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  yearly: 1,
};

/**
 * Annualized cost for one recurring expense. Weekly is annualized as
 * amount × 52 (a documented approximation — not every year has exactly 52
 * weeks, but this is the standard, simplest convention and needs no
 * calendar-aware logic). Returns null if the billing cycle isn't one of the
 * five the database allows.
 */
export function annualCost(amount: number, billingCycle: string): number | null {
  const cyclesPerYear = CYCLES_PER_YEAR[billingCycle];
  if (cyclesPerYear == null) return null;
  return amount * cyclesPerYear;
}

/**
 * Monthly-equivalent cost, derived from the annual figure (annual / 12) so
 * every cycle normalizes through the same math rather than having its own
 * special case.
 */
export function monthlyCost(amount: number, billingCycle: string): number | null {
  const annual = annualCost(amount, billingCycle);
  return annual == null ? null : annual / 12;
}
