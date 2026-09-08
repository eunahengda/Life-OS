import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesInsert, TablesUpdate } from '../../types/database';

export type Vehicle = Tables<'vehicles'>;
export type VehicleUpdate = TablesUpdate<'vehicles'>;

// The canonical assets.category value that marks an asset as a Vehicle.
// assets.category is a free-form text column with no enum/type table behind
// it (see supabase/migrations) — this is a plain product convention, not a
// new type system.
export const VEHICLE_CATEGORY = 'vehicle';

// The only two units that matter for LifeOS's initial (Malaysia-first)
// audience. Not a database enum — mileage_unit is plain free-form text —
// this list exists only for the UI to offer two buttons instead of a
// freeform input, and must stay in sync with product expectations, not a
// schema constraint.
export const MILEAGE_UNITS = ['km', 'mi'] as const;

/**
 * The vehicle extension row for a given asset, if it has one. Filtering by
 * `.eq('asset_id', assetId)` alone is intentional — RLS (inherited via the
 * parent asset's household, same as warranties/maintenance_records) is what
 * actually authorizes this, not the filter itself. Returns null both when
 * the asset isn't a vehicle and when RLS hides it — indistinguishable from
 * the client's point of view, which is the point.
 */
export async function getVehicle(assetId: string): Promise<Vehicle | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('asset_id', assetId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createVehicle(
  assetId: string,
  fields: Omit<TablesInsert<'vehicles'>, 'asset_id' | 'id'>,
): Promise<Vehicle> {
  const insert: TablesInsert<'vehicles'> = { ...fields, asset_id: assetId };
  const { data, error } = await supabase.from('vehicles').insert(insert).select().single();

  if (error) throw error;
  return data;
}

export async function updateVehicle(assetId: string, updates: VehicleUpdate): Promise<Vehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('asset_id', assetId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Removes only the vehicle extension row — the underlying asset is
 * untouched and continues to exist as a normal Thing. This is deliberately
 * a different operation from deleteAsset() in assets/api.ts, which removes
 * the whole asset (and, via cascade, this row too).
 */
export async function deleteVehicle(assetId: string): Promise<void> {
  const { error } = await supabase.from('vehicles').delete().eq('asset_id', assetId);
  if (error) throw error;
}
