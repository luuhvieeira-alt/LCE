import type { Timestamp } from 'firebase/firestore';

export type JobId = 'entregador' | 'supermercado' | 'motorista' | 'mecanico';
export type LegalJobId = JobId;

export type TransactionType =
  | 'deposit'
  | 'withdraw'
  | 'transfer'
  | 'salary'
  | 'admin_adjustment'
  | 'business_purchase'
  | 'business_sale'
  | 'business_payroll'
  | 'business_capital'
  | 'vehicle_purchase'
  | 'vehicle_p2p_sale'
  | 'vehicle_maintenance'
  | 'vehicle_commission';

export type CurrencyCategory = 'clean_cash' | 'bank' | 'dirty_cash';

export type ProfessionalTierName =
  | 'Iniciante'
  | 'Intermediário'
  | 'Experiente'
  | 'Especialista'
  | 'Mestre';

export interface Wallet {
  uid: string;
  cleanCash: number;
  dirtyCash: number;
  companiesValue: number;
  realEstateValue: number;
  vehiclesValue: number;
  investmentsValue: number;
  otherAssetsValue: number;
  lastTxId: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface BankAccount {
  uid: string;
  accountNumber: string;
  bankName: string;
  balance: number;
  status: 'active' | 'frozen';
  lastTxId: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface BankDirectoryEntry {
  uid: string;
  characterName: string;
  alias: string;
  accountNumber: string;
  active: boolean;
  updatedAt?: Timestamp | string;
}

export interface FinancialTransaction {
  id: string;
  operationId: string;
  type: TransactionType;
  currencyCategory: CurrencyCategory;
  amount: number;
  fromUid: string;
  fromLabel: string;
  toUid: string;
  toLabel: string;
  actorUid: string;
  participants: string[];
  description: string;
  status: 'completed';
  createdAt?: Timestamp | string;
}

export interface JobDefinition {
  id: JobId;
  name: string;
  description: string;
  baseSalary: number;
  durationSeconds: number;
  cooldownSeconds: number;
  maxDailyPayouts: number;
  minLevel: number;
  requiredExperience: number;
  xpReward: number;
  reputationReward: number;
  available: boolean;
  isCatalogJob: true;
  updatedBy?: string;
  updatedAt?: Timestamp | string;
}

export interface WorkSession {
  id: string;
  uid: string;
  jobId: JobId;
  jobName: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  durationSeconds: number;
  expectedSalary: number;
  xpReward: number;
  startedAt?: Timestamp | string;
  completedAt?: Timestamp | string;
  payoutTxId?: string;
}

export interface SalaryPayment {
  id: string;
  sessionId: string;
  uid: string;
  jobId: JobId;
  jobName: string;
  amount: number;
  xpAwarded: number;
  tierLabel: ProfessionalTierName;
  txId: string;
  paidAt?: Timestamp | string;
}

export interface JobExperience {
  uid: string;
  totalXp: number;
  entregadorXp: number;
  supermercadoXp: number;
  motoristaXp: number;
  mecanicoXp: number;
  lastSessionId: string;
  createdAt?: Timestamp | string;
  updatedAt?: Timestamp | string;
}

export interface ProfessionalTierInfo {
  name: ProfessionalTierName;
  multiplier: number;
  minXp: number;
  nextMinXp: number | null;
  progressPercent: number;
}
