import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AssetPhoto,
  deleteAssetPhoto,
  getAssetPhotoUrl,
  listAssetPhotos,
  PickedImage,
  uploadAssetPhoto,
} from '../../src/features/assetPhotos/api';
import {
  ASSET_CATEGORIES,
  Asset,
  AssetUpdate,
  deleteAsset,
  getAsset,
  updateAsset,
} from '../../src/features/assets/api';
import {
  AssetDocument,
  Document,
  deleteDocument,
  downloadDocument,
  getDocumentUrl,
  listAssetDocuments,
  PickedFile,
  unlinkDocumentFromAsset,
  uploadDocumentForAsset,
} from '../../src/features/documents/api';
import {
  createMaintenanceRecord,
  deleteMaintenanceRecord,
  getAssetMaintenanceRecords,
  MaintenanceRecord,
  updateMaintenanceRecord,
} from '../../src/features/maintenance/api';
import {
  createWarranty,
  deleteWarranty,
  getAssetWarranties,
  getWarrantyStatus,
  updateWarranty,
  Warranty,
  WarrantyStatus,
} from '../../src/features/warranties/api';
import { createSourcedReminder, dateStringToIsoMidnight } from '../../src/features/reminders/api';
import { listProperties, Property } from '../../src/features/properties/api';
import {
  deleteVehicle,
  getVehicle,
  MILEAGE_UNITS,
  updateVehicle,
  Vehicle,
  VEHICLE_CATEGORY,
} from '../../src/features/vehicles/api';
import { Button, Card, DateField, ErrorState, LoadingState, Screen } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { spacing } from '../../src/constants/spacing';
import { formatDisplayDate, isValidDateString } from '../../src/utils/date';

type LoadStatus = 'loading' | 'loaded' | 'not-found' | 'error';
type Mode = 'view' | 'edit';

type Draft = {
  name: string;
  userCategory: string;
  description: string;
  modelNumber: string;
  serialNumber: string;
  purchaseDate: string;
  purchasePrice: string;
  currency: string;
  merchant: string;
  notes: string;
  propertyId: string;
};

function toDraft(asset: Asset): Draft {
  return {
    name: asset.name,
    userCategory: asset.user_category ?? '',
    description: asset.description ?? '',
    modelNumber: asset.model_number ?? '',
    serialNumber: asset.serial_number ?? '',
    purchaseDate: asset.purchase_date ?? '',
    purchasePrice: asset.purchase_price != null ? String(asset.purchase_price) : '',
    currency: asset.currency ?? '',
    merchant: asset.merchant ?? '',
    notes: asset.notes ?? '',
    propertyId: asset.property_id ?? '',
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatPrice(price: number, currency: string | null): string {
  const amount = price.toLocaleString();
  return currency ? `${currency} ${amount}` : amount;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeDocument(document: Document): string {
  const kind = document.mime_type === 'application/pdf' ? 'PDF' : 'Image';
  const size = formatFileSize(document.file_size);
  const base = size ? `${kind} · ${size}` : kind;
  return document.document_type ? `${document.document_type} · ${base}` : base;
}

function isImage(document: Document): boolean {
  return Boolean(document.mime_type?.startsWith('image/'));
}

type DocumentsStatus = 'loading' | 'loaded' | 'error';

function describeWarranty(warranty: Warranty): string {
  if (warranty.expiry_date) return `Expires ${formatDisplayDate(warranty.expiry_date)}`;
  if (warranty.start_date) return `Started ${formatDisplayDate(warranty.start_date)}`;
  return warranty.provider ?? '';
}

const WARRANTY_STATUS_LABELS: Record<WarrantyStatus, string> = {
  active: 'Active',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
};

function warrantyStatusStyle(status: WarrantyStatus) {
  if (status === 'expired') return { color: colors.danger, fontWeight: '600' as const };
  if (status === 'expiring_soon') return { color: colors.primary, fontWeight: '600' as const };
  return { color: colors.textMuted };
}

type WarrantiesStatus = 'loading' | 'loaded' | 'error';
type WarrantyFormMode = 'closed' | 'add' | string;

type WarrantyDraft = {
  name: string;
  provider: string;
  warrantyNumber: string;
  startDate: string;
  expiryDate: string;
  notes: string;
};

const EMPTY_WARRANTY_DRAFT: WarrantyDraft = {
  name: '',
  provider: '',
  warrantyNumber: '',
  startDate: '',
  expiryDate: '',
  notes: '',
};

function toWarrantyDraft(warranty: Warranty): WarrantyDraft {
  return {
    name: warranty.name ?? '',
    provider: warranty.provider ?? '',
    warrantyNumber: warranty.warranty_number ?? '',
    startDate: warranty.start_date ?? '',
    expiryDate: warranty.expiry_date ?? '',
    notes: warranty.notes ?? '',
  };
}

type MaintenanceStatus = 'loading' | 'loaded' | 'error';
type MaintenanceFormMode = 'closed' | 'add' | string;

type MaintenanceDraft = {
  name: string;
  provider: string;
  performedAt: string;
  cost: string;
  currency: string;
  nextDueDate: string;
  nextDueMileage: string;
  notes: string;
};

const EMPTY_MAINTENANCE_DRAFT: MaintenanceDraft = {
  name: '',
  provider: '',
  performedAt: '',
  cost: '',
  currency: '',
  nextDueDate: '',
  nextDueMileage: '',
  notes: '',
};

function toMaintenanceDraft(record: MaintenanceRecord): MaintenanceDraft {
  return {
    name: record.name,
    provider: record.provider ?? '',
    performedAt: record.performed_at ?? '',
    cost: record.cost != null ? String(record.cost) : '',
    currency: record.currency ?? '',
    nextDueDate: record.next_due_date ?? '',
    nextDueMileage: record.next_due_mileage != null ? String(record.next_due_mileage) : '',
    notes: record.notes ?? '',
  };
}

function describeMaintenance(record: MaintenanceRecord): string {
  if (record.next_due_date) return `Next due ${formatDisplayDate(record.next_due_date)}`;
  if (record.performed_at) return `Last serviced ${formatDisplayDate(record.performed_at)}`;
  return record.provider ?? '';
}

type VehicleStatus = 'loading' | 'loaded' | 'error';
type VehicleMode = 'view' | 'edit';

type VehicleDraft = {
  make: string;
  model: string;
  year: string;
  licensePlate: string;
  vin: string;
  currentMileage: string;
  mileageUnit: string;
};

function toVehicleDraft(vehicle: Vehicle): VehicleDraft {
  return {
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    year: vehicle.year != null ? String(vehicle.year) : '',
    licensePlate: vehicle.license_plate ?? '',
    vin: vehicle.vin ?? '',
    currentMileage: vehicle.current_mileage != null ? String(vehicle.current_mileage) : '',
    mileageUnit: vehicle.mileage_unit,
  };
}

function formatMileage(vehicle: Vehicle): string {
  if (vehicle.current_mileage == null) return '';
  return `${vehicle.current_mileage.toLocaleString()} ${vehicle.mileage_unit}`;
}

const hasAnyVehicleDetails = (vehicle: Vehicle): boolean =>
  Boolean(
    vehicle.make ||
    vehicle.model ||
    vehicle.year != null ||
    vehicle.license_plate ||
    vehicle.vin ||
    vehicle.current_mileage != null,
  );

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmDeleteAsset, setConfirmDeleteAsset] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState(false);
  const [deleteAssetError, setDeleteAssetError] = useState('');

  const [photos, setPhotos] = useState<AssetPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photosStatus, setPhotosStatus] = useState<DocumentsStatus>('loading');
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState('');
  const [photoPreview, setPhotoPreview] = useState<{ photo: AssetPhoto; url: string } | null>(null);
  const [confirmDeletePhoto, setConfirmDeletePhoto] = useState(false);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [deletePhotoError, setDeletePhotoError] = useState('');

  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [vehicleStatus, setVehicleStatus] = useState<VehicleStatus>('loading');
  const [vehicleMode, setVehicleMode] = useState<VehicleMode>('view');
  const [vehicleDraft, setVehicleDraft] = useState<VehicleDraft | null>(null);
  const [vehicleSaving, setVehicleSaving] = useState(false);
  const [vehicleSaveError, setVehicleSaveError] = useState('');
  const [confirmRemoveVehicle, setConfirmRemoveVehicle] = useState(false);
  const [removingVehicle, setRemovingVehicle] = useState(false);
  const [removeVehicleError, setRemoveVehicleError] = useState('');

  const [documents, setDocuments] = useState<AssetDocument[]>([]);
  const [documentsStatus, setDocumentsStatus] = useState<DocumentsStatus>('loading');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [previewError, setPreviewError] = useState('');

  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [warrantiesStatus, setWarrantiesStatus] = useState<WarrantiesStatus>('loading');
  const [warrantyFormMode, setWarrantyFormMode] = useState<WarrantyFormMode>('closed');
  const [warrantyDraft, setWarrantyDraft] = useState<WarrantyDraft | null>(null);
  const [warrantySaving, setWarrantySaving] = useState(false);
  const [warrantyError, setWarrantyError] = useState('');
  const [confirmDeleteWarrantyId, setConfirmDeleteWarrantyId] = useState<string | null>(null);
  const [deletingWarranty, setDeletingWarranty] = useState(false);
  const [deleteWarrantyError, setDeleteWarrantyError] = useState('');

  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus>('loading');
  const [maintenanceFormMode, setMaintenanceFormMode] = useState<MaintenanceFormMode>('closed');
  const [maintenanceDraft, setMaintenanceDraft] = useState<MaintenanceDraft | null>(null);
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState('');
  const [confirmDeleteMaintenanceId, setConfirmDeleteMaintenanceId] = useState<string | null>(null);
  const [deletingMaintenance, setDeletingMaintenance] = useState(false);
  const [deleteMaintenanceError, setDeleteMaintenanceError] = useState('');

  const [addingReminderFor, setAddingReminderFor] = useState<string | null>(null);
  const [reminderAddedFor, setReminderAddedFor] = useState<Set<string>>(new Set());
  const [reminderError, setReminderError] = useState('');

  const [properties, setProperties] = useState<Property[]>([]);

  // Fetched once on mount, same convention as the Add screen's Property
  // selector — the list is small and used only to render the selector and
  // resolve the currently-linked property's name for display.
  useEffect(() => {
    listProperties()
      .then(setProperties)
      .catch((error) => {
        if (__DEV__) console.warn('[properties] list failed', error);
      });
  }, []);

  const loadMaintenanceRecords = useCallback(async (assetId: string) => {
    setMaintenanceStatus('loading');
    try {
      const data = await getAssetMaintenanceRecords(assetId);
      setMaintenanceRecords(data);
      setMaintenanceStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[maintenance] getAssetMaintenanceRecords failed', error);
      setMaintenanceStatus('error');
    }
  }, []);

  const loadWarranties = useCallback(async (assetId: string) => {
    setWarrantiesStatus('loading');
    try {
      const data = await getAssetWarranties(assetId);
      setWarranties(data);
      setWarrantiesStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[warranties] getAssetWarranties failed', error);
      setWarrantiesStatus('error');
    }
  }, []);

  const loadVehicle = useCallback(async (assetId: string) => {
    setVehicleStatus('loading');
    try {
      const data = await getVehicle(assetId);
      setVehicle(data);
      setVehicleStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[vehicles] getVehicle failed', error);
      setVehicleStatus('error');
    }
  }, []);

  const loadPhotos = useCallback(async (assetId: string) => {
    setPhotosStatus('loading');
    try {
      const data = await listAssetPhotos(assetId);
      const urls = await Promise.all(data.map((photo) => getAssetPhotoUrl(photo.storage_path)));
      const urlMap: Record<string, string> = {};
      data.forEach((photo, index) => {
        urlMap[photo.id] = urls[index];
      });
      setPhotos(data);
      setPhotoUrls(urlMap);
      setPhotosStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[assetPhotos] listAssetPhotos failed', error);
      setPhotosStatus('error');
    }
  }, []);

  const loadDocuments = useCallback(async (assetId: string) => {
    setDocumentsStatus('loading');
    try {
      const data = await listAssetDocuments(assetId);
      setDocuments(data);
      setDocumentsStatus('loaded');
    } catch (error) {
      if (__DEV__) console.warn('[documents] listAssetDocuments failed', error);
      setDocumentsStatus('error');
    }
  }, []);

  const load = useCallback(async () => {
    if (!id) {
      setStatus('not-found');
      return;
    }
    setStatus('loading');
    try {
      const data = await getAsset(id);
      if (!data) {
        setStatus('not-found');
        return;
      }
      setAsset(data);
      setStatus('loaded');
      void loadVehicle(data.id);
      void loadPhotos(data.id);
      void loadDocuments(data.id);
      void loadWarranties(data.id);
      void loadMaintenanceRecords(data.id);
    } catch (error) {
      if (__DEV__) console.warn('[assets] getAsset failed', error);
      setStatus('error');
    }
  }, [id, loadVehicle, loadPhotos, loadDocuments, loadWarranties, loadMaintenanceRecords]);

  // useFocusEffect (not plain useEffect) so returning to this screen after
  // an edit elsewhere always shows current data, consistent with how the
  // Life list refetches on focus.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const startEdit = () => {
    if (!asset) return;
    setDraft(toDraft(asset));
    setSaveError('');
    setMode('edit');
  };

  const cancelEdit = () => {
    setDraft(null);
    setSaveError('');
    setMode('view');
  };

  const updateDraft = (field: keyof Draft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSave = async () => {
    if (saving || !draft || !asset) return;

    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setSaveError('Please enter a name.');
      return;
    }

    const trimmedDate = draft.purchaseDate.trim();
    if (trimmedDate && !DATE_PATTERN.test(trimmedDate)) {
      setSaveError('Please enter a valid date (YYYY-MM-DD).');
      return;
    }

    let purchasePrice: number | null = null;
    const trimmedPrice = draft.purchasePrice.trim();
    if (trimmedPrice) {
      purchasePrice = Number(trimmedPrice);
      if (!Number.isFinite(purchasePrice)) {
        setSaveError('Please enter a valid price.');
        return;
      }
    }

    setSaving(true);
    setSaveError('');
    try {
      const updates: AssetUpdate = {
        name: trimmedName,
        user_category: draft.userCategory || null,
        description: draft.description.trim() || null,
        model_number: draft.modelNumber.trim() || null,
        serial_number: draft.serialNumber.trim() || null,
        purchase_date: trimmedDate || null,
        purchase_price: purchasePrice,
        currency: draft.currency.trim() || null,
        merchant: draft.merchant.trim() || null,
        notes: draft.notes.trim() || null,
        property_id: draft.propertyId || null,
      };
      const updated = await updateAsset(asset.id, updates);
      setAsset(updated);
      setDraft(null);
      setMode('view');
    } catch (error) {
      if (__DEV__) console.warn('[assets] updateAsset failed', error);
      setSaveError('Unable to save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAsset = async () => {
    if (deletingAsset || !asset) return;
    setDeletingAsset(true);
    setDeleteAssetError('');
    try {
      await deleteAsset(asset.id);
      router.replace('/life');
    } catch (error) {
      if (__DEV__) console.warn('[assets] deleteAsset failed', error);
      setDeleteAssetError('Unable to delete this item. Please try again.');
      setDeletingAsset(false);
    }
  };

  const runPhotoUpload = async (file: PickedImage) => {
    if (photoUploading || !asset) return;
    setPhotoUploading(true);
    setPhotoUploadError('');
    try {
      const added = await uploadAssetPhoto(asset.household_id, asset.id, file);
      const url = await getAssetPhotoUrl(added.storage_path);
      setPhotos((current) => [...current, added]);
      setPhotoUrls((current) => ({ ...current, [added.id]: url }));
    } catch (error) {
      if (__DEV__) console.warn('[assetPhotos] upload failed', error);
      setPhotoUploadError('Unable to add this photo. Please try again.');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleChoosePhotoFromLibrary = async () => {
    setPhotoPickerOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    const picked = result.canceled ? null : result.assets[0];
    if (!picked) return;
    await runPhotoUpload({
      uri: picked.uri,
      name: picked.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: picked.mimeType ?? 'image/jpeg',
    });
  };

  // launchCameraAsync has no native camera to call on Expo Web — it throws
  // there. Requesting permission first is what the native (iOS/Android)
  // runtimes require before the camera can open.
  const handleTakePhoto = async () => {
    setPhotoPickerOpen(false);
    setPhotoUploadError('');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPhotoUploadError('Camera permission was not granted.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] });
      const picked = result.canceled ? null : result.assets[0];
      if (!picked) return;
      await runPhotoUpload({
        uri: picked.uri,
        name: picked.fileName ?? `photo-${Date.now()}.jpg`,
        mimeType: picked.mimeType ?? 'image/jpeg',
      });
    } catch (error) {
      if (__DEV__) console.warn('[assetPhotos] camera capture failed', error);
      setPhotoUploadError('Camera is not available on this device.');
    }
  };

  const openPhotoPreview = (photo: AssetPhoto) => {
    const url = photoUrls[photo.id];
    if (!url) return;
    setPhotoPreview({ photo, url });
    setConfirmDeletePhoto(false);
    setDeletePhotoError('');
  };

  const closePhotoPreview = () => {
    setPhotoPreview(null);
    setConfirmDeletePhoto(false);
    setDeletePhotoError('');
  };

  const handleDeletePhoto = async () => {
    if (deletingPhoto || !photoPreview) return;
    const { photo } = photoPreview;
    setDeletingPhoto(true);
    setDeletePhotoError('');
    try {
      await deleteAssetPhoto(photo);
      setPhotos((current) => current.filter((p) => p.id !== photo.id));
      setPhotoUrls((current) => {
        const next = { ...current };
        delete next[photo.id];
        return next;
      });
      setPhotoPreview(null);
      setConfirmDeletePhoto(false);
    } catch (error) {
      if (__DEV__) console.warn('[assetPhotos] delete failed', error);
      setDeletePhotoError('Unable to delete this photo. Please try again.');
    } finally {
      setDeletingPhoto(false);
    }
  };

  const startEditVehicle = () => {
    if (!vehicle) return;
    setVehicleDraft(toVehicleDraft(vehicle));
    setVehicleSaveError('');
    setVehicleMode('edit');
  };

  const cancelVehicleForm = () => {
    setVehicleDraft(null);
    setVehicleSaveError('');
    setVehicleMode('view');
  };

  const updateVehicleDraft = (field: keyof VehicleDraft, value: string) => {
    setVehicleDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSaveVehicle = async () => {
    if (vehicleSaving || !vehicleDraft || !asset) return;

    let year: number | null = null;
    const trimmedYear = vehicleDraft.year.trim();
    if (trimmedYear) {
      year = Number(trimmedYear);
      const currentYear = new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1900 || year > currentYear + 1) {
        setVehicleSaveError('Please enter a valid year.');
        return;
      }
    }

    let currentMileage: number | null = null;
    const trimmedMileage = vehicleDraft.currentMileage.trim();
    if (trimmedMileage) {
      currentMileage = Number(trimmedMileage);
      if (!Number.isFinite(currentMileage) || currentMileage < 0) {
        setVehicleSaveError('Please enter a valid mileage.');
        return;
      }
    }

    setVehicleSaving(true);
    setVehicleSaveError('');
    try {
      const updated = await updateVehicle(asset.id, {
        make: vehicleDraft.make.trim() || null,
        model: vehicleDraft.model.trim() || null,
        year,
        license_plate: vehicleDraft.licensePlate.trim() || null,
        vin: vehicleDraft.vin.trim() || null,
        current_mileage: currentMileage,
        mileage_unit: vehicleDraft.mileageUnit,
      });
      setVehicle(updated);
      setVehicleDraft(null);
      setVehicleMode('view');
    } catch (error) {
      if (__DEV__) console.warn('[vehicles] update failed', error);
      setVehicleSaveError('Unable to save vehicle information. Please try again.');
    } finally {
      setVehicleSaving(false);
    }
  };

  const handleRemoveVehicle = async () => {
    if (removingVehicle || !asset) return;
    setRemovingVehicle(true);
    setRemoveVehicleError('');
    try {
      await deleteVehicle(asset.id);
      setVehicle(null);
      setConfirmRemoveVehicle(false);

      // Best-effort: also clear the internal 'vehicle' category tag so the
      // asset actually reads as a normal Thing again (e.g. in the Life
      // list). The vehicle row is already gone at this point either way,
      // so a failure here doesn't undo the removal itself — just log it.
      if (asset.category === VEHICLE_CATEGORY) {
        try {
          const updated = await updateAsset(asset.id, { category: null });
          setAsset(updated);
        } catch (categoryError) {
          if (__DEV__) {
            console.warn('[vehicles] clearing category after removal failed', categoryError);
          }
        }
      }
    } catch (error) {
      if (__DEV__) console.warn('[vehicles] remove failed', error);
      setRemoveVehicleError('Unable to remove vehicle details. Please try again.');
    } finally {
      setRemovingVehicle(false);
    }
  };

  const runUpload = async (file: PickedFile) => {
    if (uploading || !asset) return;
    setUploading(true);
    setUploadError('');
    try {
      const added = await uploadDocumentForAsset(asset.household_id, asset.id, file);
      setDocuments((current) => [added, ...current]);
    } catch (error) {
      if (__DEV__) console.warn('[documents] upload failed', error);
      setUploadError('Unable to add this document. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleChoosePhoto = async () => {
    setPickerOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    const picked = result.canceled ? null : result.assets[0];
    if (!picked) return;
    await runUpload({
      uri: picked.uri,
      name: picked.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: picked.mimeType ?? 'image/jpeg',
      size: picked.fileSize ?? null,
    });
  };

  const handleChooseFile = async () => {
    setPickerOpen(false);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
    });
    const picked = result.canceled ? null : result.assets[0];
    if (!picked) return;
    await runUpload({
      uri: picked.uri,
      name: picked.name,
      mimeType: picked.mimeType ?? 'application/octet-stream',
      size: picked.size ?? null,
    });
  };

  const openDocument = async (document: Document) => {
    setPreviewError('');
    try {
      const url = await getDocumentUrl(document.file_path);
      if (isImage(document)) {
        setPreview({ url, name: document.name });
      } else {
        await Linking.openURL(url);
      }
    } catch (error) {
      if (__DEV__) console.warn('[documents] open failed', error);
      setPreviewError('Unable to open this document. Please try again.');
    }
  };

  const handleDelete = async (item: AssetDocument) => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteDocument(item.document);
      setDocuments((current) => current.filter((entry) => entry.linkId !== item.linkId));
      setConfirmDeleteId(null);
    } catch (error) {
      if (__DEV__) console.warn('[documents] delete failed', error);
      setDeleteError('Unable to delete this document. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  /**
   * Removes only this asset's link to the document — the document itself
   * stays in the household's Documents list. Deliberately no confirmation
   * step, matching the Finance "Mark inactive" convention for reversible,
   * non-destructive actions (unlike handleDelete, which is destructive).
   */
  const handleUnlink = async (item: AssetDocument) => {
    if (unlinkingId) return;
    setUnlinkingId(item.linkId);
    setUnlinkError('');
    try {
      await unlinkDocumentFromAsset(item.linkId);
      setDocuments((current) => current.filter((entry) => entry.linkId !== item.linkId));
    } catch (error) {
      if (__DEV__) console.warn('[documents] unlink failed', error);
      setUnlinkError('Unable to remove this document from the asset. Please try again.');
    } finally {
      setUnlinkingId(null);
    }
  };

  /**
   * Saves the document back to the device — conceptually separate from
   * View (openDocument, above) and Delete/Remove (below): never touches the
   * document row or its Storage object (Task 030).
   */
  const handleDownload = async (item: AssetDocument) => {
    if (downloadingId) return;
    setDownloadingId(item.linkId);
    setDownloadError('');
    try {
      await downloadDocument(item.document);
    } catch (error) {
      if (__DEV__) console.warn('[documents] download failed', error);
      setDownloadError('Unable to download this document. Please try again.');
    } finally {
      setDownloadingId(null);
    }
  };

  const startAddWarranty = () => {
    setWarrantyDraft(EMPTY_WARRANTY_DRAFT);
    setWarrantyError('');
    setWarrantyFormMode('add');
  };

  const startEditWarranty = (warranty: Warranty) => {
    setWarrantyDraft(toWarrantyDraft(warranty));
    setWarrantyError('');
    setWarrantyFormMode(warranty.id);
  };

  const cancelWarrantyForm = () => {
    setWarrantyDraft(null);
    setWarrantyError('');
    setWarrantyFormMode('closed');
  };

  const updateWarrantyDraft = (field: keyof WarrantyDraft, value: string) => {
    setWarrantyDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSaveWarranty = async () => {
    if (warrantySaving || !warrantyDraft || !asset || warrantyFormMode === 'closed') return;

    // Warranty Name is optional (Task 030) — the parent Asset already
    // provides the context, so nothing here requires the user to invent a
    // second name for something that only ever belongs to this one asset.
    const trimmedName = warrantyDraft.name.trim();

    const trimmedStart = warrantyDraft.startDate.trim();
    if (trimmedStart && !isValidDateString(trimmedStart)) {
      setWarrantyError('Please enter a valid start date (YYYY-MM-DD).');
      return;
    }

    const trimmedExpiry = warrantyDraft.expiryDate.trim();
    if (trimmedExpiry && !isValidDateString(trimmedExpiry)) {
      setWarrantyError('Please enter a valid expiry date (YYYY-MM-DD).');
      return;
    }

    setWarrantySaving(true);
    setWarrantyError('');
    try {
      const fields = {
        name: trimmedName || null,
        provider: warrantyDraft.provider.trim() || null,
        warranty_number: warrantyDraft.warrantyNumber.trim() || null,
        start_date: trimmedStart || null,
        expiry_date: trimmedExpiry || null,
        notes: warrantyDraft.notes.trim() || null,
      };

      if (warrantyFormMode === 'add') {
        const created = await createWarranty(asset.id, fields);
        setWarranties((current) => [...current, created]);
      } else {
        const updated = await updateWarranty(warrantyFormMode, fields);
        setWarranties((current) => current.map((w) => (w.id === updated.id ? updated : w)));
      }
      setWarrantyDraft(null);
      setWarrantyFormMode('closed');
    } catch (error) {
      if (__DEV__) console.warn('[warranties] save failed', error);
      setWarrantyError('Unable to save this warranty. Please try again.');
    } finally {
      setWarrantySaving(false);
    }
  };

  const handleDeleteWarranty = async (warrantyId: string) => {
    if (deletingWarranty) return;
    setDeletingWarranty(true);
    setDeleteWarrantyError('');
    try {
      await deleteWarranty(warrantyId);
      setWarranties((current) => current.filter((w) => w.id !== warrantyId));
      setConfirmDeleteWarrantyId(null);
    } catch (error) {
      if (__DEV__) console.warn('[warranties] delete failed', error);
      setDeleteWarrantyError('Unable to delete this warranty. Please try again.');
    } finally {
      setDeletingWarranty(false);
    }
  };

  const startAddMaintenance = () => {
    setMaintenanceDraft(EMPTY_MAINTENANCE_DRAFT);
    setMaintenanceError('');
    setMaintenanceFormMode('add');
  };

  const startEditMaintenance = (record: MaintenanceRecord) => {
    setMaintenanceDraft(toMaintenanceDraft(record));
    setMaintenanceError('');
    setMaintenanceFormMode(record.id);
  };

  const cancelMaintenanceForm = () => {
    setMaintenanceDraft(null);
    setMaintenanceError('');
    setMaintenanceFormMode('closed');
  };

  const updateMaintenanceDraft = (field: keyof MaintenanceDraft, value: string) => {
    setMaintenanceDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const handleSaveMaintenance = async () => {
    if (maintenanceSaving || !maintenanceDraft || !asset || maintenanceFormMode === 'closed') {
      return;
    }

    const trimmedName = maintenanceDraft.name.trim();
    if (!trimmedName) {
      setMaintenanceError('Please enter a name.');
      return;
    }

    const trimmedPerformedAt = maintenanceDraft.performedAt.trim();
    if (trimmedPerformedAt && !isValidDateString(trimmedPerformedAt)) {
      setMaintenanceError('Please enter a valid date performed (YYYY-MM-DD).');
      return;
    }

    const trimmedNextDueDate = maintenanceDraft.nextDueDate.trim();
    if (trimmedNextDueDate && !isValidDateString(trimmedNextDueDate)) {
      setMaintenanceError('Please enter a valid next due date (YYYY-MM-DD).');
      return;
    }

    let cost: number | null = null;
    const trimmedCost = maintenanceDraft.cost.trim();
    if (trimmedCost) {
      cost = Number(trimmedCost);
      if (!Number.isFinite(cost)) {
        setMaintenanceError('Please enter a valid cost.');
        return;
      }
    }

    let nextDueMileage: number | null = null;
    const trimmedMileage = maintenanceDraft.nextDueMileage.trim();
    if (trimmedMileage) {
      nextDueMileage = Number(trimmedMileage);
      if (!Number.isFinite(nextDueMileage)) {
        setMaintenanceError('Please enter a valid mileage.');
        return;
      }
    }

    setMaintenanceSaving(true);
    setMaintenanceError('');
    try {
      const fields = {
        name: trimmedName,
        provider: maintenanceDraft.provider.trim() || null,
        performed_at: trimmedPerformedAt || null,
        cost,
        currency: maintenanceDraft.currency.trim() || null,
        next_due_date: trimmedNextDueDate || null,
        next_due_mileage: nextDueMileage,
        notes: maintenanceDraft.notes.trim() || null,
      };

      if (maintenanceFormMode === 'add') {
        const created = await createMaintenanceRecord(asset.id, fields);
        // Prepended, matching getAssetMaintenanceRecords()'s newest-first
        // order — a freshly-added record is the newest by created_at even
        // if its performed_at happens to predate an existing entry.
        setMaintenanceRecords((current) => [created, ...current]);
      } else {
        const updated = await updateMaintenanceRecord(maintenanceFormMode, fields);
        setMaintenanceRecords((current) => current.map((r) => (r.id === updated.id ? updated : r)));
      }
      setMaintenanceDraft(null);
      setMaintenanceFormMode('closed');
    } catch (error) {
      if (__DEV__) console.warn('[maintenance] save failed', error);
      setMaintenanceError('Unable to save this maintenance record. Please try again.');
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const handleDeleteMaintenance = async (recordId: string) => {
    if (deletingMaintenance) return;
    setDeletingMaintenance(true);
    setDeleteMaintenanceError('');
    try {
      await deleteMaintenanceRecord(recordId);
      setMaintenanceRecords((current) => current.filter((r) => r.id !== recordId));
      setConfirmDeleteMaintenanceId(null);
    } catch (error) {
      if (__DEV__) console.warn('[maintenance] delete failed', error);
      setDeleteMaintenanceError('Unable to delete this maintenance record. Please try again.');
    } finally {
      setDeletingMaintenance(false);
    }
  };

  /**
   * One-shot manual action: creates a single reminders row referencing this
   * warranty/maintenance record (source_type + source_id), reusing the
   * existing polymorphic Reminder architecture. Nothing here schedules a
   * notification or ever creates a reminder automatically — the record
   * itself is the entire feature.
   */
  const handleAddReminder = async (
    sourceType: 'warranty' | 'maintenance_record',
    sourceId: string,
    title: string,
    dueDate: string | null,
  ) => {
    if (addingReminderFor || !asset || reminderAddedFor.has(sourceId)) return;
    setAddingReminderFor(sourceId);
    setReminderError('');
    try {
      await createSourcedReminder(asset.household_id, {
        title,
        due_at: dueDate ? dateStringToIsoMidnight(dueDate) : null,
        source_type: sourceType,
        source_id: sourceId,
      });
      setReminderAddedFor((current) => new Set(current).add(sourceId));
    } catch (error) {
      if (__DEV__) console.warn('[reminders] add from asset failed', error);
      setReminderError('Unable to add a reminder. Please try again.');
    } finally {
      setAddingReminderFor(null);
    }
  };

  const backLink = (
    <Text style={styles.back} onPress={() => router.back()}>
      ‹ Back
    </Text>
  );

  if (status === 'loading') {
    return (
      <Screen>
        {backLink}
        <LoadingState message="Loading…" />
      </Screen>
    );
  }

  if (status === 'not-found') {
    return (
      <Screen>
        {backLink}
        <ErrorState message="This item could not be found." />
      </Screen>
    );
  }

  if (status === 'error' || !asset) {
    return (
      <Screen>
        {backLink}
        <ErrorState message="Unable to load this item." onRetry={load} />
      </Screen>
    );
  }

  if (mode === 'edit' && draft) {
    return (
      <Screen>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {backLink}
          <Text style={styles.title}>Edit</Text>

          <Field label="Name *">
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(value) => updateDraft('name', value)}
              editable={!saving}
            />
          </Field>

          <Text style={styles.sectionTitle}>Information</Text>
          <Field label="Category">
            <View style={styles.categoryRow}>
              <Button
                label="None"
                variant={draft.userCategory === '' ? 'primary' : 'secondary'}
                onPress={() => updateDraft('userCategory', '')}
                disabled={saving}
                style={styles.categoryButton}
              />
              {ASSET_CATEGORIES.map((category) => (
                <Button
                  key={category}
                  label={category}
                  variant={draft.userCategory === category ? 'primary' : 'secondary'}
                  onPress={() => updateDraft('userCategory', category)}
                  disabled={saving}
                  style={styles.categoryButton}
                />
              ))}
            </View>
          </Field>
          <Field label="Property">
            <View style={styles.categoryRow}>
              <Button
                label="None"
                variant={draft.propertyId === '' ? 'primary' : 'secondary'}
                onPress={() => updateDraft('propertyId', '')}
                disabled={saving}
                style={styles.categoryButton}
              />
              {properties.map((property) => (
                <Button
                  key={property.id}
                  label={property.name}
                  variant={draft.propertyId === property.id ? 'primary' : 'secondary'}
                  onPress={() => updateDraft('propertyId', property.id)}
                  disabled={saving}
                  style={styles.categoryButton}
                />
              ))}
            </View>
          </Field>
          <Field label="Description">
            <TextInput
              style={styles.input}
              value={draft.description}
              onChangeText={(value) => updateDraft('description', value)}
              editable={!saving}
            />
          </Field>
          <Field label="Model">
            <TextInput
              style={styles.input}
              value={draft.modelNumber}
              onChangeText={(value) => updateDraft('modelNumber', value)}
              editable={!saving}
            />
          </Field>
          <Field label="Serial Number">
            <TextInput
              style={styles.input}
              value={draft.serialNumber}
              onChangeText={(value) => updateDraft('serialNumber', value)}
              editable={!saving}
            />
          </Field>

          <Text style={styles.sectionTitle}>Purchase Information</Text>
          <Field label="Purchase Date">
            <DateField
              value={draft.purchaseDate}
              onChange={(value) => updateDraft('purchaseDate', value)}
              disabled={saving}
            />
          </Field>
          <Field label="Purchase Price">
            <TextInput
              style={styles.input}
              value={draft.purchasePrice}
              onChangeText={(value) => updateDraft('purchasePrice', value)}
              keyboardType="decimal-pad"
              editable={!saving}
            />
          </Field>
          <Field label="Currency">
            <TextInput
              style={styles.input}
              value={draft.currency}
              onChangeText={(value) => updateDraft('currency', value)}
              placeholder="e.g. MYR"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              editable={!saving}
            />
          </Field>
          <Field label="Seller">
            <TextInput
              style={styles.input}
              value={draft.merchant}
              onChangeText={(value) => updateDraft('merchant', value)}
              editable={!saving}
            />
          </Field>

          <Text style={styles.sectionTitle}>Notes</Text>
          <Field label="Notes">
            <TextInput
              style={[styles.input, styles.multiline]}
              value={draft.notes}
              onChangeText={(value) => updateDraft('notes', value)}
              multiline
              editable={!saving}
            />
          </Field>

          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          <Button
            label={saving ? 'Saving…' : 'Save'}
            onPress={handleSave}
            disabled={saving}
            style={styles.button}
          />
          <Button label="Cancel" variant="secondary" onPress={cancelEdit} disabled={saving} />
        </ScrollView>
      </Screen>
    );
  }

  if (preview) {
    return (
      <Screen>
        <Text style={styles.back} onPress={() => setPreview(null)}>
          ‹ Close
        </Text>
        <Text style={styles.title}>{preview.name}</Text>
        <Image source={{ uri: preview.url }} style={styles.previewImage} resizeMode="contain" />
      </Screen>
    );
  }

  if (photoPreview) {
    return (
      <Screen>
        <Text style={styles.back} onPress={closePhotoPreview}>
          ‹ Close
        </Text>
        <Image
          source={{ uri: photoPreview.url }}
          style={styles.previewImage}
          resizeMode="contain"
        />

        {deletePhotoError ? <Text style={styles.error}>{deletePhotoError}</Text> : null}

        {confirmDeletePhoto ? (
          <View style={styles.confirmRow}>
            <Text style={styles.subtitle}>Delete this photo?</Text>
            <Button
              label={deletingPhoto ? 'Deleting…' : 'Delete'}
              variant="secondary"
              onPress={handleDeletePhoto}
              disabled={deletingPhoto}
              style={styles.confirmButton}
            />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setConfirmDeletePhoto(false)}
              disabled={deletingPhoto}
            />
          </View>
        ) : (
          <Button
            label="Delete photo"
            variant="secondary"
            onPress={() => setConfirmDeletePhoto(true)}
            style={styles.button}
          />
        )}
      </Screen>
    );
  }

  // asset.category is Task 014's internal Vehicle-specialization marker
  // (e.g. 'vehicle') — never shown to the user; Vehicle Information already
  // conveys that. The user-facing category lives in the separate
  // asset.user_category column (Task 016).
  const hasBasicInfo = Boolean(
    asset.user_category || asset.description || asset.model_number || asset.serial_number,
  );
  const hasPurchaseInfo = Boolean(
    asset.purchase_date || asset.purchase_price != null || asset.merchant,
  );
  const hasNotes = Boolean(asset.notes);
  const hasAnyDetails = hasBasicInfo || hasPurchaseInfo || hasNotes;

  // Lifetime total for this asset only — missing costs count as 0 rather
  // than being skipped, so the total stays meaningful even when only some
  // records have a cost entered. Currency is a best-effort label (first
  // record that has one set), same convention as Finance/Dashboard's own
  // mixed-currency totals.
  const maintenanceTotalCost = maintenanceRecords.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const maintenanceCurrency = maintenanceRecords.find((r) => r.currency)?.currency ?? null;
  const currentProperty = properties.find((p) => p.id === asset.property_id) ?? null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {backLink}
        <Text style={styles.title}>{asset.name}</Text>
        {currentProperty ? (
          <Text
            style={styles.propertyLink}
            onPress={() => router.push(`/property/${currentProperty.id}`)}
          >
            {currentProperty.name} →
          </Text>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <Text style={styles.sectionHint}>Product · Receipt · Warranty Card</Text>

          {photosStatus === 'loading' ? <LoadingState message="Loading photos…" /> : null}

          {photosStatus === 'error' ? (
            <ErrorState message="Unable to load photos." onRetry={() => loadPhotos(asset.id)} />
          ) : null}

          {photosStatus === 'loaded' ? (
            <View style={styles.photoRow}>
              {photos.map((photo) =>
                photoUrls[photo.id] ? (
                  <Pressable key={photo.id} onPress={() => openPhotoPreview(photo)}>
                    <Image source={{ uri: photoUrls[photo.id] }} style={styles.photoThumb} />
                  </Pressable>
                ) : null,
              )}
              <Pressable
                style={styles.photoAddButton}
                onPress={() => setPhotoPickerOpen(true)}
                disabled={photoUploading}
              >
                <Text style={styles.photoAddLabel}>{photoUploading ? '…' : '+'}</Text>
              </Pressable>
            </View>
          ) : null}

          {photoUploadError ? <Text style={styles.error}>{photoUploadError}</Text> : null}

          {photoPickerOpen ? (
            <View style={styles.pickerRow}>
              <Button
                label="Choose Photo"
                onPress={handleChoosePhotoFromLibrary}
                disabled={photoUploading}
                style={styles.confirmButton}
              />
              <Button
                label="Take Photo"
                onPress={handleTakePhoto}
                disabled={photoUploading}
                style={styles.confirmButton}
              />
              <Text style={styles.deleteLink} onPress={() => setPhotoPickerOpen(false)}>
                Cancel
              </Text>
            </View>
          ) : null}
        </View>

        {vehicleStatus === 'loaded' && vehicle ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vehicle Information</Text>

            {vehicleMode === 'edit' && vehicleDraft ? (
              <VehicleForm
                draft={vehicleDraft}
                saving={vehicleSaving}
                error={vehicleSaveError}
                onChange={updateVehicleDraft}
                onSave={handleSaveVehicle}
                onCancel={cancelVehicleForm}
              />
            ) : (
              <>
                <Pressable onPress={startEditVehicle}>
                  <Card style={styles.documentCard}>
                    {hasAnyVehicleDetails(vehicle) ? (
                      <>
                        {vehicle.make ? <Text style={styles.value}>{vehicle.make}</Text> : null}
                        {vehicle.model ? <Text style={styles.value}>{vehicle.model}</Text> : null}
                        {vehicle.year != null ? (
                          <Text style={styles.value}>{vehicle.year}</Text>
                        ) : null}
                        {vehicle.license_plate ? (
                          <Text style={styles.value}>{vehicle.license_plate}</Text>
                        ) : null}
                        {vehicle.vin ? <Text style={styles.value}>{vehicle.vin}</Text> : null}
                        {formatMileage(vehicle) ? (
                          <Text style={styles.value}>{formatMileage(vehicle)}</Text>
                        ) : null}
                      </>
                    ) : (
                      <Text style={styles.subtitle}>No additional vehicle details yet.</Text>
                    )}
                  </Card>
                </Pressable>

                {removeVehicleError ? <Text style={styles.error}>{removeVehicleError}</Text> : null}

                {confirmRemoveVehicle ? (
                  <View style={styles.confirmRow}>
                    <Text style={styles.subtitle}>
                      Remove vehicle details? The item itself will remain.
                    </Text>
                    <Button
                      label={removingVehicle ? 'Removing…' : 'Remove'}
                      variant="secondary"
                      onPress={handleRemoveVehicle}
                      disabled={removingVehicle}
                      style={styles.confirmButton}
                    />
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={() => setConfirmRemoveVehicle(false)}
                      disabled={removingVehicle}
                    />
                  </View>
                ) : (
                  <Text style={styles.deleteLink} onPress={() => setConfirmRemoveVehicle(true)}>
                    Remove vehicle details
                  </Text>
                )}
              </>
            )}
          </View>
        ) : null}

        {!hasAnyDetails ? (
          <Text style={styles.subtitle}>No additional details yet.</Text>
        ) : (
          <>
            {hasBasicInfo ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Information</Text>
                {asset.user_category ? (
                  <ViewField label="Category" value={asset.user_category} />
                ) : null}
                {asset.description ? (
                  <ViewField label="Description" value={asset.description} />
                ) : null}
                {asset.model_number ? <ViewField label="Model" value={asset.model_number} /> : null}
                {asset.serial_number ? (
                  <ViewField label="Serial Number" value={asset.serial_number} />
                ) : null}
              </View>
            ) : null}

            {hasPurchaseInfo ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Purchase Information</Text>
                {asset.purchase_date ? (
                  <ViewField label="Purchase Date" value={asset.purchase_date} />
                ) : null}
                {asset.purchase_price != null ? (
                  <ViewField
                    label="Purchase Price"
                    value={formatPrice(asset.purchase_price, asset.currency)}
                  />
                ) : null}
                {asset.merchant ? <ViewField label="Seller" value={asset.merchant} /> : null}
              </View>
            ) : null}

            {hasNotes ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Notes</Text>
                <Text style={styles.value}>{asset.notes}</Text>
              </View>
            ) : null}
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Warranty</Text>

          {warrantiesStatus === 'loading' ? (
            <LoadingState message="Loading warranty information…" />
          ) : null}

          {warrantiesStatus === 'error' ? (
            <ErrorState
              message="Unable to load warranty information."
              onRetry={() => loadWarranties(asset.id)}
            />
          ) : null}

          {warrantiesStatus === 'loaded' &&
          warranties.length === 0 &&
          warrantyFormMode === 'closed' ? (
            <Text style={styles.subtitle}>No warranty information yet.</Text>
          ) : null}

          {warrantiesStatus === 'loaded' &&
            warranties.map((warranty) => {
              const status = getWarrantyStatus(warranty.expiry_date);
              const reminderAdded = reminderAddedFor.has(warranty.id);
              const addingThisReminder = addingReminderFor === warranty.id;
              return warrantyFormMode === warranty.id && warrantyDraft ? (
                <WarrantyForm
                  key={warranty.id}
                  assetName={asset.name}
                  draft={warrantyDraft}
                  saving={warrantySaving}
                  error={warrantyError}
                  onChange={updateWarrantyDraft}
                  onSave={handleSaveWarranty}
                  onCancel={cancelWarrantyForm}
                />
              ) : (
                <View key={warranty.id}>
                  <Pressable onPress={() => startEditWarranty(warranty)}>
                    <Card style={styles.documentCard}>
                      <Text style={styles.value}>{warranty.name ?? 'Warranty'}</Text>
                      {describeWarranty(warranty) || status ? (
                        <Text style={styles.label}>
                          {describeWarranty(warranty)}
                          {status ? (
                            <Text style={warrantyStatusStyle(status)}>
                              {describeWarranty(warranty) ? ' · ' : ''}
                              {WARRANTY_STATUS_LABELS[status]}
                            </Text>
                          ) : null}
                        </Text>
                      ) : null}
                    </Card>
                  </Pressable>

                  {confirmDeleteWarrantyId === warranty.id ? (
                    <View style={styles.confirmRow}>
                      <Text style={styles.subtitle}>Delete this warranty?</Text>
                      <Button
                        label={deletingWarranty ? 'Deleting…' : 'Delete'}
                        variant="secondary"
                        onPress={() => handleDeleteWarranty(warranty.id)}
                        disabled={deletingWarranty}
                        style={styles.confirmButton}
                      />
                      <Button
                        label="Cancel"
                        variant="secondary"
                        onPress={() => setConfirmDeleteWarrantyId(null)}
                        disabled={deletingWarranty}
                      />
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      <Text
                        style={styles.deleteLink}
                        onPress={
                          reminderAdded || addingThisReminder
                            ? undefined
                            : () =>
                                handleAddReminder(
                                  'warranty',
                                  warranty.id,
                                  `${warranty.name ?? asset.name} warranty`,
                                  warranty.expiry_date,
                                )
                        }
                      >
                        {reminderAdded
                          ? 'Reminder added'
                          : addingThisReminder
                            ? 'Adding…'
                            : '+ Add reminder'}
                      </Text>
                      <Text
                        style={styles.deleteLink}
                        onPress={() => setConfirmDeleteWarrantyId(warranty.id)}
                      >
                        Delete
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

          {deleteWarrantyError ? <Text style={styles.error}>{deleteWarrantyError}</Text> : null}
          {reminderError ? <Text style={styles.error}>{reminderError}</Text> : null}

          {warrantyFormMode === 'add' && warrantyDraft ? (
            <WarrantyForm
              assetName={asset.name}
              draft={warrantyDraft}
              saving={warrantySaving}
              error={warrantyError}
              onChange={updateWarrantyDraft}
              onSave={handleSaveWarranty}
              onCancel={cancelWarrantyForm}
            />
          ) : null}

          {warrantyFormMode === 'closed' ? (
            <Button label="+ Add warranty" variant="secondary" onPress={startAddWarranty} />
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Maintenance</Text>

          {maintenanceStatus === 'loading' ? (
            <LoadingState message="Loading maintenance history…" />
          ) : null}

          {maintenanceStatus === 'error' ? (
            <ErrorState
              message="Unable to load maintenance history."
              onRetry={() => loadMaintenanceRecords(asset.id)}
            />
          ) : null}

          {maintenanceStatus === 'loaded' && maintenanceRecords.length > 0 ? (
            <Text style={styles.subtitle}>
              Total maintenance cost: {formatPrice(maintenanceTotalCost, maintenanceCurrency)}
            </Text>
          ) : null}

          {maintenanceStatus === 'loaded' &&
          maintenanceRecords.length === 0 &&
          maintenanceFormMode === 'closed' ? (
            <Text style={styles.subtitle}>No maintenance records yet.</Text>
          ) : null}

          {maintenanceStatus === 'loaded' &&
            maintenanceRecords.map((record) => {
              const reminderAdded = reminderAddedFor.has(record.id);
              const addingThisReminder = addingReminderFor === record.id;
              return maintenanceFormMode === record.id && maintenanceDraft ? (
                <MaintenanceForm
                  key={record.id}
                  draft={maintenanceDraft}
                  saving={maintenanceSaving}
                  error={maintenanceError}
                  onChange={updateMaintenanceDraft}
                  onSave={handleSaveMaintenance}
                  onCancel={cancelMaintenanceForm}
                />
              ) : (
                <View key={record.id}>
                  <Pressable onPress={() => startEditMaintenance(record)}>
                    <Card style={styles.documentCard}>
                      <Text style={styles.value}>{record.name}</Text>
                      {describeMaintenance(record) ? (
                        <Text style={styles.label}>{describeMaintenance(record)}</Text>
                      ) : null}
                    </Card>
                  </Pressable>

                  {confirmDeleteMaintenanceId === record.id ? (
                    <View style={styles.confirmRow}>
                      <Text style={styles.subtitle}>Delete this maintenance record?</Text>
                      <Button
                        label={deletingMaintenance ? 'Deleting…' : 'Delete'}
                        variant="secondary"
                        onPress={() => handleDeleteMaintenance(record.id)}
                        disabled={deletingMaintenance}
                        style={styles.confirmButton}
                      />
                      <Button
                        label="Cancel"
                        variant="secondary"
                        onPress={() => setConfirmDeleteMaintenanceId(null)}
                        disabled={deletingMaintenance}
                      />
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      <Text
                        style={styles.deleteLink}
                        onPress={
                          reminderAdded || addingThisReminder
                            ? undefined
                            : () =>
                                handleAddReminder(
                                  'maintenance_record',
                                  record.id,
                                  `${record.name} maintenance`,
                                  record.next_due_date,
                                )
                        }
                      >
                        {reminderAdded
                          ? 'Reminder added'
                          : addingThisReminder
                            ? 'Adding…'
                            : '+ Add reminder'}
                      </Text>
                      <Text
                        style={styles.deleteLink}
                        onPress={() => setConfirmDeleteMaintenanceId(record.id)}
                      >
                        Delete
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}

          {deleteMaintenanceError ? (
            <Text style={styles.error}>{deleteMaintenanceError}</Text>
          ) : null}
          {reminderError ? <Text style={styles.error}>{reminderError}</Text> : null}

          {maintenanceFormMode === 'add' && maintenanceDraft ? (
            <MaintenanceForm
              draft={maintenanceDraft}
              saving={maintenanceSaving}
              error={maintenanceError}
              onChange={updateMaintenanceDraft}
              onSave={handleSaveMaintenance}
              onCancel={cancelMaintenanceForm}
            />
          ) : null}

          {maintenanceFormMode === 'closed' ? (
            <Button
              label="+ Add maintenance record"
              variant="secondary"
              onPress={startAddMaintenance}
            />
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Documents</Text>
          <Text style={styles.sectionHint}>PDF · Receipt · Invoice · Manual</Text>

          {documentsStatus === 'loading' ? <LoadingState message="Loading documents…" /> : null}

          {documentsStatus === 'error' ? (
            <ErrorState
              message="Unable to load documents."
              onRetry={() => loadDocuments(asset.id)}
            />
          ) : null}

          {documentsStatus === 'loaded' && documents.length === 0 ? (
            <Text style={styles.subtitle}>No documents yet.</Text>
          ) : null}

          {documentsStatus === 'loaded' &&
            documents.map((item) => (
              <View key={item.linkId}>
                <Pressable onPress={() => openDocument(item.document)}>
                  <Card style={styles.documentCard}>
                    <Text style={styles.value}>{item.document.name}</Text>
                    <Text style={styles.label}>{describeDocument(item.document)}</Text>
                  </Card>
                </Pressable>

                {confirmDeleteId === item.linkId ? (
                  <View style={styles.confirmRow}>
                    <Text style={styles.subtitle}>Delete this document?</Text>
                    <Button
                      label={deleting ? 'Deleting…' : 'Delete'}
                      variant="secondary"
                      onPress={() => handleDelete(item)}
                      disabled={deleting}
                      style={styles.confirmButton}
                    />
                    <Button
                      label="Cancel"
                      variant="secondary"
                      onPress={() => setConfirmDeleteId(null)}
                      disabled={deleting}
                    />
                  </View>
                ) : (
                  <View style={styles.actionRow}>
                    <Text
                      style={styles.deleteLink}
                      onPress={
                        downloadingId === item.linkId ? undefined : () => handleDownload(item)
                      }
                    >
                      {downloadingId === item.linkId ? 'Downloading…' : 'Download'}
                    </Text>
                    <Text style={styles.deleteLink} onPress={() => handleUnlink(item)}>
                      {unlinkingId === item.linkId ? 'Removing…' : 'Remove from asset'}
                    </Text>
                    <Text style={styles.deleteLink} onPress={() => setConfirmDeleteId(item.linkId)}>
                      Delete
                    </Text>
                  </View>
                )}
              </View>
            ))}

          {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
          {unlinkError ? <Text style={styles.error}>{unlinkError}</Text> : null}
          {downloadError ? <Text style={styles.error}>{downloadError}</Text> : null}
          {previewError ? <Text style={styles.error}>{previewError}</Text> : null}
          {uploadError ? <Text style={styles.error}>{uploadError}</Text> : null}

          {pickerOpen ? (
            <View style={styles.pickerRow}>
              <Button
                label="Choose Photo"
                onPress={handleChoosePhoto}
                disabled={uploading}
                style={styles.confirmButton}
              />
              <Button
                label="Choose File"
                onPress={handleChooseFile}
                disabled={uploading}
                style={styles.confirmButton}
              />
              <Text style={styles.deleteLink} onPress={() => setPickerOpen(false)}>
                Cancel
              </Text>
            </View>
          ) : (
            <Button
              label={uploading ? 'Adding…' : '+ Add document'}
              variant="secondary"
              onPress={() => setPickerOpen(true)}
              disabled={uploading}
            />
          )}
        </View>

        <Button
          label={hasAnyDetails ? 'Edit' : 'Add details'}
          onPress={startEdit}
          style={styles.button}
        />

        <View style={styles.dangerZone}>
          {deleteAssetError ? <Text style={styles.error}>{deleteAssetError}</Text> : null}

          {confirmDeleteAsset ? (
            <View style={styles.confirmRow}>
              <Text style={styles.subtitle}>
                Delete this item and its warranty and maintenance records? This cannot be undone.
              </Text>
              <Button
                label={deletingAsset ? 'Deleting…' : 'Delete'}
                variant="secondary"
                onPress={handleDeleteAsset}
                disabled={deletingAsset}
                style={styles.confirmButton}
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setConfirmDeleteAsset(false)}
                disabled={deletingAsset}
              />
            </View>
          ) : (
            <Text style={styles.deleteAssetLink} onPress={() => setConfirmDeleteAsset(true)}>
              Delete this item
            </Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function ViewField({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function VehicleForm({
  draft,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: VehicleDraft;
  saving: boolean;
  error: string;
  onChange: (field: keyof VehicleDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.warrantyForm}>
      <Field label="Make">
        <TextInput
          style={styles.input}
          value={draft.make}
          onChangeText={(value) => onChange('make', value)}
          editable={!saving}
        />
      </Field>
      <Field label="Model">
        <TextInput
          style={styles.input}
          value={draft.model}
          onChangeText={(value) => onChange('model', value)}
          editable={!saving}
        />
      </Field>
      <Field label="Year">
        <TextInput
          style={styles.input}
          value={draft.year}
          onChangeText={(value) => onChange('year', value)}
          keyboardType="number-pad"
          editable={!saving}
        />
      </Field>
      <Field label="Plate Number">
        <TextInput
          style={styles.input}
          value={draft.licensePlate}
          onChangeText={(value) => onChange('licensePlate', value)}
          autoCapitalize="characters"
          editable={!saving}
        />
      </Field>
      <Field label="VIN">
        <TextInput
          style={styles.input}
          value={draft.vin}
          onChangeText={(value) => onChange('vin', value)}
          autoCapitalize="characters"
          editable={!saving}
        />
      </Field>
      <Field label="Current Mileage">
        <TextInput
          style={styles.input}
          value={draft.currentMileage}
          onChangeText={(value) => onChange('currentMileage', value)}
          keyboardType="decimal-pad"
          editable={!saving}
        />
      </Field>
      <Field label="Mileage Unit">
        <View style={styles.mileageUnitRow}>
          {MILEAGE_UNITS.map((unit) => (
            <Button
              key={unit}
              label={unit}
              variant={draft.mileageUnit === unit ? 'primary' : 'secondary'}
              onPress={() => onChange('mileageUnit', unit)}
              disabled={saving}
              style={styles.mileageUnitButton}
            />
          ))}
        </View>
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={saving ? 'Saving…' : 'Save'}
        onPress={onSave}
        disabled={saving}
        style={styles.confirmButton}
      />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
    </View>
  );
}

function WarrantyForm({
  assetName,
  draft,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  assetName: string;
  draft: WarrantyDraft;
  saving: boolean;
  error: string;
  onChange: (field: keyof WarrantyDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.warrantyForm}>
      {/* The Asset already provides the context (Task 030) — this heading
          reads as "<Asset name> / Warranty" instead of asking the user to
          invent a separate warranty name for something that only ever
          belongs to this one asset anyway. */}
      <Text style={styles.warrantyContextName}>{assetName}</Text>
      <Text style={styles.warrantyContextLabel}>Warranty</Text>
      <Field label="Warranty Name (optional)">
        <TextInput
          style={styles.input}
          value={draft.name}
          onChangeText={(value) => onChange('name', value)}
          placeholder="Only needed if you have more than one"
          placeholderTextColor={colors.textMuted}
          editable={!saving}
        />
      </Field>
      <Field label="Provider">
        <TextInput
          style={styles.input}
          value={draft.provider}
          onChangeText={(value) => onChange('provider', value)}
          editable={!saving}
        />
      </Field>
      <Field label="Warranty Number">
        <TextInput
          style={styles.input}
          value={draft.warrantyNumber}
          onChangeText={(value) => onChange('warrantyNumber', value)}
          editable={!saving}
        />
      </Field>
      <Field label="Start Date">
        <DateField
          value={draft.startDate}
          onChange={(value) => onChange('startDate', value)}
          disabled={saving}
        />
      </Field>
      <Field label="Expiry Date">
        <DateField
          value={draft.expiryDate}
          onChange={(value) => onChange('expiryDate', value)}
          disabled={saving}
        />
      </Field>
      <Field label="Notes">
        <TextInput
          style={[styles.input, styles.multiline]}
          value={draft.notes}
          onChangeText={(value) => onChange('notes', value)}
          multiline
          editable={!saving}
        />
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={saving ? 'Saving…' : 'Save'}
        onPress={onSave}
        disabled={saving}
        style={styles.confirmButton}
      />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
    </View>
  );
}

function MaintenanceForm({
  draft,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: MaintenanceDraft;
  saving: boolean;
  error: string;
  onChange: (field: keyof MaintenanceDraft, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.warrantyForm}>
      <Field label="Name *">
        <TextInput
          style={styles.input}
          value={draft.name}
          onChangeText={(value) => onChange('name', value)}
          editable={!saving}
        />
      </Field>
      <Field label="Provider">
        <TextInput
          style={styles.input}
          value={draft.provider}
          onChangeText={(value) => onChange('provider', value)}
          editable={!saving}
        />
      </Field>
      <Field label="Date Performed">
        <DateField
          value={draft.performedAt}
          onChange={(value) => onChange('performedAt', value)}
          disabled={saving}
        />
      </Field>
      <Field label="Cost">
        <TextInput
          style={styles.input}
          value={draft.cost}
          onChangeText={(value) => onChange('cost', value)}
          keyboardType="decimal-pad"
          editable={!saving}
        />
      </Field>
      <Field label="Currency">
        <TextInput
          style={styles.input}
          value={draft.currency}
          onChangeText={(value) => onChange('currency', value)}
          placeholder="e.g. MYR"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          editable={!saving}
        />
      </Field>
      <Field label="Next Due Date">
        <DateField
          value={draft.nextDueDate}
          onChange={(value) => onChange('nextDueDate', value)}
          disabled={saving}
        />
      </Field>
      <Field label="Next Due Mileage">
        <TextInput
          style={styles.input}
          value={draft.nextDueMileage}
          onChangeText={(value) => onChange('nextDueMileage', value)}
          keyboardType="decimal-pad"
          editable={!saving}
        />
      </Field>
      <Field label="Notes">
        <TextInput
          style={[styles.input, styles.multiline]}
          value={draft.notes}
          onChangeText={(value) => onChange('notes', value)}
          multiline
          editable={!saving}
        />
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={saving ? 'Saving…' : 'Save'}
        onPress={onSave}
        disabled={saving}
        style={styles.confirmButton}
      />
      <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  back: {
    color: colors.primary,
    fontSize: 15,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  propertyLink: {
    color: colors.primary,
    fontSize: 14,
    marginBottom: spacing.lg,
  },
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  field: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.xs / 2,
  },
  value: {
    fontSize: 16,
    color: colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  button: {
    marginTop: spacing.lg,
  },
  documentCard: {
    padding: spacing.md,
  },
  deleteLink: {
    color: colors.primary,
    fontSize: 13,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  confirmRow: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  confirmButton: {
    marginTop: 0,
  },
  pickerRow: {
    gap: spacing.xs,
  },
  previewImage: {
    flex: 1,
    width: '100%',
  },
  warrantyForm: {
    marginBottom: spacing.sm,
  },
  warrantyContextName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  warrantyContextLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  mileageUnitRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  mileageUnitButton: {
    flex: 1,
    marginTop: 0,
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  categoryButton: {
    marginTop: 0,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  photoAddButton: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddLabel: {
    fontSize: 24,
    color: colors.primary,
  },
  dangerZone: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  deleteAssetLink: {
    color: colors.danger,
    fontSize: 14,
  },
});
