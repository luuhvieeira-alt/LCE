/**
 * End-to-End Automated Test Suite for Module 4:
 * LCE Vehicles, Dealerships, Individual Garage & P2P Used Vehicle Marketplace.
 *
 * Executes all 12 mandatory multi-account tests (TESTE 1..12) plus:
 * - TESTE 13: P2P Used Vehicle Offer Negotiation (submit -> accept -> complete)
 * - TESTE 14: Dealership Salesperson Commission Generation & Payout
 * - TESTE 15: Garage Maintenance, Refuel & Trip Wear/Depreciation
 * - TESTE 16: Admin Catalog Management, RBAC Rejection & Fraud Listing Suspension
 *
 * Runs against the real Express routes with a strict Rule-Aware In-Memory Firestore
 * backend that enforces exact firestore.rules field schemas, QAP constraints,
 * zero-trust private reads, atomic increments, and anti-duplication preconditions.
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
  'token-a': {
    uid: 'uid-player-a',
    email: 'jogador.a@lce.test',
    emailVerified: true,
    isBootstrappedOwner: false,
  },
  'token-b': {
    uid: 'uid-player-b',
    email: 'jogador.b@lce.test',
    emailVerified: true,
    isBootstrappedOwner: false,
  },
  'token-seller': {
    uid: 'uid-player-seller',
    email: 'vendedor@lce.test',
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
  for (const k of Object.keys(data)) {
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
  return Math.abs(a - b) <= 0.01;
}

class RuleAwareVehicleMemoryFirestore implements FirestoreBackend {
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
      assertRule(!before, `transactions/${docId} is immutable`);
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
          'vehicle_purchase',
          'vehicle_p2p_sale',
          'vehicle_maintenance',
          'vehicle_commission',
        ].includes(String(after.type)),
        `transactions.type invalid: ${String(after.type)}`
      );
      assertRule(
        ['clean_cash', 'bank', 'dirty_cash'].includes(String(after.currencyCategory)),
        `transactions.currencyCategory invalid`
      );
      assertRule(after.actorUid === user.uid, `transactions.actorUid must match caller`);
      assertRule(after.status === 'completed', `transactions.status must be completed`);
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
        if (after.vehiclesValue !== before.vehiclesValue) {
          assertRule(docId === user.uid, `wallet vehiclesValue only by owner`);
          assertRule(
            ['vehicle_purchase', 'vehicle_p2p_sale'].includes(String(tx?.type)) && tx?.fromUid === docId,
            `wallet vehiclesValue requires vehicle_purchase or vehicle_p2p_sale tx`
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
          assertRule(docId === user.uid, `bank debit must be by owner`);
          assertRule(
            approxEq(Number(tx?.amount), prevBal - nextBal),
            `bank debit (${prevBal - nextBal}) must match tx amount (${String(tx?.amount)})`
          );
        } else if (nextBal > prevBal) {
          assertRule(
            approxEq(Number(tx?.amount), nextBal - prevBal),
            `bank credit (${nextBal - prevBal}) must match tx amount (${String(tx?.amount)})`
          );
        }
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
      if (before) {
        const prevCash = Number(before.cashBalance);
        const nextCash = Number(after.cashBalance);
        if (nextCash < prevCash) {
          assertRule(
            before.ownerUid === user.uid || this.isAdmin(user),
            `business_finances debit only allowed by owner`
          );
        }
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
        'type',
        'direction',
        'amount',
        'counterpartyUid',
        'counterpartyLabel',
        'actorUid',
        'description',
        'status',
        'createdAt',
      ]);
      assertRule(
        [
          'acquisition',
          'p2p_sale',
          'capital_inject',
          'capital_withdraw',
          'payroll',
          'inventory_purchase',
          'product_sale',
          'operating_expense',
          'admin_adjustment',
          'vehicle_restock',
          'vehicle_sale',
          'vehicle_commission',
        ].includes(String(after.type)),
        `business_transactions.type invalid: ${String(after.type)}`
      );
      return;
    }

    if (col === 'vehicle_catalog') {
      assertRule(this.isAdmin(user), `vehicle_catalog writes require admin`);
      assertExactKeys(col, docId, after, [
        'id',
        'manufacturer',
        'model',
        'year',
        'category',
        'basePrice',
        'marketValue',
        'topSpeed',
        'acceleration',
        'capacity',
        'fuelConsumption',
        'defaultCondition',
        'imageKey',
        'minPriceMultiplier',
        'maxPriceMultiplier',
        'maxCommissionPercent',
        'description',
        'active',
        'isCatalogVehicle',
        'updatedBy',
        'updatedAt',
      ]);
      return;
    }

    if (col === 'dealership_inventory') {
      assertExactKeys(
        col,
        docId,
        after,
        [
          'id',
          'businessId',
          'businessName',
          'ownerUid',
          'ownerName',
          'modelId',
          'manufacturer',
          'model',
          'year',
          'category',
          'imageKey',
          'purchaseCost',
          'salePrice',
          'promoDiscountPercent',
          'finalPrice',
          'topSpeed',
          'acceleration',
          'capacity',
          'fuelConsumption',
          'condition',
          'commissionPercent',
          'assignedSellerUid',
          'assignedSellerName',
          'status',
          'lastTxId',
          'createdAt',
          'updatedAt',
        ],
        [
          'id',
          'businessId',
          'businessName',
          'ownerUid',
          'ownerName',
          'modelId',
          'manufacturer',
          'model',
          'year',
          'category',
          'imageKey',
          'purchaseCost',
          'salePrice',
          'promoDiscountPercent',
          'finalPrice',
          'topSpeed',
          'acceleration',
          'capacity',
          'fuelConsumption',
          'condition',
          'commissionPercent',
          'assignedSellerUid',
          'assignedSellerName',
          'status',
          'soldToUid',
          'soldVehicleId',
          'lastTxId',
          'createdAt',
          'updatedAt',
        ]
      );
      if (before && after.status === 'sold') {
        assertRule(before.status === 'available', `dealership_inventory anti-dup: must be available before sold`);
        assertRule(after.soldToUid === user.uid, `dealership_inventory soldToUid must match buyer`);
      }
      return;
    }

    if (col === 'vehicles') {
      assertExactKeys(col, docId, after, [
        'id',
        'ownerUid',
        'ownerName',
        'ownerAlias',
        'modelId',
        'manufacturer',
        'model',
        'year',
        'category',
        'imageKey',
        'plate',
        'purchasePrice',
        'marketValue',
        'topSpeed',
        'acceleration',
        'capacity',
        'fuelConsumption',
        'condition',
        'mileageKm',
        'fuelLevel',
        'status',
        'activeListingId',
        'originBusinessId',
        'originBusinessName',
        'lastTxId',
        'parkedZone',
        'parkedX',
        'parkedZ',
        'acquiredAt',
        'updatedAt',
      ]);
      if (before && after.ownerUid !== before.ownerUid) {
        // Atomic P2P ownership transfer rule parity
        assertRule(before.status === 'listed', `P2P transfer requires vehicle status == listed`);
        assertRule(after.ownerUid === user.uid, `P2P transfer new ownerUid must match caller`);
        assertRule(after.status === 'in_garage', `P2P transfer resets status to in_garage`);
        assertRule(after.activeListingId === 'none', `P2P transfer clears activeListingId`);
      }
      return;
    }

    if (col === 'vehicle_transactions') {
      assertRule(!before, `vehicle_transactions/${docId} is immutable`);
      assertExactKeys(col, docId, after, [
        'id',
        'operationId',
        'type',
        'vehicleId',
        'modelId',
        'vehicleLabel',
        'businessId',
        'fromUid',
        'fromLabel',
        'toUid',
        'toLabel',
        'actorUid',
        'participants',
        'amount',
        'description',
        'status',
        'createdAt',
      ]);
      assertRule(after.actorUid === user.uid, `vehicle_transactions.actorUid must match caller`);
      return;
    }

    if (col === 'vehicle_listings') {
      assertExactKeys(
        col,
        docId,
        after,
        [
          'id',
          'vehicleId',
          'sellerUid',
          'sellerName',
          'sellerAlias',
          'modelId',
          'manufacturer',
          'model',
          'year',
          'category',
          'imageKey',
          'plate',
          'condition',
          'mileageKm',
          'fuelLevel',
          'topSpeed',
          'acceleration',
          'capacity',
          'marketValue',
          'askingPrice',
          'description',
          'status',
          'createdAt',
          'updatedAt',
        ],
        [
          'id',
          'vehicleId',
          'sellerUid',
          'sellerName',
          'sellerAlias',
          'modelId',
          'manufacturer',
          'model',
          'year',
          'category',
          'imageKey',
          'plate',
          'condition',
          'mileageKm',
          'fuelLevel',
          'topSpeed',
          'acceleration',
          'capacity',
          'marketValue',
          'askingPrice',
          'description',
          'status',
          'buyerUid',
          'soldTxId',
          'createdAt',
          'updatedAt',
        ]
      );
      if (before && after.status === 'sold') {
        assertRule(before.status === 'active', `vehicle_listings anti-dup: must be active before sold`);
        assertRule(after.buyerUid === user.uid, `vehicle_listings buyerUid must match caller`);
      }
      return;
    }

    if (col === 'vehicle_offers') {
      assertExactKeys(
        col,
        docId,
        after,
        [
          'id',
          'listingId',
          'vehicleId',
          'vehicleLabel',
          'sellerUid',
          'sellerName',
          'buyerUid',
          'buyerName',
          'buyerAlias',
          'askingPrice',
          'offerPrice',
          'message',
          'status',
          'createdAt',
          'updatedAt',
        ],
        [
          'id',
          'listingId',
          'vehicleId',
          'vehicleLabel',
          'sellerUid',
          'sellerName',
          'buyerUid',
          'buyerName',
          'buyerAlias',
          'askingPrice',
          'offerPrice',
          'message',
          'status',
          'completedTxId',
          'createdAt',
          'updatedAt',
        ]
      );
      return;
    }

    if (col === 'vehicle_maintenance') {
      assertRule(!before, `vehicle_maintenance/${docId} is immutable`);
      assertExactKeys(col, docId, after, [
        'id',
        'operationId',
        'vehicleId',
        'ownerUid',
        'serviceType',
        'cost',
        'conditionBefore',
        'conditionAfter',
        'fuelBefore',
        'fuelAfter',
        'bankTxId',
        'description',
        'createdAt',
      ]);
      return;
    }

    if (col === 'vehicle_commissions') {
      assertExactKeys(
        col,
        docId,
        after,
        [
          'id',
          'businessId',
          'businessName',
          'ownerUid',
          'sellerUid',
          'sellerName',
          'stockId',
          'vehicleId',
          'vehicleLabel',
          'salePrice',
          'commissionPercent',
          'commissionAmount',
          'status',
          'saleTxId',
          'createdAt',
        ],
        [
          'id',
          'businessId',
          'businessName',
          'ownerUid',
          'sellerUid',
          'sellerName',
          'stockId',
          'vehicleId',
          'vehicleLabel',
          'salePrice',
          'commissionPercent',
          'commissionAmount',
          'status',
          'saleTxId',
          'payoutTxId',
          'createdAt',
          'paidAt',
        ]
      );
      return;
    }

    if (col === 'admin_logs') {
      assertRule(this.isAdmin(user), `admin_logs requires admin`);
      assertExactKeys(
        col,
        docId,
        after,
        ['actorUid', 'action', 'summary', 'createdAt'],
        ['actorUid', 'action', 'targetUid', 'summary', 'createdAt']
      );
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
    if (!existing) return;

    if (col === 'business_finances') {
      if (existing.ownerUid !== user.uid && !this.isAdmin(user)) {
        throw new FirestoreRestError(
          403,
          'PERMISSION_DENIED',
          `Finanças da empresa ${docId} restritas ao proprietário`
        );
      }
    }

    if (col === 'vehicle_offers') {
      if (
        existing.sellerUid !== user.uid &&
        existing.buyerUid !== user.uid &&
        !this.isAdmin(user)
      ) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Proposta veicular restrita');
      }
    }

    if (col === 'vehicle_maintenance') {
      if (existing.ownerUid !== user.uid && !this.isAdmin(user)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Manutenção restrita ao dono');
      }
    }

    if (col === 'vehicle_commissions') {
      if (
        existing.ownerUid !== user.uid &&
        existing.sellerUid !== user.uid &&
        !this.isAdmin(user)
      ) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Comissão restrita');
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
      'vehicle_transactions',
      'vehicle_offers',
      'vehicle_maintenance',
      'vehicle_commissions',
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
    if (collectionId === 'vehicle_transactions' && !this.isAdmin(user)) {
      if (!(fieldPath === 'participants' && op === 'ARRAY_CONTAINS' && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP vehicle_transactions negado');
      }
    }
    if (collectionId === 'vehicle_offers' && !this.isAdmin(user)) {
      if (!((fieldPath === 'sellerUid' || fieldPath === 'buyerUid') && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP vehicle_offers negado');
      }
    }
    if (collectionId === 'vehicle_maintenance' && !this.isAdmin(user)) {
      if (!(fieldPath === 'ownerUid' && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP vehicle_maintenance negado');
      }
    }
    if (collectionId === 'vehicle_commissions' && !this.isAdmin(user)) {
      if (!((fieldPath === 'ownerUid' || fieldPath === 'sellerUid') && value === user.uid)) {
        throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'QAP vehicle_commissions negado');
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
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function seedCitizen(
  backend: RuleAwareVehicleMemoryFirestore,
  uid: string,
  name: string,
  alias: string,
  bankBalance: number
): void {
  const now = new Date('2026-11-25T10:00:00.000Z').toISOString();
  backend.store.set(`users/${uid}`, {
    uid,
    characterName: name,
    alias,
    origin: 'comerciante',
    style: 'executivo',
    coatColor: '#1E293B',
    accentColor: '#F59E0B',
    skinTone: '#D6A77A',
    district: 'Distrito Central',
    level: 2,
    experience: 120,
    reputation: 25,
    cashBalance: 500,
    bankBalance,
    lastX: 0,
    lastZ: 0,
    lastRotY: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  backend.store.set(`wallets/${uid}`, {
    uid,
    cleanCash: 500,
    dirtyCash: 0,
    companiesValue: 0,
    realEstateValue: 0,
    vehiclesValue: 0,
    investmentsValue: 0,
    otherAssetsValue: 0,
    lastTxId: 'seed_init',
    createdAt: now,
    updatedAt: now,
  });
  backend.store.set(`bank_accounts/${uid}`, {
    uid,
    accountNumber: `LCE-${uid.slice(-6).toUpperCase()}`,
    bankName: 'Banco Central LCE',
    balance: bankBalance,
    status: 'active',
    lastTxId: 'seed_init',
    createdAt: now,
    updatedAt: now,
  });
}

async function runTests(): Promise<void> {
  let fakeNow = Date.parse('2026-11-25T10:00:00.000Z');
  const backend = new RuleAwareVehicleMemoryFirestore(() => {
    fakeNow += 1000;
    return fakeNow;
  });

  // Seed 3 player accounts + admin with realistic balances for dealership & LCE catalog (R$ 8.000 - R$ 85.000)
  seedCitizen(backend, 'uid-player-a', 'Jogador A Veridia', 'jogadora', 50000);
  seedCitizen(backend, 'uid-player-b', 'Jogador B Solaris', 'jogadorb', 40000);
  seedCitizen(backend, 'uid-player-seller', 'Carlos Vendedor', 'vendedor', 5000);
  seedCitizen(backend, 'uid-admin', 'Administrador LCE', 'adminlce', 100000);

  let world = createWorldServer({
    firebaseProjectId: 'test-lce-project',
    bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
    firestoreBackend: backend,
    nowFn: () => fakeNow,
    customVerifier: async (token: string) => {
      const payload = TOKENS[token];
      if (!payload) throw new Error('Token inválido');
      return payload;
    },
  });

  await new Promise<void>((resolve) => {
    world.httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  let port = (world.httpServer.address() as AddressInfo).port;
  let baseUrl = `http://127.0.0.1:${port}`;

  const results: Array<{ id: string; title: string; status: 'PASS' }> = [];
  const pass = (id: string, title: string, detail: string) => {
    results.push({ id, title, status: 'PASS' });
    console.log(`✅ ${id} — ${title}: ${detail}`);
  };

  try {
    // =========================================================================
    // TESTE 1 — Catálogo inicial oficial com os 8 modelos LCE + preço configurável pelo Admin
    // =========================================================================
    const catalogRes = await apiJson(baseUrl, 'GET', '/api/vehicles/catalog', 'token-b');
    assert.equal(catalogRes.status, 200);
    const initialModels = catalogRes.json.catalog as Array<Record<string, unknown>>;
    assert.equal(initialModels.length, 8, `Esperados 8 modelos oficiais, encontrados ${initialModels.length}`);

    const expectedCatalog: Array<{ id: string; model: string; category: string; basePrice: number }> = [
      { id: 'lce-compact', model: 'LCE Compact', category: 'popular', basePrice: 8000 },
      { id: 'lce-urban', model: 'LCE Urban', category: 'popular', basePrice: 12000 },
      { id: 'lce-sedan', model: 'LCE Sedan', category: 'sedan', basePrice: 18000 },
      { id: 'lce-family', model: 'LCE Family', category: 'suv', basePrice: 25000 },
      { id: 'lce-pickup', model: 'LCE Pickup', category: 'picape', basePrice: 32000 },
      { id: 'lce-sport', model: 'LCE Sport', category: 'esportivo', basePrice: 55000 },
      { id: 'lce-cargo', model: 'LCE Cargo', category: 'caminhao', basePrice: 65000 },
      { id: 'lce-premium', model: 'LCE Premium', category: 'luxo', basePrice: 85000 },
    ];
    for (const exp of expectedCatalog) {
      const found = initialModels.find((m) => m.id === exp.id);
      assert.ok(found, `Modelo ${exp.model} (${exp.id}) ausente do catálogo`);
      assert.equal(found.model, exp.model);
      assert.equal(found.category, exp.category);
      assert.equal(found.basePrice, exp.basePrice);
    }

    // Admin reconfigures a catalog price and restores it to confirm configurability
    const adminEditPrice = await apiJson(
      baseUrl,
      'PUT',
      '/api/admin/vehicles/catalog/lce-compact',
      'token-admin',
      { basePrice: 8500, marketValue: 8500 }
    );
    assert.equal(adminEditPrice.status, 200);
    assert.equal((adminEditPrice.json.model as Record<string, unknown>).basePrice, 8500);
    const adminRestorePrice = await apiJson(
      baseUrl,
      'PUT',
      '/api/admin/vehicles/catalog/lce-compact',
      'token-admin',
      { basePrice: 8000, marketValue: 8000 }
    );
    assert.equal(adminRestorePrice.status, 200);
    pass(
      'TESTE 1',
      'Catálogo inicial (8 modelos LCE) e preços configuráveis pelo Admin',
      'LCE Compact (R$ 8.000) até LCE Premium (R$ 85.000) validados + edição admin OK'
    );

    // =========================================================================
    // TESTE 2 — Jogador A possui concessionária própria + Estoque Inicial persistente sem alterar propriedade
    // =========================================================================
    const acquireRes = await apiJson(baseUrl, 'POST', '/api/businesses/acquire', 'token-a', {
      locationId: 'concessionaria',
      customName: 'Veridia Motors Prime',
      operationId: 'acq_concessionaria_t2',
    });
    assert.equal(acquireRes.status, 201, `Aquisição falhou: ${JSON.stringify(acquireRes.json)}`);
    const dealershipId = String(acquireRes.json.businessId);

    // Inject R$ 25.000 capital into Player A's dealership (initial 300 + 25000 = 25300)
    const injectRes = await apiJson(
      baseUrl,
      'POST',
      `/api/businesses/${dealershipId}/capital`,
      'token-a',
      { direction: 'inject', amount: 25000, operationId: 'cap_inject_t2' }
    );
    assert.equal(injectRes.status, 200, `Aporte falhou: ${JSON.stringify(injectRes.json)}`);

    // Non-admin player triggers initial stock bootstrap -> creates biz_concessionaria_demo + 16 units (2 per model)
    const boot1 = await apiJson(
      baseUrl,
      'POST',
      '/api/vehicles/bootstrap-initial-stock',
      'token-b'
    );
    assert.equal(boot1.status, 200, `Bootstrap inicial falhou: ${JSON.stringify(boot1.json)}`);
    assert.equal(boot1.json.dealershipId, 'biz_concessionaria_demo');
    assert.equal(boot1.json.createdDealership, true);
    assert.equal(boot1.json.createdUnits, 16);
    assert.equal(boot1.json.availableUnits, 16);

    // Verify Player A's existing business ownership & cash were NOT altered!
    const playerABizAfterBoot = backend.store.get(`businesses/${dealershipId}`);
    assert.equal(playerABizAfterBoot?.ownerUid, 'uid-player-a');
    assert.equal(playerABizAfterBoot?.name, 'Veridia Motors Prime');
    assert.equal(backend.store.get(`business_finances/${dealershipId}`)?.cashBalance, 25300);

    // Second call by non-admin must be strictly idempotent (zero duplicate units, zero 403)
    const boot2 = await apiJson(
      baseUrl,
      'POST',
      '/api/vehicles/bootstrap-initial-stock',
      'token-b'
    );
    assert.equal(boot2.status, 200, `2º bootstrap deveria ser 200 idempotente: ${JSON.stringify(boot2.json)}`);
    assert.equal(boot2.json.createdDealership, false);
    assert.equal(boot2.json.createdUnits, 0);
    assert.equal(boot2.json.availableUnits, 16);

    // Verify demo showroom exposes >= 2 units of each of the 8 models
    const demoShowroom = await apiJson(
      baseUrl,
      'GET',
      '/api/dealerships/biz_concessionaria_demo/showroom',
      'token-b'
    );
    assert.equal(demoShowroom.status, 200);
    const demoAvail = demoShowroom.json.availableStock as Array<Record<string, unknown>>;
    assert.equal(demoAvail.length, 16);
    for (const exp of expectedCatalog) {
      const unitsForModel = demoAvail.filter((u) => u.modelId === exp.id);
      assert.equal(unitsForModel.length, 2, `Esperadas 2 unidades de ${exp.model}, encontradas ${unitsForModel.length}`);
      assert.equal(unitsForModel[0].finalPrice, exp.basePrice);
    }
    pass(
      'TESTE 2',
      'Estoque inicial persistente (16 un.) sem alterar empresas de jogadores',
      'biz_concessionaria_demo criada com 2 un. × 8 modelos; empresa de Jogador A intacta; 2ª chamada idempotente'
    );

    // =========================================================================
    // TESTE 3 — Compra na Concessionária Inicial de Demonstração (LCE Compact R$ 8.000)
    // =========================================================================
    const compactStockId = 'stk_demo_lce_compact_1';
    const playerBBalanceBeforeDemo = Number(backend.store.get('bank_accounts/uid-player-b')?.balance);
    assert.equal(playerBBalanceBeforeDemo, 40000);

    const buyDemoRes = await apiJson(
      baseUrl,
      'POST',
      '/api/dealerships/biz_concessionaria_demo/buy',
      'token-b',
      { stockId: compactStockId, operationId: 'op_buy_demo_compact' }
    );
    assert.equal(buyDemoRes.status, 201, `Compra na demo falhou: ${JSON.stringify(buyDemoRes.json)}`);
    const demoVehicle = buyDemoRes.json.vehicle as Record<string, unknown>;
    const demoVehicleId = String(demoVehicle.id);
    assert.equal(buyDemoRes.json.paidAmount, 8000);
    assert.equal(Number(backend.store.get('bank_accounts/uid-player-b')?.balance), 32000);
    assert.equal(Number(backend.store.get('business_finances/biz_concessionaria_demo')?.cashBalance), 8000);
    assert.equal(backend.store.get(`dealership_inventory/${compactStockId}`)?.status, 'sold');

    // Re-running bootstrap after sale must NOT resurrect the sold unit
    const bootAfterSale = await apiJson(
      baseUrl,
      'POST',
      '/api/vehicles/bootstrap-initial-stock',
      'token-b'
    );
    assert.equal(bootAfterSale.status, 200);
    assert.equal(bootAfterSale.json.createdUnits, 0);
    assert.equal(bootAfterSale.json.availableUnits, 15);

    // Duplicate buy on sold demo stock must return 409
    const dupDemoBuy = await apiJson(
      baseUrl,
      'POST',
      '/api/dealerships/biz_concessionaria_demo/buy',
      'token-a',
      { stockId: compactStockId, operationId: 'op_dup_demo_buy' }
    );
    assert.equal(dupDemoBuy.status, 409, `Compra duplicada na demo deveria retornar 409, retornou ${dupDemoBuy.status}`);
    pass(
      'TESTE 3',
      'Compra na Concessionária Inicial + Débito/Crédito/Bloqueio Duplicado',
      `LCE Compact (R$ 8.000) comprado (${String(demoVehicle.plate)}), estoque demo=15, caixa demo=R$ 8.000, duplicata=409`
    );

    // =========================================================================
    // TESTE 4 — Jogador A adiciona LCE Urban (R$ 12.000) ao estoque da sua concessionária
    // =========================================================================
    const stockRes = await apiJson(
      baseUrl,
      'POST',
      `/api/dealerships/${dealershipId}/stock`,
      'token-a',
      {
        modelId: 'lce-urban',
        salePrice: 14500,
        promoDiscountPercent: 0,
        commissionPercent: 0,
      }
    );
    assert.equal(stockRes.status, 201, `Adição ao estoque falhou: ${JSON.stringify(stockRes.json)}`);
    const createdStock = stockRes.json.stock as Record<string, unknown>;
    const stockId = String(createdStock.id);
    assert.equal(createdStock.purchaseCost, 12000);
    assert.equal(createdStock.finalPrice, 14500);
    assert.equal(stockRes.json.cashBalance, 13300); // 25300 - 12000
    pass(
      'TESTE 4',
      'Jogador A abastece estoque da própria concessionária (LCE Urban)',
      `stockId=${stockId}, custo=R$ 12.000, venda=R$ 14.500, caixa=R$ 13.300`
    );

    // =========================================================================
    // TESTE 5 — Jogador B visualiza e compra LCE Urban na concessionária do Jogador A
    // =========================================================================
    const showroomB = await apiJson(
      baseUrl,
      'GET',
      `/api/dealerships/${dealershipId}/showroom`,
      'token-b'
    );
    assert.equal(showroomB.status, 200);
    assert.equal(showroomB.json.isOwner, false);
    assert.equal(showroomB.json.finances, null, 'Caixa privado deve ficar oculto para visitante');
    assert.equal((showroomB.json.availableStock as unknown[]).length, 1);

    const playerBBalanceBefore = Number(backend.store.get('bank_accounts/uid-player-b')?.balance);
    const dealershipCashBefore = Number(backend.store.get(`business_finances/${dealershipId}`)?.cashBalance);
    assert.equal(playerBBalanceBefore, 32000);
    assert.equal(dealershipCashBefore, 13300);

    const buyRes = await apiJson(
      baseUrl,
      'POST',
      `/api/dealerships/${dealershipId}/buy`,
      'token-b',
      { stockId, operationId: 'op_buy_vehicle_t5' }
    );
    assert.equal(buyRes.status, 201, `Compra de veículo falhou: ${JSON.stringify(buyRes.json)}`);
    const boughtVehicle = buyRes.json.vehicle as Record<string, unknown>;
    const vehicleId = String(boughtVehicle.id);
    const plate = String(boughtVehicle.plate);
    assert.equal(buyRes.json.paidAmount, 14500);
    pass('TESTE 5', 'Jogador B compra LCE Urban da concessionária do Jogador A', `vehicleId=${vehicleId}, placa=${plate}, preço=R$ 14.500`);

    // =========================================================================
    // TESTE 6 — Débito bancário, Crédito empresarial, Garagem & Saída de Estoque
    // =========================================================================
    assert.equal(Number(backend.store.get('bank_accounts/uid-player-b')?.balance), 17500); // 32000 - 14500
    assert.equal(Number(backend.store.get(`business_finances/${dealershipId}`)?.cashBalance), 27800); // 13300 + 14500
    const garageB = await apiJson(baseUrl, 'GET', '/api/vehicles/garage', 'token-b');
    const vehiclesB = garageB.json.vehicles as Array<Record<string, unknown>>;
    assert.equal(vehiclesB.length, 2, 'Jogador B deve possuir 2 veículos (LCE Compact + LCE Urban)');
    assert.ok(vehiclesB.some((v) => v.id === demoVehicleId && v.model === 'LCE Compact'));
    assert.ok(vehiclesB.some((v) => v.id === vehicleId && v.model === 'LCE Urban'));
    const showroomAfterBuy = await apiJson(
      baseUrl,
      'GET',
      `/api/dealerships/${dealershipId}/showroom`,
      'token-b'
    );
    assert.equal((showroomAfterBuy.json.availableStock as unknown[]).length, 0);
    assert.equal(backend.store.get(`dealership_inventory/${stockId}`)?.status, 'sold');
    pass(
      'TESTE 6',
      'Débito bancário, Crédito empresarial, Garagem & Baixa de Estoque',
      'Banco B=R$ 17.500, Caixa A=R$ 27.800, Garagem B=2 veículos, estoque A=0'
    );

    // =========================================================================
    // TESTE 7 — Venda entre jogadores (P2P): Jogador B anuncia LCE Urban -> Jogador A compra
    // =========================================================================
    const listRes = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/${vehicleId}/list`,
      'token-b',
      {
        askingPrice: 13000,
        description: 'LCE Urban seminovo, único dono, documentação LCE em dia.',
      }
    );
    assert.equal(listRes.status, 201);
    const listingId = String((listRes.json.listing as Record<string, unknown>).id);

    const dupListRes = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/${vehicleId}/list`,
      'token-b',
      { askingPrice: 13500 }
    );
    assert.equal(dupListRes.status, 409, 'Anúncio duplicado deve ser bloqueado com 409');

    const playerABankBefore = Number(backend.store.get('bank_accounts/uid-player-a')?.balance);
    const playerBBankBeforeP2P = Number(backend.store.get('bank_accounts/uid-player-b')?.balance);

    const p2pBuyRes = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/listings/${listingId}/buy`,
      'token-a',
      { operationId: 'op_p2p_buy_t7' }
    );
    assert.equal(p2pBuyRes.status, 200, `Compra P2P falhou: ${JSON.stringify(p2pBuyRes.json)}`);
    assert.equal(p2pBuyRes.json.paidAmount, 13000);
    assert.equal(Number(backend.store.get('bank_accounts/uid-player-a')?.balance), playerABankBefore - 13000);
    assert.equal(Number(backend.store.get('bank_accounts/uid-player-b')?.balance), playerBBankBeforeP2P + 13000);

    const garageA = await apiJson(baseUrl, 'GET', '/api/vehicles/garage', 'token-a');
    const garageBAfter = await apiJson(baseUrl, 'GET', '/api/vehicles/garage', 'token-b');
    const vehiclesA = garageA.json.vehicles as Array<Record<string, unknown>>;
    const vehiclesBAfter = garageBAfter.json.vehicles as Array<Record<string, unknown>>;
    assert.equal(vehiclesA.length, 1);
    assert.equal(vehiclesA[0].id, vehicleId);
    assert.equal(vehiclesA[0].ownerUid, 'uid-player-a');
    assert.equal(vehiclesBAfter.length, 1, 'Jogador B mantém apenas o LCE Compact');
    assert.equal(vehiclesBAfter[0].id, demoVehicleId);
    pass(
      'TESTE 7',
      'Venda entre jogadores (P2P) e transferência de dono único',
      `R$ 13.000 transferidos; Garagem A=1 (${plate}), Garagem B=1 (LCE Compact)`
    );

    // =========================================================================
    // TESTE 8 — Bloqueio de compra/venda duplicada (concessionária + P2P + ex-dono)
    // =========================================================================
    const dupDealershipBuy = await apiJson(
      baseUrl,
      'POST',
      `/api/dealerships/${dealershipId}/buy`,
      'token-b',
      { stockId, operationId: 'op_dup_dealership_buy' }
    );
    assert.equal(dupDealershipBuy.status, 409);

    const dupP2pBuy = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/listings/${listingId}/buy`,
      'token-seller',
      { operationId: 'op_dup_p2p_buy' }
    );
    assert.equal(dupP2pBuy.status, 409);

    const formerOwnerList = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/${vehicleId}/list`,
      'token-b',
      { askingPrice: 12500, description: 'Tentativa indevida de reanunciar veículo já transferido.' }
    );
    assert.equal(formerOwnerList.status, 403);
    pass(
      'TESTE 8',
      'Bloqueio de compra/venda duplicada validado',
      'Concessionária vendida=409, P2P vendido=409, ex-dono=403'
    );

    // =========================================================================
    // TESTE 9 — Negociação por Proposta P2P (submit -> accept -> complete)
    // =========================================================================
    const relistA = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/${vehicleId}/list`,
      'token-a',
      { askingPrice: 13500, description: 'Aceito proposta à vista pelo banco.' }
    );
    assert.equal(relistA.status, 201);
    const listing2Id = String((relistA.json.listing as Record<string, unknown>).id);

    const submitOffer = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/listings/${listing2Id}/offers`,
      'token-b',
      { offerPrice: 12200, message: 'Fecho por R$ 12.200 à vista agora.' }
    );
    assert.equal(submitOffer.status, 201);
    const offerId = String((submitOffer.json.offer as Record<string, unknown>).id);

    const acceptOffer = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/offers/${offerId}/respond`,
      'token-a',
      { decision: 'accept' }
    );
    assert.equal(acceptOffer.status, 200);

    const completeOffer = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/offers/${offerId}/complete`,
      'token-b',
      { operationId: 'op_complete_offer_t9' }
    );
    assert.equal(completeOffer.status, 200);
    assert.equal(completeOffer.json.paidAmount, 12200);
    assert.equal(backend.store.get(`vehicles/${vehicleId}`)?.ownerUid, 'uid-player-b');
    pass('TESTE 9', 'Negociação por Proposta P2P completa', 'Proposta R$ 12.200 aceita e concluída atomicamente');

    // =========================================================================
    // TESTE 10 — Comissão de Vendedor & Promoção na Concessionária
    // =========================================================================
    const nowIso = new Date(fakeNow).toISOString();
    backend.store.set(`business_employees/emp_${dealershipId}_seller`, {
      id: `emp_${dealershipId}_seller`,
      businessId: dealershipId,
      businessName: 'Veridia Motors Prime',
      ownerUid: 'uid-player-a',
      employeeUid: 'uid-player-seller',
      employeeName: 'Carlos Vendedor',
      employeeAlias: 'vendedor',
      vacancyId: 'vac_vendedor',
      roleTitle: 'Vendedor',
      salary: 280,
      schedule: 'Turno Integral',
      status: 'active',
      totalPaid: 0,
      paymentsCount: 0,
      hiredAt: nowIso,
      updatedAt: nowIso,
    });

    const stockCompactRes = await apiJson(
      baseUrl,
      'POST',
      `/api/dealerships/${dealershipId}/stock`,
      'token-a',
      {
        modelId: 'lce-compact', // basePrice 8000
        salePrice: 10000,
        promoDiscountPercent: 10, // finalPrice = 9000
        commissionPercent: 10, // commission = 900
        assignedSellerUid: 'uid-player-seller',
      }
    );
    assert.equal(stockCompactRes.status, 201, `Stock compact falhou: ${JSON.stringify(stockCompactRes.json)}`);
    const compactUnit = stockCompactRes.json.stock as Record<string, unknown>;
    assert.equal(compactUnit.finalPrice, 9000);

    const buyCompactCommRes = await apiJson(
      baseUrl,
      'POST',
      `/api/dealerships/${dealershipId}/buy`,
      'token-b',
      { stockId: String(compactUnit.id), operationId: 'op_buy_compact_comm' }
    );
    assert.equal(buyCompactCommRes.status, 201);

    const showroomOwner = await apiJson(
      baseUrl,
      'GET',
      `/api/dealerships/${dealershipId}/showroom`,
      'token-a'
    );
    const commissionsList = showroomOwner.json.commissions as Array<Record<string, unknown>>;
    assert.equal(commissionsList.length, 1);
    const commissionId = String(commissionsList[0].id);
    assert.equal(commissionsList[0].commissionAmount, 900);

    const sellerBankBefore = Number(backend.store.get('bank_accounts/uid-player-seller')?.balance);
    const payCommRes = await apiJson(
      baseUrl,
      'POST',
      `/api/dealerships/${dealershipId}/commissions/${commissionId}/pay`,
      'token-a',
      { operationId: 'op_pay_comm_t10' }
    );
    assert.equal(payCommRes.status, 200);
    assert.equal(
      Number(backend.store.get('bank_accounts/uid-player-seller')?.balance),
      sellerBankBefore + 900
    );
    pass('TESTE 10', 'Comissão de Vendedor e Promoção na Concessionária', 'Promoção 10% (R$ 9.000), comissão R$ 900 paga ao vendedor');

    // =========================================================================
    // TESTE 11 — Rodagem, Depreciação e Manutenção/Revisão na Garagem
    // =========================================================================
    const tripRes = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/${vehicleId}/trip`,
      'token-b',
      { distanceKm: 60 }
    );
    assert.equal(tripRes.status, 200);
    assert.ok(Number(tripRes.json.fuelLevel) < 100);
    assert.ok(Number(tripRes.json.condition) < 100);

    const maintRes = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/${vehicleId}/maintenance`,
      'token-b',
      { serviceType: 'revision', operationId: 'op_maint_rev_t11' }
    );
    assert.equal(maintRes.status, 200, `Manutenção falhou: ${JSON.stringify(maintRes.json)}`);
    assert.equal(maintRes.json.condition, 100);
    assert.equal(maintRes.json.fuelLevel, 100);
    pass('TESTE 11', 'Rodagem, Depreciação e Revisão Completa na Garagem', '60km aplicados e revisão restaurou 100%');

    // =========================================================================
    // TESTE 12 — Governança Admin (Seed Catálogo 8, Reposição Demo, RBAC 403, Suspensão P2P)
    // =========================================================================
    const nonAdminBlocked = await apiJson(baseUrl, 'GET', '/api/admin/vehicles/overview', 'token-b');
    assert.equal(nonAdminBlocked.status, 403);

    const nonAdminSeedBlocked = await apiJson(
      baseUrl,
      'POST',
      '/api/admin/vehicles/seed-initial-stock',
      'token-b'
    );
    assert.equal(nonAdminSeedBlocked.status, 403);

    const seedRes = await apiJson(baseUrl, 'POST', '/api/admin/vehicles/seed-catalog', 'token-admin');
    assert.equal(seedRes.status, 200);
    assert.equal(seedRes.json.seededCount, 8);

    // Admin replenishes demo dealership back to 16 available units (adds 1 LCE Compact)
    const adminReplenish = await apiJson(
      baseUrl,
      'POST',
      '/api/admin/vehicles/seed-initial-stock',
      'token-admin'
    );
    assert.equal(adminReplenish.status, 200, `Reposição admin falhou: ${JSON.stringify(adminReplenish.json)}`);
    assert.equal(adminReplenish.json.createdUnits, 1);
    assert.equal(adminReplenish.json.availableUnits, 16);

    // Admin updates LCE Sport price to R$ 58.000 to verify persistence after restart
    const adminPriceUpdate = await apiJson(
      baseUrl,
      'PUT',
      '/api/admin/vehicles/catalog/lce-sport',
      'token-admin',
      { basePrice: 58000, marketValue: 58000 }
    );
    assert.equal(adminPriceUpdate.status, 200);

    // Fraud listing suspension
    const suspectList = await apiJson(
      baseUrl,
      'POST',
      `/api/vehicles/${vehicleId}/list`,
      'token-b',
      { askingPrice: 999999, description: 'Anúncio suspeito para teste antifraude.' }
    );
    assert.equal(suspectList.status, 201);
    const suspectListingId = String((suspectList.json.listing as Record<string, unknown>).id);
    const suspendRes = await apiJson(
      baseUrl,
      'PUT',
      `/api/admin/vehicles/listings/${suspectListingId}/suspend`,
      'token-admin',
      { reason: 'Preço abusivo em investigação antifraude' }
    );
    assert.equal(suspendRes.status, 200);
    assert.equal(backend.store.get(`vehicle_listings/${suspectListingId}`)?.status, 'suspended');
    assert.equal(backend.store.get(`vehicles/${vehicleId}`)?.status, 'in_garage');
    pass(
      'TESTE 12',
      'Governança Admin Veicular, Reposição de Estoque & Antifraude',
      '8 modelos sincronizados, reposição demo=+1 (total 16), não-admin=403, anúncio suspenso'
    );

    // =========================================================================
    // TESTE 13 — Persistência após novo login / reinicialização do servidor
    // =========================================================================
    const savedPlayerBBalance = Number(backend.store.get('bank_accounts/uid-player-b')?.balance);
    const savedDemoCash = Number(backend.store.get('business_finances/biz_concessionaria_demo')?.cashBalance);
    const savedPlayerACash = Number(backend.store.get(`business_finances/${dealershipId}`)?.cashBalance);

    await world.shutdown();

    // Spin up a brand-new server instance against the exact same persisted store (simulating fresh session/re-login)
    world = createWorldServer({
      firebaseProjectId: 'test-lce-project',
      bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
      firestoreBackend: backend,
      nowFn: () => fakeNow,
      customVerifier: async (token: string) => {
        const payload = TOKENS[token];
        if (!payload) throw new Error('Token inválido');
        return payload;
      },
    });
    await new Promise<void>((resolve) => {
      world.httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    port = (world.httpServer.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Verify catalog price change persisted
    const catalogReloaded = await apiJson(baseUrl, 'GET', '/api/vehicles/catalog', 'token-b');
    assert.equal(catalogReloaded.status, 200);
    const reloadedSport = (catalogReloaded.json.catalog as Array<Record<string, unknown>>).find(
      (m) => m.id === 'lce-sport'
    );
    assert.equal(reloadedSport?.basePrice, 58000, 'Preço reconfigurado pelo admin deve persistir após reinício');

    // Verify demo stock persisted
    const demoReloaded = await apiJson(
      baseUrl,
      'GET',
      '/api/dealerships/biz_concessionaria_demo/showroom',
      'token-b'
    );
    assert.equal(demoReloaded.status, 200);
    assert.equal((demoReloaded.json.availableStock as unknown[]).length, 16);

    // Verify Player B's garage (3 vehicles: LCE Compact demo + LCE Urban + LCE Compact promo) persisted
    const garageBReloaded = await apiJson(baseUrl, 'GET', '/api/vehicles/garage', 'token-b');
    assert.equal(garageBReloaded.status, 200);
    assert.equal((garageBReloaded.json.vehicles as unknown[]).length, 3);

    // Verify bank balance & dealership cash persisted identically
    assert.equal(Number(backend.store.get('bank_accounts/uid-player-b')?.balance), savedPlayerBBalance);
    assert.equal(Number(backend.store.get('business_finances/biz_concessionaria_demo')?.cashBalance), savedDemoCash);
    assert.equal(Number(backend.store.get(`business_finances/${dealershipId}`)?.cashBalance), savedPlayerACash);
    pass(
      'TESTE 13',
      'Persistência integral após reinicialização e novo login',
      `Catálogo editado (LCE Sport R$ 58.000), 16 un. demo, 3 veículos na garagem B e saldos preservados`
    );

    console.log(`\n🎉 TODOS OS ${results.length}/${results.length} TESTES DO MÓDULO 4 + CATÁLOGO/ESTOQUE INICIAL PASSARAM COM SUCESSO!`);
  } finally {
    await world.shutdown();
  }
}

runTests().catch((err) => {
  console.error('❌ FALHA NA SUÍTE DE TESTES DO MÓDULO 4:', err);
  process.exit(1);
});
