import type {
  JobDefinition,
  JobExperience,
  JobId,
  ProfessionalTierInfo,
  ProfessionalTierName,
} from '../types/economy';

export const LCE_BANK_NAME = 'Banco Central LCE';
export const DEFAULT_INITIAL_CLEAN_CASH = 500;
export const DEFAULT_INITIAL_BANK_BALANCE = 1000;
export const DEFAULT_MAX_DAILY_PAYOUTS = 12;

export const PROFESSIONAL_TIERS: Array<{
  name: ProfessionalTierName;
  minXp: number;
  multiplier: number;
}> = [
  { name: 'Iniciante', minXp: 0, multiplier: 1.0 },
  { name: 'Intermediário', minXp: 100, multiplier: 1.15 },
  { name: 'Experiente', minXp: 300, multiplier: 1.3 },
  { name: 'Especialista', minXp: 650, multiplier: 1.5 },
  { name: 'Mestre', minXp: 1200, multiplier: 1.75 },
];

export const DEFAULT_JOBS_CATALOG: JobDefinition[] = [
  {
    id: 'entregador',
    name: 'Entregador',
    description:
      'Entregas expressas de encomendas e suprimentos pelos estabelecimentos do Distrito Central.',
    baseSalary: 140,
    durationSeconds: 20,
    cooldownSeconds: 15,
    maxDailyPayouts: 12,
    minLevel: 1,
    requiredExperience: 0,
    xpReward: 25,
    reputationReward: 2,
    available: true,
    isCatalogJob: true,
  },
  {
    id: 'supermercado',
    name: 'Funcionário de Supermercado',
    description:
      'Reposição de estoque, atendimento no caixa e conferência de mercadorias no comércio local.',
    baseSalary: 175,
    durationSeconds: 25,
    cooldownSeconds: 20,
    maxDailyPayouts: 10,
    minLevel: 1,
    requiredExperience: 0,
    xpReward: 30,
    reputationReward: 3,
    available: true,
    isCatalogJob: true,
  },
  {
    id: 'motorista',
    name: 'Motorista',
    description:
      'Transporte urbano de passageiros e logística corporativa entre avenidas do distrito.',
    baseSalary: 230,
    durationSeconds: 30,
    cooldownSeconds: 25,
    maxDailyPayouts: 10,
    minLevel: 1,
    requiredExperience: 50,
    xpReward: 40,
    reputationReward: 4,
    available: true,
    isCatalogJob: true,
  },
  {
    id: 'mecanico',
    name: 'Mecânico',
    description:
      'Revisão técnica, reparos de frota e diagnósticos especializados na Apex Motors Garagem.',
    baseSalary: 310,
    durationSeconds: 35,
    cooldownSeconds: 30,
    maxDailyPayouts: 8,
    minLevel: 1,
    requiredExperience: 120,
    xpReward: 55,
    reputationReward: 5,
    available: true,
    isCatalogJob: true,
  },
];

export const DEFAULT_JOBS_MAP: Record<JobId, JobDefinition> = DEFAULT_JOBS_CATALOG.reduce(
  (acc, job) => {
    acc[job.id] = job;
    return acc;
  },
  {} as Record<JobId, JobDefinition>
);

export const JOB_TASKS_BY_ID: Record<JobId, string[]> = {
  entregador: [
    'Conferir manifesto de entrega na central',
    'Roteirizar entregas nas quadras do Distrito Central',
    'Registrar protocolo de recebimento com o destinatário',
  ],
  supermercado: [
    'Organizar reposição nas gôndolas do turno',
    'Validar fechamento de caixa e notas fiscais',
    'Auditar estoque mínimo da loja',
  ],
  motorista: [
    'Realizar inspeção rápida do veículo de serviço',
    'Cumprir trajeto executivo pelas avenidas principais',
    'Encerrar corrida e registrar quilometragem',
  ],
  mecanico: [
    'Executar diagnóstico eletrônico na oficina',
    'Substituir componentes desgastados e calibrar freios',
    'Emitir laudo técnico de liberação do veículo',
  ],
};

export function getXpForJob(exp: JobExperience | null | undefined, jobId: JobId): number {
  if (!exp) return 0;
  switch (jobId) {
    case 'entregador':
      return exp.entregadorXp ?? 0;
    case 'supermercado':
      return exp.supermercadoXp ?? 0;
    case 'motorista':
      return exp.motoristaXp ?? 0;
    case 'mecanico':
      return exp.mecanicoXp ?? 0;
  }
}

export const getJobXpFromRecord = getXpForJob;

export function getJobXpFieldKey(jobId: JobId): keyof Pick<
  JobExperience,
  'entregadorXp' | 'supermercadoXp' | 'motoristaXp' | 'mecanicoXp'
> {
  switch (jobId) {
    case 'entregador':
      return 'entregadorXp';
    case 'supermercado':
      return 'supermercadoXp';
    case 'motorista':
      return 'motoristaXp';
    case 'mecanico':
      return 'mecanicoXp';
  }
}

export function resolveProfessionalTier(xp: number): ProfessionalTierInfo {
  const safeXp = Math.max(0, Number.isFinite(xp) ? xp : 0);
  let idx = 0;
  for (let i = 0; i < PROFESSIONAL_TIERS.length; i++) {
    if (safeXp >= PROFESSIONAL_TIERS[i].minXp) {
      idx = i;
    }
  }
  const current = PROFESSIONAL_TIERS[idx];
  const next = PROFESSIONAL_TIERS[idx + 1] ?? null;
  const progressPercent = next
    ? Math.min(100, Math.round(((safeXp - current.minXp) / (next.minXp - current.minXp)) * 100))
    : 100;

  return {
    name: current.name,
    multiplier: current.multiplier,
    minXp: current.minXp,
    nextMinXp: next ? next.minXp : null,
    progressPercent,
  };
}

export function computeExpectedSalary(baseSalary: number, xp: number): number {
  const tier = resolveProfessionalTier(xp);
  return Math.round(baseSalary * tier.multiplier);
}

export function deriveAccountNumber(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  const part1 = String((hash % 9000) + 1000);
  const part2 = String(((hash >>> 8) % 9000) + 1000);
  return `LCE-${part1}-${part2}`;
}

export function formatBRL(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
