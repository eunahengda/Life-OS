import { supabase } from '../../lib/supabase/client';
import { VEHICLE_CATEGORY } from '../vehicles/api';

const RESULT_LIMIT = 20;

// PostgREST's `.or()` filter string uses `,` and `()` as syntax delimiters.
// Stripping them from user input avoids a malformed filter (and the request
// erroring out) — this is a parsing concern, not a security one, since the
// value is never concatenated into raw SQL. Losing these two characters
// from a search query has no meaningful impact on matching.
function toPattern(query: string): string {
  return `%${query.replace(/[,()]/g, ' ').trim()}%`;
}

export type AssetSearchResult = {
  type: 'asset';
  id: string;
  name: string;
  // The internal Vehicle-specialization marker (assets.category, e.g.
  // 'vehicle') — never shown to the user directly; use `isVehicle` for that.
  category: string | null;
  // The user's own organizational category (assets.user_category) — see
  // Task 016. Independent of `isVehicle`/`category` above.
  userCategory: string | null;
  isVehicle: boolean;
  vehicleMake: string | null;
  vehicleModel: string | null;
};

export type DocumentSearchResult = {
  type: 'document';
  id: string;
  name: string;
  mimeType: string | null;
  // The asset this document is linked to, if any — used for navigation.
  // Documents have no detail screen of their own (see documents/api.ts);
  // tapping a result opens the parent asset instead.
  assetId: string | null;
};

export type WarrantySearchResult = {
  type: 'warranty';
  id: string;
  name: string | null;
  provider: string | null;
  assetId: string;
  assetName: string;
};

export type MaintenanceSearchResult = {
  type: 'maintenance';
  id: string;
  name: string;
  provider: string | null;
  assetId: string;
  assetName: string;
};

export type PropertySearchResult = {
  type: 'property';
  id: string;
  name: string;
  address: string | null;
};

export type ReminderSearchResult = {
  type: 'reminder';
  id: string;
  title: string;
  due_at: string | null;
};

export type RecurringExpenseSearchResult = {
  type: 'expense';
  id: string;
  name: string;
  category: string | null;
};

export type SearchResults = {
  assets: AssetSearchResult[];
  documents: DocumentSearchResult[];
  warranties: WarrantySearchResult[];
  maintenance: MaintenanceSearchResult[];
  properties: PropertySearchResult[];
  reminders: ReminderSearchResult[];
  expenses: RecurringExpenseSearchResult[];
};

const EMPTY_RESULTS: SearchResults = {
  assets: [],
  documents: [],
  warranties: [],
  maintenance: [],
  properties: [],
  reminders: [],
  expenses: [],
};

/**
 * Searches across Assets (including Vehicles, matched through their own
 * make/model as well as the parent asset's name/description — see the
 * merge below), Documents, Warranties, and Maintenance records.
 *
 * Every query below is a plain `ilike` against columns that already exist;
 * no new schema, no full-text index, no service-role client. RLS is what
 * actually authorizes every row returned — none of these queries filter by
 * household, exactly like every other list function in the app.
 */
export async function search(rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (!query) return EMPTY_RESULTS;

  const pattern = toPattern(query);

  const [
    assetsResult,
    vehiclesResult,
    documentsResult,
    warrantiesResult,
    maintenanceResult,
    propertiesResult,
    remindersResult,
    expensesResult,
  ] = await Promise.all([
    supabase
      .from('assets')
      .select('id, name, category, user_category, vehicles(make, model)')
      .or(`name.ilike.${pattern},description.ilike.${pattern}`)
      .limit(RESULT_LIMIT),
    supabase
      .from('vehicles')
      .select('make, model, assets(id, name, category, user_category)')
      .or(`make.ilike.${pattern},model.ilike.${pattern}`)
      .limit(RESULT_LIMIT),
    supabase
      .from('documents')
      .select('id, name, mime_type, document_links(entity_type, entity_id)')
      .ilike('name', pattern)
      .limit(RESULT_LIMIT),
    supabase
      .from('warranties')
      .select('id, name, provider, asset_id, assets(id, name)')
      .or(`name.ilike.${pattern},provider.ilike.${pattern}`)
      .limit(RESULT_LIMIT),
    supabase
      .from('maintenance_records')
      .select('id, name, provider, asset_id, assets(id, name)')
      .or(`name.ilike.${pattern},provider.ilike.${pattern}`)
      .limit(RESULT_LIMIT),
    supabase
      .from('properties')
      .select('id, name, address')
      .or(`name.ilike.${pattern},address.ilike.${pattern}`)
      .limit(RESULT_LIMIT),
    supabase
      .from('reminders')
      .select('id, title, due_at')
      .ilike('title', pattern)
      .limit(RESULT_LIMIT),
    supabase
      .from('recurring_expenses')
      .select('id, name, category')
      .ilike('name', pattern)
      .limit(RESULT_LIMIT),
  ]);

  if (assetsResult.error) throw assetsResult.error;
  if (vehiclesResult.error) throw vehiclesResult.error;
  if (documentsResult.error) throw documentsResult.error;
  if (warrantiesResult.error) throw warrantiesResult.error;
  if (maintenanceResult.error) throw maintenanceResult.error;
  if (propertiesResult.error) throw propertiesResult.error;
  if (remindersResult.error) throw remindersResult.error;
  if (expensesResult.error) throw expensesResult.error;

  // Merge the two asset-matching queries by asset id so a Vehicle whose
  // name matched (from the first query) and whose make/model also matched
  // (from the second) still appears exactly once — never duplicated across
  // "Assets" and "Vehicles", per product spec.
  const assetMap = new Map<string, AssetSearchResult>();

  for (const row of assetsResult.data ?? []) {
    assetMap.set(row.id, {
      type: 'asset',
      id: row.id,
      name: row.name,
      category: row.category,
      userCategory: row.user_category,
      isVehicle: row.category === VEHICLE_CATEGORY || row.vehicles != null,
      vehicleMake: row.vehicles?.make ?? null,
      vehicleModel: row.vehicles?.model ?? null,
    });
  }

  for (const row of vehiclesResult.data ?? []) {
    if (!row.assets) continue;
    const existing = assetMap.get(row.assets.id);
    if (existing) {
      existing.isVehicle = true;
      existing.vehicleMake = existing.vehicleMake ?? row.make;
      existing.vehicleModel = existing.vehicleModel ?? row.model;
    } else {
      assetMap.set(row.assets.id, {
        type: 'asset',
        id: row.assets.id,
        name: row.assets.name,
        category: row.assets.category,
        userCategory: row.assets.user_category,
        isVehicle: true,
        vehicleMake: row.make,
        vehicleModel: row.model,
      });
    }
  }

  const assets = Array.from(assetMap.values()).slice(0, RESULT_LIMIT);

  const documents: DocumentSearchResult[] = (documentsResult.data ?? []).map((row) => {
    const assetLink = row.document_links.find((link) => link.entity_type === 'asset');
    return {
      type: 'document',
      id: row.id,
      name: row.name,
      mimeType: row.mime_type,
      assetId: assetLink?.entity_id ?? null,
    };
  });

  const warranties: WarrantySearchResult[] = (warrantiesResult.data ?? [])
    .filter(
      (row): row is typeof row & { assets: { id: string; name: string } } => row.assets != null,
    )
    .map((row) => ({
      type: 'warranty',
      id: row.id,
      name: row.name,
      provider: row.provider,
      assetId: row.assets.id,
      assetName: row.assets.name,
    }));

  const maintenance: MaintenanceSearchResult[] = (maintenanceResult.data ?? [])
    .filter(
      (row): row is typeof row & { assets: { id: string; name: string } } => row.assets != null,
    )
    .map((row) => ({
      type: 'maintenance',
      id: row.id,
      name: row.name,
      provider: row.provider,
      assetId: row.assets.id,
      assetName: row.assets.name,
    }));

  const properties: PropertySearchResult[] = (propertiesResult.data ?? []).map((row) => ({
    type: 'property',
    id: row.id,
    name: row.name,
    address: row.address,
  }));

  const reminders: ReminderSearchResult[] = (remindersResult.data ?? []).map((row) => ({
    type: 'reminder',
    id: row.id,
    title: row.title,
    due_at: row.due_at,
  }));

  const expenses: RecurringExpenseSearchResult[] = (expensesResult.data ?? []).map((row) => ({
    type: 'expense',
    id: row.id,
    name: row.name,
    category: row.category,
  }));

  return { assets, documents, warranties, maintenance, properties, reminders, expenses };
}
