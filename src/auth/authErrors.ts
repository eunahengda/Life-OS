/**
 * Translates Supabase auth errors into copy a user can act on. Never pass
 * the raw error message through to the UI — it can contain provider/DB
 * implementation details that mean nothing to a user (or that we simply
 * don't want to expose).
 */
export function translateAuthError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (message.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }
  if (message.includes('already registered') || message.includes('user already registered')) {
    return 'An account with this email already exists. Try signing in.';
  }
  if (message.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }
  if (message.includes('password') && message.includes('at least')) {
    return message.charAt(0).toUpperCase() + message.slice(1);
  }
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('failed to connect')
  ) {
    return 'Unable to connect. Please check your internet connection and try again.';
  }

  return 'Something went wrong. Please try again.';
}
