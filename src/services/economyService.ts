import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { DEFAULT_JOBS_CATALOG } from '../config/economyCatalog';
import { handleFirestoreError, OperationType } from './firestoreError';
import type {
  BankAccount,
  BankDirectoryEntry,
  FinancialTransaction,
  JobDefinition,
  JobExperience,
  LegalJobId,
  SalaryPayment,
  Wallet,
  WorkSession,
} from '../types/economy';

export function createOperationId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function timestampToEpochMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof val === 'object') {
    const obj = val as { toMillis?: () => number; seconds?: number };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    if (typeof obj.seconds === 'number') return obj.seconds * 1000;
  }
  return 0;
}

async function authedEconomyPost<T>(
  user: User,
  url: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof data.error === 'string' ? data.error : `Erro na operação econômica (HTTP ${res.status}).`
    );
  }
  return data as T;
}

// --- Server-Authoritative Economic API Calls ---

export async function bootstrapEconomy(user: User): Promise<{
  ok: boolean;
  accountNumber: string;
  createdDocuments: number;
}> {
  return authedEconomyPost(user, '/api/economy/bootstrap', {});
}

export async function depositCleanCash(
  user: User,
  amount: number,
  description?: string,
  operationId = createOperationId('dep')
): Promise<{ ok: boolean; txId: string; cleanCash: number; bankBalance: number }> {
  return authedEconomyPost(user, '/api/economy/deposit', {
    amount,
    operationId,
    source: 'clean_cash',
    description,
  });
}

export async function withdrawBankCash(
  user: User,
  amount: number,
  description?: string,
  operationId = createOperationId('wdr')
): Promise<{ ok: boolean; txId: string; cleanCash: number; bankBalance: number }> {
  return authedEconomyPost(user, '/api/economy/withdraw', {
    amount,
    operationId,
    description,
  });
}

export async function transferBankFunds(
  user: User,
  recipientUid: string,
  amount: number,
  description?: string,
  operationId = createOperationId('trf')
): Promise<{ ok: boolean; txId: string; bankBalance: number; recipientLabel: string }> {
  return authedEconomyPost(user, '/api/economy/transfer', {
    recipientUid,
    amount,
    operationId,
    description,
  });
}

export async function startWorkShift(
  user: User,
  jobId: LegalJobId
): Promise<{
  ok: boolean;
  session: {
    id: string;
    jobId: LegalJobId;
    jobName: string;
    durationSeconds: number;
    expectedSalary: number;
    xpReward: number;
    tierLabel: string;
    startedAtMs: number;
  };
}> {
  return authedEconomyPost(user, '/api/jobs/start', { jobId });
}

export async function completeWorkShift(
  user: User,
  sessionId: string
): Promise<{
  ok: boolean;
  txId: string;
  paidAmount: number;
  xpAwarded: number;
  bankBalance: number;
  totalXp: number;
  jobXp: number;
  tierLabel: string;
}> {
  return authedEconomyPost(user, '/api/jobs/complete', { sessionId });
}

export async function cancelWorkShift(
  user: User,
  sessionId: string
): Promise<{ ok: boolean; sessionId: string }> {
  return authedEconomyPost(user, '/api/jobs/cancel', { sessionId });
}

// --- Real-Time Private Firestore Read Subscriptions ---

export function subscribeWallet(
  uid: string,
  onChange: (wallet: Wallet | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `wallets/${uid}`;
  return onSnapshot(
    doc(db, 'wallets', uid),
    (snap) => {
      onChange(snap.exists() ? (snap.data() as Wallet) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeBankAccount(
  uid: string,
  onChange: (account: BankAccount | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `bank_accounts/${uid}`;
  return onSnapshot(
    doc(db, 'bank_accounts', uid),
    (snap) => {
      onChange(snap.exists() ? (snap.data() as BankAccount) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeJobExperience(
  uid: string,
  onChange: (xp: JobExperience | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `job_experience/${uid}`;
  return onSnapshot(
    doc(db, 'job_experience', uid),
    (snap) => {
      onChange(snap.exists() ? (snap.data() as JobExperience) : null);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribePlayerTransactions(
  uid: string,
  onChange: (txs: FinancialTransaction[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'transactions';
  const q = query(
    collection(db, 'transactions'),
    where('participants', 'array-contains', uid),
    limit(60)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<FinancialTransaction, 'id'>) }))
        .sort((a, b) => timestampToEpochMs(b.createdAt) - timestampToEpochMs(a.createdAt));
      onChange(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeBankDirectory(
  onChange: (entries: BankDirectoryEntry[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'bank_directory';
  const q = query(collection(db, 'bank_directory'), where('active', '==', true), limit(60));
  return onSnapshot(
    q,
    (snap) => {
      const entries = snap.docs
        .map((d) => d.data() as BankDirectoryEntry)
        .sort((a, b) => a.characterName.localeCompare(b.characterName));
      onChange(entries);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeJobsCatalog(
  onChange: (jobs: JobDefinition[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'jobs';
  const q = query(collection(db, 'jobs'), where('isCatalogJob', '==', true), limit(20));
  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onChange(DEFAULT_JOBS_CATALOG);
        return;
      }
      const remoteMap = new Map<string, JobDefinition>();
      for (const d of snap.docs) {
        const data = d.data() as JobDefinition;
        remoteMap.set(data.id, data);
      }
      const merged = DEFAULT_JOBS_CATALOG.map((def) => remoteMap.get(def.id) ?? def);
      onChange(merged);
    },
    (error) => {
      onChange(DEFAULT_JOBS_CATALOG);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribePlayerWorkSessions(
  uid: string,
  onChange: (sessions: WorkSession[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'work_sessions';
  const q = query(collection(db, 'work_sessions'), where('uid', '==', uid), limit(30));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<WorkSession, 'id'>) }))
        .sort((a, b) => timestampToEpochMs(b.startedAt) - timestampToEpochMs(a.startedAt));
      onChange(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeSalaryPayments(
  uid: string,
  onChange: (payments: SalaryPayment[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'salary_payments';
  const q = query(collection(db, 'salary_payments'), where('uid', '==', uid), limit(40));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<SalaryPayment, 'id'>) }))
        .sort((a, b) => timestampToEpochMs(b.paidAt) - timestampToEpochMs(a.paidAt));
      onChange(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}
