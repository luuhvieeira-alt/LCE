import type { CharacterOrigin, CharacterStyle } from '../types/character';

export type GameModuleId =
  | 'painel'
  | 'personagem'
  | 'mundo'
  | 'trabalho'
  | 'empresas'
  | 'financeiro'
  | 'investimentos'
  | 'garagem'
  | 'negociacoes'
  | 'configuracoes'
  | 'admin';

export interface GameModuleMeta {
  id: GameModuleId;
  label: string;
  shortLabel: string;
  description: string;
  status: 'ativo' | 'estrutura';
  roadmapModule: string;
}

export const MAIN_GAME_MODULES: GameModuleMeta[] = [
  {
    id: 'mundo',
    label: 'Mundo',
    shortLabel: 'Mundo',
    description: 'Distrito Central 3D em tempo real com universo compartilhado e câmera em terceira pessoa.',
    status: 'ativo',
    roadmapModule: 'Módulo 1 (Implementado)',
  },
  {
    id: 'painel',
    label: 'Painel',
    shortLabel: 'Painel',
    description: 'Resumo operacional do cidadão, indicadores da cidade e estado do universo compartilhado.',
    status: 'ativo',
    roadmapModule: 'Módulo 1 (Implementado)',
  },
  {
    id: 'personagem',
    label: 'Personagem',
    shortLabel: 'Perfil',
    description: 'Ficha de identidade, origem, reputação e personalização visual do traje em tempo real.',
    status: 'ativo',
    roadmapModule: 'Módulo 1 (Implementado)',
  },
  {
    id: 'trabalho',
    label: 'Trabalho',
    shortLabel: 'Trabalho',
    description: 'Carreiras urbanas, jornadas remuneradas e contratos validados no servidor.',
    status: 'estrutura',
    roadmapModule: 'Módulo 2 (Economia Base)',
  },
  {
    id: 'empresas',
    label: 'Empresas',
    shortLabel: 'Empresas',
    description: 'Abertura, compra e gestão de empresas, contratação de jogadores, folha salarial e estoque.',
    status: 'ativo',
    roadmapModule: 'Módulo 3 (Implementado)',
  },
  {
    id: 'financeiro',
    label: 'Financeiro',
    shortLabel: 'Banco',
    description: 'Extrato bancário, transferências e tributação com validação autoritativa no backend.',
    status: 'estrutura',
    roadmapModule: 'Módulo 2 (Economia Base)',
  },
  {
    id: 'investimentos',
    label: 'Investimentos',
    shortLabel: 'Ativos',
    description: 'Renda fixa municipal, participações empresariais e imóveis urbanos.',
    status: 'estrutura',
    roadmapModule: 'Módulo 4 (Mercado de Capitais)',
  },
  {
    id: 'garagem',
    label: 'Garagem',
    shortLabel: 'Garagem',
    description: 'Frota pessoal de veículos, manutenção e estacionamentos registrados.',
    status: 'estrutura',
    roadmapModule: 'Módulo 3 (Mobilidade)',
  },
  {
    id: 'negociacoes',
    label: 'Negociações',
    shortLabel: 'Mercado',
    description: 'Negociação livre entre jogadores sobre a tabela de preços-base da economia mista.',
    status: 'estrutura',
    roadmapModule: 'Módulo 2 (Economia Mista)',
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    shortLabel: 'Ajustes',
    description: 'Preferências gráficas 3D, controles de câmera, áudio e sessão Firebase.',
    status: 'ativo',
    roadmapModule: 'Módulo 1 (Implementado)',
  },
];

export interface CharacterOriginOption {
  id: CharacterOrigin;
  name: string;
  subtitle: string;
  description: string;
}

export const CHARACTER_ORIGINS: CharacterOriginOption[] = [
  {
    id: 'comerciante',
    name: 'Comerciante Local',
    subtitle: 'Redes de abastecimento e varejo',
    description: 'Começa com foco em negociações urbanas e leitura rápida de preços de mercado.',
  },
  {
    id: 'operario',
    name: 'Operário Metropolitano',
    subtitle: 'Logística e infraestrutura',
    description: 'Rotina prática nos galpões e contratos de transporte do Distrito Central.',
  },
  {
    id: 'corretor',
    name: 'Corretor Financeiro',
    subtitle: 'Crédito, imóveis e custódia',
    description: 'Perfil analítico voltado à gestão patrimonial e parcerias empresariais.',
  },
  {
    id: 'independente',
    name: 'Autônomo das Ruas',
    subtitle: 'Mobilidade e serviços sob demanda',
    description: 'Flexibilidade total para transitar entre negócios formais e oportunidades de risco.',
  },
];

export const CHARACTER_STYLES: { id: CharacterStyle; label: string }[] = [
  { id: 'executivo', label: 'Executivo' },
  { id: 'urbano', label: 'Urbano' },
  { id: 'tatico', label: 'Tático' },
];

export const COAT_PALETTE = [
  { name: 'Obsidiana', hex: '#181C24' },
  { name: 'Ardósia', hex: '#2B3445' },
  { name: 'Grafite', hex: '#383B42' },
  { name: 'Borgonha', hex: '#5C2229' },
  { name: 'Oliva Escuro', hex: '#28362B' },
  { name: 'Azul Marinho', hex: '#1B2D4B' },
];

export const ACCENT_PALETTE = [
  { name: 'Âmbar', hex: '#D97706' },
  { name: 'Ouro Fosco', hex: '#B48A3E' },
  { name: 'Aço Claro', hex: '#94A3B8' },
  { name: 'Carmesim', hex: '#B91C1C' },
  { name: 'Cobre', hex: '#9A4E27' },
];

export const SKIN_PALETTE = [
  { name: 'Claro', hex: '#E6BC9A' },
  { name: 'Dourado', hex: '#D4A373' },
  { name: 'Pardo', hex: '#A9744F' },
  { name: 'Retinto', hex: '#6B4226' },
];

export interface CityEstablishment {
  id: string;
  name: string;
  category: string;
  position: [number, number, number];
  size: [number, number, number];
  accentHex: string;
  moduleLink: GameModuleId;
  description: string;
}

// Compact urban district layout with collision boxes and interactive establishments
export const CITY_ESTABLISHMENTS: CityEstablishment[] = [
  {
    id: 'banco-central',
    name: 'Banco Central LCE',
    category: 'Financeiro',
    position: [-18, 0, -18],
    size: [14, 18, 12],
    accentHex: '#D97706',
    moduleLink: 'financeiro',
    description: 'Sede bancária da cidade. Custódia de saldos validada no servidor.',
  },
  {
    id: 'agencia-trabalho',
    name: 'Agência Metropolitana',
    category: 'Trabalho',
    position: [18, 0, -18],
    size: [13, 13, 11],
    accentHex: '#38BDF8',
    moduleLink: 'trabalho',
    description: 'Central de registros trabalhistas e contratos urbanos.',
  },
  {
    id: 'concessionaria',
    name: 'Apex Motors Garagem',
    category: 'Garagem',
    position: [-18, 0, 18],
    size: [14, 8, 12],
    accentHex: '#EF4444',
    moduleLink: 'garagem',
    description: 'Showroom e garagem central preparada para o módulo de veículos.',
  },
  {
    id: 'bolsa-comercio',
    name: 'Galeria Comercial LCE',
    category: 'Negociações',
    position: [18, 0, 18],
    size: [14, 15, 12],
    accentHex: '#10B981',
    moduleLink: 'negociacoes',
    description: 'Centro de negócios e livre negociação da economia mista.',
  },
];

// Additional architectural perimeter towers for urban depth
export interface PerimeterBuilding {
  id: string;
  position: [number, number, number];
  size: [number, number, number];
  roofHeight: number;
  tone: string;
}

export const PERIMETER_BUILDINGS: PerimeterBuilding[] = [
  { id: 'tower-n1', position: [-38, 0, -34], size: [12, 24, 12], roofHeight: 2.2, tone: '#141923' },
  { id: 'tower-n2', position: [0, 0, -38], size: [16, 28, 10], roofHeight: 3.0, tone: '#171C28' },
  { id: 'tower-n3', position: [38, 0, -34], size: [12, 22, 12], roofHeight: 1.8, tone: '#131720' },
  { id: 'tower-w1', position: [-38, 0, 0], size: [10, 19, 16], roofHeight: 1.5, tone: '#161B26' },
  { id: 'tower-e1', position: [38, 0, 0], size: [10, 21, 16], roofHeight: 2.0, tone: '#151A24' },
  { id: 'tower-s1', position: [-38, 0, 34], size: [12, 17, 12], roofHeight: 1.5, tone: '#131822' },
  { id: 'tower-s2', position: [0, 0, 38], size: [16, 20, 10], roofHeight: 2.2, tone: '#181E2B' },
  { id: 'tower-s3', position: [38, 0, 34], size: [12, 25, 12], roofHeight: 2.6, tone: '#141923' },
];
