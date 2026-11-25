import type {
  VehicleCatalogModel,
  VehicleCategory,
  VehicleMaintenanceType,
} from '../types/vehicle';

export const VEHICLE_CATEGORIES: VehicleCategory[] = [
  'popular',
  'sedan',
  'suv',
  'esportivo',
  'luxo',
  'picape',
  'moto',
  'caminhao',
];

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  popular: 'Popular',
  sedan: 'Sedã',
  suv: 'SUV',
  esportivo: 'Esportivo',
  luxo: 'Luxuoso',
  picape: 'Picape',
  moto: 'Moto',
  caminhao: 'Caminhão',
};

export const VEHICLE_MAINTENANCE_LABELS: Record<
  VehicleMaintenanceType,
  { label: string; description: string; baseMultiplier: number }
> = {
  fuel: {
    label: 'Abastecimento Completo',
    description: 'Restaura o tanque de combustível para 100% com combustível certificado.',
    baseMultiplier: 0.008,
  },
  repair: {
    label: 'Reparo Mecânico',
    description: 'Recupera integridade estrutural, motor e suspensão para 100%.',
    baseMultiplier: 0.024,
  },
  revision: {
    label: 'Revisão Preventiva Premium',
    description: 'Revisão completa + abastecimento total + preservação de valor de mercado.',
    baseMultiplier: 0.032,
  },
};

export const DEMO_DEALERSHIP_ID = 'biz_concessionaria_demo';
export const DEMO_DEALERSHIP_OWNER_UID = 'lce_city_motors';
export const DEMO_DEALERSHIP_OWNER_NAME = 'LCE Motors Oficial';
export const DEMO_DEALERSHIP_OWNER_ALIAS = 'LCE_MOTORS';
export const DEMO_DEALERSHIP_NAME = 'LCE Motors — Concessionária Central';
export const DEMO_DEALERSHIP_LOCATION_ID = 'concessionaria_demo';
export const INITIAL_STOCK_UNITS_PER_MODEL = 2;

export function makeInitialDemoStockId(modelId: string, unitIndex: 1 | 2): string {
  const slug = modelId.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return `stk_demo_${slug}_${unitIndex}`;
}

/**
 * Official LCE Initial Vehicle Catalog (8 fictional models).
 * All prices, margins and commission ceilings are configurable by Admin via /api/admin/vehicles/catalog.
 */
export const INITIAL_LCE_VEHICLE_CATALOG: VehicleCatalogModel[] = [
  {
    id: 'lce-compact',
    manufacturer: 'LCE Motors',
    model: 'LCE Compact',
    year: 2025,
    category: 'popular',
    basePrice: 8000,
    marketValue: 8000,
    topSpeed: 162,
    acceleration: 5.4,
    capacity: 4,
    fuelConsumption: 6.2,
    defaultCondition: 100,
    imageKey: 'popular',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.2,
    maxCommissionPercent: 12,
    description:
      'Hatch urbano econômico de entrada, ágil no trânsito do Distrito Central e com manutenção acessível.',
    active: true,
    isCatalogVehicle: true,
  },
  {
    id: 'lce-urban',
    manufacturer: 'LCE Motors',
    model: 'LCE Urban',
    year: 2025,
    category: 'popular',
    basePrice: 12000,
    marketValue: 12000,
    topSpeed: 174,
    acceleration: 6.0,
    capacity: 5,
    fuelConsumption: 6.8,
    defaultCondition: 100,
    imageKey: 'popular',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.2,
    maxCommissionPercent: 12,
    description:
      'Compacto metropolitano com acabamento refinado, cinco lugares e excelente autonomia para jornadas diárias.',
    active: true,
    isCatalogVehicle: true,
  },
  {
    id: 'lce-sedan',
    manufacturer: 'LCE Motors',
    model: 'LCE Sedan',
    year: 2025,
    category: 'sedan',
    basePrice: 18000,
    marketValue: 18000,
    topSpeed: 205,
    acceleration: 6.9,
    capacity: 5,
    fuelConsumption: 7.9,
    defaultCondition: 100,
    imageKey: 'sedan',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.3,
    maxCommissionPercent: 14,
    description:
      'Sedã executivo equilibrado com amplo porta-malas, estabilidade em vias expressas e conforto acústico.',
    active: true,
    isCatalogVehicle: true,
  },
  {
    id: 'lce-family',
    manufacturer: 'LCE Motors',
    model: 'LCE Family',
    year: 2025,
    category: 'suv',
    basePrice: 25000,
    marketValue: 25000,
    topSpeed: 196,
    acceleration: 6.6,
    capacity: 7,
    fuelConsumption: 9.8,
    defaultCondition: 100,
    imageKey: 'suv',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.3,
    maxCommissionPercent: 14,
    description:
      'SUV espaçoso de sete lugares com suspensão elevada e tração reforçada para toda a região metropolitana.',
    active: true,
    isCatalogVehicle: true,
  },
  {
    id: 'lce-pickup',
    manufacturer: 'LCE Motors',
    model: 'LCE Pickup',
    year: 2025,
    category: 'picape',
    basePrice: 32000,
    marketValue: 32000,
    topSpeed: 188,
    acceleration: 6.8,
    capacity: 5,
    fuelConsumption: 11.4,
    defaultCondition: 100,
    imageKey: 'picape',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.3,
    maxCommissionPercent: 15,
    description:
      'Picape cabine dupla com chassi reforçado, caçamba utilitária e torque elevado para trabalho e cidade.',
    active: true,
    isCatalogVehicle: true,
  },
  {
    id: 'lce-sport',
    manufacturer: 'LCE Motors',
    model: 'LCE Sport',
    year: 2026,
    category: 'esportivo',
    basePrice: 55000,
    marketValue: 55000,
    topSpeed: 292,
    acceleration: 9.1,
    capacity: 2,
    fuelConsumption: 13.8,
    defaultCondition: 100,
    imageKey: 'esportivo',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.6,
    maxCommissionPercent: 18,
    description:
      'Cupê esportivo biturbo de alta resposta aerodinâmica, freios cerâmicos e aceleração imediata.',
    active: true,
    isCatalogVehicle: true,
  },
  {
    id: 'lce-cargo',
    manufacturer: 'LCE Motors',
    model: 'LCE Cargo',
    year: 2025,
    category: 'caminhao',
    basePrice: 65000,
    marketValue: 65000,
    topSpeed: 138,
    acceleration: 4.5,
    capacity: 3,
    fuelConsumption: 21.5,
    defaultCondition: 100,
    imageKey: 'caminhao',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.3,
    maxCommissionPercent: 15,
    description:
      'Caminhão comercial pesado projetado para transporte de carga empresarial, logística e abastecimento urbano.',
    active: true,
    isCatalogVehicle: true,
  },
  {
    id: 'lce-premium',
    manufacturer: 'LCE Motors',
    model: 'LCE Premium',
    year: 2026,
    category: 'luxo',
    basePrice: 85000,
    marketValue: 85000,
    topSpeed: 274,
    acceleration: 8.6,
    capacity: 5,
    fuelConsumption: 12.6,
    defaultCondition: 100,
    imageKey: 'luxo',
    minPriceMultiplier: 0.85,
    maxPriceMultiplier: 2.6,
    maxCommissionPercent: 20,
    description:
      'Flagship de luxo da LCE Motors com interior artesanal, suspensão pneumática e prestígio máximo.',
    active: true,
    isCatalogVehicle: true,
  },
];

export const DEFAULT_VEHICLE_CATALOG: VehicleCatalogModel[] = INITIAL_LCE_VEHICLE_CATALOG;

export const DEFAULT_VEHICLE_CATALOG_MAP: Record<string, VehicleCatalogModel> = Object.fromEntries(
  DEFAULT_VEHICLE_CATALOG.map((m) => [m.id, m])
);

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeDiscountedPrice(salePrice: number, promoDiscountPercent: number): number {
  const clampedPromo = Math.max(0, Math.min(35, promoDiscountPercent));
  return roundMoney(salePrice * (1 - clampedPromo / 100));
}

export function computeDepreciatedMarketValue(
  baseMarketValue: number,
  condition: number,
  mileageKm: number
): number {
  const condFactor = 0.55 + 0.45 * (Math.max(0, Math.min(100, condition)) / 100);
  const mileageFactor = Math.max(0.65, 1 - mileageKm / 120000);
  return roundMoney(Math.max(20, baseMarketValue * condFactor * mileageFactor));
}

export interface MaintenanceQuote {
  cost: number;
  nextCondition: number;
  nextFuelLevel: number;
  label: string;
}

export function estimateMaintenanceCost(
  serviceType: VehicleMaintenanceType,
  baseFuelPrice: number,
  condition: number,
  fuelLevel: number,
  marketValue: number
): MaintenanceQuote {
  const safeCond = Math.max(0, Math.min(100, condition));
  const safeFuel = Math.max(0, Math.min(100, fuelLevel));
  const safeValue = Math.max(100, marketValue);
  const safeFuelPrice = Math.max(1, baseFuelPrice);

  if (serviceType === 'fuel') {
    const missingPct = Math.max(10, 100 - safeFuel);
    const liters = Math.max(4, (missingPct / 100) * 55);
    return {
      cost: roundMoney(Math.max(12, liters * safeFuelPrice)),
      nextCondition: safeCond,
      nextFuelLevel: 100,
      label: 'Abastecimento Completo (100%)',
    };
  }
  if (serviceType === 'repair') {
    const missingCond = Math.max(10, 100 - safeCond);
    return {
      cost: roundMoney(Math.max(25, Math.min(2500, safeValue * 0.025 * (missingCond / 100) + 25))),
      nextCondition: 100,
      nextFuelLevel: safeFuel,
      label: 'Reparo Mecânico Integral (100%)',
    };
  }
  const fuelPart = Math.max(10, ((100 - safeFuel) / 100) * 45 * safeFuelPrice);
  const mechPart = Math.max(30, Math.min(3000, safeValue * 0.03 * Math.max(0.25, (100 - safeCond) / 100) + 30));
  return {
    cost: roundMoney(Math.min(5000, fuelPart + mechPart)),
    nextCondition: 100,
    nextFuelLevel: 100,
    label: 'Revisão Preventiva + Abastecimento Total',
  };
}

export interface DealershipRolePreset {
  roleTitle: string;
  suggestedSalary: number;
  schedule: string;
  description: string;
}

export const DEALERSHIP_ROLE_PRESETS: DealershipRolePreset[] = [
  {
    roleTitle: 'Vendedor de Showroom',
    suggestedSalary: 280,
    schedule: 'Turno Comercial',
    description: 'Atendimento a clientes, apresentação dos veículos em exposição e fechamento de vendas.',
  },
  {
    roleTitle: 'Consultor de Frota',
    suggestedSalary: 340,
    schedule: 'Integral',
    description: 'Negociação corporativa de utilitários, picapes e caminhões para empresas da cidade.',
  },
  {
    roleTitle: 'Gerente Comercial',
    suggestedSalary: 460,
    schedule: 'Integral',
    description: 'Gestão de vitrine, precificação estratégica e supervisão de metas e comissões.',
  },
];

export function getConditionLabel(condition: number): string {
  if (condition >= 90) return 'Impecável';
  if (condition >= 70) return 'Bom Estado';
  if (condition >= 45) return 'Desgaste Moderado';
  return 'Manutenção Urgente';
}

export function getVehicleStatusLabel(status: string): string {
  switch (status) {
    case 'in_garage':
      return 'Na Garagem';
    case 'listed':
      return 'Anunciado (P2P)';
    case 'parked':
      return 'Estacionado na Cidade';
    default:
      return status;
  }
}

export function getVehicleTxLabel(type: string): string {
  switch (type) {
    case 'dealership_restock':
      return 'Compra de Estoque';
    case 'dealership_sale':
      return 'Compra em Concessionária';
    case 'p2p_sale':
      return 'Transferência P2P';
    case 'maintenance':
      return 'Manutenção / Combustível';
    case 'commission_paid':
      return 'Comissão de Venda';
    default:
      return type;
  }
}

export function getVehicleConditionTier(condition: number): {
  label: string;
  toneClass: string;
} {
  if (condition >= 90) return { label: 'Impecável', toneClass: 'text-emerald-400' };
  if (condition >= 70) return { label: 'Bom Estado', toneClass: 'text-sky-400' };
  if (condition >= 45) return { label: 'Desgaste Moderado', toneClass: 'text-amber-400' };
  return { label: 'Manutenção Urgente', toneClass: 'text-red-400' };
}
