import { unstable_createElement } from 'react-native-web';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import type { TimeFieldProps } from './TimeField';

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1–12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 00–59

function parse(value: string): { hour12: number; minute: number; period: 'AM' | 'PM' } | null {
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const period: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { hour12, minute: m, period };
}

function to24Hour(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  let h = hour12 % 12;
  if (period === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Always renders as 12-hour with AM/PM (e.g. "09:30 AM", "06:30 PM"), per
// Task 030 — never 24-hour, never mixed with AM/PM. Must stay in sync with
// the native file's export of the same name (both are re-exported from a
// single './TimeField' specifier that Metro resolves per-platform).
export function formatTime12Hour(value: string): string {
  const parsed = parse(value);
  if (!parsed) return '';
  return `${String(parsed.hour12).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${parsed.period}`;
}

/**
 * Web variant of TimeField. A native <input type="time"> can't be forced
 * into 12-hour display — that follows the browser's own locale regardless
 * of any HTML attribute — so this renders three plain <select> dropdowns
 * (hour/minute/AM-PM) instead, which is the only way to guarantee the
 * 12-hour-with-AM/PM display Task 030 requires, on every browser. Same
 * 'HH:MM' 24-hour string contract as the native file.
 */
export function TimeField({ value, onChange, disabled }: TimeFieldProps) {
  const current = parse(value) ?? { hour12: 9, minute: 0, period: 'AM' as const };

  const update = (patch: Partial<typeof current>) => {
    const next = { ...current, ...patch };
    onChange(to24Hour(next.hour12, next.minute, next.period));
  };

  return (
    <View>
      <View style={styles.row}>
        {unstable_createElement('select', {
          value: current.hour12,
          disabled,
          onChange: (e: { target: { value: string } }) =>
            update({ hour12: Number(e.target.value) }),
          style: styles.select,
          children: HOURS.map((h) =>
            unstable_createElement('option', { key: h, value: h, children: String(h) }),
          ),
        })}
        {unstable_createElement('select', {
          value: current.minute,
          disabled,
          onChange: (e: { target: { value: string } }) =>
            update({ minute: Number(e.target.value) }),
          style: styles.select,
          children: MINUTES.map((m) =>
            unstable_createElement('option', {
              key: m,
              value: m,
              children: String(m).padStart(2, '0'),
            }),
          ),
        })}
        {unstable_createElement('select', {
          value: current.period,
          disabled,
          onChange: (e: { target: { value: string } }) =>
            update({ period: e.target.value as 'AM' | 'PM' }),
          style: styles.select,
          children: ['AM', 'PM'].map((p) =>
            unstable_createElement('option', { key: p, value: p, children: p }),
          ),
        })}
      </View>

      {value ? (
        <Text style={styles.clearLink} onPress={() => !disabled && onChange('')}>
          Clear
        </Text>
      ) : (
        <Text style={styles.placeholderText}>No time set</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  select: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.text,
    fontFamily: 'inherit',
  },
  placeholderText: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  clearLink: {
    color: colors.primary,
    fontSize: 13,
    marginTop: spacing.xs,
  },
});
