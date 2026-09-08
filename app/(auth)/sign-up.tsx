import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { useAuth } from '../../src/auth';
import { translateAuthError } from '../../src/auth/authErrors';
import { Button, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';

type Status = 'idle' | 'submitting' | 'confirmation-required' | 'error';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const isSubmitting = status === 'submitting';

  const handleSubmit = async () => {
    if (isSubmitting) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password || !confirmPassword) {
      setStatus('error');
      setErrorMessage('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setStatus('error');
      setErrorMessage('Passwords do not match.');
      return;
    }

    setStatus('submitting');
    try {
      const { needsEmailConfirmation } = await signUp(trimmedEmail, password);
      setStatus(needsEmailConfirmation ? 'confirmation-required' : 'idle');
      // If a session came back, AuthProvider already has it and the root
      // layout will redirect into the app on its own.
    } catch (error) {
      if (__DEV__) console.warn('[auth] sign up failed', error);
      setStatus('error');
      setErrorMessage(translateAuthError(error));
    }
  };

  if (status === 'confirmation-required') {
    return (
      <Screen style={styles.container}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          We sent a confirmation link to {email.trim()}. Confirm your email, then sign in.
        </Text>
        <Link href="/sign-in" asChild>
          <Button label="Back to Sign In" onPress={() => {}} />
        </Link>
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      <Text style={styles.title}>Create Account</Text>

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
        autoComplete="password-new"
        editable={!isSubmitting}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
        placeholderTextColor={colors.textMuted}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        editable={!isSubmitting}
      />

      {status === 'error' ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Button
        label={isSubmitting ? 'Creating Account…' : 'Create Account'}
        onPress={handleSubmit}
        disabled={isSubmitting}
        style={styles.button}
      />

      <Link href="/sign-in" style={styles.link}>
        Already have an account? Sign In
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
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
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
