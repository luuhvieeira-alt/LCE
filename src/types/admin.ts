import type { Timestamp } from 'firebase/firestore';
import type {
  BankAccount,
  FinancialTransaction,
  JobDefinition,
  SalaryPayment,
  Wallet,
} from './economy';
import type { CharacterProfile } from './character';

export interface EconomyBaseConfig {
  id: string;
  cityName: string;
  taxRatePercent: number;
  baseSalaryHourly: number;
  baseFuelPrice: number;
  basePropertyPrice: number;
  initialCleanCash?: number;
  initialBankBalance?: number;
  defaultMaxDailyPayouts?: number;
  marketOpen: boolean;
  updatedBy: string;
  updatedAt: Timestamp;
}

export interface EconomyConfigDraft {
  cityName: string;
  taxRatePercent: number;
  baseSalaryHourly: number;
  baseFuelPrice: number;
  basePropertyPrice: number;
  initialCleanCash: number;
  initialBankBalance: number;
  defaultMaxDailyPayouts: number;
  marketOpen: boolean;
}

export type AuditActionType =
  | 'update_economy_config'
  | 'bootstrap_admin'
  | 'update_citizen_status'
  | 'update_job_config'
  | 'admin_balance_adjustment'
  | 'create_business_location'
  | 'update_business_location'
  | 'admin_business_action';

export interface AdminAuditLog {
  id?: string;
  actorUid: string;
  action: AuditActionType;
  targetUid?: string;
  summary: string;
  createdAt: Timestamp | string;
}

export interface AdminServerSession {
  authorized: boolean;
  uid: string;
  isBootstrappedOwner: boolean;
  serverTimestamp: number;
  shardStats: {
    onlinePlayers: number;
    activeDistricts: string[];
    economyMode: string;
  };
}

export interface AdminEconomyOverview {
  users: CharacterProfile[];
  wallets: Wallet[];
  bankAccounts: BankAccount[];
  transactions: FinancialTransaction[];
  salaryPayments: SalaryPayment[];
  jobs: JobDefinition[];
  adminLogs: AdminAuditLog[];
}

