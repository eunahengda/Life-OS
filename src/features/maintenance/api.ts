import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database';
import { deleteSourcedReminders } from '../reminders/api';

export type MaintenanceRecord = Tables<'maintenance_records'>;
export type MaintenanceRecordInsert = TablesInsert<'maintenance_records'>;
export type MaintenanceRecordUpdate = TablesUpdate<'maintenance_records'>;

/**
 * All maintenance records for the given asset, newest first. Filtering by
 * `.eq('asset_id', assetId)` alone is intentional — RLS (inherited via the
 * parent asset's household, same as warranties) is what actually authorizes
 * this, not the filter itself.
 *
 * Ordered by `performed_at` (the actual service date, more meaningful than
 * row-creation time) descending, with `created_at` descending as a
 * tiebreaker for equal or missing dates. `nullsFirst: false` is explicit
 * because PostgREST's own default for descending order is the opposite of
 * what it is for ascending (see the equivalent note in finance/api.ts) —
 * being explicit here avoids relying on either default.
 */
export async function getAssetMaintenanceRecords(assetId: string): Promise<MaintenanceRecord[]> {
  const { data, error } = await supabase
    .from('maintenance_records')
    .select('*')
    .eq('asset_id', assetId)
    .order('performed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createMaintenanceRecord(
  assetId: string,
  fields: Omit<MaintenanceRecordInsert, 'asset_id' | 'id'>,
): Promise<MaintenanceRecord> {
  const insert: MaintenanceRecordInsert = { ...fields, asset_id: assetId };
  const { data, error } = await supabase
    .from('maintenance_records')
    .insert(insert)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateMaintenanceRecord(
  recordId: string,
  updates: MaintenanceRecordUpdate,
): Promise<MaintenanceRecord> {
  const { data, error } = await supabase
    .from('maintenance_records')
    .update(updates)
    .eq('id', recordId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes any reminder sourced from this maintenance record first — same
 * reasoning and ordering as deleteWarranty() in warranties/api.ts.
 */
export async function deleteMaintenanceRecord(recordId: string): Promise<void> {
  await deleteSourcedReminders('maintenance_record', recordId);

  const { error } = await supabase.from('maintenance_records').delete().eq('id', recordId);
  if (error) throw error;
}
