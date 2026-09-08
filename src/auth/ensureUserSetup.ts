import { supabase } from '../lib/supabase/client';

const DEFAULT_HOUSEHOLD_NAME = 'My Household';

/**
 * Makes sure a freshly (or previously) authenticated user has everything
 * LifeOS needs to function: a profile row and membership in a household.
 *
 * Safe to call more than once for the same user — it always checks existing
 * membership before creating anything, and never creates a household if one
 * already exists. The profile itself is never created here: it's the
 * database's handle_new_user trigger's job (see supabase/migrations). If
 * it's missing, that's a backend bug, not something this function should
 * paper over.
 */
export async function ensureUserSetup(userId: string): Promise<{ householdId: string }> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) {
    throw new Error(
      'No profile found for the signed-in user. The handle_new_user database trigger ' +
        'may be missing or broken — this needs a backend fix, not a client-side workaround.',
    );
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1);

  if (membershipError) throw membershipError;

  if (memberships && memberships.length > 0) {
    return { householdId: memberships[0].household_id };
  }

  const { data: household, error: createError } = await supabase.rpc('create_household', {
    household_name: DEFAULT_HOUSEHOLD_NAME,
  });

  if (createError) throw createError;
  if (!household) {
    throw new Error('create_household did not return a household.');
  }

  return { householdId: household.id };
}
