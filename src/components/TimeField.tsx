import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';

export type TimeFieldProps = {
  value: string; // 'HH:MM' in 24-hour, or '' for unset — internal representation only
  onChange: (value: string) => void;
  disabled?: boolean;
};

// Always renders as 12-hour with AM/PM (e.g. "09:30 AM", "06:30 PM"), per
// Task 030 — never 24-hour, never mixed with AM/PM, regardless of what
// format the underlying platform picker's own UI happens to use.
export function formatTime12Hour(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

function toTimeOrNull(value: string): Date | null {
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return date;
}

function toTimeString(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Native (iOS/Android) time picker. Time is always optional (Task 030) — a
 * "Clear" link only appears once a time is set, mirroring DateField, and
 * nothing here ever invents a default time on its own.
 */
export function TimeField({ value, onChange, disabled }: TimeFieldProps) {
  const [show, setShow] = useState(false);
  const selected = toTimeOrNull(value);

  return (
    <View>
      <Pressable
        style={[styles.input, disabled && styles.disabled]}
        onPress={() => !disabled && setShow(true)}
      >
        <Text style={value ? styles.valueText : styles.placeholderText}>
          {value ? formatTime12Hour(value) : 'No time set'}
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
          mode="time"
          is24Hour={false}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            if (Platform.OS !== 'ios') setShow(false);
            if (event.type === 'dismissed' || !date) return;
            onChange(toTimeString(date));
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
