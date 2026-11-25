import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { handleFirestoreError, OperationType } from './firestoreError';
import { createOperationId } from './economyService';
import type { AdminRecord, AdminSessionStatus } from '../types/user';
import type {
  AdminAuditLog,
  AdminEconomyOverview,
  AdminServerSession,
  EconomyBaseConfig,
  EconomyConfigDraft,
} from '../types/admin';
import type { CharacterProfile, CharacterStatus } from '../types/character';
import type { CurrencyCategory, JobDefinition, LegalJobId } from '../types/economy';

export const DEFAULT_ECONOMY_DRAFT: EconomyConfigDraft = {
  cityName: 'Nova Veridia — Distrito Central',
  taxRatePercent: 8.5,
  baseSalaryHourly: 120,
  baseFuelPrice: 6.5,
  basePropertyPrice: 85000,
  initialCleanCash: 500,
  initialBankBalance: 1000,
  defaultMaxDailyPayouts: 12,
  marketOpen: true,
};

export async function fetchAdminServerSession(user: User): Promise<AdminServerSession | null> {
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/session', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as AdminServerSession;
  } catch {
    return null;
  }
}

export async function resolveAdminStatus(user: User): Promise<AdminSessionStatus> {
  if (!user.emailVerified) {
    return {
      isAdmin: false,
      role: null,
      label: null,
      isBootstrappedOwner: false,
      verifiedByServer: false,
    };
  }

  // Step 1: Server-side cryptographic verification of Firebase ID Token
  const serverSession = await fetchAdminServerSession(user);
  const verifiedByServer = Boolean(serverSession?.authorized);
  const isBootstrappedOwner = Boolean(serverSession?.isBootstrappedOwner);

  // Step 2: Database-backed RBAC check in Firestore /admins/{uid}
  let adminDoc: AdminRecord | null = null;
  const adminPath = `admins/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    if (snap.exists()) {
      adminDoc = snap.data() as AdminRecord;
    }
  } catch (error) {
    console.warn('Verificação de registro administrativo:', adminPath, error);
  }

  const isAdmin = verifiedByServer && (isBootstrappedOwner || adminDoc !== null);

  return {
    isAdmin,
    role: adminDoc?.role ?? (isBootstrappedOwner ? 'super_admin' : null),
    label: adminDoc?.label ?? (isBootstrappedOwner ? 'Fundador do Universo' : null),
    isBootstrappedOwner,
    verifiedByServer,
  };
}

export async function getEconomyConfig(): Promise<EconomyBaseConfig | null> {
  const path = 'economyConfig/global';
  try {
    const snap = await getDoc(doc(db, 'economyConfig', 'global'));
    if (!snap.exists()) return null;
    return snap.data() as EconomyBaseConfig;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveEconomyConfig(
  actorUid: string,
  draft: EconomyConfigDraft
): Promise<void> {
  const cityName = draft.cityName.trim().slice(0, 64);
  if (cityName.length < 3) {
    throw new Error('O nome da cidade deve ter pelo menos 3 caracteres.');
  }

  const taxRatePercent = Math.max(0, Math.min(50, Number(draft.taxRatePercent)));
  const baseSalaryHourly = Math.max(10, Math.min(10000, Number(draft.baseSalaryHourly)));
  const baseFuelPrice = Math.max(1, Math.min(500, Number(draft.baseFuelPrice)));
  const basePropertyPrice = Math.max(1000, Math.min(10000000, Number(draft.basePropertyPrice)));
  const initialCleanCash = Math.max(0, Math.min(1000000, Math.round(Number(draft.initialCleanCash))));
  const initialBankBalance = Math.max(
    0,
    Math.min(1000000, Math.round(Number(draft.initialBankBalance)))
  );
  const defaultMaxDailyPayouts = Math.max(
    1,
    Math.min(100, Math.round(Number(draft.defaultMaxDailyPayouts)))
  );

  const path = 'economyConfig/global';
  try {
    await setDoc(doc(db, 'economyConfig', 'global'), {
      id: 'global',
      cityName,
      taxRatePercent,
      baseSalaryHourly,
      baseFuelPrice,
      basePropertyPrice,
      initialCleanCash,
      initialBankBalance,
      defaultMaxDailyPayouts,
      marketOpen: Boolean(draft.marketOpen),
      updatedBy: actorUid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }

  await appendAdminAuditLog(
    actorUid,
    'update_economy_config',
    `Economia atualizada: imposto ${taxRatePercent}%, inicial espécie R$ ${initialCleanCash} / banco R$ ${initialBankBalance}, teto diário ${defaultMaxDailyPayouts}.`
  );
}

export async function bootstrapOwnerAdminRecord(uid: string, label: string): Promise<void> {
  const path = `admins/${uid}`;
  try {
    await setDoc(doc(db, 'admins', uid), {
      uid,
      role: 'super_admin',
      label: label.trim().slice(0, 64) || 'Administrador Principal',
      grantedBy: uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  await appendAdminAuditLog(
    uid,
    'bootstrap_admin',
    `Registro administrativo oficial ativado na coleção /admins/${uid}.`
  );
}

export async function appendAdminAuditLog(
  actorUid: string,
  action: AdminAuditLog['action'],
  summary: string,
  targetUid?: string
): Promise<void> {
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `admin_logs/${logId}`;
  try {
    const payload: Record<string, unknown> = {
      actorUid,
      action,
      summary: summary.trim().slice(0, 240),
      createdAt: serverTimestamp(),
    };
    if (targetUid) {
      payload.targetUid = targetUid;
    }
    await setDoc(doc(db, 'admin_logs', logId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listAdminAuditLogs(
  actorUid: string,
  isBootstrappedOwner: boolean
): Promise<AdminAuditLog[]> {
  const path = 'admin_logs';
  try {
    const colRef = collection(db, 'admin_logs');
    const q = isBootstrappedOwner
      ? query(colRef, orderBy('createdAt', 'desc'), limit(30))
      : query(colRef, where('actorUid', '==', actorUid), orderBy('createdAt', 'desc'), limit(30));

    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AdminAuditLog, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listCitizensForAdmin(): Promise<CharacterProfile[]> {
  const path = 'users';
  try {
    const q = query(collection(db, 'users'), limit(50));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as CharacterProfile);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function updateCitizenOperationalStatus(
  actorUid: string,
  targetUid: string,
  status: CharacterStatus
): Promise<void> {
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  await appendAdminAuditLog(
    actorUid,
    'update_citizen_status',
    `Status operacional do cidadão ${targetUid} alterado para ${status}.`,
    targetUid
  );
}

// --- Server-Authoritative Admin Economy Endpoints ---

async function adminApiRequest<T>(
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
        : `Falha na operação administrativa (HTTP ${res.status}).`
    );
  }
  return data as T;
}

export async function fetchAdminEconomyOverview(user: User): Promise<AdminEconomyOverview> {
  return adminApiRequest<AdminEconomyOverview>(user, 'GET', '/api/admin/economy/overview');
}

export async function seedJobsCatalogAdmin(user: User): Promise<{ ok: boolean; seededCount: number }> {
  return adminApiRequest(user, 'POST', '/api/admin/economy/seed-jobs', {});
}

export async function updateJobConfigAdmin(
  user: User,
  jobId: LegalJobId,
  payload: Partial<JobDefinition>
): Promise<{ ok: boolean; jobId: string }> {
  return adminApiRequest(
    user,
    'PUT',
    `/api/admin/economy/jobs/${encodeURIComponent(jobId)}`,
    payload as Record<string, unknown>
  );
}

export async function executeAdminBalanceAdjustment(
  user: User,
  input: {
    targetUid: string;
    targetAccount: CurrencyCategory;
    delta: number;
    reason: string;
  }
): Promise<{ ok: boolean; txId: string; logId: string; newBalance: number }> {
  return adminApiRequest(user, 'POST', '/api/admin/economy/adjust', {
    ...input,
    operationId: createOperationId('adj'),
  });
}

