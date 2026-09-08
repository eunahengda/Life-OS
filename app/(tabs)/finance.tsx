import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../src/auth';
import {
  Button,
  Card,
  DateField,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
} from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import { getActiveHouseholdId } from '../../src/features/assets/api';
import {
  annualCost,
  BILLING_CYCLES,
  createRecurringExpense,
  deleteRecurringExpense,
  EXPENSE_CATEGORIES,
  listRecurringExpenses,
  monthlyCost,
  RecurringExpense,
  setRecurringExpenseStatus,
  updateRecurringExpense,
} from '../../src/features/finance/api';
import { createSourcedReminder, dateStringToIsoMidnight } from '../../src/features/reminders/api';
import { formatDisplayDate, isValidDateString } from '../../src/utils/date';

type Status = 'loading' | 'loaded' | 'error';
type FormMode = 'closed' | 'add' | string;

type Draft = {
  name: string;
  amount: string;
  currency: string;
  billingCycle: string;
  nextPaymentDate: string;
  category: string;
  notes: string;
};

// Task 031: MYR is the app's default currency — a new expense starts with it
// pre-filled rather than blank, though the user can still change it.
const DEFAULT_CURRENCY = 'MYR';

const EMPTY_DRAFT: Draft = {
  name: '',
  amount: '',
  currency: DEFAULT_CURRENCY,
  billingCycle: '',
  nextPaymentDate: '',
  category: '',
  notes: '',
};

const CATEGORY_SECTION_ORDER = [
  'Bill',
  'Subscription',
  'Insurance',
  'Membership',
  'Other',
] as const;
type CategorySection = (typeof CATEGORY_SECTION_ORDER)[number];

// Plural section headings (Task 031's own mockup: "BILLS", "SUBSCRIPTIONS")
// — distinct from EXPENSE_CATEGORIES, which stays singular since it's also
// the label shown on each category-picker button in the form.
const SECTION_HEADING: Record<CategorySection, string> = {
  Bill: 'BILLS',
  Subscription: 'SUBSCRIPTIONS',
  Insurance: 'INSURANCE',
  Membership: 'MEMBERSHIPS',
  Other: 'OTHER',
};

// An expense with no category (or one outside the known set) is grouped
// under "Other" for display purposes only — this never rewrites the stored
// category value.
function sectionForCategory(category: string | null): CategorySection {
  return category && (CATEGORY_SECTION_ORDER as readonly string[]).includes(category)
    ? (category as CategorySection)
    : 'Other';
}

type DisplayMode = 'monthly' | 'yearly';

const CYCLE_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

// Task 031: a null/empty stored currency (every record created before this
// task defaulted to none) always displays as MYR — the app's default — never
// as a bare, unlabeled number. This is display-only: it never writes MYR
// back into a record the user hasn't touched via the form.
function formatAmount(amount: number, currency: string | null): string {
  const value = amount.toLocaleString(undefined, { minimumFractionDigits: 0 });
  return `${currency || DEFAULT_CURRENCY} ${value}`;
}

// For the top summary card specifically: always 2 decimal places (matching
// the task brief's own example, "MYR 206.90"), unlike per-row amounts, which
// use whole numbers.
function formatSummaryAmount(amount: number, currency: string | null): string {
  const value = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency || DEFAULT_CURRENCY} ${value}`;
}

// The amount shown for one row under the current Monthly/Yearly display
// toggle — a pure display calculation via the existing Task 018
// monthlyCost()/annualCost() normalization, never touching the stored
// amount/billing_cycle themselves.
function displayAmountFor(expense: RecurringExpense, mode: DisplayMode): string | null {
  if (expense.amount == null || !expense.billing_cycle) return null;
  const value =
    mode === 'monthly'
      ? monthlyCost(expense.amount, expense.billing_cycle)
      : annualCost(expense.amount, expense.billing_cycle);
  return value == null ? null : formatAmount(value, expense.currency);
}

function toDraft(expense: RecurringExpense): Draft {
  return {
    name: expense.name,
    amount: expense.amount != null ? String(expense.amount) : '',
    currency: expense.currency || DEFAULT_CURRENCY,
    billingCycle: expense.billing_cycle ?? '',
    nextPaymentDate: expense.next_payment_date ?? '',
    category: expense.category ?? '',
    notes: expense.notes ?? '',
  };
}

export default function FinanceScreen() {
  const { user } = useAuth();
  const { autoAdd } = useLocalSearchParams<{ autoAdd?: string }>();

  const [status, setStatus] = useState<Status>('loading');
  const [expenses, setExpenses] = useState<RecurringExpense[]>([]);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState('');
  const [addingReminderFor, setAddingReminderFor] = useState<string | null>(null);
  const [reminderAddedFor, setReminderAddedFor] = useState<Set<string>>(new Set());
  const [reminderError, setReminderError] = useState('');
  // Session-only — Task 031 explicitly asks not to introduce persistent
  // settings infrastructure just for this toggle.
  const [displayMode, setDisplayMode] = useState<DisplayMode>('monthly');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await listRecurringExpenses();
      setExpenses(data);
      setStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[finance] listRecurringExpenses failed', error);
      setStatus('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const startAdd = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setFormError('');
    setFormMode('add');
  }, []);

  // Lets the Add launcher open this screen with the create form already
  // showing. The ref guard means this only fires once per navigation here
  // with the param present, not on every refocus of the tab.
  const autoAddHandled = useRef(false);
  useEffect(() => {
    if (autoAdd && !autoAddHandled.current) {
      autoAddHandled.current = true;
      startAdd();
    }
  }, [autoAdd, startAdd]);

  const startEdit = (expense: RecurringExpense) => {
    setDraft(toDraft(expense));
    setFormError('');
    setFormMode(expense.id);
    setOpenMenuId(null);
  };

  const toggleMenu = (id: string) => {
    setOpenMenuId((current) => (current === id ? null : id));
  };

  const cancelForm = () => {
    setDraft(null);
    setFormError('');
    setFormMode('closed');
  };

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSave = async () => {
    if (saving || !draft || formMode === 'closed') return;

    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setFormError('Please enter a name.');
      return;
    }

    const trimmedAmount = draft.amount.trim();
    const amount = Number(trimmedAmount);
    if (!trimmedAmount || !Number.isFinite(amount) || amount <= 0) {
      setFormError('Please enter a valid amount.');
      return;
    }

    if (!draft.billingCycle) {
      setFormError('Please choose a billing cycle.');
      return;
    }

    const trimmedDate = draft.nextPaymentDate.trim();
    if (trimmedDate && !isValidDateString(trimmedDate)) {
      setFormError('Please enter a valid next payment date (YYYY-MM-DD).');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      const fields = {
        name: trimmedName,
        amount,
        // Task 031: default currency is MYR — a form save never produces a
        // blank currency, even if the user cleared the field.
        currency: draft.currency.trim() || DEFAULT_CURRENCY,
        billing_cycle: draft.billingCycle,
        next_payment_date: trimmedDate || null,
        category: draft.category.trim() || null,
        notes: draft.notes.trim() || null,
      };

      if (formMode === 'add') {
        if (!user) {
          setFormError('Unable to save this expense. Please try again.');
          return;
        }
        const householdId = await getActiveHouseholdId(user.id);
        if (!householdId) {
          setFormError("We couldn't find your household. Please try again.");
          return;
        }
        const created = await createRecurringExpense(householdId, fields);
        setExpenses((current) => [...current, created]);
      } else {
        const updated = await updateRecurringExpense(formMode, fields);
        setExpenses((current) => current.map((e) => (e.id === updated.id ? updated : e)));
      }
      setDraft(null);
      setFormMode('closed');
    } catch (error) {
      if (__DEV__) console.warn('[finance] save failed', error);
      setFormError('Unable to save this expense. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteRecurringExpense(id);
      setExpenses((current) => current.filter((e) => e.id !== id));
      setConfirmDeleteId(null);
    } catch (error) {
      if (__DEV__) console.warn('[finance] delete failed', error);
      setDeleteError('Unable to delete this expense. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  /**
   * One-shot manual action, same pattern as Asset Detail's "+ Add reminder"
   * for Warranty/Maintenance: creates a single reminders row referencing
   * this recurring expense (source_type='recurring_expense'). Nothing here
   * schedules a notification or keeps the reminder in sync with later edits
   * to the expense — see reminders/api.ts's createSourcedReminder.
   */
  const handleAddReminder = async (expense: RecurringExpense) => {
    if (addingReminderFor || reminderAddedFor.has(expense.id)) return;
    setAddingReminderFor(expense.id);
    setReminderError('');
    try {
      await createSourcedReminder(expense.household_id, {
        title: `${expense.name} payment`,
        due_at: expense.next_payment_date
          ? dateStringToIsoMidnight(expense.next_payment_date)
          : null,
        source_type: 'recurring_expense',
        source_id: expense.id,
      });
      setReminderAddedFor((current) => new Set(current).add(expense.id));
    } catch (error) {
      if (__DEV__) console.warn('[finance] add reminder failed', error);
      setReminderError('Unable to add a reminder. Please try again.');
    } finally {
      setAddingReminderFor(null);
    }
  };

  const handleToggleStatus = async (expense: RecurringExpense) => {
    if (togglingId) return;
    setTogglingId(expense.id);
    setToggleError('');
    try {
      const updated = await setRecurringExpenseStatus(
        expense.id,
        expense.status === 'active' ? 'paused' : 'active',
      );
      setExpenses((current) => current.map((e) => (e.id === updated.id ? updated : e)));
    } catch (error) {
      if (__DEV__) console.warn('[finance] status toggle failed', error);
      setToggleError('Unable to update this expense. Please try again.');
    } finally {
      setTogglingId(null);
    }
  };

  if (status === 'loading') {
    return (
      <Screen>
        <LoadingState message="Loading recurring expenses…" />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen>
        <ErrorState message="Unable to load recurring expenses." onRetry={load} />
      </Screen>
    );
  }

  // Only active expenses count toward the recurring-cost summary — an
  // inactive one is kept for history but shouldn't inflate what the
  // household is actually paying right now.
  const activeExpenses = expenses.filter((e) => e.status === 'active');

  const totalMonthly = activeExpenses.reduce((sum, e) => {
    if (e.amount == null || !e.billing_cycle) return sum;
    return sum + (monthlyCost(e.amount, e.billing_cycle) ?? 0);
  }, 0);
  const totalAnnual = activeExpenses.reduce((sum, e) => {
    if (e.amount == null || !e.billing_cycle) return sum;
    return sum + (annualCost(e.amount, e.billing_cycle) ?? 0);
  }, 0);
  // Best-effort label, same convention as the Dashboard's Finance card:
  // active expenses don't share one household-level currency setting, so
  // this just uses the first one that has a currency set. Falls back to
  // MYR (Task 031) rather than leaving the summary unlabeled.
  const summaryCurrency = activeExpenses.find((e) => e.currency)?.currency || DEFAULT_CURRENCY;

  const inactiveExpenses = expenses.filter((e) => e.status !== 'active');
  const categorySections = CATEGORY_SECTION_ORDER.map((key) => ({
    key,
    items: activeExpenses.filter((e) => sectionForCategory(e.category) === key),
  })).filter((section) => section.items.length > 0);

  const renderExpenseRow = (expense: RecurringExpense) => {
    if (formMode === expense.id && draft) {
      return (
        <RecurringExpenseForm
          key={expense.id}
          draft={draft}
          saving={saving}
          error={formError}
          onChange={updateDraft}
          onSave={handleSave}
          onCancel={cancelForm}
        />
      );
    }

    const inactive = expense.status !== 'active';
    const amountText = displayAmountFor(expense, displayMode);

    return (
      <View key={expense.id} style={styles.item}>
        <Card style={styles.card}>
          <View style={styles.expenseRow}>
            <Pressable style={styles.expenseMain} onPress={() => startEdit(expense)}>
              <View style={styles.expenseLine1}>
                <Text
                  style={[styles.expenseName, inactive && styles.inactiveText]}
                  numberOfLines={1}
                >
                  {expense.name}
                </Text>
                {amountText ? (
                  <Text style={[styles.expenseAmount, inactive && styles.inactiveText]}>
                    {amountText}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.nextPaymentText}>
                {expense.next_payment_date
                  ? `Next payment · ${formatDisplayDate(expense.next_payment_date)}`
                  : inactive
                    ? 'Inactive'
                    : 'No upcoming payment'}
              </Text>
            </Pressable>
            <Pressable
              style={styles.overflowButton}
              onPress={() => toggleMenu(expense.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="More actions"
            >
              <Text style={styles.overflowIcon}>⋯</Text>
            </Pressable>
          </View>

          {openMenuId === expense.id ? (
            <View style={styles.overflowMenu}>
              <Text
                style={styles.overflowMenuItem}
                onPress={() => {
                  setOpenMenuId(null);
                  void handleToggleStatus(expense);
                }}
              >
                {togglingId === expense.id ? 'Updating…' : inactive ? 'Resume' : 'Pause'}
              </Text>
              <Text
                style={styles.overflowMenuItem}
                onPress={
                  reminderAddedFor.has(expense.id) || addingReminderFor === expense.id
                    ? undefined
                    : () => void handleAddReminder(expense)
                }
              >
                {reminderAddedFor.has(expense.id)
                  ? 'Reminder added'
                  : addingReminderFor === expense.id
                    ? 'Adding…'
                    : 'Set reminder'}
              </Text>
              <Text
                style={[styles.overflowMenuItem, styles.overflowMenuDanger]}
                onPress={() => {
                  setConfirmDeleteId(expense.id);
                  setOpenMenuId(null);
                }}
              >
                Delete
              </Text>
            </View>
          ) : null}

          {confirmDeleteId === expense.id ? (
            <View style={styles.confirmRow}>
              <Text style={styles.subtitle}>Delete this recurring expense?</Text>
              <Button
                label={deleting ? 'Deleting…' : 'Delete'}
                variant="secondary"
                onPress={() => handleDelete(expense.id)}
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
        </Card>
      </View>
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Finance</Text>

        <View style={styles.displayToggleRow}>
          <Button
            label="Monthly"
            variant={displayMode === 'monthly' ? 'primary' : 'secondary'}
            onPress={() => setDisplayMode('monthly')}
            style={styles.displayToggleButton}
          />
          <Button
            label="Yearly"
            variant={displayMode === 'yearly' ? 'primary' : 'secondary'}
            onPress={() => setDisplayMode('yearly')}
            style={styles.displayToggleButton}
          />
        </View>

        <Card style={styles.summaryCard}>
          {displayMode === 'monthly' ? (
            <>
              <Text style={styles.summaryLabel}>Monthly recurring</Text>
              <Text style={styles.summaryValue}>
                {formatSummaryAmount(totalMonthly, summaryCurrency)} / month
              </Text>
              <Text style={[styles.summaryLabel, styles.summarySecondLabel]}>Annual recurring</Text>
              <Text style={styles.summaryValue}>
                {formatSummaryAmount(totalAnnual, summaryCurrency)} / year
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.summaryLabel}>Annual recurring</Text>
              <Text style={styles.summaryValue}>
                {formatSummaryAmount(totalAnnual, summaryCurrency)} / year
              </Text>
            </>
          )}
        </Card>

        {expenses.length === 0 && formMode === 'closed' ? (
          <EmptyState
            title="No recurring expenses yet"
            description="Track subscriptions, bills, and other recurring costs."
          />
        ) : null}

        {categorySections.map((section) => (
          <View key={section.key} style={styles.categorySection}>
            <Text style={styles.categoryHeading}>{SECTION_HEADING[section.key]}</Text>
            {section.items.map(renderExpenseRow)}
          </View>
        ))}

        {inactiveExpenses.length > 0 ? (
          <View style={styles.categorySection}>
            <Text style={styles.categoryHeading}>INACTIVE</Text>
            {inactiveExpenses.map(renderExpenseRow)}
          </View>
        ) : null}

        {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
        {toggleError ? <Text style={styles.error}>{toggleError}</Text> : null}
        {reminderError ? <Text style={styles.error}>{reminderError}</Text> : null}

        {formMode === 'add' && draft ? (
          <RecurringExpenseForm
            draft={draft}
            saving={saving}
            error={formError}
            onChange={updateDraft}
            onSave={handleSave}
            onCancel={cancelForm}
          />
        ) : null}

        {formMode === 'closed' ? (
          <Button label="+ Add recurring expense" onPress={startAdd} style={styles.button} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function RecurringExpenseForm({
  draft,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  saving: boolean;
  error: string;
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
      <Field label="Amount *">
        <TextInput
          style={styles.input}
          value={draft.amount}
          onChangeText={(value) => onChange('amount', value)}
          keyboardType="decimal-pad"
          editable={!saving}
        />
      </Field>
      <Field label="Currency">
        <TextInput
          style={styles.input}
          value={draft.currency}
          onChangeText={(value) => onChange('currency', value)}
          placeholder="e.g. MYR"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          editable={!saving}
        />
      </Field>
      <Field label="Billing cycle *">
        <View style={styles.cycleRow}>
          {BILLING_CYCLES.map((cycle) => (
            <Button
              key={cycle}
              label={CYCLE_LABELS[cycle]}
              variant={draft.billingCycle === cycle ? 'primary' : 'secondary'}
              onPress={() => onChange('billingCycle', cycle)}
              disabled={saving}
              style={styles.cycleButton}
            />
          ))}
        </View>
      </Field>
      <Field label="Next Payment Date">
        <DateField
          value={draft.nextPaymentDate}
          onChange={(value) => onChange('nextPaymentDate', value)}
          disabled={saving}
        />
      </Field>
      <Field label="Category">
        <View style={styles.cycleRow}>
          <Button
            label="None"
            variant={draft.category === '' ? 'primary' : 'secondary'}
            onPress={() => onChange('category', '')}
            disabled={saving}
            style={styles.cycleButton}
          />
          {EXPENSE_CATEGORIES.map((category) => (
            <Button
              key={category}
              label={category}
              variant={draft.category === category ? 'primary' : 'secondary'}
              onPress={() => onChange('category', category)}
              disabled={saving}
              style={styles.cycleButton}
            />
          ))}
        </View>
      </Field>
      <Field label="Notes">
        <TextInput
          style={[styles.input, styles.multiline]}
          value={draft.notes}
          onChangeText={(value) => onChange('notes', value)}
          multiline
          editable={!saving}
        />
      </Field>

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
    marginBottom: spacing.xs,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  summaryCard: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  summarySecondLabel: {
    marginTop: spacing.sm,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.xs / 2,
  },
  displayToggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  displayToggleButton: {
    marginTop: 0,
    flex: 1,
  },
  categorySection: {
    marginBottom: spacing.lg,
  },
  categoryHeading: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  item: {
    marginBottom: spacing.sm,
  },
  card: {
    padding: spacing.md,
  },
  inactiveText: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  expenseMain: {
    flex: 1,
  },
  expenseLine1: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  expenseName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  expenseAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  nextPaymentText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  overflowButton: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs / 2,
    marginLeft: spacing.xs,
  },
  overflowIcon: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textMuted,
    lineHeight: 20,
  },
  overflowMenu: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  overflowMenuItem: {
    fontSize: 14,
    color: colors.primary,
  },
  overflowMenuDanger: {
    color: colors.danger,
  },
  confirmRow: {
    gap: spacing.xs,
    marginTop: spacing.sm,
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
  cycleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  cycleButton: {
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
