import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../src/auth';
import {
  Button,
  Card,
  DateField,
  EmptyState,
  ErrorState,
  formatTime12Hour,
  LoadingState,
  Screen,
  TimeField,
} from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import { getActiveHouseholdId } from '../../src/features/assets/api';
import {
  completeReminder,
  createReminder,
  deleteReminder,
  groupReminders,
  isReminderOverdue,
  listReminders,
  Reminder,
  updateReminder,
} from '../../src/features/reminders/api';

type Status = 'loading' | 'loaded' | 'error';
type FormMode = 'closed' | 'add' | string;

type Draft = {
  title: string;
  dueDate: string; // 'YYYY-MM-DD' or '' — picked via DateField
  dueTime: string; // 'HH:MM' 24-hour internal, or '' — picked via TimeField, always optional
};

const EMPTY_DRAFT: Draft = { title: '', dueDate: '', dueTime: '' };

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

/**
 * due_at is a timestamptz (a moment in time), unlike the plain `date`
 * columns on assets/warranties/maintenance — so converting through a real
 * Date here for storage is correct, not a timezone bug. A date with no time
 * defaults to local midnight, same convention as dateStringToIsoMidnight
 * elsewhere in the app; a time is never invented when the user leaves it
 * unset (Task 030). No date at all means no due date.
 */
function composeDueAt(dueDate: string, dueTime: string): string | null {
  if (!dueDate) return null;
  const [year, month, day] = dueDate.split('-').map(Number);
  let hours = 0;
  let minutes = 0;
  if (dueTime) {
    [hours, minutes] = dueTime.split(':').map(Number);
  }
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

function formatDueAt(iso: string): string {
  const date = new Date(iso);
  const label = `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  const hours = date.getHours();
  const minutes = date.getMinutes();
  if (hours === 0 && minutes === 0) return label;
  const time24 = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return `${label}, ${formatTime12Hour(time24)}`;
}

// Decomposes an existing due_at back into separate date/time picker values
// — the inverse of composeDueAt, used to pre-fill the edit form.
function toDraftDateTime(iso: string): { dueDate: string; dueTime: string } {
  const date = new Date(iso);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const dueDate = `${y}-${m}-${d}`;
  if (hours === 0 && minutes === 0) return { dueDate, dueTime: '' };
  return {
    dueDate,
    dueTime: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
  };
}

// Whole calendar days between the due date and today, ignoring time of day —
// "2 days overdue" should mean 2 calendar days, not a fractional duration.
function daysOverdue(iso: string, now: Date): number {
  const due = new Date(iso);
  const dueDayStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((todayStart.getTime() - dueDayStart.getTime()) / 86400000);
}

// The label shown for a reminder's due date: "Overdue · N days" replaces the
// plain formatted date once it's passed and still active, per product spec —
// never shown alongside the date, only instead of it.
function dueLabel(reminder: Reminder, now: Date): string | null {
  if (!reminder.due_at) return null;
  if (isReminderOverdue(reminder, now)) {
    const days = daysOverdue(reminder.due_at, now);
    return `Overdue · ${days} day${days === 1 ? '' : 's'}`;
  }
  return formatDueAt(reminder.due_at);
}

const SOURCE_LABELS: Record<string, string> = {
  warranty: 'Warranty',
  maintenance_record: 'Maintenance',
  recurring_expense: 'Recurring expense',
};

// 'manual' is deliberately not labeled — every reminder this screen creates
// is manual, so calling it out on every single item would just be noise.
// Non-manual source_types show a plain label only; resolving them to the
// actual warranty/maintenance/expense name would need extra cross-table
// lookups the polymorphic source_id can't support via a normal join (no FK),
// and no such reminders exist yet since this task only creates manual ones.
function describeSource(reminder: Reminder): string | null {
  if (!reminder.source_type) return null;
  return SOURCE_LABELS[reminder.source_type] ?? null;
}

function toDraft(reminder: Reminder): Draft {
  const { dueDate, dueTime } = reminder.due_at
    ? toDraftDateTime(reminder.due_at)
    : { dueDate: '', dueTime: '' };
  return { title: reminder.title, dueDate, dueTime };
}

export default function RemindersScreen() {
  const { user } = useAuth();
  const { autoAdd } = useLocalSearchParams<{ autoAdd?: string }>();

  const [status, setStatus] = useState<Status>('loading');
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await listReminders();
      setReminders(data);
      setStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[reminders] listReminders failed', error);
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

  const startEdit = (reminder: Reminder) => {
    setDraft(toDraft(reminder));
    setFormError('');
    setFormMode(reminder.id);
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

    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) {
      setFormError('Please enter a title.');
      return;
    }

    const dueAtIso = composeDueAt(draft.dueDate, draft.dueTime);

    if (!user) {
      setFormError('Unable to save this reminder. Please try again.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      if (formMode === 'add') {
        const householdId = await getActiveHouseholdId(user.id);
        if (!householdId) {
          setFormError("We couldn't find your household. Please try again.");
          return;
        }
        const created = await createReminder(householdId, {
          title: trimmedTitle,
          due_at: dueAtIso,
        });
        setReminders((current) => [...current, created]);
      } else {
        const updated = await updateReminder(formMode, {
          title: trimmedTitle,
          due_at: dueAtIso,
        });
        setReminders((current) => current.map((r) => (r.id === updated.id ? updated : r)));
      }
      setDraft(null);
      setFormMode('closed');
    } catch (error) {
      if (__DEV__) console.warn('[reminders] save failed', error);
      setFormError('Unable to save this reminder. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (reminderId: string) => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteReminder(reminderId);
      setReminders((current) => current.filter((r) => r.id !== reminderId));
      setConfirmDeleteId(null);
    } catch (error) {
      if (__DEV__) console.warn('[reminders] delete failed', error);
      setDeleteError('Unable to delete this reminder. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleComplete = async (reminder: Reminder) => {
    if (completingId) return;
    setCompletingId(reminder.id);
    setCompleteError('');
    try {
      const updated = await completeReminder(reminder.id, !reminder.is_completed);
      setReminders((current) => current.map((r) => (r.id === updated.id ? updated : r)));
    } catch (error) {
      if (__DEV__) console.warn('[reminders] complete failed', error);
      setCompleteError('Unable to update this reminder. Please try again.');
    } finally {
      setCompletingId(null);
    }
  };

  if (status === 'loading') {
    return (
      <Screen>
        <LoadingState message="Loading reminders…" />
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen>
        <ErrorState message="Unable to load reminders." onRetry={load} />
      </Screen>
    );
  }

  const now = new Date();

  const renderReminder = (reminder: Reminder) => {
    if (formMode === reminder.id && draft) {
      return (
        <ReminderForm
          key={reminder.id}
          draft={draft}
          saving={saving}
          error={formError}
          onChange={updateDraft}
          onSave={handleSave}
          onCancel={cancelForm}
        />
      );
    }

    const label = dueLabel(reminder, now);
    const overdue = isReminderOverdue(reminder, now);

    return (
      <View key={reminder.id} style={styles.item}>
        <Card style={styles.card}>
          <Text
            style={[styles.value, reminder.is_completed && styles.completedText]}
            onPress={() => startEdit(reminder)}
          >
            {reminder.title}
          </Text>
          {label || describeSource(reminder) ? (
            <Text style={[styles.label, overdue && styles.overdueText]}>
              {label}
              {label && describeSource(reminder) ? ' · ' : null}
              {describeSource(reminder)}
            </Text>
          ) : null}
          {reminder.is_completed ? <Text style={styles.label}>Completed</Text> : null}
        </Card>

        <View style={styles.actionRow}>
          <Text style={styles.link} onPress={() => handleToggleComplete(reminder)}>
            {completingId === reminder.id
              ? 'Updating…'
              : reminder.is_completed
                ? 'Mark not done'
                : 'Mark done'}
          </Text>
          <Text style={styles.link} onPress={() => setConfirmDeleteId(reminder.id)}>
            Delete
          </Text>
        </View>

        {confirmDeleteId === reminder.id ? (
          <View style={styles.confirmRow}>
            <Text style={styles.subtitle}>Delete this reminder?</Text>
            <Button
              label={deleting ? 'Deleting…' : 'Delete'}
              variant="secondary"
              onPress={() => handleDelete(reminder.id)}
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
    );
  };

  const groups = groupReminders(reminders, now);

  return (
    <Screen>
      <Text style={styles.title}>Reminders</Text>

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {reminders.length === 0 && formMode === 'closed' ? (
          <EmptyState
            title="Nothing to remember yet"
            description="Add a reminder for something important."
          />
        ) : null}

        {groups.overdue.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Overdue</Text>
            {groups.overdue.map(renderReminder)}
          </>
        ) : null}

        {groups.today.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Today</Text>
            {groups.today.map(renderReminder)}
          </>
        ) : null}

        {groups.upcoming.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Upcoming</Text>
            {groups.upcoming.map(renderReminder)}
          </>
        ) : null}

        {groups.completed.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Completed</Text>
            {groups.completed.map(renderReminder)}
          </>
        ) : null}

        {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
        {completeError ? <Text style={styles.error}>{completeError}</Text> : null}

        {formMode === 'add' && draft ? (
          <ReminderForm
            draft={draft}
            saving={saving}
            error={formError}
            onChange={updateDraft}
            onSave={handleSave}
            onCancel={cancelForm}
          />
        ) : null}

        {formMode === 'closed' ? (
          <Button label="+ Add reminder" onPress={startAdd} style={styles.button} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ReminderForm({
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
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Title *</Text>
        <TextInput
          style={styles.input}
          value={draft.title}
          onChangeText={(value) => onChange('title', value)}
          editable={!saving}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Due Date (optional)</Text>
        <DateField
          value={draft.dueDate}
          onChange={(value) => {
            onChange('dueDate', value);
            // A time with no date doesn't mean anything — clearing the date
            // clears any time picked alongside it too.
            if (!value) onChange('dueTime', '');
          }}
          disabled={saving}
        />
      </View>
      {draft.dueDate ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Due Time (optional)</Text>
          <TimeField
            value={draft.dueTime}
            onChange={(value) => onChange('dueTime', value)}
            disabled={saving}
          />
        </View>
      ) : null}

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

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
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
  completedText: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs / 2,
  },
  overdueText: {
    color: colors.danger,
    fontWeight: '600',
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
