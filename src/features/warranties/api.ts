import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database';
import { deleteSourcedReminders } from '../reminders/api';

export type Warranty = Tables<'warranties'>;
export type WarrantyInsert = TablesInsert<'warranties'>;
export type WarrantyUpdate = TablesUpdate<'warranties'>;

export type WarrantyStatus = 'active' | 'expiring_soon' | 'expired';

// Matches dashboard/api.ts's own UPCOMING_WINDOW_DAYS (the existing
// "expiring soon" threshold already used for the Dashboard's warranty card)
// — reused here rather than introducing a second, conflicting threshold.
const EXPIRING_SOON_WINDOW_DAYS = 30;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// Local calendar date, not UTC — consistent with src/utils/date.ts and
// dashboard/api.ts's own todayDateString(). Small, single-purpose
// duplication rather than extracting a shared utility for three lines used
// in two places.
function todayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function addDaysDateString(base: string, days: number): string {
  const [year, month, day] = base.split('-').map(Number);
  const d = new Date(year, month - 1, day + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Deterministic, date-only status — warranties has no status column of its
 * own. Plain string comparison against YYYY-MM-DD is safe and intentional
 * (see src/utils/date.ts): expiry_date < today → expired; within the next
 * 30 days → expiring_soon; otherwise active. Returns null when there's no
 * expiry date to judge by.
 */
export function getWarrantyStatus(expiryDate: string | null): WarrantyStatus | null {
  if (!expiryDate) return null;
  const today = todayDateString();
  if (expiryDate < today) return 'expired';
  if (expiryDate <= addDaysDateString(today, EXPIRING_SOON_WINDOW_DAYS)) return 'expiring_soon';
  return 'active';
}

/**
 * All warranties for the given asset. Filtering by `.eq('asset_id', assetId)`
 * alone is intentional — RLS (inherited via the parent asset's household,
 * same as every other asset-owned table) is what actually authorizes this,
 * not the filter itself.
 */
export async function getAssetWarranties(assetId: string): Promise<Warranty[]> {
  const { data, error } = await supabase
    .from('warranties')
    .select('*')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createWarranty(
  assetId: string,
  fields: Omit<WarrantyInsert, 'asset_id' | 'id'>,
): Promise<Warranty> {
  const insert: WarrantyInsert = { ...fields, asset_id: assetId };
  const { data, error } = await supabase.from('warranties').insert(insert).select().single();

  if (error) throw error;
  return data;
}

export async function updateWarranty(
  warrantyId: string,
  updates: WarrantyUpdate,
): Promise<Warranty> {
  const { data, error } = await supabase
    .from('warranties')
    .update(updates)
    .eq('id', warrantyId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes any reminder sourced from this warranty first, so deleting it
 * never leaves a "Warranty expiring" reminder pointing at nothing — see
 * deleteSourcedReminders() in reminders/api.ts. If that step fails, the
 * warranty itself is left untouched rather than deleted with an orphaned
 * reminder still around.
 */
export async function deleteWarranty(warrantyId: string): Promise<void> {
  await deleteSourcedReminders('warranty', warrantyId);

  const { error } = await supabase.from('warranties').delete().eq('id', warrantyId);
  if (error) throw error;
}
