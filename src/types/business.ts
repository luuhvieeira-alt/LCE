import type { Timestamp } from 'firebase/firestore';

export type BusinessTemplateType =
  | 'concessionaria'
  | 'supermercado'
  | 'oficina'
  | 'transportadora'
  | 'restaurante'
  | 'imobiliaria'
  | 'seguranca'
  | 'loja_roupas'
  | 'posto_combustivel'
  | 'entretenimento';

export type BusinessStatus = 'active' | 'inactive_funds' | 'suspended';

export type BusinessEmployeeStatus = 'active' | 'resigned' | 'terminated';

export type BusinessApplicationStatus =
  | 'pending'
  | 'offer_sent'
  | 'hired'
  | 'rejected'
  | 'declined'
  | 'withdrawn';

export type BusinessTransactionType =
  | 'acquisition'
  | 'p2p_sale'
  | 'capital_inject'
  | 'capital_withdraw'
  | 'payroll'
  | 'inventory_purchase'
  | 'product_sale'
  | 'operating_expense'
  | 'admin_adjustment'
  | 'vehicle_restock'
  | 'vehicle_sale'
  | 'vehicle_commission';

export interface BusinessLocation {
  id: string;
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
  available: boolean;
  isCatalogLocation: true;
  updatedBy?: string;
  updatedAt?: Timestamp | string;
}

export interface BusinessRecord {
  id: string;
  locationId: string;
  templateType: BusinessTemplateType;
  name: string;
  category: string;
  description: string;
  ownerUid: string;
  ownerName: string;
  ownerAlias: string;
  status: BusinessStatus;
  acquisitionPrice: number;
  marketValue: number;
  operatingExpense: number;
  maxEmployees: number;
  growthLevel: number;
  employeeCount: number;
  reputation: number;
  reputationCount: number;
  forSale: boolean;
  salePrice: number;
  locationLabel: string;
  posX: number;
  posZ: number;
  lastTxId: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface BusinessFinance {
  businessId: string;
  ownerUid: string;
  cashBalance: number;
  totalRevenue: number;
  totalExpenses: number;
  totalPayrollPaid: number;
  netProfit: number;
  lastTxId: string;
  updatedAt?: Timestamp | string;
}

export interface BusinessVacancy {
  id: string;
  businessId: string;
  businessName: string;
  ownerUid: string;
  roleTitle: string;
  salary: number;
  schedule: string;
  requirements: string;
  slots: number;
  filledSlots: number;
  description: string;
  status: 'open' | 'closed';
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface BusinessEmployee {
  id: string;
  businessId: string;
  businessName: string;
  ownerUid: string;
  employeeUid: string;
  employeeName: string;
  employeeAlias: string;
  vacancyId: string;
  roleTitle: string;
  salary: number;
  schedule: string;
  status: BusinessEmployeeStatus;
  hiredAt?: Timestamp | string;
  nextPaymentAt?: Timestamp | string;
  lastPaidAt?: Timestamp | string;
  lastPayrollId?: string;
  totalPaid: number;
  paymentsCount: number;
  updatedAt?: Timestamp | string;
}

export interface BusinessApplication {
  id: string;
  businessId: string;
  businessName: string;
  ownerUid: string;
  vacancyId: string;
  applicantUid: string;
  applicantName: string;
  applicantAlias: string;
  roleTitle: string;
  offeredSalary: number;
  schedule: string;
  coverNote: string;
  status: BusinessApplicationStatus;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface BusinessProduct {
  id: string;
  businessId: string;
  ownerUid: string;
  name: string;
  sku: string;
  category: string;
  unitCost: number;
  salePrice: number;
  minAllowedPrice: number;
  maxAllowedPrice: number;
  marginPercent: number;
  active: boolean;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface BusinessInventoryItem {
  id: string;
  businessId: string;
  ownerUid: string;
  productName: string;
  quantity: number;
  unitCost: number;
  salePrice: number;
  lastMovementType: 'init' | 'restock' | 'sale' | 'adjustment';
  lastMovementQty: number;
  updatedAt?: Timestamp | string;
}

export interface BusinessTransaction {
  id: string;
  operationId: string;
  businessId: string;
  ownerUid: string;
  actorUid: string;
  type: BusinessTransactionType;
  direction: 'in' | 'out';
  amount: number;
  description: string;
  counterpartyUid: string;
  counterpartyLabel: string;
  status: 'completed';
  createdAt?: Timestamp | string;
}

export interface BusinessPayrollRecord {
  id: string;
  operationId: string;
  businessId: string;
  businessName: string;
  contractId: string;
  ownerUid: string;
  employeeUid: string;
  employeeName: string;
  roleTitle: string;
  amount: number;
  bankTxId: string;
  businessTxId: string;
  status: 'paid';
  paidAt?: Timestamp | string;
}

export interface BusinessReview {
  id: string;
  businessId: string;
  authorUid: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt?: Timestamp | string;
}

export interface BusinessDashboardPayload {
  business: BusinessRecord;
  isOwner: boolean;
  isEmployee: boolean;
  finances: BusinessFinance | null;
  vacancies: BusinessVacancy[];
  employees: BusinessEmployee[];
  applications: BusinessApplication[];
  products: BusinessProduct[];
  inventory: BusinessInventoryItem[];
  transactions: BusinessTransaction[];
  payroll: BusinessPayrollRecord[];
  reviews: BusinessReview[];
}

export interface AdminBusinessOverview {
  locations: BusinessLocation[];
  businesses: BusinessRecord[];
  finances: BusinessFinance[];
  employees: BusinessEmployee[];
  transactions: BusinessTransaction[];
  payroll: BusinessPayrollRecord[];
}
