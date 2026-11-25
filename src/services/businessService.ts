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
import { DEFAULT_BUSINESS_LOCATIONS } from '../config/businessCatalog';
import { createOperationId } from './economyService';
import type {
  AdminBusinessOverview,
  BusinessApplication,
  BusinessDashboardPayload,
  BusinessEmployee,
  BusinessLocation,
  BusinessRecord,
  BusinessStatus,
  BusinessTemplateType,
  BusinessVacancy,
} from '../types/business';

async function authedBusinessRequest<T>(
  user: User,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body?: Record<string, unknown>
): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : `Erro na operação empresarial (HTTP ${res.status}).`
    );
  }
  return data as T;
}

// =========================================================================
// Authoritative Server Business Endpoints
// =========================================================================

export async function fetchPublicBusinessMarket(user: User): Promise<{
  locations: BusinessLocation[];
  businesses: BusinessRecord[];
  vacancies: BusinessVacancy[];
}> {
  return authedBusinessRequest(user, 'GET', '/api/businesses/public');
}

export async function fetchBusinessDashboard(
  user: User,
  businessId: string
): Promise<BusinessDashboardPayload> {
  return authedBusinessRequest(user, 'GET', `/api/businesses/${encodeURIComponent(businessId)}/dashboard`);
}

export async function acquireBusiness(
  user: User,
  locationId: string,
  customName?: string,
  operationId = createOperationId('acq')
): Promise<{
  businessId: string;
  name: string;
  ownerUid: string;
  acquisitionPrice: number;
  initialCapital: number;
  newBankBalance: number;
  transactionId: string;
}> {
  return authedBusinessRequest(user, 'POST', '/api/businesses/acquire', {
    locationId,
    customName,
    operationId,
  });
}

export async function updateBusinessListing(
  user: User,
  businessId: string,
  forSale: boolean,
  salePrice: number
): Promise<{ businessId: string; forSale: boolean; salePrice: number }> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/listing`,
    { forSale, salePrice }
  );
}

export async function buyBusinessFromOwner(
  user: User,
  businessId: string,
  operationId = createOperationId('p2p')
): Promise<{
  businessId: string;
  newOwnerUid: string;
  previousOwnerUid: string;
  salePrice: number;
  newBuyerBalance: number;
  transactionId: string;
}> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/buy-from-owner`,
    { operationId }
  );
}

export async function transferBusinessCapital(
  user: User,
  businessId: string,
  direction: 'inject' | 'withdraw',
  amount: number,
  operationId = createOperationId('cap')
): Promise<{
  businessId: string;
  direction: 'inject' | 'withdraw';
  amount: number;
  cashBalance: number;
  bankBalance: number;
  businessStatus: BusinessStatus;
  transactionId: string;
}> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/capital`,
    { direction, amount, operationId }
  );
}

export async function createBusinessVacancy(
  user: User,
  businessId: string,
  payload: {
    roleTitle: string;
    salary: number;
    schedule: string;
    requirements: string;
    slots: number;
    description: string;
  }
): Promise<BusinessVacancy> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/vacancies`,
    payload
  );
}

export async function updateBusinessVacancy(
  user: User,
  businessId: string,
  vacancyId: string,
  payload: { status: 'open' | 'closed'; salary?: number }
): Promise<{ id: string; status: 'open' | 'closed'; salary: number }> {
  return authedBusinessRequest(
    user,
    'PUT',
    `/api/businesses/${encodeURIComponent(businessId)}/vacancies/${encodeURIComponent(vacancyId)}`,
    payload
  );
}

export async function applyToBusinessVacancy(
  user: User,
  businessId: string,
  vacancyId: string,
  coverNote: string
): Promise<{ id: string; businessId: string; vacancyId: string; status: string }> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/apply`,
    { vacancyId, coverNote }
  );
}

export async function decideBusinessApplication(
  user: User,
  businessId: string,
  appId: string,
  action: 'send_offer' | 'hire' | 'reject' | 'accept_offer' | 'decline_offer' | 'withdraw',
  options?: { offeredSalary?: number; roleTitle?: string }
): Promise<{ applicationId: string; contractId?: string; status: string }> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/applications/${encodeURIComponent(appId)}/decision`,
    { action, ...(options ?? {}) }
  );
}

export async function updateEmployeeContract(
  user: User,
  businessId: string,
  contractId: string,
  payload: {
    action: 'update' | 'terminate' | 'resign';
    roleTitle?: string;
    salary?: number;
    schedule?: string;
  }
): Promise<Record<string, unknown>> {
  return authedBusinessRequest(
    user,
    'PUT',
    `/api/businesses/${encodeURIComponent(businessId)}/employees/${encodeURIComponent(contractId)}`,
    payload
  );
}

export async function payEmployeeSalary(
  user: User,
  businessId: string,
  contractId: string,
  operationId = createOperationId('pay')
): Promise<{
  payrollId: string;
  amount: number;
  businessCashBalance: number;
  employeeName: string;
  reputation: number;
}> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/payroll/pay`,
    { contractId, operationId }
  );
}

export async function createBusinessProduct(
  user: User,
  businessId: string,
  payload: {
    name: string;
    sku: string;
    category: string;
    unitCost: number;
    salePrice: number;
  }
): Promise<Record<string, unknown>> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/products`,
    payload
  );
}

export async function updateBusinessProduct(
  user: User,
  businessId: string,
  productId: string,
  payload: { salePrice?: number; active?: boolean }
): Promise<Record<string, unknown>> {
  return authedBusinessRequest(
    user,
    'PUT',
    `/api/businesses/${encodeURIComponent(businessId)}/products/${encodeURIComponent(productId)}`,
    payload
  );
}

export async function restockBusinessInventory(
  user: User,
  businessId: string,
  productId: string,
  quantity: number,
  operationId = createOperationId('rst')
): Promise<{ productId: string; newQuantity: number; totalCost: number; cashBalance: number }> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/inventory/restock`,
    { productId, quantity, operationId }
  );
}

export async function sellBusinessInventory(
  user: User,
  businessId: string,
  productId: string,
  quantity: number,
  buyerLabel?: string,
  operationId = createOperationId('sale')
): Promise<{
  productId: string;
  newQuantity: number;
  revenue: number;
  cashBalance: number;
  reputation: number;
}> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/inventory/sell`,
    { productId, quantity, buyerLabel, operationId }
  );
}

export async function payBusinessOperatingExpenses(
  user: User,
  businessId: string,
  operationId = createOperationId('exp')
): Promise<{
  paid: boolean;
  status: BusinessStatus;
  amount?: number;
  requiredAmount?: number;
  cashBalance: number;
  message?: string;
}> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/expenses/pay`,
    { operationId }
  );
}

export async function submitBusinessReview(
  user: User,
  businessId: string,
  rating: number,
  comment: string
): Promise<{ id: string; reputation: number; reputationCount: number }> {
  return authedBusinessRequest(
    user,
    'POST',
    `/api/businesses/${encodeURIComponent(businessId)}/reviews`,
    { rating, comment }
  );
}

// =========================================================================
// Admin Business Governance Endpoints
// =========================================================================

export async function fetchAdminBusinessOverview(user: User): Promise<AdminBusinessOverview> {
  return authedBusinessRequest(user, 'GET', '/api/admin/businesses/overview');
}

export async function seedBusinessLocationsAdmin(
  user: User
): Promise<{ seededCount: number; logId: string }> {
  return authedBusinessRequest(user, 'POST', '/api/admin/businesses/seed-locations', {});
}

export async function createBusinessLocationAdmin(
  user: User,
  payload: {
    id?: string;
    templateType: BusinessTemplateType;
    name: string;
    category: string;
    description: string;
    acquisitionPrice: number;
    initialCapital: number;
    operatingExpense: number;
    maxEmployees: number;
    revenuePotential: number;
    minPriceMultiplier: number;
    maxPriceMultiplier: number;
    locationLabel: string;
    posX: number;
    posZ: number;
  }
): Promise<{ id: string; name: string; acquisitionPrice: number; logId: string }> {
  return authedBusinessRequest(user, 'POST', '/api/admin/businesses/locations', payload);
}

export async function updateBusinessLocationAdmin(
  user: User,
  locationId: string,
  payload: Partial<
    Pick<
      BusinessLocation,
      | 'acquisitionPrice'
      | 'initialCapital'
      | 'operatingExpense'
      | 'maxEmployees'
      | 'minPriceMultiplier'
      | 'maxPriceMultiplier'
      | 'available'
    >
  >
): Promise<Record<string, unknown>> {
  return authedBusinessRequest(
    user,
    'PUT',
    `/api/admin/businesses/locations/${encodeURIComponent(locationId)}`,
    payload
  );
}

export async function updateBusinessAdminStatus(
  user: User,
  businessId: string,
  payload: {
    status: BusinessStatus;
    operatingExpense?: number;
    maxEmployees?: number;
    reason: string;
  }
): Promise<Record<string, unknown>> {
  return authedBusinessRequest(
    user,
    'PUT',
    `/api/admin/businesses/${encodeURIComponent(businessId)}/admin-update`,
    payload
  );
}

// =========================================================================
// Real-Time Firestore Subscriptions (100% QAP-Compliant with firestore.rules)
// =========================================================================

export function subscribeBusinesses(
  onData: (businesses: BusinessRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'businesses'), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ ...(d.data() as BusinessRecord), id: d.id }));
      onData(list);
    },
    () => {
      // Non-fatal fallback
    }
  );
}

export function subscribeBusinessLocations(
  onData: (locations: BusinessLocation[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'business_locations'),
    where('isCatalogLocation', '==', true),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const merged = new Map<string, BusinessLocation>();
      for (const loc of DEFAULT_BUSINESS_LOCATIONS) merged.set(loc.id, { ...loc });
      for (const d of snap.docs) {
        merged.set(d.id, { ...(d.data() as BusinessLocation), id: d.id });
      }
      onData(Array.from(merged.values()));
    },
    () => {
      onData(DEFAULT_BUSINESS_LOCATIONS);
    }
  );
}

export function subscribeOpenVacancies(
  onData: (vacancies: BusinessVacancy[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'business_vacancies'),
    where('status', '==', 'open'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as BusinessVacancy), id: d.id })));
    },
    () => {
      onData([]);
    }
  );
}

export function subscribeMyEmploymentContracts(
  uid: string,
  onData: (contracts: BusinessEmployee[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'business_employees'),
    where('employeeUid', '==', uid),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as BusinessEmployee), id: d.id })));
    },
    () => {
      onData([]);
    }
  );
}

export function subscribeMyBusinessApplications(
  uid: string,
  onData: (apps: BusinessApplication[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'business_applications'),
    where('applicantUid', '==', uid),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => ({ ...(d.data() as BusinessApplication), id: d.id })));
    },
    () => {
      onData([]);
    }
  );
}
