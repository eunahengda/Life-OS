import { unstable_createElement } from 'react-native-web';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import type { DateFieldProps } from './DateField';

/**
 * Web variant of DateField. @react-native-community/datetimepicker ships no
 * web renderer at all (native-only library), so this uses the browser's own
 * <input type="date"> via react-native-web's raw-DOM-element escape hatch —
 * still a real calendar picker, just the platform-native one for web,
 * exactly like the native file is the platform-native one for iOS/Android
 * (see Task 030's "platform-appropriate" requirement). Same YYYY-MM-DD
 * string contract as the native file.
 */
export function DateField({ value, onChange, disabled }: DateFieldProps) {
  return (
    <View>
      {unstable_createElement('input', {
        type: 'date',
        value,
        disabled,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        style: styles.input,
      })}
      {value ? (
        <Text style={styles.clearLink} onPress={() => !disabled && onChange('')}>
          Clear
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingTop: spacing.sm + 4,
    paddingBottom: spacing.sm + 4,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.text,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  },
  clearLink: {
    color: colors.primary,
    fontSize: 13,
    marginTop: spacing.xs,
  },
});
