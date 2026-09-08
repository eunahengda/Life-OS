import { supabase } from '../../lib/supabase/client';
import type { Tables, TablesUpdate } from '../../types/database';

export type Property = Tables<'properties'>;
export type PropertyUpdate = TablesUpdate<'properties'>;

// property_type is plain free text with no check constraint — the same
// UI-only-fixed-list convention as ASSET_CATEGORIES / EXPENSE_CATEGORIES /
// BILLING_CYCLES elsewhere in this app.
export const PROPERTY_TYPES = ['Home', 'Apartment', 'Condo', 'Land', 'Other'] as const;

/**
 * All properties for the current user's household. No household filter
 * here on purpose — same as listAssets(): RLS already scopes this.
 */
export async function listProperties(): Promise<Property[]> {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetches a single property by id. Filtering by `.eq('id', propertyId)`
 * alone is intentional — RLS decides visibility, same as getAsset().
 */
export async function getProperty(propertyId: string): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createProperty(
  householdId: string,
  fields: {
    name: string;
    property_type: string | null;
    address: string | null;
    notes: string | null;
  },
): Promise<Property> {
  const { data, error } = await supabase
    .from('properties')
    .insert({ ...fields, household_id: householdId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateProperty(
  propertyId: string,
  updates: PropertyUpdate,
): Promise<Property> {
  const { data, error } = await supabase
    .from('properties')
    .update(updates)
    .eq('id', propertyId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes a property. Any Asset that referenced it has property_id cleared
 * automatically by the database itself (the composite foreign key's
 * `on delete set null (property_id)` — see supabase/migrations); nothing
 * asset-related needs to happen here, and the Asset row is never touched.
 */
export async function deleteProperty(propertyId: string): Promise<void> {
  const { error } = await supabase.from('properties').delete().eq('id', propertyId);
  if (error) throw error;
}
