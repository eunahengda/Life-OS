import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { formatDisplayDate } from '../utils/date';

export type DateFieldProps = {
  value: string; // 'YYYY-MM-DD' or '' for unset
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

function toDateOrNull(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Native (iOS/Android) date picker — a tappable field that opens the
 * platform's own calendar UI instead of asking the user to type
 * "YYYY-MM-DD" by hand. Internally still produces/consumes a plain
 * YYYY-MM-DD string, so every existing date column and API function is
 * completely unaffected (see Task 030). Web has its own implementation —
 * see DateField.web.tsx — since this native picker library has no web
 * renderer at all.
 */
export function DateField({ value, onChange, placeholder, disabled }: DateFieldProps) {
  const [show, setShow] = useState(false);
  const selected = toDateOrNull(value);

  return (
    <View>
      <Pressable
        style={[styles.input, disabled && styles.disabled]}
        onPress={() => !disabled && setShow(true)}
      >
        <Text style={value ? styles.valueText : styles.placeholderText}>
          {value ? formatDisplayDate(value) : (placeholder ?? 'Select a date')}
        </Text>
      </Pressable>

      {value ? (
        <Text style={styles.clearLink} onPress={() => !disabled && onChange('')}>
          Clear
        </Text>
      ) : null}

      {show ? (
        <DateTimePicker
          value={selected ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(event, date) => {
            // Android's dialog dismisses itself and fires a 'dismissed'
            // event with no date; iOS's inline picker stays open until the
            // caller hides it, so both branches close it here explicitly.
            if (Platform.OS !== 'ios') setShow(false);
            if (event.type === 'dismissed' || !date) return;
            onChange(toDateString(date));
            if (Platform.OS === 'ios') setShow(false);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.surface,
  },
  disabled: {
    opacity: 0.5,
  },
  valueText: {
    fontSize: 16,
    color: colors.text,
  },
  placeholderText: {
    fontSize: 16,
    color: colors.textMuted,
  },
  clearLink: {
    color: colors.primary,
    fontSize: 13,
    marginTop: spacing.xs,
  },
});
