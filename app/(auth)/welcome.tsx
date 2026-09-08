import { Link } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Button, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';

export default function WelcomeScreen() {
  return (
    <Screen style={styles.container}>
      <Text style={styles.title}>LifeOS</Text>
      <Text style={styles.subtitle}>Everything you own. Everything you need to remember.</Text>
      <Link href="/sign-in" asChild>
        <Button label="Sign In" onPress={() => {}} style={styles.button} />
      </Link>
      <Link href="/sign-up" asChild>
        <Button label="Create Account" variant="secondary" onPress={() => {}} />
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  button: {
    marginBottom: spacing.sm,
  },
});
