import type { BusinessLocation, BusinessTemplateType } from '../types/business';

export interface DefaultBusinessProductTemplate {
  name: string;
  sku: string;
  category: string;
  unitCost: number;
  salePrice: number;
}

export const BUSINESS_TEMPLATE_TYPES: BusinessTemplateType[] = [
  'concessionaria',
  'supermercado',
  'oficina',
  'transportadora',
  'restaurante',
  'imobiliaria',
  'seguranca',
  'loja_roupas',
  'posto_combustivel',
  'entretenimento',
];

export const DEFAULT_BUSINESS_LOCATIONS: BusinessLocation[] = [
  {
    id: 'concessionaria',
    templateType: 'concessionaria',
    name: 'Apex Motors Concessionária',
    category: 'Automotivo',
    description:
      'Showroom oficial de veículos urbanos e utilitários de alto giro no Distrito Central.',
    acquisitionPrice: 850,
    initialCapital: 300,
    operatingExpense: 110,
    maxEmployees: 8,
    revenuePotential: 980,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.5,
    locationLabel: 'Quadra Sudoeste · Apex Motors',
    posX: -18,
    posZ: 18,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'supermercado',
    templateType: 'supermercado',
    name: 'Mercado Central Veridia',
    category: 'Varejo Alimentício',
    description:
      'Abastecimento diário de mantimentos, bebidas e itens essenciais para moradores e empresas.',
    acquisitionPrice: 650,
    initialCapital: 250,
    operatingExpense: 85,
    maxEmployees: 10,
    revenuePotential: 760,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.2,
    locationLabel: 'Avenida Leste · Galeria Sul',
    posX: 11,
    posZ: 14,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'oficina',
    templateType: 'oficina',
    name: 'Oficina Turbo Distrito',
    category: 'Serviços Automotivos',
    description:
      'Manutenção preventiva, peças automotivas, calibração e reparos para frotas da cidade.',
    acquisitionPrice: 700,
    initialCapital: 260,
    operatingExpense: 90,
    maxEmployees: 7,
    revenuePotential: 820,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.4,
    locationLabel: 'Alameda Oeste · Polo Automotivo',
    posX: -11,
    posZ: 14,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'transportadora',
    templateType: 'transportadora',
    name: 'TransLCE Logística',
    category: 'Logística & Cargas',
    description:
      'Distribuição comercial, fretes corporativos e entrega de suprimentos entre estabelecimentos.',
    acquisitionPrice: 780,
    initialCapital: 280,
    operatingExpense: 100,
    maxEmployees: 9,
    revenuePotential: 890,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.3,
    locationLabel: 'Setor Nordeste · Terminal Metropolitano',
    posX: 11,
    posZ: -14,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'restaurante',
    templateType: 'restaurante',
    name: 'Bistrô Avenida Sul',
    category: 'Gastronomia',
    description:
      'Restaurante executivo e delivery urbano com alta recorrência e forte valorização de reputação.',
    acquisitionPrice: 600,
    initialCapital: 220,
    operatingExpense: 80,
    maxEmployees: 8,
    revenuePotential: 720,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.4,
    locationLabel: 'Boulevard Sul · Praça Central',
    posX: 0,
    posZ: 22,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'imobiliaria',
    templateType: 'imobiliaria',
    name: 'Veridia Imóveis & Patrimônio',
    category: 'Mercado Imobiliário',
    description:
      'Intermediação de escritórios, salas comerciais, gestão de contratos e avaliação patrimonial.',
    acquisitionPrice: 950,
    initialCapital: 350,
    operatingExpense: 125,
    maxEmployees: 6,
    revenuePotential: 1120,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.6,
    locationLabel: 'Setor Noroeste · Centro Financeiro',
    posX: -11,
    posZ: -14,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'seguranca',
    templateType: 'seguranca',
    name: 'Sentinel Segurança Privada',
    category: 'Segurança Corporativa',
    description:
      'Escolta legal, monitoramento patrimonial e proteção de estabelecimentos e cargas comerciais.',
    acquisitionPrice: 820,
    initialCapital: 300,
    operatingExpense: 105,
    maxEmployees: 10,
    revenuePotential: 940,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.5,
    locationLabel: 'Avenida Leste · Torre Sentinel',
    posX: 24,
    posZ: 0,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'loja_roupas',
    templateType: 'loja_roupas',
    name: 'Atelier Distrito Moda',
    category: 'Varejo & Moda',
    description:
      'Trajes executivos, vestuário urbano e coleções exclusivas na Galeria Comercial LCE.',
    acquisitionPrice: 550,
    initialCapital: 200,
    operatingExpense: 70,
    maxEmployees: 6,
    revenuePotential: 660,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.5,
    locationLabel: 'Quadra Sudeste · Galeria Comercial',
    posX: 18,
    posZ: 18,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'posto_combustivel',
    templateType: 'posto_combustivel',
    name: 'Posto Veridia Combustíveis',
    category: 'Energia & Abastecimento',
    description:
      'Abastecimento de frotas, lubrificantes e loja de conveniência com fluxo contínuo na avenida.',
    acquisitionPrice: 750,
    initialCapital: 280,
    operatingExpense: 95,
    maxEmployees: 8,
    revenuePotential: 870,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.2,
    locationLabel: 'Avenida Oeste · Corredor Urbano',
    posX: -24,
    posZ: 0,
    available: true,
    isCatalogLocation: true,
  },
  {
    id: 'entretenimento',
    templateType: 'entretenimento',
    name: 'Club & Lounge Solaris',
    category: 'Entretenimento & Eventos',
    description:
      'Casa de eventos corporativos, camarotes e programação noturna no eixo norte da cidade.',
    acquisitionPrice: 900,
    initialCapital: 320,
    operatingExpense: 120,
    maxEmployees: 12,
    revenuePotential: 1080,
    minPriceMultiplier: 1.05,
    maxPriceMultiplier: 2.8,
    locationLabel: 'Boulevard Norte · Eixo Solaris',
    posX: 0,
    posZ: -22,
    available: true,
    isCatalogLocation: true,
  },
];

export const DEFAULT_BUSINESS_LOCATIONS_MAP: Record<string, BusinessLocation> =
  DEFAULT_BUSINESS_LOCATIONS.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {} as Record<string, BusinessLocation>);

export const DEFAULT_PRODUCTS_BY_TYPE: Record<
  BusinessTemplateType,
  DefaultBusinessProductTemplate[]
> = {
  concessionaria: [
    { name: 'Kit Acessórios Executivos', sku: 'APX-01', category: 'Acessórios', unitCost: 45, salePrice: 75 },
    { name: 'Pacote Revisão Zero KM', sku: 'APX-02', category: 'Serviços', unitCost: 60, salePrice: 105 },
  ],
  supermercado: [
    { name: 'Cesta Básica Metropolitana', sku: 'SUP-01', category: 'Alimentos', unitCost: 22, salePrice: 36 },
    { name: 'Pack Bebidas Premium', sku: 'SUP-02', category: 'Bebidas', unitCost: 18, salePrice: 30 },
  ],
  oficina: [
    { name: 'Jogo de Pastilhas de Freio', sku: 'OFC-01', category: 'Peças', unitCost: 35, salePrice: 62 },
    { name: 'Troca de Óleo Sintético', sku: 'OFC-02', category: 'Manutenção', unitCost: 28, salePrice: 52 },
  ],
  transportadora: [
    { name: 'Contrato Frete Expresso', sku: 'TRN-01', category: 'Logística', unitCost: 40, salePrice: 72 },
    { name: 'Lote Embalagens Industriais', sku: 'TRN-02', category: 'Suprimentos', unitCost: 25, salePrice: 44 },
  ],
  restaurante: [
    { name: 'Menu Executivo Distrito', sku: 'RST-01', category: 'Refeições', unitCost: 16, salePrice: 32 },
    { name: 'Combo Jantar Corporativo', sku: 'RST-02', category: 'Eventos', unitCost: 38, salePrice: 68 },
  ],
  imobiliaria: [
    { name: 'Laudo de Avaliação Comercial', sku: 'IMB-01', category: 'Consultoria', unitCost: 50, salePrice: 95 },
    { name: 'Pacote Gestão de Locação', sku: 'IMB-02', category: 'Contratos', unitCost: 65, salePrice: 120 },
  ],
  seguranca: [
    { name: 'Kit Monitoramento CFTV', sku: 'SEG-01', category: 'Equipamentos', unitCost: 55, salePrice: 98 },
    { name: 'Diária Escolta Patrimonial', sku: 'SEG-02', category: 'Serviços', unitCost: 48, salePrice: 88 },
  ],
  loja_roupas: [
    { name: 'Blazer Executivo Obsidiana', sku: 'MOD-01', category: 'Vestuário', unitCost: 30, salePrice: 58 },
    { name: 'Jaqueta Urbana Distrito', sku: 'MOD-02', category: 'Vestuário', unitCost: 24, salePrice: 46 },
  ],
  posto_combustivel: [
    { name: 'Galão Combustível Aditivado', sku: 'PST-01', category: 'Combustível', unitCost: 20, salePrice: 34 },
    { name: 'Lubrificante Alta Performance', sku: 'PST-02', category: 'Automotivo', unitCost: 26, salePrice: 45 },
  ],
  entretenimento: [
    { name: 'Ingresso Camarote Solaris', sku: 'ENT-01', category: 'Ingressos', unitCost: 32, salePrice: 64 },
    { name: 'Reserva Mesa VIP', sku: 'ENT-02', category: 'Eventos', unitCost: 55, salePrice: 110 },
  ],
};

export function getBusinessStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Funcionando';
    case 'inactive_funds':
      return 'Inoperante (Caixa Insuficiente)';
    case 'suspended':
      return 'Suspensa pela Administração';
    default:
      return status;
  }
}

export function getBusinessTxLabel(type: string): string {
  switch (type) {
    case 'acquisition':
      return 'Abertura / Aquisição';
    case 'p2p_sale':
      return 'Compra e Venda P2P';
    case 'capital_inject':
      return 'Aporte de Capital';
    case 'capital_withdraw':
      return 'Retirada de Lucro';
    case 'payroll':
      return 'Folha Salarial';
    case 'inventory_purchase':
      return 'Compra de Estoque';
    case 'product_sale':
      return 'Venda Comercial';
    case 'operating_expense':
      return 'Despesas Operacionais';
    case 'admin_adjustment':
      return 'Intervenção Administrativa';
    case 'vehicle_restock':
      return 'Compra de Estoque (Veículo)';
    case 'vehicle_sale':
      return 'Venda de Veículo';
    case 'vehicle_commission':
      return 'Comissão de Vendedor';
    default:
      return type;
  }
}

export function getReputationTier(rep: number): string {
  if (rep >= 85) return 'Excelência Corporativa';
  if (rep >= 65) return 'Consolidada';
  if (rep >= 45) return 'Estável';
  if (rep >= 25) return 'Em Desenvolvimento';
  return 'Crítica';
}
