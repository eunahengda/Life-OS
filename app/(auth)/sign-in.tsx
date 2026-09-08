import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { useAuth } from '../../src/auth';
import { translateAuthError } from '../../src/auth/authErrors';
import { Button, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';

type Status = 'idle' | 'submitting' | 'error';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const isSubmitting = status === 'submitting';

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setStatus('error');
      setErrorMessage('Please fill in all fields.');
      return;
    }

    setStatus('submitting');
    try {
      await signIn(trimmedEmail, password);
      // AuthProvider now has the session; the root layout redirects into the app.
    } catch (error) {
      if (__DEV__) console.warn('[auth] sign in failed', error);
      setStatus('error');
      setErrorMessage(translateAuthError(error));
    }
  };

  return (
    <Screen style={styles.container}>
      <Text style={styles.title}>Sign In</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!isSubmitting}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        editable={!isSubmitting}
      />

      {status === 'error' ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Button
        label={isSubmitting ? 'Signing In…' : 'Sign In'}
        onPress={handleSubmit}
        disabled={isSubmitting}
        style={styles.button}
      />

      <Link href="/sign-up" style={styles.link}>
        Don&apos;t have an account? Create Account
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
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.xs,
  },
  link: {
    marginTop: spacing.md,
    textAlign: 'center',
    color: colors.primary,
  },
});
