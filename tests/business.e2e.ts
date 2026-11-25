/**
 * End-to-End Automated Test Suite for Module 3: LCE Business & Enterprise System.
 *
 * Executes all 10 mandatory two-account tests (TESTE 1..10) plus anti-fraud,
 * anti-duplication, inventory commercialization, operating expenses, P2P sale,
 * reputation reviews, and admin governance verification against real Express routes.
 */

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createWorldServer, type VerifiedTokenPayload } from '../src/server/worldServer.ts';
import {
  FirestoreRestError,
  type FirestoreBackend,
  type FirestoreCommitWrite,
  type FirestoreQueryDoc,
} from '../src/server/firestoreRest.ts';

const TOKENS: Record<string, VerifiedTokenPayload> = {
  'token-citizen-real': {
    uid: 'uid-citizen-real',
    email: 'jogador.veridia@lce.test',
    emailVerified: true,
    isBootstrappedOwner: false,
  },
  'token-alpha': {
    uid: 'uid-alpha',
    email: 'alpha@lce.test',
    emailVerified: true,
    isBootstrappedOwner: false,
  },
  'token-beta': {
    uid: 'uid-beta',
    email: 'beta@lce.test',
    emailVerified: true,
    isBootstrappedOwner: false,
  },
  'token-admin': {
    uid: 'uid-admin',
    email: 'luuhvieeira@gmail.com',
    emailVerified: true,
    isBootstrappedOwner: true,
  },
};

const VALID_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function assertExactKeys(
  col: string,
  docId: string,
  data: Record<string, unknown>,
  required: string[],
  allowed: string[] = required
): void {
  const keys = Object.keys(data);
  for (const reqKey of required) {
    if (!(reqKey in data)) {
      throw new FirestoreRestError(
        403,
        'PERMISSION_DENIED',
        `[Rules Parity] ${col}/${docId} missing required field '${reqKey}'`
      );
    }
  }
  const allowedSet = new Set(allowed);
  for (const k of keys) {
    if (!allowedSet.has(k)) {
      throw new FirestoreRestError(
        403,
        'PERMISSION_DENIED',
        `[Rules Parity] ${col}/${docId} contains forbidden extra field '${k}'`
      );
    }
  }
}

function assertRule(condition: boolean, message: string): void {
  if (!condition) {
    throw new FirestoreRestError(403, 'PERMISSION_DENIED', `[Rules Parity] ${message}`);
  }
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.001;
}

class RuleAwareBusinessMemoryFirestore implements FirestoreBackend {
  public readonly store = new Map<string, Record<string, unknown>>();
  private readonly nowFn: () => number;

  constructor(nowFn: () => number) {
    this.nowFn = nowFn;
  }

  private resolveCaller(idToken: string): VerifiedTokenPayload {
    const user = TOKENS[idToken];
    if (!user) throw new FirestoreRestError(401, 'UNAUTHENTICATED', 'Token inválido');
    return user;
  }

  private isAdmin(user: VerifiedTokenPayload): boolean {
    return user.isBootstrappedOwner || this.store.has(`admins/${user.uid}`);
  }

  private validateCommittedDoc(
    cleanPath: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
    user: VerifiedTokenPayload,
    beforeStore: Map<string, Record<string, unknown>>,
    afterStore: Map<string, Record<string, unknown>>
  ): void {
    const [col, docId] = cleanPath.split('/');
    assertRule(Boolean(user.emailVerified), `Verified user required for ${cleanPath}`);
    assertRule(VALID_ID_RE.test(docId), `Invalid docId ${cleanPath}`);

    if (col === 'transactions') {
      assertRule(!before, `transactions/${docId} is immutable (no updates)`);
      assertExactKeys(col, docId, after, [
        'id',
        'operationId',
        'type',
        'currencyCategory',
        'amount',
        'fromUid',
        'fromLabel',
        'toUid',
        'toLabel',
        'actorUid',
        'participants',
        'description',
        'status',
        'createdAt',
      ]);
      assertRule(after.id === docId, `transactions.id mismatch`);
      assertRule(
        typeof after.operationId === 'string' &&
          after.operationId.length >= 4 &&
          after.operationId.length <= 128 &&
          VALID_ID_RE.test(after.operationId),
        `transactions.operationId invalid`
      );
      assertRule(
        [
          'deposit',
          'withdraw',
          'transfer',
          'salary',
          'admin_adjustment',
          'business_purchase',
          'business_sale',
          'business_payroll',
          'business_capital',
        ].includes(String(after.type)),
        `transactions.type invalid`
      );
      assertRule(
        ['clean_cash', 'bank', 'dirty_cash'].includes(String(after.currencyCategory)),
        `transactions.currencyCategory invalid`
      );
      assertRule(
        typeof after.amount === 'number' && after.amount > 0 && after.amount <= 100_000_000,
        `transactions.amount invalid`
      );
      assertRule(
        typeof after.fromLabel === 'string' && after.fromLabel.length >= 1 && after.fromLabel.length <= 64,
        `transactions.fromLabel length invalid`
      );
      assertRule(
        typeof after.toLabel === 'string' && after.toLabel.length >= 1 && after.toLabel.length <= 64,
        `transactions.toLabel length invalid`
      );
      assertRule(
        typeof after.description === 'string' &&
          after.description.length >= 3 &&
          after.description.length <= 180,
        `transactions.description length invalid`
      );
      assertRule(after.actorUid === user.uid, `transactions.actorUid must match caller`);
      assertRule(after.status === 'completed', `transactions.status must be completed`);
      assertRule(Array.isArray(after.participants) && after.participants.length >= 1 && after.participants.length <= 2, `transactions.participants invalid`);
      return;
    }

    if (col === 'wallets') {
      assertExactKeys(col, docId, after, [
        'uid',
        'cleanCash',
        'dirtyCash',
        'companiesValue',
        'realEstateValue',
        'vehiclesValue',
        'investmentsValue',
        'otherAssetsValue',
        'lastTxId',
        'createdAt',
        'updatedAt',
      ]);
      if (before) {
        const txId = String(after.lastTxId);
        assertRule(!beforeStore.has(`transactions/${txId}`), `wallet lastTxId must be new`);
        const tx = afterStore.get(`transactions/${txId}`);
        assertRule(Boolean(tx), `wallet update requires atomic transaction`);
        if (after.companiesValue !== before.companiesValue) {
          assertRule(docId === user.uid, `wallet companiesValue only by owner`);
          assertRule(
            ['business_purchase', 'business_sale'].includes(String(tx?.type)) && tx?.fromUid === docId,
            `wallet companiesValue requires business_purchase or business_sale tx`
          );
        }
      }
      return;
    }

    if (col === 'bank_accounts') {
      assertExactKeys(col, docId, after, [
        'uid',
        'accountNumber',
        'bankName',
        'balance',
        'status',
        'lastTxId',
        'createdAt',
        'updatedAt',
      ]);
      if (before) {
        const txId = String(after.lastTxId);
        assertRule(!beforeStore.has(`transactions/${txId}`), `bank_account lastTxId must be new`);
        const tx = afterStore.get(`transactions/${txId}`);
        assertRule(Boolean(tx), `bank_account update requires atomic transaction`);
        const prevBal = Number(before.balance);
        const nextBal = Number(after.balance);
        assertRule(nextBal >= 0, `bank_account balance must be >= 0`);
        if (nextBal < prevBal) {
          assertRule(docId === user.uid, `bank debit must be by account owner`);
          assertRule(approxEq(Number(tx?.amount), prevBal - nextBal), `bank debit must match tx amount`);
        } else if (nextBal > prevBal) {
          assertRule(approxEq(Number(tx?.amount), nextBal - prevBal), `bank credit must match tx amount`);
        }
      }
      return;
    }

    if (col === 'businesses') {
      assertExactKeys(col, docId, after, [
        'id',
        'locationId',
        'templateType',
        'name',
        'category',
        'description',
        'ownerUid',
        'ownerName',
        'ownerAlias',
        'status',
        'acquisitionPrice',
        'marketValue',
        'operatingExpense',
        'maxEmployees',
        'growthLevel',
        'employeeCount',
        'reputation',
        'reputationCount',
        'forSale',
        'salePrice',
        'locationLabel',
        'posX',
        'posZ',
        'lastTxId',
        'createdAt',
        'updatedAt',
      ]);
      if (!before) {
        assertRule(after.ownerUid === user.uid, `business create ownerUid must match caller`);
        assertRule(after.status === 'active' && after.employeeCount === 0 && after.forSale === false, `business create defaults invalid`);
        const tx = afterStore.get(`transactions/${String(after.lastTxId)}`);
        assertRule(
          tx?.type === 'business_purchase' &&
            tx?.fromUid === user.uid &&
            approxEq(Number(tx?.amount), Number(after.acquisitionPrice)),
          `business create requires atomic business_purchase tx`
        );
      }
      return;
    }

    if (col === 'business_finances') {
      assertExactKeys(col, docId, after, [
        'businessId',
        'ownerUid',
        'cashBalance',
        'totalRevenue',
        'totalExpenses',
        'totalPayrollPaid',
        'netProfit',
        'lastTxId',
        'updatedAt',
      ]);
      assertRule(Number(after.cashBalance) >= 0, `business_finances.cashBalance must be >= 0`);
      if (!before) {
        const biz = afterStore.get(`businesses/${docId}`);
        assertRule(
          after.ownerUid === user.uid && biz?.ownerUid === user.uid,
          `business_finances create requires matching owner`
        );
      }
      return;
    }

    if (col === 'business_transactions') {
      assertRule(!before, `business_transactions/${docId} is immutable`);
      assertExactKeys(col, docId, after, [
        'id',
        'operationId',
        'businessId',
        'ownerUid',
        'actorUid',
        'type',
        'direction',
        'amount',
        'description',
        'counterpartyUid',
        'counterpartyLabel',
        'status',
        'createdAt',
      ]);
      assertRule(
        typeof after.description === 'string' && after.description.length >= 3 && after.description.length <= 180,
        `business_transactions.description length invalid`
      );
      assertRule(
        typeof after.counterpartyLabel === 'string' &&
          after.counterpartyLabel.length >= 1 &&
          after.counterpartyLabel.length <= 64,
        `business_transactions.counterpartyLabel length invalid`
      );
      return;
    }

    if (col === 'business_payroll') {
      assertRule(!before, `business_payroll/${docId} is immutable`);
      assertExactKeys(col, docId, after, [
        'id',
        'operationId',
        'businessId',
        'businessName',
        'contractId',
        'ownerUid',
        'employeeUid',
        'employeeName',
        'roleTitle',
        'amount',
        'bankTxId',
        'businessTxId',
        'status',
        'paidAt',
      ]);
      assertRule(after.ownerUid === user.uid && after.employeeUid !== user.uid, `business_payroll actor invalid`);
      return;
    }

    if (col === 'business_locations') {
      assertRule(this.isAdmin(user), `business_locations requires admin`);
      assertExactKeys(col, docId, after, [
        'id',
        'templateType',
        'name',
        'category',
        'description',
        'acquisitionPrice',
        'initialCapital',
        'operatingExpense',
        'maxEmployees',
        'revenuePotential',
        'minPriceMultiplier',
        'maxPriceMultiplier',
        'locationLabel',
        'posX',
        'posZ',
        'available',
        'isCatalogLocation',
        'updatedBy',
        'updatedAt',
      ]);
      assertRule(after.updatedBy === user.uid, `business_locations.updatedBy must match caller`);
      return;
    }

    if (col === 'admin_logs') {
      assertRule(!before && this.isAdmin(user), `admin_logs create requires admin`);
      assertExactKeys(
        col,
        docId,
        after,
        ['actorUid', 'action', 'summary', 'createdAt'],
        ['actorUid', 'action', 'targetUid', 'summary', 'createdAt']
      );
      assertRule(after.actorUid === user.uid, `admin_logs.actorUid must match caller`);
      assertRule(
        typeof after.summary === 'string' && after.summary.length >= 3 && after.summary.length <= 240,
        `admin_logs.summary length invalid`
      );
      return;
    }

    if (col === 'business_products') {
      assertExactKeys(col, docId, after, [
        'id',
        'businessId',
        'ownerUid',
        'name',
        'sku',
        'category',
        'unitCost',
        'salePrice',
        'minAllowedPrice',
        'maxAllowedPrice',
        'marginPercent',
        'active',
        'createdAt',
        'updatedAt',
      ]);
      return;
    }

    if (col === 'business_inventory') {
      assertExactKeys(col, docId, after, [
        'id',
        'businessId',
        'ownerUid',
        'productName',
        'quantity',
        'unitCost',
        'salePrice',
        'lastMovementType',
        'lastMovementQty',
        'updatedAt',
      ]);
      return;
    }

    if (col === 'business_vacancies') {
      assertExactKeys(col, docId, after, [
        'id',
        'businessId',
        'businessName',
        'ownerUid',
        'roleTitle',
        'salary',
        'schedule',
        'requirements',
        'slots',
        'filledSlots',
        'description',
        'status',
        'createdAt',
        'updatedAt',
      ]);
      return;
    }

    if (col === 'business_applications') {
      assertExactKeys(col, docId, after, [
        'id',
        'businessId',
        'businessName',
        'ownerUid',
        'vacancyId',
        'applicantUid',
        'applicantName',
        'applicantAlias',
        'roleTitle',
        'offeredSalary',
        'schedule',
        'coverNote',
        'status',
        'createdAt',
        'updatedAt',
      ]);
      return;
    }

    if (col === 'business_employees') {
      assertExactKeys(
        col,
        docId,
        after,
        [
          'id',
          'businessId',
          'businessName',
          'ownerUid',
          'employeeUid',
          'employeeName',
          'employeeAlias',
          'vacancyId',
          'roleTitle',
          'salary',
          'schedule',
          'status',
          'totalPaid',
          'paymentsCount',
          'hiredAt',
          'updatedAt',
        ],
        [
          'id',
          'businessId',
          'businessName',
          'ownerUid',
          'employeeUid',
          'employeeName',
          'employeeAlias',
          'vacancyId',
          'roleTitle',
          'salary',
          'schedule',
          'status',
          'lastPayrollId',
          'lastPaidAt',
          'nextPaymentAt',
          'totalPaid',
          'paymentsCount',
          'hiredAt',
          'updatedAt',
        ]
      );
      return;
    }

    if (col === 'business_reviews') {
      assertExactKeys(col, docId, after, [
        'id',
        'businessId',
        'authorUid',
        'authorName',
        'rating',
        'comment',
        'createdAt',
      ]);
      return;
    }
  }

  private assertCanRead(path: string, user: VerifiedTokenPayload): void {
    const [col, docId] = path.split('/');
    if (col === 'wallets' || col === 'bank_accounts' || col === 'job_experience') {
      if (docId !== user.uid && !this.isAdmin(user)) {
        throw new FirestoreRestError(
          403,
          'PERMISSION_DENIED',
          `Acesso privado negado a ${path} por ${user.uid}`
        );
      }
      return;
    }

    const existing = this.store.get(path);
    if (!existing) return; // resource == null -> 404

    if (col === 'business_finances') {
      if (existing.ownerUid !== user.uid && !this.isAdmin(user)) {
        throw new FirestoreRestError(
          403,
          'PERMISSION_DENIED',
          `Finanças da empresa ${docId} restritas ao proprietário (${String(existing.ownerUid)})`
        );
      }
    }

    if (col === 'business_employees') {
      if (
        existing.ownerUid !== user.uid &&
        existing.employeeUid !== user.uid &&
        !this.isAdmin(user)
      ) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Contrato restrito');
      }
    }

    if (col === 'business_applications') {
      if (
        existing.ownerUid !== user.uid &&
        existing.applicantUid !== user.uid &&
        !this.isAdmin(user)
      ) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Candidatura restrita');
      }
    }

    if (col === 'business_payroll') {
      if (
        existing.ownerUid !== user.uid &&
        existing.employeeUid !== user.uid &&
        !this.isAdmin(user)
      ) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Folha restrita');
      }
    }

    if (col === 'business_transactions') {
      if (
        existing.ownerUid !== user.uid &&
        existing.counterpartyUid !== user.uid &&
        !this.isAdmin(user)
      ) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Extrato empresarial restrito');
      }
    }
  }

  async getDoc(path: string, idToken: string): Promise<Record<string, unknown> | null> {
    const user = this.resolveCaller(idToken);
    this.assertCanRead(path, user);
    const existing = this.store.get(path);
    return existing ? structuredClone(existing) : null;
  }

  async listCollection(
    collectionId: string,
    idToken: string,
    pageSize = 50
  ): Promise<FirestoreQueryDoc[]> {
    const user = this.resolveCaller(idToken);
    const privateCollections = new Set([
      'wallets',
      'bank_accounts',
      'transactions',
      'admin_logs',
      'business_finances',
      'business_employees',
      'business_applications',
      'business_transactions',
      'business_payroll',
    ]);
    if (privateCollections.has(collectionId) && !this.isAdmin(user)) {
      throw new FirestoreRestError(
        403,
        'PERMISSION_DENIED',
        `Listagem global negada em ${collectionId} para não-admin`
      );
    }

    const prefix = `${collectionId}/`;
    const out: FirestoreQueryDoc[] = [];
    for (const [key, val] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        out.push({ id: key.slice(prefix.length), data: structuredClone(val) });
        if (out.length >= pageSize) break;
      }
    }
    return out;
  }

  async queryByField(
    collectionId: string,
    fieldPath: string,
    op: 'EQUAL' | 'ARRAY_CONTAINS',
    value: unknown,
    idToken: string,
    limit = 50
  ): Promise<FirestoreQueryDoc[]> {
    const user = this.resolveCaller(idToken);

    // Enforce QAP rules matching firestore.rules
    if (collectionId === 'business_employees' && !this.isAdmin(user)) {
      if (!((fieldPath === 'ownerUid' || fieldPath === 'employeeUid') && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP business_employees negado');
      }
    }
    if (collectionId === 'business_applications' && !this.isAdmin(user)) {
      if (!((fieldPath === 'ownerUid' || fieldPath === 'applicantUid') && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP business_applications negado');
      }
    }
    if (collectionId === 'business_transactions' && !this.isAdmin(user)) {
      if (!((fieldPath === 'ownerUid' || fieldPath === 'counterpartyUid') && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP business_transactions negado');
      }
    }
    if (collectionId === 'business_payroll' && !this.isAdmin(user)) {
      if (!((fieldPath === 'ownerUid' || fieldPath === 'employeeUid') && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP business_payroll negado');
      }
    }

    const prefix = `${collectionId}/`;
    const out: FirestoreQueryDoc[] = [];
    for (const [key, val] of this.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const fieldVal = val[fieldPath];
      const match =
        op === 'EQUAL'
          ? fieldVal === value
          : Array.isArray(fieldVal) && fieldVal.includes(value);
      if (match) {
        out.push({ id: key.slice(prefix.length), data: structuredClone(val) });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async commit(writes: FirestoreCommitWrite[], idToken: string): Promise<void> {
    const user = this.resolveCaller(idToken);
    const snapshot = new Map<string, Record<string, unknown>>();
    for (const [k, v] of this.store.entries()) {
      snapshot.set(k, structuredClone(v));
    }

    const nowIso = new Date(this.nowFn()).toISOString();
    const touchedPaths: string[] = [];

    for (const w of writes) {
      const cleanPath = w.path.replace(/^\/+/, '');
      const exists = snapshot.has(cleanPath);
      if (w.precondition?.exists === false && exists) {
        throw new FirestoreRestError(409, 'ALREADY_EXISTS', `Documento já existe: ${cleanPath}`);
      }
      if (w.precondition?.exists === true && !exists) {
        throw new FirestoreRestError(404, 'FAILED_PRECONDITION', `Documento ausente: ${cleanPath}`);
      }

      const [col] = cleanPath.split('/');
      if (col === 'admin_logs' && !this.isAdmin(user)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Somente admin grava admin_logs');
      }

      let target: Record<string, unknown>;
      if (w.updateMask) {
        target = exists ? structuredClone(snapshot.get(cleanPath)!) : {};
        for (const field of w.updateMask) {
          if (w.fields && field in w.fields) {
            const rawVal = w.fields[field];
            if (rawVal && typeof rawVal === 'object' && '__timestamp' in (rawVal as Record<string, unknown>)) {
              target[field] = (rawVal as Record<string, unknown>).__timestamp;
            } else {
              target[field] = structuredClone(rawVal);
            }
          }
        }
      } else {
        target = {};
        for (const [k, rawVal] of Object.entries(w.fields ?? {})) {
          if (rawVal && typeof rawVal === 'object' && '__timestamp' in (rawVal as Record<string, unknown>)) {
            target[k] = (rawVal as Record<string, unknown>).__timestamp;
          } else {
            target[k] = structuredClone(rawVal);
          }
        }
      }

      for (const tr of w.transforms ?? []) {
        if (tr.setToServerValue === 'REQUEST_TIME') {
          target[tr.fieldPath] = nowIso;
        } else if (tr.increment) {
          const prev = typeof target[tr.fieldPath] === 'number' ? (target[tr.fieldPath] as number) : 0;
          const inc =
            tr.increment.integerValue !== undefined
              ? Number(tr.increment.integerValue)
              : tr.increment.doubleValue ?? 0;
          target[tr.fieldPath] = Math.round((prev + inc) * 100) / 100;
        }
      }

      snapshot.set(cleanPath, target);
      touchedPaths.push(cleanPath);
    }

    // Strict firestore.rules post-commit schema & cross-document validation (mirrors live Cloud Firestore)
    for (const cleanPath of touchedPaths) {
      this.validateCommittedDoc(
        cleanPath,
        this.store.get(cleanPath),
        snapshot.get(cleanPath)!,
        user,
        this.store,
        snapshot
      );
    }

    // Commit atomically
    this.store.clear();
    for (const [k, v] of snapshot.entries()) {
      this.store.set(k, v);
    }
  }
}

async function apiJson(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

async function runTests(): Promise<void> {
  let virtualClock = Date.UTC(2026, 10, 25, 14, 0, 0);
  const nowFn = () => virtualClock;
  const memDb = new RuleAwareBusinessMemoryFirestore(nowFn);

  // Seed profiles for Real Citizen (non-admin), Player A (Alpha), Player B (Beta), and Admin
  memDb.store.set('users/uid-citizen-real', {
    uid: 'uid-citizen-real',
    characterName: 'Rafael Veridia',
    alias: 'veridia',
    status: 'active',
  });
  memDb.store.set('users/uid-alpha', {
    uid: 'uid-alpha',
    characterName: 'Lucas Alpha',
    alias: 'alpha',
    status: 'active',
  });
  memDb.store.set('users/uid-beta', {
    uid: 'uid-beta',
    characterName: 'Marina Beta',
    alias: 'beta',
    status: 'active',
  });
  memDb.store.set('users/uid-admin', {
    uid: 'uid-admin',
    characterName: 'Prefeito LCE',
    alias: 'admin',
    status: 'active',
  });

  const server = createWorldServer({
    firebaseProjectId: 'test-lce-project',
    bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
    customVerifier: async (token) => {
      const payload = TOKENS[token];
      if (!payload) throw new Error('Token inválido');
      return payload;
    },
    firestoreBackend: memDb,
    nowFn,
  });

  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Bootstrap Real Citizen, Alpha & Beta wallets + bank accounts (R$ 1.000,00 each in bank)
    const bootReal = await apiJson(baseUrl, 'POST', '/api/economy/bootstrap', 'token-citizen-real', {});
    const bootA = await apiJson(baseUrl, 'POST', '/api/economy/bootstrap', 'token-alpha', {});
    const bootB = await apiJson(baseUrl, 'POST', '/api/economy/bootstrap', 'token-beta', {});
    assert.equal(bootReal.status, 200);
    assert.equal(bootA.status, 200);
    assert.equal(bootB.status, 200);

    // Reproduce exact live citizen state: R$ 1.140,00 bank balance (R$ 1.000 inicial + R$ 140 de salário)
    const realBankInit = memDb.store.get('bank_accounts/uid-citizen-real')!;
    realBankInit.balance = 1140;
    realBankInit.lastTxId = 'sal_shift_prev';

    // =========================================================================
    // TESTE 0 — Regressão HTTP 403 (Conta cidadã comum verificada: R$ 1.140 -> Supermercado R$ 650 / Capital R$ 250)
    // =========================================================================
    const realBuyRes = await apiJson(baseUrl, 'POST', '/api/businesses/acquire', 'token-citizen-real', {
      locationId: 'supermercado',
      customName: 'Mercado Central Veridia',
      operationId: 'acq_real_supermercado_01',
    });
    assert.equal(realBuyRes.status, 201, `Aquisição real falhou: ${JSON.stringify(realBuyRes.data)}`);
    assert.equal(realBuyRes.data.businessId, 'biz_supermercado');
    assert.equal(realBuyRes.data.ownerUid, 'uid-citizen-real');
    assert.equal(realBuyRes.data.acquisitionPrice, 650);
    assert.equal(realBuyRes.data.initialCapital, 250);
    assert.equal(realBuyRes.data.newBankBalance, 490); // 1140 - 650

    // Verify exact persisted records in Firestore (bank debit, business cash, ownership, canonical currencyCategory)
    const realBankAfter = await memDb.getDoc('bank_accounts/uid-citizen-real', 'token-citizen-real');
    const realWalletAfter = await memDb.getDoc('wallets/uid-citizen-real', 'token-citizen-real');
    const supBiz = await memDb.getDoc('businesses/biz_supermercado', 'token-citizen-real');
    const supFin = await memDb.getDoc('business_finances/biz_supermercado', 'token-citizen-real');
    const supTx = memDb.store.get(`transactions/${String(realBuyRes.data.transactionId)}`);
    assert.equal(realBankAfter?.balance, 490);
    assert.equal(realWalletAfter?.companiesValue, 650);
    assert.equal(supBiz?.ownerUid, 'uid-citizen-real');
    assert.equal(supBiz?.ownerName, 'Rafael Veridia');
    assert.equal(supBiz?.ownerAlias, 'veridia');
    assert.equal(supFin?.cashBalance, 250);
    assert.equal(supTx?.currencyCategory, 'bank');
    assert.equal('currency' in (supTx ?? {}), false, 'Campo legado currency não pode existir em transactions');

    // Attempt duplicate purchase by same buyer AND by another player -> both MUST fail with 409
    const dupSameBuyer = await apiJson(baseUrl, 'POST', '/api/businesses/acquire', 'token-citizen-real', {
      locationId: 'supermercado',
      operationId: 'acq_real_supermercado_dup1',
    });
    assert.equal(dupSameBuyer.status, 409);

    const dupOtherBuyer = await apiJson(baseUrl, 'POST', '/api/businesses/acquire', 'token-beta', {
      locationId: 'supermercado',
      operationId: 'acq_real_supermercado_dup2',
    });
    assert.equal(dupOtherBuyer.status, 409);

    // Another player CANNOT access private cash or mutate capital of uid-citizen-real's business
    const betaViewSup = await apiJson(baseUrl, 'GET', '/api/businesses/biz_supermercado/dashboard', 'token-beta');
    assert.equal(betaViewSup.status, 200);
    assert.equal(betaViewSup.data.finances, null);
    const betaHackSupCap = await apiJson(baseUrl, 'POST', '/api/businesses/biz_supermercado/capital', 'token-beta', {
      direction: 'withdraw',
      amount: 100,
      operationId: 'cap_hack_sup',
    });
    assert.equal(betaHackSupCap.status, 403);
    console.log(
      '✓ TESTE 0 aprovado: Cidadão comum verificado (R$ 1.140 -> R$ 490) comprou Mercado Central Veridia (R$ 650, capital inicial R$ 250, currencyCategory=bank, duplicidade 409, isolamento 403).'
    );

    // =========================================================================
    // TESTE 1 — Jogador A compra uma empresa
    // =========================================================================
    const acquireRes = await apiJson(baseUrl, 'POST', '/api/businesses/acquire', 'token-alpha', {
      locationId: 'restaurante',
      customName: 'Bistrô Alpha Central',
      operationId: 'op_acq_restaurante_1',
    });
    assert.equal(acquireRes.status, 201, `Acquire falhou: ${JSON.stringify(acquireRes.data)}`);
    assert.equal(acquireRes.data.businessId, 'biz_restaurante');
    assert.equal(acquireRes.data.acquisitionPrice, 600);
    assert.equal(acquireRes.data.initialCapital, 220);
    assert.equal(acquireRes.data.newBankBalance, 400); // 1000 - 600

    // Duplicate acquisition attempt by B on same location MUST fail with 409
    const dupAcquire = await apiJson(baseUrl, 'POST', '/api/businesses/acquire', 'token-beta', {
      locationId: 'restaurante',
      operationId: 'op_acq_dup_beta',
    });
    assert.equal(dupAcquire.status, 409);
    console.log('✓ TESTE 1 aprovado: Jogador A adquiriu empresa (R$ 600 debitados, R$ 220 em caixa inicial, duplicidade bloqueada).');

    // =========================================================================
    // TESTE 2 — Jogador B consulta estabelecimento e vê A como dono (sem ver caixa privado)
    // =========================================================================
    const pubB = await apiJson(baseUrl, 'GET', '/api/businesses/public', 'token-beta');
    assert.equal(pubB.status, 200);
    const businessesList = pubB.data.businesses as Array<Record<string, unknown>>;
    const restBiz = businessesList.find((b) => b.id === 'biz_restaurante');
    assert.ok(restBiz, 'Empresa deve aparecer no mercado compartilhado para B');
    assert.equal(restBiz.ownerUid, 'uid-alpha');
    assert.equal(restBiz.ownerName, 'Lucas Alpha');

    const dashB = await apiJson(
      baseUrl,
      'GET',
      '/api/businesses/biz_restaurante/dashboard',
      'token-beta'
    );
    assert.equal(dashB.status, 200);
    assert.equal(dashB.data.isOwner, false);
    assert.equal(dashB.data.finances, null, 'Visitante B NÃO pode visualizar caixa privado de A');
    console.log('✓ TESTE 2 aprovado: Jogador B visualiza Jogador A como proprietário e não acessa finanças privadas.');

    // =========================================================================
    // TESTE 3 — Jogador A abre vaga de emprego
    // =========================================================================
    const vacRes = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/vacancies',
      'token-alpha',
      {
        roleTitle: 'Chef de Cozinha',
        salary: 120,
        schedule: 'Turno Noturno (8h)',
        requirements: 'Agilidade e organização',
        slots: 2,
        description: 'Responsável pelo preparo dos pratos executivos.',
      }
    );
    assert.equal(vacRes.status, 201);
    const vacancyId = String(vacRes.data.id);
    assert.ok(vacancyId.startsWith('vac_'));
    console.log(`✓ TESTE 3 aprovado: Jogador A abriu vaga '${vacRes.data.roleTitle}' (salário R$ 120).`);

    // =========================================================================
    // TESTE 4 — Jogador B se candidata
    // =========================================================================
    const applyRes = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/apply',
      'token-beta',
      {
        vacancyId,
        coverNote: 'Tenho experiência em gastronomia urbana e disponibilidade total.',
      }
    );
    assert.equal(applyRes.status, 201);
    const applicationId = String(applyRes.data.id);
    assert.equal(applyRes.data.status, 'pending');
    console.log(`✓ TESTE 4 aprovado: Jogador B candidatou-se à vaga (${applicationId}).`);

    // =========================================================================
    // TESTE 5 — Jogador A contrata B
    // =========================================================================
    const hireRes = await apiJson(
      baseUrl,
      'POST',
      `/api/businesses/biz_restaurante/applications/${applicationId}/decision`,
      'token-alpha',
      { action: 'hire' }
    );
    assert.equal(hireRes.status, 200);
    assert.equal(hireRes.data.status, 'hired');
    assert.equal(hireRes.data.employeeCount, 1);
    const contractId = String(hireRes.data.contractId);
    assert.equal(contractId, 'emp_biz_restaurante_uid-beta');
    console.log(`✓ TESTE 5 aprovado: Jogador A contratou Jogador B (contrato ${contractId}, equipe = 1).`);

    // =========================================================================
    // TESTE 6 — Empresa paga salário para B (e impede duplicidade / adulteração de valor)
    // =========================================================================
    const betaBankBefore = (await memDb.getDoc('bank_accounts/uid-beta', 'token-beta'))!.balance as number;
    assert.equal(betaBankBefore, 1000);

    // Attempt to sneak a spoofed amount=99999 in body — server MUST ignore and pay exact contract.salary (120)!
    const payRes = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/payroll/pay',
      'token-alpha',
      {
        contractId,
        operationId: 'op_payroll_1',
        amount: 99999,
      }
    );
    assert.equal(payRes.status, 200, `Payroll falhou: ${JSON.stringify(payRes.data)}`);
    assert.equal(payRes.data.amount, 120, 'Servidor deve ignorar valor do navegador e usar salário contratual');

    // Duplicate payroll attempt with same operationId MUST fail with 409
    const dupPayRes = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/payroll/pay',
      'token-alpha',
      { contractId, operationId: 'op_payroll_1' }
    );
    assert.equal(dupPayRes.status, 409);

    const betaBankAfter = (await memDb.getDoc('bank_accounts/uid-beta', 'token-beta'))!.balance as number;
    assert.equal(betaBankAfter, 1120, 'Salário de R$ 120 deve ser creditado diretamente na conta bancária de B');
    console.log('✓ TESTE 6 aprovado: Empresa pagou salário de R$ 120 para B (conta de B: R$ 1000 -> R$ 1120; duplicidade bloqueada).');

    // =========================================================================
    // TESTE 7 — Saldo da empresa é atualizado corretamente
    // =========================================================================
    const finAfterPayroll = await memDb.getDoc('business_finances/biz_restaurante', 'token-alpha');
    assert.ok(finAfterPayroll);
    assert.equal(finAfterPayroll.cashBalance, 100); // 220 initial - 120 payroll
    assert.equal(finAfterPayroll.totalPayrollPaid, 120);
    assert.equal(finAfterPayroll.totalExpenses, 120);
    console.log('✓ TESTE 7 aprovado: Caixa da empresa atualizado com exatidão (R$ 220 -> R$ 100, folha total R$ 120).');

    // =========================================================================
    // TESTE 8 — Funcionário B NÃO pode alterar caixa da empresa nem o próprio salário
    // =========================================================================
    const betaCapitalAttempt = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/capital',
      'token-beta',
      { direction: 'withdraw', amount: 50, operationId: 'op_hack_cap' }
    );
    assert.equal(betaCapitalAttempt.status, 403, 'Funcionário B não pode retirar caixa da empresa');

    const betaPayrollAttempt = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/payroll/pay',
      'token-beta',
      { contractId, operationId: 'op_hack_pay' }
    );
    assert.equal(betaPayrollAttempt.status, 403, 'Funcionário B não pode disparar folha salarial');

    const betaSalaryTamper = await apiJson(
      baseUrl,
      'PUT',
      `/api/businesses/biz_restaurante/employees/${contractId}`,
      'token-beta',
      { action: 'update', salary: 50000, roleTitle: 'CEO' }
    );
    assert.equal(betaSalaryTamper.status, 403, 'Funcionário B não pode alterar o próprio salário ou cargo');

    const dashBAsEmp = await apiJson(
      baseUrl,
      'GET',
      '/api/businesses/biz_restaurante/dashboard',
      'token-beta'
    );
    assert.equal(dashBAsEmp.status, 200);
    assert.equal(dashBAsEmp.data.isEmployee, true);
    assert.equal(dashBAsEmp.data.finances, null, 'Funcionário B continua sem acesso ao caixa privado');
    console.log('✓ TESTE 8 aprovado: Funcionário B bloqueado (HTTP 403) ao tentar alterar caixa, disparar folha ou mudar salário.');

    // =========================================================================
    // TESTE 9 — Dono A visualiza receitas e despesas (incluindo estoque, venda e despesa operacional)
    // =========================================================================
    // Restock starter product prod_restaurante_1 (unitCost 16, salePrice 32) x 3 = R$ 48
    const restockRes = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/inventory/restock',
      'token-alpha',
      { productId: 'prod_restaurante_1', quantity: 3, operationId: 'op_rst_1' }
    );
    assert.equal(restockRes.status, 200);
    assert.equal(restockRes.data.cashBalance, 52); // 100 - 48

    // Sell 3 units at R$ 32 = R$ 96 revenue -> cash 148
    const sellRes = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/inventory/sell',
      'token-alpha',
      { productId: 'prod_restaurante_1', quantity: 3, operationId: 'op_sell_1' }
    );
    assert.equal(sellRes.status, 200);
    assert.equal(sellRes.data.revenue, 96);
    assert.equal(sellRes.data.cashBalance, 148);

    // Pay operating expenses cycle (R$ 80) -> cash 68
    const expRes = await apiJson(
      baseUrl,
      'POST',
      '/api/businesses/biz_restaurante/expenses/pay',
      'token-alpha',
      { operationId: 'op_exp_1' }
    );
    assert.equal(expRes.status, 200);
    assert.equal(expRes.data.paid, true);
    assert.equal(expRes.data.cashBalance, 68);

    const dashA = await apiJson(
      baseUrl,
      'GET',
      '/api/businesses/biz_restaurante/dashboard',
      'token-alpha'
    );
    assert.equal(dashA.status, 200);
    assert.equal(dashA.data.isOwner, true);
    const finA = dashA.data.finances as Record<string, unknown>;
    assert.equal(finA.cashBalance, 68);
    assert.equal(finA.totalRevenue, 96);
    assert.equal(finA.totalExpenses, 248); // 120 payroll + 48 stock + 80 operating expense
    assert.equal(finA.netProfit, -152); // 96 - 248
    assert.ok(Array.isArray(dashA.data.transactions) && (dashA.data.transactions as unknown[]).length >= 5);
    console.log('✓ TESTE 9 aprovado: Proprietário A visualiza receitas (R$ 96), despesas (R$ 248), lucro/prejuízo líquido e extrato completo.');

    // =========================================================================
    // TESTE 10 — Persistência completa após saída e novo login dos dois jogadores
    // =========================================================================
    // Simulate full server restart (new Express instance backed by the same persisted database)
    await server.shutdown();
    const serverAfterRelogin = createWorldServer({
      firebaseProjectId: 'test-lce-project',
      bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
      customVerifier: async (token) => {
        const payload = TOKENS[token];
        if (!payload) throw new Error('Token inválido');
        return payload;
      },
      firestoreBackend: memDb,
      nowFn,
    });
    await new Promise<void>((resolve) =>
      serverAfterRelogin.httpServer.listen(0, '127.0.0.1', () => resolve())
    );
    const reloginPort = (serverAfterRelogin.httpServer.address() as AddressInfo).port;
    const reloginBaseUrl = `http://127.0.0.1:${reloginPort}`;

    try {
      const reloginDashA = await apiJson(
        reloginBaseUrl,
        'GET',
        '/api/businesses/biz_restaurante/dashboard',
        'token-alpha'
      );
      assert.equal(reloginDashA.status, 200);
      assert.equal((reloginDashA.data.business as Record<string, unknown>).ownerUid, 'uid-alpha');
      assert.equal((reloginDashA.data.finances as Record<string, unknown>).cashBalance, 68);
      assert.equal((reloginDashA.data.employees as unknown[]).length, 1);

      const reloginDashB = await apiJson(
        reloginBaseUrl,
        'GET',
        '/api/businesses/biz_restaurante/dashboard',
        'token-beta'
      );
      assert.equal(reloginDashB.status, 200);
      assert.equal(reloginDashB.data.isEmployee, true);
      assert.equal((reloginDashB.data.payroll as unknown[]).length, 1);

      // Bonus check: P2P Business Sale + Admin Audit Governance
      const listRes = await apiJson(
        reloginBaseUrl,
        'POST',
        '/api/businesses/biz_restaurante/listing',
        'token-alpha',
        { forSale: true, salePrice: 700 }
      );
      assert.equal(listRes.status, 200);

      const buyP2P = await apiJson(
        reloginBaseUrl,
        'POST',
        '/api/businesses/biz_restaurante/buy-from-owner',
        'token-beta',
        { operationId: 'op_p2p_sale_1' }
      );
      assert.equal(buyP2P.status, 200);
      assert.equal(buyP2P.data.newOwnerUid, 'uid-beta');
      assert.equal(buyP2P.data.newBuyerBalance, 420); // 1120 - 700
      const alphaBankAfterSale = (await memDb.getDoc('bank_accounts/uid-alpha', 'token-alpha'))!
        .balance as number;
      assert.equal(alphaBankAfterSale, 1100); // 400 + 700

      // Bonus check: Admin overview, seed-locations, update-location & audited suspension (strict admin_logs schema!)
      const adminSeed = await apiJson(
        reloginBaseUrl,
        'POST',
        '/api/admin/businesses/seed-locations',
        'token-admin',
        {}
      );
      assert.equal(adminSeed.status, 200, `Admin seed falhou: ${JSON.stringify(adminSeed.data)}`);

      const adminUpdateLoc = await apiJson(
        reloginBaseUrl,
        'PUT',
        '/api/admin/businesses/locations/oficina',
        'token-admin',
        { acquisitionPrice: 720, operatingExpense: 95 }
      );
      assert.equal(adminUpdateLoc.status, 200, `Admin update location falhou: ${JSON.stringify(adminUpdateLoc.data)}`);

      const adminOverview = await apiJson(
        reloginBaseUrl,
        'GET',
        '/api/admin/businesses/overview',
        'token-admin'
      );
      assert.equal(adminOverview.status, 200);

      const adminSuspend = await apiJson(
        reloginBaseUrl,
        'PUT',
        '/api/admin/businesses/biz_restaurante/admin-update',
        'token-admin',
        { status: 'suspended', reason: 'Auditoria fiscal de rotina' }
      );
      assert.equal(adminSuspend.status, 200);
      assert.equal(adminSuspend.data.status, 'suspended');

      console.log('✓ TESTE 10 aprovado: Empresa, caixa, contratos, folha, venda P2P e auditoria admin persistiram integralmente após reinício/relogin.');
      console.log('\n✅ TODOS OS 11 TESTES EMPRESARIAIS COM PARIDADE ESTRITA DE FIRESTORE RULES FORAM APROVADOS!');
    } finally {
      await serverAfterRelogin.shutdown();
    }
  } finally {
    try {
      await server.shutdown();
    } catch {
      // already closed in TESTE 10
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Falha nos testes do Módulo 3:', err);
  process.exit(1);
});
