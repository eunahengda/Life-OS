import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '../../types/database';
import { supabaseConfig } from './config';

const isConfigured = Boolean(supabaseConfig.url && supabaseConfig.anonKey);

if (!isConfigured && __DEV__) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env and fill them in — Supabase calls will fail until then.',
  );
}

// Falls back to obviously-invalid placeholders so `createClient` never
// throws at import time; requests will simply fail until real env vars are
// provided, instead of crashing the whole app on startup.
export const supabase = createClient<Database>(
  supabaseConfig.url ?? 'https://missing-env-var.supabase.co',
  supabaseConfig.anonKey ?? 'missing-env-var',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

export const isSupabaseConfigured = isConfigured;
