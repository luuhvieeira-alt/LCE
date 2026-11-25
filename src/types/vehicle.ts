import type { Timestamp } from 'firebase/firestore';

export type VehicleCategory =
  | 'popular'
  | 'sedan'
  | 'suv'
  | 'esportivo'
  | 'luxo'
  | 'picape'
  | 'moto'
  | 'caminhao';

export type VehicleOwnershipStatus = 'in_garage' | 'listed' | 'parked';

export type DealershipStockStatus = 'available' | 'sold' | 'removed';

export type VehicleTransactionType =
  | 'dealership_restock'
  | 'dealership_sale'
  | 'p2p_sale'
  | 'maintenance'
  | 'commission_paid';

export type VehicleListingStatus = 'active' | 'sold' | 'cancelled' | 'suspended';

export type VehicleOfferStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'
  | 'completed';

export type VehicleMaintenanceType = 'fuel' | 'repair' | 'revision';

export type VehicleCommissionStatus = 'pending' | 'paid' | 'cancelled';

export interface VehicleCatalogModel {
  id: string;
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
  defaultCondition: number;
  imageKey: VehicleCategory;
  minPriceMultiplier: number;
  maxPriceMultiplier: number;
  maxCommissionPercent: number;
  description: string;
  active: boolean;
  isCatalogVehicle: true;
  updatedBy?: string;
  updatedAt?: Timestamp | string;
}

export interface DealershipStockItem {
  id: string;
  businessId: string;
  businessName: string;
  ownerUid: string;
  ownerName: string;
  modelId: string;
  manufacturer: string;
  model: string;
  year: number;
  category: VehicleCategory;
  imageKey: VehicleCategory;
  purchaseCost: number;
  salePrice: number;
  promoDiscountPercent: number;
  finalPrice: number;
  topSpeed: number;
  acceleration: number;
  capacity: number;
  fuelConsumption: number;
  condition: number;
  commissionPercent: number;
  assignedSellerUid: string;
  assignedSellerName: string;
  status: DealershipStockStatus;
  soldToUid?: string;
  soldVehicleId?: string;
  lastTxId: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface PlayerVehicle {
  id: string;
  ownerUid: string;
  ownerName: string;
  ownerAlias: string;
  modelId: string;
  manufacturer: string;
  model: string;
  year: number;
  category: VehicleCategory;
  imageKey: VehicleCategory;
  plate: string;
  purchasePrice: number;
  marketValue: number;
  topSpeed: number;
  acceleration: number;
  capacity: number;
  fuelConsumption: number;
  condition: number;
  mileageKm: number;
  fuelLevel: number;
  status: VehicleOwnershipStatus;
  activeListingId: string;
  originBusinessId: string;
  originBusinessName: string;
  lastTxId: string;
  /** Future 3D driving/parking integration fields */
  parkedZone: string;
  parkedX: number;
  parkedZ: number;
  acquiredAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface VehicleTransaction {
  id: string;
  operationId: string;
  type: VehicleTransactionType;
  vehicleId: string;
  modelId: string;
  vehicleLabel: string;
  businessId: string;
  fromUid: string;
  fromLabel: string;
  toUid: string;
  toLabel: string;
  actorUid: string;
  participants: string[];
  amount: number;
  description: string;
  status: 'completed';
  createdAt?: Timestamp | string;
}

export interface VehicleListing {
  id: string;
  vehicleId: string;
  sellerUid: string;
  sellerName: string;
  sellerAlias: string;
  modelId: string;
  manufacturer: string;
  model: string;
  year: number;
  category: VehicleCategory;
  imageKey: VehicleCategory;
  plate: string;
  condition: number;
  mileageKm: number;
  fuelLevel: number;
  topSpeed: number;
  acceleration: number;
  capacity: number;
  marketValue: number;
  askingPrice: number;
  description: string;
  status: VehicleListingStatus;
  buyerUid?: string;
  soldTxId?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface VehicleOffer {
  id: string;
  listingId: string;
  vehicleId: string;
  vehicleLabel: string;
  sellerUid: string;
  sellerName: string;
  buyerUid: string;
  buyerName: string;
  buyerAlias: string;
  askingPrice: number;
  offerPrice: number;
  message: string;
  status: VehicleOfferStatus;
  completedTxId?: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface VehicleMaintenanceRecord {
  id: string;
  operationId: string;
  vehicleId: string;
  ownerUid: string;
  serviceType: VehicleMaintenanceType;
  cost: number;
  conditionBefore: number;
  conditionAfter: number;
  fuelBefore: number;
  fuelAfter: number;
  bankTxId: string;
  description: string;
  createdAt?: Timestamp | string;
}

export interface VehicleCommissionRecord {
  id: string;
  businessId: string;
  businessName: string;
  ownerUid: string;
  sellerUid: string;
  sellerName: string;
  stockId: string;
  vehicleId: string;
  vehicleLabel: string;
  salePrice: number;
  commissionPercent: number;
  commissionAmount: number;
  status: VehicleCommissionStatus;
  saleTxId: string;
  payoutTxId?: string;
  createdAt?: Timestamp | string;
  paidAt?: Timestamp | string;
}

export interface DealershipShowroomPayload {
  business: {
    id: string;
    name: string;
    ownerUid: string;
    ownerName: string;
    ownerAlias: string;
    status: string;
    locationLabel: string;
    posX: number;
    posZ: number;
  };
  isOwner: boolean;
  availableStock: DealershipStockItem[];
  soldStock: DealershipStockItem[];
  commissions: VehicleCommissionRecord[];
  activeEmployees: Array<{
    id: string;
    employeeUid: string;
    employeeName: string;
    roleTitle: string;
    status: string;
  }>;
  finances: {
    cashBalance: number;
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
  } | null;
  stats: {
    availableCount: number;
    soldCount: number;
    totalVehicleRevenue: number;
    pendingCommissionsAmount: number;
  };
}

export interface GarageOverviewPayload {
  vehicles: PlayerVehicle[];
  transactions: VehicleTransaction[];
  maintenance: VehicleMaintenanceRecord[];
  myListings: VehicleListing[];
  incomingOffers: VehicleOffer[];
  outgoingOffers: VehicleOffer[];
  myCommissions: VehicleCommissionRecord[];
  totalVehiclesValue: number;
}

export interface AdminVehicleOverview {
  catalog: VehicleCatalogModel[];
  vehicles: PlayerVehicle[];
  stock: DealershipStockItem[];
  listings: VehicleListing[];
  transactions: VehicleTransaction[];
  commissions: VehicleCommissionRecord[];
  dealerships: Array<{
    id: string;
    name: string;
    ownerUid: string;
    ownerName: string;
    status: string;
    availableCount: number;
    soldCount: number;
  }>;
}
