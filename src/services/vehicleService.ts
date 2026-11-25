import type { User } from 'firebase/auth';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { DEFAULT_VEHICLE_CATALOG } from '../config/vehicleCatalog';
import type {
  AdminVehicleOverview,
  DealershipShowroomPayload,
  DealershipStockItem,
  GarageOverviewPayload,
  PlayerVehicle,
  VehicleCatalogModel,
  VehicleCategory,
  VehicleListing,
  VehicleMaintenanceType,
} from '../types/vehicle';

async function vehicleApiFetch<T>(
  user: User,
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT'; body?: Record<string, unknown> } = {}
): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(json.error || `Erro na operação veicular (HTTP ${res.status}).`);
  }
  return json;
}

// =========================================================================
// REAL-TIME FIRESTORE SUBSCRIPTIONS (100% QAP-COMPLIANT)
// =========================================================================

export function subscribeVehicleCatalog(
  onUpdate: (models: VehicleCatalogModel[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'vehicle_catalog'),
    where('isCatalogVehicle', '==', true),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const merged = new Map<string, VehicleCatalogModel>();
      for (const def of DEFAULT_VEHICLE_CATALOG) {
        merged.set(def.id, { ...def });
      }
      for (const d of snap.docs) {
        const data = d.data() as VehicleCatalogModel;
        merged.set(d.id, { ...data, id: d.id });
      }
      onUpdate(Array.from(merged.values()).sort((a, b) => a.basePrice - b.basePrice));
    },
    () => {
      onUpdate([...DEFAULT_VEHICLE_CATALOG]);
    }
  );
}

export function subscribeMyVehicles(
  uid: string,
  onUpdate: (vehicles: PlayerVehicle[]) => void
): Unsubscribe {
  const q = query(collection(db, 'vehicles'), where('ownerUid', '==', uid), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as PlayerVehicle), id: d.id }));
      onUpdate(list);
    },
    () => onUpdate([])
  );
}

export function subscribeAvailableDealershipStock(
  onUpdate: (items: DealershipStockItem[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'dealership_inventory'),
    where('status', '==', 'available'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as DealershipStockItem), id: d.id }));
      onUpdate(list);
    },
    () => onUpdate([])
  );
}

export function subscribeActiveVehicleListings(
  onUpdate: (listings: VehicleListing[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'vehicle_listings'),
    where('status', '==', 'active'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as VehicleListing), id: d.id }));
      onUpdate(list);
    },
    () => onUpdate([])
  );
}

// =========================================================================
// AUTHORITATIVE SERVER API CALLS
// =========================================================================

export async function fetchDealershipShowroom(
  user: User,
  businessId: string
): Promise<DealershipShowroomPayload> {
  return vehicleApiFetch<DealershipShowroomPayload>(
    user,
    `/api/dealerships/${encodeURIComponent(businessId)}/showroom`
  );
}

export async function restockDealershipVehicle(
  user: User,
  businessId: string,
  input: {
    modelId: string;
    salePrice?: number;
    promoDiscountPercent?: number;
    commissionPercent?: number;
    assignedSellerUid?: string;
  }
): Promise<{ stock: DealershipStockItem; cashBalance: number; bizTxId: string }> {
  return vehicleApiFetch(user, `/api/dealerships/${encodeURIComponent(businessId)}/stock`, {
    method: 'POST',
    body: input,
  });
}

export async function updateDealershipStockUnit(
  user: User,
  businessId: string,
  stockId: string,
  input: {
    salePrice?: number;
    promoDiscountPercent?: number;
    commissionPercent?: number;
    assignedSellerUid?: string;
    status?: 'available' | 'removed';
  }
): Promise<{ stockId: string; finalPrice: number; status: string }> {
  return vehicleApiFetch(
    user,
    `/api/dealerships/${encodeURIComponent(businessId)}/stock/${encodeURIComponent(stockId)}`,
    { method: 'PUT', body: input }
  );
}

export async function buyVehicleFromDealership(
  user: User,
  businessId: string,
  stockId: string
): Promise<{
  vehicle: PlayerVehicle;
  paidAmount: number;
  newBuyerBalance: number;
  bankTxId: string;
}> {
  return vehicleApiFetch(user, `/api/dealerships/${encodeURIComponent(businessId)}/buy`, {
    method: 'POST',
    body: { stockId },
  });
}

export async function payDealershipCommission(
  user: User,
  businessId: string,
  commissionId: string
): Promise<{ commissionId: string; paidAmount: number; cashBalance: number }> {
  return vehicleApiFetch(
    user,
    `/api/dealerships/${encodeURIComponent(businessId)}/commissions/${encodeURIComponent(commissionId)}/pay`,
    { method: 'POST' }
  );
}

export async function fetchGarageOverview(user: User): Promise<GarageOverviewPayload> {
  return vehicleApiFetch<GarageOverviewPayload>(user, '/api/vehicles/garage');
}

export async function performVehicleMaintenance(
  user: User,
  vehicleId: string,
  serviceType: VehicleMaintenanceType
): Promise<{
  vehicleId: string;
  cost: number;
  condition: number;
  fuelLevel: number;
  marketValue: number;
  newBalance: number;
}> {
  return vehicleApiFetch(user, `/api/vehicles/${encodeURIComponent(vehicleId)}/maintenance`, {
    method: 'POST',
    body: { serviceType },
  });
}

export async function recordVehicleTripWear(
  user: User,
  vehicleId: string,
  distanceKm = 40
): Promise<{
  vehicleId: string;
  mileageKm: number;
  fuelLevel: number;
  condition: number;
  marketValue: number;
}> {
  return vehicleApiFetch(user, `/api/vehicles/${encodeURIComponent(vehicleId)}/trip`, {
    method: 'POST',
    body: { distanceKm },
  });
}

export async function createVehicleListing(
  user: User,
  vehicleId: string,
  input: { askingPrice: number; description: string }
): Promise<{ listing: VehicleListing }> {
  return vehicleApiFetch(user, `/api/vehicles/${encodeURIComponent(vehicleId)}/list`, {
    method: 'POST',
    body: input,
  });
}

export async function cancelVehicleListing(
  user: User,
  listingId: string
): Promise<{ listingId: string; status: string }> {
  return vehicleApiFetch(
    user,
    `/api/vehicles/listings/${encodeURIComponent(listingId)}/cancel`,
    { method: 'POST' }
  );
}

export async function buyUsedVehicleListing(
  user: User,
  listingId: string
): Promise<{
  listingId: string;
  vehicleId: string;
  paidAmount: number;
  newBuyerBalance: number;
}> {
  return vehicleApiFetch(user, `/api/vehicles/listings/${encodeURIComponent(listingId)}/buy`, {
    method: 'POST',
  });
}

export async function submitVehicleOffer(
  user: User,
  listingId: string,
  input: { offerPrice: number; message: string }
): Promise<{ offer: { id: string } }> {
  return vehicleApiFetch(
    user,
    `/api/vehicles/listings/${encodeURIComponent(listingId)}/offers`,
    { method: 'POST', body: input }
  );
}

export async function respondVehicleOffer(
  user: User,
  offerId: string,
  decision: 'accept' | 'reject' | 'withdraw'
): Promise<{ offerId: string; status: string }> {
  return vehicleApiFetch(user, `/api/vehicles/offers/${encodeURIComponent(offerId)}/respond`, {
    method: 'POST',
    body: { decision },
  });
}

export async function completeAcceptedVehicleOffer(
  user: User,
  offerId: string
): Promise<{ offerId: string; vehicleId: string; paidAmount: number; newBuyerBalance: number }> {
  return vehicleApiFetch(user, `/api/vehicles/offers/${encodeURIComponent(offerId)}/complete`, {
    method: 'POST',
  });
}

// =========================================================================
// ADMIN VEHICLE GOVERNANCE API
// =========================================================================

export interface InitialStockBootstrapResult {
  dealershipId: string;
  dealershipName: string;
  createdDealership: boolean;
  createdUnits: number;
  availableUnits: number;
  existingDealershipsCount: number;
  totalCatalogModels: number;
}

export async function bootstrapInitialVehicleStock(
  user: User
): Promise<InitialStockBootstrapResult> {
  return vehicleApiFetch<InitialStockBootstrapResult>(
    user,
    '/api/vehicles/bootstrap-initial-stock',
    { method: 'POST' }
  );
}

export async function fetchAdminVehicleOverview(user: User): Promise<AdminVehicleOverview> {
  return vehicleApiFetch<AdminVehicleOverview>(user, '/api/admin/vehicles/overview');
}

export async function seedVehicleCatalogAdmin(user: User): Promise<{ seededCount: number }> {
  return vehicleApiFetch(user, '/api/admin/vehicles/seed-catalog', { method: 'POST' });
}

export async function seedInitialVehicleStockAdmin(
  user: User
): Promise<InitialStockBootstrapResult> {
  return vehicleApiFetch<InitialStockBootstrapResult>(
    user,
    '/api/admin/vehicles/seed-initial-stock',
    { method: 'POST' }
  );
}

export async function createVehicleModelAdmin(
  user: User,
  input: {
    id?: string;
    manufacturer: string;
    model: string;
    year: number;
    category: VehicleCategory;
    basePrice: number;
    marketValue: number;
    topSpeed: number;
    acceleration: number;
    capacity: number;
    fuelConsumption: number;
    minPriceMultiplier: number;
    maxPriceMultiplier: number;
    maxCommissionPercent: number;
    description: string;
  }
): Promise<{ model: VehicleCatalogModel }> {
  return vehicleApiFetch(user, '/api/admin/vehicles/catalog', {
    method: 'POST',
    body: input,
  });
}

export async function updateVehicleModelAdmin(
  user: User,
  modelId: string,
  input: Partial<{
    manufacturer: string;
    model: string;
    year: number;
    category: VehicleCategory;
    basePrice: number;
    marketValue: number;
    minPriceMultiplier: number;
    maxPriceMultiplier: number;
    maxCommissionPercent: number;
    active: boolean;
    description: string;
  }>
): Promise<{ model: VehicleCatalogModel }> {
  return vehicleApiFetch(user, `/api/admin/vehicles/catalog/${encodeURIComponent(modelId)}`, {
    method: 'PUT',
    body: input as Record<string, unknown>,
  });
}

export async function suspendVehicleListingAdmin(
  user: User,
  listingId: string,
  reason: string
): Promise<{ listingId: string; status: string }> {
  return vehicleApiFetch(
    user,
    `/api/admin/vehicles/listings/${encodeURIComponent(listingId)}/suspend`,
    { method: 'PUT', body: { reason } }
  );
}
