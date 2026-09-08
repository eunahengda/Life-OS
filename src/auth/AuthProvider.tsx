import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { supabase } from '../lib/supabase/client';
import { ensureUserSetup } from './ensureUserSetup';

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Guards ensureUserSetup against running twice at once for the same user
  // (multiple auth events can fire in quick succession — see AuthProvider's
  // onAuthStateChange handler below).
  const setupInFlight = useRef<Map<string, Promise<unknown>>>(new Map());

  const runSetup = useCallback((userId: string) => {
    const inFlight = setupInFlight.current;
    if (!inFlight.has(userId)) {
      const task = ensureUserSetup(userId)
        .catch((error: unknown) => {
          if (__DEV__) {
            console.warn('[auth] ensureUserSetup failed', error);
          }
        })
        .finally(() => {
          inFlight.delete(userId);
        });
      inFlight.set(userId, task);
    }
  }, []);

  const applySession = useCallback(
    (nextSession: Session | null) => {
      setSession(nextSession);
      setLoading(false);
      if (nextSession?.user) {
        runSetup(nextSession.user.id);
      }
    },
    [runSetup],
  );

  useEffect(() => {
    let isMounted = true;

    // Covers SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED and INITIAL_SESSION
    // uniformly: for all of them, the correct app behavior is simply "make
    // our session state match whatever Supabase now says it is."
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) applySession(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (isMounted) applySession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signUp,
      signIn,
      signOut,
    }),
    [session, loading, signUp, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
