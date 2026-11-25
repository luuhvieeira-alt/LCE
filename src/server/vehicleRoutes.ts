import crypto from 'crypto';
import type { Express, NextFunction, Response } from 'express';
import {
  DEFAULT_VEHICLE_CATALOG,
  DEFAULT_VEHICLE_CATALOG_MAP,
  DEMO_DEALERSHIP_ID,
  DEMO_DEALERSHIP_LOCATION_ID,
  DEMO_DEALERSHIP_NAME,
  DEMO_DEALERSHIP_OWNER_ALIAS,
  DEMO_DEALERSHIP_OWNER_NAME,
  DEMO_DEALERSHIP_OWNER_UID,
  INITIAL_LCE_VEHICLE_CATALOG,
  INITIAL_STOCK_UNITS_PER_MODEL,
  VEHICLE_CATEGORIES,
  computeDepreciatedMarketValue,
  computeDiscountedPrice,
  estimateMaintenanceCost,
  makeInitialDemoStockId,
  roundMoney,
} from '../config/vehicleCatalog.ts';
import type {
  VehicleCatalogModel,
  VehicleCategory,
  VehicleMaintenanceType,
} from '../types/vehicle.ts';
import type { SharedVehicleState } from '../types/multiplayer.ts';
import type { EconomyAuthedRequest } from './economyRoutes.ts';
import type { WorldVehiclesController } from './worldServer.ts';
import {
  FirestoreRestError,
  toFsNumber,
  type FirestoreBackend,
  type FirestoreCommitWrite,
} from './firestoreRest.ts';

export interface RegisterVehicleRoutesOptions {
  app: Express;
  backend: FirestoreBackend;
  requireAuth: (req: EconomyAuthedRequest, res: Response, next: NextFunction) => Promise<void>;
  nowFn?: () => number;
  worldVehicles?: WorldVehiclesController;
}

const VALID_CATEGORIES = new Set<VehicleCategory>(VEHICLE_CATEGORIES);
const VALID_MAINT_TYPES = new Set<VehicleMaintenanceType>(['fuel', 'repair', 'revision']);
const ID_PATTERN = /^[a-zA-Z0-9_-]{2,80}$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parsePositiveMoney(value: unknown, min = 1, max = 200_000_000): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const r = round2(value);
  if (r < min || r > max) return null;
  return r;
}

function parseNumberInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return round2(value);
}

function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

function clampStr(value: string, maxLen: number, fallback = 'LCE'): string {
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeText(raw: unknown, fallback: string, minLen: number, maxLen: number): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, maxLen);
  return cleaned.length >= minLen ? cleaned : fallback;
}

function numField(doc: Record<string, unknown> | null | undefined, key: string, fallback = 0): number {
  const val = doc?.[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function strField(doc: Record<string, unknown> | null | undefined, key: string, fallback = ''): string {
  const val = doc?.[key];
  return typeof val === 'string' ? val : fallback;
}

function boolField(doc: Record<string, unknown> | null | undefined, key: string, fallback = false): boolean {
  const val = doc?.[key];
  return typeof val === 'boolean' ? val : fallback;
}

function makeId(prefix: string, raw?: unknown): string {
  const clean = sanitizeId(raw);
  if (clean && clean.length >= 4) return clean;
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

const issuedPlates = new Set<string>();

function generateLcePlate(): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const digits = '0123456789';
  const rand = (pool: string) => pool[crypto.randomInt(0, pool.length)];
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = `LCE-${rand(digits)}${rand(letters)}${rand(digits)}${rand(digits)}`;
    if (!issuedPlates.has(candidate)) {
      issuedPlates.add(candidate);
      return candidate;
    }
  }
  const fallback = `LCE-${rand(letters)}${rand(digits)}${rand(letters)}${rand(digits)}`;
  issuedPlates.add(fallback);
  return fallback;
}

function buildCatalogModelFields(model: VehicleCatalogModel, updatedBy: string): Record<string, unknown> {
  return {
    id: model.id,
    manufacturer: clampStr(model.manufacturer, 48, 'Veridia'),
    model: clampStr(model.model, 64, model.id),
    year: Math.floor(model.year),
    category: model.category,
    basePrice: round2(model.basePrice),
    marketValue: round2(model.marketValue),
    topSpeed: Math.floor(model.topSpeed),
    acceleration: round2(model.acceleration),
    capacity: Math.floor(model.capacity),
    fuelConsumption: round2(model.fuelConsumption),
    defaultCondition: Math.floor(model.defaultCondition),
    imageKey: model.imageKey,
    minPriceMultiplier: round2(model.minPriceMultiplier),
    maxPriceMultiplier: round2(model.maxPriceMultiplier),
    maxCommissionPercent: round2(model.maxCommissionPercent),
    description: clampStr(model.description, 240, 'Veículo oficial homologado no catálogo LCE.'),
    active: Boolean(model.active),
    isCatalogVehicle: true,
    updatedBy,
  };
}

export function registerVehicleRoutes(options: RegisterVehicleRoutesOptions): void {
  const { app, backend, requireAuth, worldVehicles } = options;

  const activeLocks = new Map<string, Promise<void>>();
  const withLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = activeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    activeLocks.set(key, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (activeLocks.get(key) === chained) {
        activeLocks.delete(key);
      }
    }
  };

  const withLocks = async <T>(keys: string[], fn: () => Promise<T>): Promise<T> => {
    const sorted = Array.from(new Set(keys)).sort();
    const runAt = (idx: number): Promise<T> => {
      if (idx >= sorted.length) return fn();
      return withLock(sorted[idx], () => runAt(idx + 1));
    };
    return runAt(0);
  };

  const requireVerifiedCitizen = async (
    req: EconomyAuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    await requireAuth(req, res, async () => {
      if (!req.verifiedUser?.emailVerified) {
        res.status(403).json({
          error: 'Verifique seu e-mail antes de operar veículos ou concessionárias.',
        });
        return;
      }
      next();
    });
  };

  const resolveIsAdmin = async (req: EconomyAuthedRequest): Promise<boolean> => {
    if (!req.verifiedUser || !req.rawIdToken) return false;
    if (req.verifiedUser.isBootstrappedOwner) return true;
    const adminDoc = await backend.getDoc(`admins/${req.verifiedUser.uid}`, req.rawIdToken);
    return adminDoc !== null;
  };

  const handleRouteError = (res: Response, err: unknown, fallbackMessage: string): void => {
    if (err instanceof FirestoreRestError) {
      if (err.status === 409 || err.code === 'ALREADY_EXISTS' || err.code === 'FAILED_PRECONDITION') {
        res.status(409).json({ error: 'Conflito de concorrência ou estado alterado. Atualize e tente novamente.' });
        return;
      }
      if (err.status === 403 || err.code === 'PERMISSION_DENIED') {
        console.error('[LCE Vehicles] Firestore PERMISSION_DENIED:', err.message);
        res.status(403).json({
          error: 'Operação recusada pelas regras de segurança do servidor veicular.',
        });
        return;
      }
      res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
        error: err.message || fallbackMessage,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : fallbackMessage;
    res.status(400).json({ error: msg });
  };

  const loadMergedCatalog = async (idToken: string): Promise<VehicleCatalogModel[]> => {
    let storedDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
    try {
      storedDocs = await backend.queryByField(
        'vehicle_catalog',
        'isCatalogVehicle',
        'EQUAL',
        true,
        idToken,
        100
      );
    } catch {
      storedDocs = [];
    }

    const map = new Map<string, VehicleCatalogModel>();
    for (const def of DEFAULT_VEHICLE_CATALOG) {
      map.set(def.id, { ...def });
    }
    for (const row of storedDocs) {
      const d = row.data;
      const cat = strField(d, 'category', 'sedan') as VehicleCategory;
      const imgKey = strField(d, 'imageKey', cat) as VehicleCategory;
      map.set(row.id, {
        id: row.id,
        manufacturer: strField(d, 'manufacturer', 'Veridia Motors'),
        model: strField(d, 'model', row.id),
        year: numField(d, 'year', 2025),
        category: VALID_CATEGORIES.has(cat) ? cat : 'sedan',
        basePrice: numField(d, 'basePrice', 300),
        marketValue: numField(d, 'marketValue', 360),
        topSpeed: numField(d, 'topSpeed', 180),
        acceleration: numField(d, 'acceleration', 6.5),
        capacity: numField(d, 'capacity', 4),
        fuelConsumption: numField(d, 'fuelConsumption', 8.5),
        defaultCondition: numField(d, 'defaultCondition', 100),
        imageKey: VALID_CATEGORIES.has(imgKey) ? imgKey : 'sedan',
        minPriceMultiplier: numField(d, 'minPriceMultiplier', 1.0),
        maxPriceMultiplier: numField(d, 'maxPriceMultiplier', 2.4),
        maxCommissionPercent: numField(d, 'maxCommissionPercent', 15),
        description: strField(d, 'description', 'Modelo oficial LCE.'),
        active: boolField(d, 'active', true),
        isCatalogVehicle: true,
        updatedBy: strField(d, 'updatedBy', ''),
        updatedAt: strField(d, 'updatedAt', ''),
      });
    }
    return Array.from(map.values()).sort((a, b) => a.basePrice - b.basePrice);
  };

  const resolveCharacterInfo = async (
    uid: string,
    idToken: string
  ): Promise<{ name: string; alias: string; status: string }> => {
    const profile = await backend.getDoc(`users/${uid}`, idToken);
    if (!profile) {
      throw new Error('Perfil de personagem não encontrado.');
    }
    return {
      name: clampStr(strField(profile, 'characterName', 'Cidadão LCE'), 64, 'Cidadão LCE'),
      alias: clampStr(strField(profile, 'alias', 'cidadao'), 32, 'cidadao'),
      status: strField(profile, 'status', 'active'),
    };
  };

  // =========================================================================
  // 1. PUBLIC CATALOG & SHARED MARKETPLACE ENDPOINTS
  // =========================================================================

  app.get('/api/vehicles/catalog', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    try {
      const catalog = await loadMergedCatalog(req.rawIdToken!);
      res.json({ catalog });
    } catch (err) {
      handleRouteError(res, err, 'Erro ao carregar catálogo de veículos.');
    }
  });

  app.get('/api/vehicles/market', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    try {
      const idToken = req.rawIdToken!;
      const [stockDocs, listingDocs, businessDocs] = await Promise.all([
        backend.queryByField('dealership_inventory', 'status', 'EQUAL', 'available', idToken, 100),
        backend.queryByField('vehicle_listings', 'status', 'EQUAL', 'active', idToken, 100),
        backend.listCollection('businesses', idToken, 100),
      ]);

      const dealerships = businessDocs
        .map((b) => b.data)
        .filter((b) => strField(b, 'templateType') === 'concessionaria')
        .map((b) => {
          const bid = strField(b, 'id');
          const availableCount = stockDocs.filter(
            (s) => strField(s.data, 'businessId') === bid
          ).length;
          return {
            id: bid,
            name: strField(b, 'name'),
            ownerUid: strField(b, 'ownerUid'),
            ownerName: strField(b, 'ownerName'),
            ownerAlias: strField(b, 'ownerAlias'),
            status: strField(b, 'status'),
            locationLabel: strField(b, 'locationLabel'),
            posX: numField(b, 'posX'),
            posZ: numField(b, 'posZ'),
            availableCount,
          };
        });

      res.json({
        dealerships,
        availableStock: stockDocs.map((s) => s.data),
        listings: listingDocs.map((l) => l.data),
      });
    } catch (err) {
      handleRouteError(res, err, 'Erro ao carregar mercado de veículos.');
    }
  });

  // =========================================================================
  // 2. DEALERSHIP SHOWROOM, STOCKING, PRICING, PURCHASE & COMMISSIONS
  // =========================================================================

  app.get(
    '/api/dealerships/:businessId/showroom',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        const uid = req.verifiedUser!.uid;
        const idToken = req.rawIdToken!;
        const businessId = sanitizeId(req.params.businessId);
        if (!businessId) {
          res.status(400).json({ error: 'Identificador de concessionária inválido.' });
          return;
        }

        const biz = await backend.getDoc(`businesses/${businessId}`, idToken);
        if (!biz) {
          res.status(404).json({ error: 'Concessionária não encontrada.' });
          return;
        }
        if (strField(biz, 'templateType') !== 'concessionaria') {
          res.status(400).json({ error: 'Este estabelecimento não é uma concessionária de veículos.' });
          return;
        }

        const isAdmin = await resolveIsAdmin(req);
        const isOwner = strField(biz, 'ownerUid') === uid;

        const stockDocs = await backend.queryByField(
          'dealership_inventory',
          'businessId',
          'EQUAL',
          businessId,
          idToken,
          100
        );

        const availableStock = stockDocs
          .map((d) => d.data)
          .filter((d) => strField(d, 'status') === 'available');
        const soldStock =
          isOwner || isAdmin
            ? stockDocs.map((d) => d.data).filter((d) => strField(d, 'status') === 'sold')
            : [];

        let finances: Record<string, unknown> | null = null;
        let commissions: Record<string, unknown>[] = [];
        let activeEmployees: Array<Record<string, unknown>> = [];

        if (isOwner || isAdmin) {
          const [finDoc, commDocs, empDocs] = await Promise.all([
            backend.getDoc(`business_finances/${businessId}`, idToken),
            backend.queryByField('vehicle_commissions', 'ownerUid', 'EQUAL', strField(biz, 'ownerUid'), idToken, 100),
            backend.queryByField('business_employees', 'ownerUid', 'EQUAL', strField(biz, 'ownerUid'), idToken, 100),
          ]);
          finances = finDoc;
          commissions = commDocs
            .map((c) => c.data)
            .filter((c) => strField(c, 'businessId') === businessId);
          activeEmployees = empDocs
            .map((e) => e.data)
            .filter(
              (e) =>
                strField(e, 'businessId') === businessId && strField(e, 'status') === 'active'
            )
            .map((e) => ({
              id: strField(e, 'id'),
              employeeUid: strField(e, 'employeeUid'),
              employeeName: strField(e, 'employeeName'),
              roleTitle: strField(e, 'roleTitle'),
              status: strField(e, 'status'),
            }));
        }

        const totalVehicleRevenue = round2(
          soldStock.reduce((acc, s) => acc + numField(s, 'finalPrice', 0), 0)
        );
        const pendingCommissionsAmount = round2(
          commissions
            .filter((c) => strField(c, 'status') === 'pending')
            .reduce((acc, c) => acc + numField(c, 'commissionAmount', 0), 0)
        );

        res.json({
          business: {
            id: strField(biz, 'id'),
            name: strField(biz, 'name'),
            ownerUid: strField(biz, 'ownerUid'),
            ownerName: strField(biz, 'ownerName'),
            ownerAlias: strField(biz, 'ownerAlias'),
            status: strField(biz, 'status'),
            locationLabel: strField(biz, 'locationLabel'),
            posX: numField(biz, 'posX'),
            posZ: numField(biz, 'posZ'),
          },
          isOwner,
          availableStock,
          soldStock,
          commissions,
          activeEmployees,
          finances: finances
            ? {
                cashBalance: numField(finances, 'cashBalance'),
                totalRevenue: numField(finances, 'totalRevenue'),
                totalExpenses: numField(finances, 'totalExpenses'),
                netProfit: numField(finances, 'netProfit'),
              }
            : null,
          stats: {
            availableCount: availableStock.length,
            soldCount: soldStock.length,
            totalVehicleRevenue,
            pendingCommissionsAmount,
          },
        });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao carregar showroom da concessionária.');
      }
    }
  );

  // Owner stocks a vehicle from the official catalog into dealership_inventory (paid from business_finances.cashBalance)
  app.post(
    '/api/dealerships/:businessId/stock',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'Concessionária inválida.' });
        return;
      }

      try {
        const result = await withLocks([`biz:${businessId}`, `user:${uid}`], async () => {
          const modelId = sanitizeId(req.body?.modelId);
          if (!modelId) throw new Error('Selecione um modelo válido do catálogo.');

          const [biz, fin, catalog] = await Promise.all([
            backend.getDoc(`businesses/${businessId}`, idToken),
            backend.getDoc(`business_finances/${businessId}`, idToken),
            loadMergedCatalog(idToken),
          ]);

          if (!biz || !fin) throw new Error('Concessionária ou caixa empresarial não encontrado.');
          if (strField(biz, 'ownerUid') !== uid) {
            throw new Error('Apenas o proprietário da concessionária pode comprar estoque.');
          }
          if (strField(biz, 'templateType') !== 'concessionaria') {
            throw new Error('Apenas concessionárias podem estocar veículos.');
          }
          if (strField(biz, 'status') === 'suspended') {
            throw new Error('Esta concessionária está suspensa pela administração.');
          }

          const model = catalog.find((m) => m.id === modelId);
          if (!model || !model.active) {
            throw new Error('Modelo indisponível no catálogo oficial.');
          }

          const purchaseCost = round2(model.basePrice);
          const cashBalance = numField(fin, 'cashBalance', 0);
          if (cashBalance < purchaseCost) {
            throw new Error(
              `Caixa da concessionária insuficiente (R$ ${cashBalance.toFixed(2)} disponível; custo do modelo R$ ${purchaseCost.toFixed(2)}).`
            );
          }

          const minAllowed = round2(purchaseCost * model.minPriceMultiplier);
          const maxAllowed = round2(purchaseCost * model.maxPriceMultiplier);
          const defaultSuggested = round2(Math.max(minAllowed, Math.min(maxAllowed, model.marketValue)));
          const requestedSalePrice =
            typeof req.body?.salePrice === 'number'
              ? parsePositiveMoney(req.body.salePrice, minAllowed, maxAllowed)
              : defaultSuggested;

          if (requestedSalePrice === null) {
            throw new Error(
              `Preço de venda fora da faixa permitida (R$ ${minAllowed.toFixed(2)} a R$ ${maxAllowed.toFixed(2)}).`
            );
          }

          const promoDiscountPercent =
            typeof req.body?.promoDiscountPercent === 'number'
              ? parseNumberInRange(req.body.promoDiscountPercent, 0, 35)
              : 0;
          if (promoDiscountPercent === null) {
            throw new Error('Desconto promocional deve ficar entre 0% e 35%.');
          }

          const finalPrice = computeDiscountedPrice(requestedSalePrice, promoDiscountPercent);
          if (finalPrice < 15) {
            throw new Error('Preço final promocional inválido.');
          }

          const commissionPercent =
            typeof req.body?.commissionPercent === 'number'
              ? parseNumberInRange(req.body.commissionPercent, 0, model.maxCommissionPercent)
              : 0;
          if (commissionPercent === null) {
            throw new Error(
              `Comissão deve ficar entre 0% e ${model.maxCommissionPercent}% para este modelo.`
            );
          }

          let assignedSellerUid = 'none';
          let assignedSellerName = 'Showroom Direto';
          const reqSellerUid = sanitizeId(req.body?.assignedSellerUid);
          if (reqSellerUid && reqSellerUid !== 'none') {
            const empDocs = await backend.queryByField(
              'business_employees',
              'ownerUid',
              'EQUAL',
              uid,
              idToken,
              100
            );
            const activeEmp = empDocs
              .map((d) => d.data)
              .find(
                (e) =>
                  strField(e, 'businessId') === businessId &&
                  strField(e, 'employeeUid') === reqSellerUid &&
                  strField(e, 'status') === 'active'
              );
            if (!activeEmp) {
              throw new Error('Vendedor informado não é funcionário ativo desta concessionária.');
            }
            assignedSellerUid = reqSellerUid;
            assignedSellerName = clampStr(strField(activeEmp, 'employeeName', 'Vendedor'), 64, 'Vendedor');
          }

          const stockId = makeId('stk', req.body?.stockId);
          const bizTxId = makeId('btx_vr');
          const vTxId = makeId('vtx_vr');
          const newCashBalance = round2(cashBalance - purchaseCost);
          const newTotalExpenses = round2(numField(fin, 'totalExpenses', 0) + purchaseCost);
          const newNetProfit = round2(numField(fin, 'netProfit', 0) - purchaseCost);
          const businessName = clampStr(strField(biz, 'name', 'Concessionária LCE'), 64, 'Concessionária LCE');
          const ownerName = clampStr(strField(biz, 'ownerName', 'Proprietário'), 64, 'Proprietário');
          const vehicleLabel = clampStr(`${model.manufacturer} ${model.model} (${model.year})`, 80, model.model);

          const stockDoc: Record<string, unknown> = {
            id: stockId,
            businessId,
            businessName,
            ownerUid: uid,
            ownerName,
            modelId: model.id,
            manufacturer: clampStr(model.manufacturer, 48, 'Veridia'),
            model: clampStr(model.model, 64, model.id),
            year: Math.floor(model.year),
            category: model.category,
            imageKey: model.imageKey,
            purchaseCost,
            salePrice: requestedSalePrice,
            promoDiscountPercent,
            finalPrice,
            topSpeed: Math.floor(model.topSpeed),
            acceleration: round2(model.acceleration),
            capacity: Math.floor(model.capacity),
            fuelConsumption: round2(model.fuelConsumption),
            condition: Math.floor(model.defaultCondition),
            commissionPercent,
            assignedSellerUid,
            assignedSellerName,
            status: 'available',
            lastTxId: bizTxId,
          };

          const writes: FirestoreCommitWrite[] = [
            {
              path: `business_transactions/${bizTxId}`,
              fields: {
                id: bizTxId,
                operationId: stockId,
                businessId,
                ownerUid: uid,
                actorUid: uid,
                type: 'vehicle_restock',
                direction: 'out',
                amount: purchaseCost,
                description: clampStr(`Estoque adquirido: ${vehicleLabel}`, 180, 'Aquisição de veículo'),
                counterpartyUid: 'vehicle_factory',
                counterpartyLabel: clampStr(model.manufacturer, 64, 'Montadora LCE'),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `business_finances/${businessId}`,
              fields: {
                cashBalance: newCashBalance,
                totalExpenses: newTotalExpenses,
                netProfit: newNetProfit,
                lastTxId: bizTxId,
              },
              updateMask: ['cashBalance', 'totalExpenses', 'netProfit', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `dealership_inventory/${stockId}`,
              fields: stockDoc,
              transforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            },
            {
              path: `vehicle_transactions/${vTxId}`,
              fields: {
                id: vTxId,
                operationId: stockId,
                type: 'dealership_restock',
                vehicleId: stockId,
                modelId: model.id,
                vehicleLabel,
                businessId,
                fromUid: 'vehicle_factory',
                fromLabel: clampStr(model.manufacturer, 64, 'Montadora LCE'),
                toUid: uid,
                toLabel: businessName,
                actorUid: uid,
                participants: [uid],
                amount: purchaseCost,
                description: clampStr(`Compra de estoque para ${businessName}: ${vehicleLabel}`, 180, 'Estoque veicular'),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ];

          await backend.commit(writes, idToken);

          return {
            stock: stockDoc,
            cashBalance: newCashBalance,
            bizTxId,
          };
        });

        res.status(201).json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao adicionar veículo ao estoque da concessionária.');
      }
    }
  );

  // Owner updates salePrice, promotion discount, commission, seller assignment, or removes unsold stock
  app.put(
    '/api/dealerships/:businessId/stock/:stockId',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const stockId = sanitizeId(req.params.stockId);
      if (!businessId || !stockId) {
        res.status(400).json({ error: 'Identificadores inválidos.' });
        return;
      }

      try {
        const result = await withLock(`stock:${stockId}`, async () => {
          const [stock, catalog] = await Promise.all([
            backend.getDoc(`dealership_inventory/${stockId}`, idToken),
            loadMergedCatalog(idToken),
          ]);

          if (!stock || strField(stock, 'businessId') !== businessId) {
            throw new Error('Veículo não encontrado no estoque desta concessionária.');
          }
          if (strField(stock, 'ownerUid') !== uid) {
            throw new Error('Apenas o proprietário da concessionária pode editar este veículo.');
          }
          if (strField(stock, 'status') !== 'available') {
            throw new Error('Este veículo não está mais disponível para edição.');
          }

          const model = catalog.find((m) => m.id === strField(stock, 'modelId'));
          const purchaseCost = numField(stock, 'purchaseCost', 100);
          const minAllowed = round2(purchaseCost * (model?.minPriceMultiplier ?? 1.0));
          const maxAllowed = round2(purchaseCost * (model?.maxPriceMultiplier ?? 2.5));
          const maxComm = model?.maxCommissionPercent ?? 15;

          const salePrice =
            typeof req.body?.salePrice === 'number'
              ? parsePositiveMoney(req.body.salePrice, minAllowed, maxAllowed)
              : numField(stock, 'salePrice', purchaseCost);
          if (salePrice === null) {
            throw new Error(
              `Preço deve estar entre R$ ${minAllowed.toFixed(2)} e R$ ${maxAllowed.toFixed(2)}.`
            );
          }

          const promoDiscountPercent =
            typeof req.body?.promoDiscountPercent === 'number'
              ? parseNumberInRange(req.body.promoDiscountPercent, 0, 35)
              : numField(stock, 'promoDiscountPercent', 0);
          if (promoDiscountPercent === null) {
            throw new Error('Desconto promocional deve ficar entre 0% e 35%.');
          }

          const commissionPercent =
            typeof req.body?.commissionPercent === 'number'
              ? parseNumberInRange(req.body.commissionPercent, 0, maxComm)
              : numField(stock, 'commissionPercent', 0);
          if (commissionPercent === null) {
            throw new Error(`Comissão deve ficar entre 0% e ${maxComm}%.`);
          }

          let assignedSellerUid = strField(stock, 'assignedSellerUid', 'none');
          let assignedSellerName = strField(stock, 'assignedSellerName', 'Showroom Direto');
          if (typeof req.body?.assignedSellerUid === 'string') {
            const rawSeller = req.body.assignedSellerUid.trim();
            if (rawSeller === '' || rawSeller === 'none') {
              assignedSellerUid = 'none';
              assignedSellerName = 'Showroom Direto';
            } else {
              const empDocs = await backend.queryByField(
                'business_employees',
                'ownerUid',
                'EQUAL',
                uid,
                idToken,
                100
              );
              const emp = empDocs
                .map((d) => d.data)
                .find(
                  (e) =>
                    strField(e, 'businessId') === businessId &&
                    strField(e, 'employeeUid') === rawSeller &&
                    strField(e, 'status') === 'active'
                );
              if (!emp) {
                throw new Error('Vendedor selecionado não está ativo nesta concessionária.');
              }
              assignedSellerUid = rawSeller;
              assignedSellerName = clampStr(strField(emp, 'employeeName', 'Vendedor'), 64, 'Vendedor');
            }
          }

          const nextStatus = req.body?.status === 'removed' ? 'removed' : 'available';
          const finalPrice = computeDiscountedPrice(salePrice, promoDiscountPercent);

          await backend.commit(
            [
              {
                path: `dealership_inventory/${stockId}`,
                fields: {
                  salePrice,
                  promoDiscountPercent,
                  finalPrice,
                  commissionPercent,
                  assignedSellerUid,
                  assignedSellerName,
                  status: nextStatus,
                },
                updateMask: [
                  'salePrice',
                  'promoDiscountPercent',
                  'finalPrice',
                  'commissionPercent',
                  'assignedSellerUid',
                  'assignedSellerName',
                  'status',
                ],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
            ],
            idToken
          );

          return {
            stockId,
            salePrice,
            promoDiscountPercent,
            finalPrice,
            commissionPercent,
            assignedSellerUid,
            assignedSellerName,
            status: nextStatus,
          };
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao atualizar veículo em estoque.');
      }
    }
  );

  // Atomic Vehicle Purchase from a Player-Owned Dealership (Buyer debited -> Dealership Cash credited -> Vehicle created in Buyer's Garage)
  app.post(
    '/api/dealerships/:businessId/buy',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const buyerUid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const stockId = sanitizeId(req.body?.stockId);

      if (!businessId || !stockId) {
        res.status(400).json({ error: 'Concessionária ou veículo inválido.' });
        return;
      }

      try {
        const result = await withLocks(
          [`stock:${stockId}`, `biz:${businessId}`, `user:${buyerUid}`],
          async () => {
            const [biz, stock, bank, wallet, buyerChar] = await Promise.all([
              backend.getDoc(`businesses/${businessId}`, idToken),
              backend.getDoc(`dealership_inventory/${stockId}`, idToken),
              backend.getDoc(`bank_accounts/${buyerUid}`, idToken),
              backend.getDoc(`wallets/${buyerUid}`, idToken),
              resolveCharacterInfo(buyerUid, idToken),
            ]);

            if (!biz) throw new Error('Concessionária não encontrada.');
            if (strField(biz, 'templateType') !== 'concessionaria') {
              throw new Error('Estabelecimento não é uma concessionária.');
            }
            if (strField(biz, 'status') === 'suspended') {
              throw new Error('Esta concessionária está suspensa pela administração.');
            }
            if (!stock || strField(stock, 'businessId') !== businessId) {
              throw new Error('Veículo não encontrado no estoque desta concessionária.');
            }
            if (strField(stock, 'status') !== 'available') {
              const conflictErr = new FirestoreRestError(
                409,
                'FAILED_PRECONDITION',
                'Este veículo já foi vendido ou removido do estoque.'
              );
              throw conflictErr;
            }
            if (strField(stock, 'ownerUid') === buyerUid || strField(biz, 'ownerUid') === buyerUid) {
              throw new Error('O proprietário não pode comprar veículos da própria concessionária.');
            }
            if (buyerChar.status !== 'active') {
              throw new Error('Personagem suspenso não pode comprar veículos.');
            }
            if (!bank || !wallet) {
              throw new Error('Conta bancária ou carteira não inicializada.');
            }
            if (strField(bank, 'status') !== 'active') {
              throw new Error('Conta bancária congelada.');
            }

            const finalPrice = round2(numField(stock, 'finalPrice', 0));
            if (finalPrice < 15) {
              throw new Error('Preço do veículo inválido.');
            }
            const buyerBalance = numField(bank, 'balance', 0);
            if (buyerBalance < finalPrice) {
              throw new Error(
                `Saldo bancário insuficiente (R$ ${buyerBalance.toFixed(2)} disponível; preço R$ ${finalPrice.toFixed(2)}).`
              );
            }

            const ownerUid = strField(biz, 'ownerUid');
            const businessName = clampStr(strField(biz, 'name', 'Concessionária LCE'), 64, 'Concessionária LCE');
            const manufacturer = clampStr(strField(stock, 'manufacturer', 'Veridia'), 48, 'Veridia');
            const modelName = clampStr(strField(stock, 'model', 'Modelo LCE'), 64, 'Modelo LCE');
            const year = Math.floor(numField(stock, 'year', 2025));
            const category = strField(stock, 'category', 'sedan') as VehicleCategory;
            const imageKey = strField(stock, 'imageKey', category) as VehicleCategory;
            const vehicleLabel = clampStr(`${manufacturer} ${modelName} (${year})`, 80, modelName);

            const catalogModel = DEFAULT_VEHICLE_CATALOG_MAP[strField(stock, 'modelId')];
            const initialMarketValue = round2(
              Math.max(15, catalogModel?.marketValue ?? finalPrice * 0.92)
            );

            const vehicleId = makeId('veh');
            const bankTxId = makeId('tx_vp', req.body?.operationId);
            const bizTxId = makeId('btx_vs');
            const vTxId = makeId('vtx_vs');
            const plate = generateLcePlate();

            const newBuyerBalance = round2(buyerBalance - finalPrice);
            const newVehiclesValue = round2(numField(wallet, 'vehiclesValue', 0) + initialMarketValue);

            const newVehicleDoc: Record<string, unknown> = {
              id: vehicleId,
              ownerUid: buyerUid,
              ownerName: buyerChar.name,
              ownerAlias: buyerChar.alias,
              modelId: strField(stock, 'modelId'),
              manufacturer,
              model: modelName,
              year,
              category,
              imageKey,
              plate,
              purchasePrice: finalPrice,
              marketValue: initialMarketValue,
              topSpeed: Math.floor(numField(stock, 'topSpeed', 180)),
              acceleration: round2(numField(stock, 'acceleration', 6.5)),
              capacity: Math.floor(numField(stock, 'capacity', 4)),
              fuelConsumption: round2(numField(stock, 'fuelConsumption', 8.5)),
              condition: Math.floor(numField(stock, 'condition', 100)),
              mileageKm: 0,
              fuelLevel: 100,
              status: 'in_garage',
              activeListingId: 'none',
              originBusinessId: businessId,
              originBusinessName: businessName,
              lastTxId: bankTxId,
              parkedZone: 'Garagem Central',
              parkedX: 0,
              parkedZ: 0,
            };

            const writes: FirestoreCommitWrite[] = [
              // 1. Immutable Financial Ledger Transaction (Buyer -> Dealership)
              {
                path: `transactions/${bankTxId}`,
                fields: {
                  id: bankTxId,
                  operationId: stockId,
                  type: 'vehicle_purchase',
                  currencyCategory: 'bank',
                  amount: finalPrice,
                  fromUid: buyerUid,
                  fromLabel: buyerChar.name,
                  toUid: businessId,
                  toLabel: businessName,
                  actorUid: buyerUid,
                  participants: [buyerUid, ownerUid],
                  description: clampStr(`Compra de veículo em ${businessName}: ${vehicleLabel}`, 180, 'Compra de veículo'),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              // 2. Debit Buyer Bank Account
              {
                path: `bank_accounts/${buyerUid}`,
                fields: {
                  balance: newBuyerBalance,
                  lastTxId: bankTxId,
                },
                updateMask: ['balance', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              // 3. Update Buyer Patrimony (wallets.vehiclesValue)
              {
                path: `wallets/${buyerUid}`,
                fields: {
                  vehiclesValue: newVehiclesValue,
                  lastTxId: bankTxId,
                },
                updateMask: ['vehiclesValue', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              // 4. Mark Dealership Stock Unit as SOLD (prevents double purchase!)
              {
                path: `dealership_inventory/${stockId}`,
                fields: {
                  status: 'sold',
                  soldToUid: buyerUid,
                  soldVehicleId: vehicleId,
                  lastTxId: bankTxId,
                },
                updateMask: ['status', 'soldToUid', 'soldVehicleId', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              // 5. Business Ledger Entry for Dealership Vehicle Sale
              {
                path: `business_transactions/${bizTxId}`,
                fields: {
                  id: bizTxId,
                  operationId: bankTxId,
                  businessId,
                  ownerUid,
                  actorUid: buyerUid,
                  type: 'vehicle_sale',
                  direction: 'in',
                  amount: finalPrice,
                  description: clampStr(`Venda de veículo ${vehicleLabel} para ${buyerChar.name}`, 180, 'Venda de veículo'),
                  counterpartyUid: buyerUid,
                  counterpartyLabel: buyerChar.name,
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              // 6. Atomic Increment on Dealership Private Cash (NO private read by buyer!)
              {
                path: `business_finances/${businessId}`,
                fields: {
                  lastTxId: bizTxId,
                },
                updateMask: ['lastTxId'],
                transforms: [
                  { fieldPath: 'cashBalance', increment: toFsNumber(finalPrice) },
                  { fieldPath: 'totalRevenue', increment: toFsNumber(finalPrice) },
                  { fieldPath: 'netProfit', increment: toFsNumber(finalPrice) },
                  { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
                precondition: { exists: true },
              },
              // 7. Create Vehicle in Buyer's Garage
              {
                path: `vehicles/${vehicleId}`,
                fields: newVehicleDoc,
                transforms: [
                  { fieldPath: 'acquiredAt', setToServerValue: 'REQUEST_TIME' },
                  { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
                precondition: { exists: false },
              },
              // 8. Immutable Vehicle Ledger Entry
              {
                path: `vehicle_transactions/${vTxId}`,
                fields: {
                  id: vTxId,
                  operationId: bankTxId,
                  type: 'dealership_sale',
                  vehicleId,
                  modelId: strField(stock, 'modelId'),
                  vehicleLabel,
                  businessId,
                  fromUid: ownerUid,
                  fromLabel: businessName,
                  toUid: buyerUid,
                  toLabel: buyerChar.name,
                  actorUid: buyerUid,
                  participants: [buyerUid, ownerUid],
                  amount: finalPrice,
                  description: clampStr(`Aquisição em ${businessName}: ${vehicleLabel} [${plate}]`, 180, 'Compra de veículo'),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
            ];

            // 9. Optional Salesperson Commission Record
            const assignedSellerUid = strField(stock, 'assignedSellerUid', 'none');
            const commissionPercent = numField(stock, 'commissionPercent', 0);
            let commissionRecord: Record<string, unknown> | null = null;
            if (
              assignedSellerUid &&
              assignedSellerUid !== 'none' &&
              assignedSellerUid !== ownerUid &&
              commissionPercent > 0
            ) {
              const commissionAmount = roundMoney((finalPrice * commissionPercent) / 100);
              if (commissionAmount > 0) {
                const commissionId = makeId('vcom');
                commissionRecord = {
                  id: commissionId,
                  businessId,
                  businessName,
                  ownerUid,
                  sellerUid: assignedSellerUid,
                  sellerName: clampStr(strField(stock, 'assignedSellerName', 'Vendedor'), 64, 'Vendedor'),
                  stockId,
                  vehicleId,
                  vehicleLabel,
                  salePrice: finalPrice,
                  commissionPercent,
                  commissionAmount,
                  status: 'pending',
                  saleTxId: bankTxId,
                };
                writes.push({
                  path: `vehicle_commissions/${commissionId}`,
                  fields: commissionRecord,
                  transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: false },
                });
              }
            }

            await backend.commit(writes, idToken);

            return {
              vehicle: newVehicleDoc,
              bankTxId,
              bizTxId,
              paidAmount: finalPrice,
              newBuyerBalance,
              commission: commissionRecord,
            };
          }
        );

        res.status(201).json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao concluir compra do veículo.');
      }
    }
  );

  // Dealership Owner Pays a Pending Salesperson Commission (Business Cash -> Seller Bank Account)
  app.post(
    '/api/dealerships/:businessId/commissions/:commissionId/pay',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const ownerUid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const commissionId = sanitizeId(req.params.commissionId);

      if (!businessId || !commissionId) {
        res.status(400).json({ error: 'Identificadores inválidos.' });
        return;
      }

      try {
        const result = await withLocks(
          [`commission:${commissionId}`, `biz:${businessId}`],
          async () => {
            const [comm, fin, biz] = await Promise.all([
              backend.getDoc(`vehicle_commissions/${commissionId}`, idToken),
              backend.getDoc(`business_finances/${businessId}`, idToken),
              backend.getDoc(`businesses/${businessId}`, idToken),
            ]);

            if (!comm || strField(comm, 'businessId') !== businessId) {
              throw new Error('Comissão não encontrada.');
            }
            if (strField(comm, 'ownerUid') !== ownerUid || !biz || strField(biz, 'ownerUid') !== ownerUid) {
              throw new Error('Apenas o proprietário da concessionária pode pagar comissões.');
            }
            if (strField(comm, 'status') !== 'pending') {
              throw new FirestoreRestError(409, 'FAILED_PRECONDITION', 'Esta comissão já foi paga ou cancelada.');
            }
            if (!fin) throw new Error('Caixa empresarial não encontrado.');

            const amount = round2(numField(comm, 'commissionAmount', 0));
            const cashBalance = numField(fin, 'cashBalance', 0);
            if (cashBalance < amount) {
              throw new Error(
                `Caixa empresarial insuficiente para pagar comissão (R$ ${cashBalance.toFixed(2)} disponível; comissão R$ ${amount.toFixed(2)}).`
              );
            }

            const sellerUid = strField(comm, 'sellerUid');
            const sellerName = clampStr(strField(comm, 'sellerName', 'Vendedor'), 64, 'Vendedor');
            const businessName = clampStr(strField(biz, 'name', 'Concessionária LCE'), 64, 'Concessionária LCE');
            const vehicleLabel = clampStr(strField(comm, 'vehicleLabel', 'Veículo'), 80, 'Veículo');

            const bankTxId = makeId('tx_vc');
            const bizTxId = makeId('btx_vc');
            const vTxId = makeId('vtx_vc');
            const newCashBalance = round2(cashBalance - amount);
            const newTotalExpenses = round2(numField(fin, 'totalExpenses', 0) + amount);
            const newNetProfit = round2(numField(fin, 'netProfit', 0) - amount);

            const writes: FirestoreCommitWrite[] = [
              {
                path: `transactions/${bankTxId}`,
                fields: {
                  id: bankTxId,
                  operationId: commissionId,
                  type: 'vehicle_commission',
                  currencyCategory: 'bank',
                  amount,
                  fromUid: businessId,
                  fromLabel: businessName,
                  toUid: sellerUid,
                  toLabel: sellerName,
                  actorUid: ownerUid,
                  participants: [ownerUid, sellerUid],
                  description: clampStr(`Comissão de venda (${businessName}): ${vehicleLabel}`, 180, 'Comissão de venda'),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `business_transactions/${bizTxId}`,
                fields: {
                  id: bizTxId,
                  operationId: commissionId,
                  businessId,
                  ownerUid,
                  actorUid: ownerUid,
                  type: 'vehicle_commission',
                  direction: 'out',
                  amount,
                  description: clampStr(`Pagamento de comissão para ${sellerName}: ${vehicleLabel}`, 180, 'Comissão'),
                  counterpartyUid: sellerUid,
                  counterpartyLabel: sellerName,
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `business_finances/${businessId}`,
                fields: {
                  cashBalance: newCashBalance,
                  totalExpenses: newTotalExpenses,
                  netProfit: newNetProfit,
                  lastTxId: bizTxId,
                },
                updateMask: ['cashBalance', 'totalExpenses', 'netProfit', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              {
                path: `bank_accounts/${sellerUid}`,
                fields: {
                  lastTxId: bankTxId,
                },
                updateMask: ['lastTxId'],
                transforms: [
                  { fieldPath: 'balance', increment: toFsNumber(amount) },
                  { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
                precondition: { exists: true },
              },
              {
                path: `vehicle_commissions/${commissionId}`,
                fields: {
                  status: 'paid',
                  payoutTxId: bankTxId,
                },
                updateMask: ['status', 'payoutTxId'],
                transforms: [{ fieldPath: 'paidAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              {
                path: `vehicle_transactions/${vTxId}`,
                fields: {
                  id: vTxId,
                  operationId: commissionId,
                  type: 'commission_paid',
                  vehicleId: strField(comm, 'vehicleId'),
                  modelId: 'commission',
                  vehicleLabel,
                  businessId,
                  fromUid: ownerUid,
                  fromLabel: businessName,
                  toUid: sellerUid,
                  toLabel: sellerName,
                  actorUid: ownerUid,
                  participants: [ownerUid, sellerUid],
                  amount,
                  description: clampStr(`Comissão paga a ${sellerName} pela venda de ${vehicleLabel}`, 180, 'Comissão paga'),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
            ];

            await backend.commit(writes, idToken);
            return { commissionId, paidAmount: amount, cashBalance: newCashBalance, bankTxId };
          }
        );

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao pagar comissão de vendedor.');
      }
    }
  );

  // =========================================================================
  // 3. INDIVIDUAL GARAGE & MAINTENANCE / FUEL / DEPRECIATION
  // =========================================================================

  app.get('/api/vehicles/garage', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    try {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;

      const [vehicleDocs, txDocs, maintDocs, myListingDocs, sellerOffers, buyerOffers, commDocs] =
        await Promise.all([
          backend.queryByField('vehicles', 'ownerUid', 'EQUAL', uid, idToken, 100),
          backend.queryByField('vehicle_transactions', 'participants', 'ARRAY_CONTAINS', uid, idToken, 100),
          backend.queryByField('vehicle_maintenance', 'ownerUid', 'EQUAL', uid, idToken, 100),
          backend.queryByField('vehicle_listings', 'sellerUid', 'EQUAL', uid, idToken, 100),
          backend.queryByField('vehicle_offers', 'sellerUid', 'EQUAL', uid, idToken, 100),
          backend.queryByField('vehicle_offers', 'buyerUid', 'EQUAL', uid, idToken, 100),
          backend.queryByField('vehicle_commissions', 'sellerUid', 'EQUAL', uid, idToken, 100),
        ]);

      const vehicles = vehicleDocs.map((d) => d.data);
      const totalVehiclesValue = round2(
        vehicles.reduce((sum, v) => sum + numField(v, 'marketValue', 0), 0)
      );

      res.json({
        vehicles,
        transactions: txDocs.map((d) => d.data),
        maintenance: maintDocs.map((d) => d.data),
        myListings: myListingDocs.map((d) => d.data),
        incomingOffers: sellerOffers.map((d) => d.data),
        outgoingOffers: buyerOffers.map((d) => d.data),
        myCommissions: commDocs.map((d) => d.data),
        totalVehiclesValue,
      });
    } catch (err) {
      handleRouteError(res, err, 'Erro ao carregar garagem individual.');
    }
  });

  app.post(
    '/api/vehicles/:vehicleId/maintenance',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const vehicleId = sanitizeId(req.params.vehicleId);
      const serviceType = strField(req.body, 'serviceType') as VehicleMaintenanceType;

      if (!vehicleId || !VALID_MAINT_TYPES.has(serviceType)) {
        res.status(400).json({ error: 'Serviço de manutenção inválido (use fuel, repair ou revision).' });
        return;
      }

      try {
        const result = await withLocks([`vehicle:${vehicleId}`, `user:${uid}`], async () => {
          const [vehicle, bank, econConfig, charInfo] = await Promise.all([
            backend.getDoc(`vehicles/${vehicleId}`, idToken),
            backend.getDoc(`bank_accounts/${uid}`, idToken),
            backend.getDoc('economyConfig/global', idToken),
            resolveCharacterInfo(uid, idToken),
          ]);

          if (!vehicle) throw new Error('Veículo não encontrado.');
          if (strField(vehicle, 'ownerUid') !== uid) {
            throw new Error('Apenas o proprietário pode realizar manutenção neste veículo.');
          }
          if (!bank || strField(bank, 'status') !== 'active') {
            throw new Error('Conta bancária indisponível.');
          }

          const conditionBefore = numField(vehicle, 'condition', 100);
          const fuelBefore = numField(vehicle, 'fuelLevel', 100);
          const mileageKm = numField(vehicle, 'mileageKm', 0);
          const baseFuelPrice = numField(econConfig, 'baseFuelPrice', 7.5);
          const modelRef = DEFAULT_VEHICLE_CATALOG_MAP[strField(vehicle, 'modelId')];
          const baseMarket = modelRef?.marketValue ?? numField(vehicle, 'marketValue', 250);

          const quote = estimateMaintenanceCost(
            serviceType,
            baseFuelPrice,
            conditionBefore,
            fuelBefore,
            numField(vehicle, 'marketValue', baseMarket)
          );

          const balance = numField(bank, 'balance', 0);
          if (balance < quote.cost) {
            throw new Error(
              `Saldo bancário insuficiente (R$ ${balance.toFixed(2)} disponível; custo R$ ${quote.cost.toFixed(2)}).`
            );
          }

          const newBalance = round2(balance - quote.cost);
          const newMarketValue = computeDepreciatedMarketValue(
            baseMarket,
            quote.nextCondition,
            mileageKm
          );
          const bankTxId = makeId('tx_vm');
          const maintId = makeId('mnt');
          const vTxId = makeId('vtx_vm');
          const vehicleLabel = clampStr(
            `${strField(vehicle, 'manufacturer')} ${strField(vehicle, 'model')} (${numField(vehicle, 'year', 2025)})`,
            80,
            'Veículo LCE'
          );

          const writes: FirestoreCommitWrite[] = [
            {
              path: `transactions/${bankTxId}`,
              fields: {
                id: bankTxId,
                operationId: vehicleId,
                type: 'vehicle_maintenance',
                currencyCategory: 'bank',
                amount: quote.cost,
                fromUid: uid,
                fromLabel: charInfo.name,
                toUid: 'city_workshop',
                toLabel: 'Rede Automotiva Veridia',
                actorUid: uid,
                participants: [uid],
                description: clampStr(`${quote.label} — ${vehicleLabel}`, 180, 'Manutenção veicular'),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `bank_accounts/${uid}`,
              fields: {
                balance: newBalance,
                lastTxId: bankTxId,
              },
              updateMask: ['balance', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `vehicles/${vehicleId}`,
              fields: {
                condition: quote.nextCondition,
                fuelLevel: quote.nextFuelLevel,
                marketValue: newMarketValue,
                lastTxId: bankTxId,
              },
              updateMask: ['condition', 'fuelLevel', 'marketValue', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `vehicle_maintenance/${maintId}`,
              fields: {
                id: maintId,
                operationId: bankTxId,
                vehicleId,
                ownerUid: uid,
                serviceType,
                cost: quote.cost,
                conditionBefore,
                conditionAfter: quote.nextCondition,
                fuelBefore,
                fuelAfter: quote.nextFuelLevel,
                bankTxId,
                description: clampStr(quote.label, 180, 'Manutenção veicular'),
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `vehicle_transactions/${vTxId}`,
              fields: {
                id: vTxId,
                operationId: bankTxId,
                type: 'maintenance',
                vehicleId,
                modelId: strField(vehicle, 'modelId'),
                vehicleLabel,
                businessId: 'city_workshop',
                fromUid: uid,
                fromLabel: charInfo.name,
                toUid: 'city_workshop',
                toLabel: 'Rede Automotiva Veridia',
                actorUid: uid,
                participants: [uid],
                amount: quote.cost,
                description: clampStr(`${quote.label} — ${vehicleLabel}`, 180, 'Manutenção'),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ];

          await backend.commit(writes, idToken);

          // Synchronize refreshed fuel/condition directly to any active vehicle in the 3D world
          worldVehicles?.updateLiveMetrics(vehicleId, {
            condition: quote.nextCondition,
            fuelLevel: quote.nextFuelLevel,
          });

          return {
            vehicleId,
            serviceType,
            cost: quote.cost,
            condition: quote.nextCondition,
            fuelLevel: quote.nextFuelLevel,
            marketValue: newMarketValue,
            newBalance,
          };
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao executar manutenção do veículo.');
      }
    }
  );

  // Record simulated urban trip wear (prepares future drivable vehicles, fuel consumption, mileage & depreciation)
  app.post(
    '/api/vehicles/:vehicleId/trip',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const vehicleId = sanitizeId(req.params.vehicleId);
      if (!vehicleId) {
        res.status(400).json({ error: 'Veículo inválido.' });
        return;
      }

      try {
        const result = await withLock(`vehicle:${vehicleId}`, async () => {
          const vehicle = await backend.getDoc(`vehicles/${vehicleId}`, idToken);
          if (!vehicle) throw new Error('Veículo não encontrado.');
          if (strField(vehicle, 'ownerUid') !== uid) {
            throw new Error('Apenas o proprietário pode registrar rodagem neste veículo.');
          }
          if (strField(vehicle, 'status') === 'listed') {
            throw new Error('Retire o anúncio antes de utilizar o veículo.');
          }

          const distanceKm = parseNumberInRange(req.body?.distanceKm ?? 35, 1, 500);
          if (distanceKm === null) throw new Error('Distância inválida.');

          const curMileage = numField(vehicle, 'mileageKm', 0);
          const curFuel = numField(vehicle, 'fuelLevel', 100);
          const curCond = numField(vehicle, 'condition', 100);
          const consumption = numField(vehicle, 'fuelConsumption', 8.5);

          const fuelUsed = Math.max(2, Math.round((distanceKm / 100) * consumption * 1.6));
          const condWear = Math.max(1, Math.round(distanceKm / 40));

          const nextMileage = round2(curMileage + distanceKm);
          const nextFuel = Math.max(0, curFuel - fuelUsed);
          const nextCond = Math.max(15, curCond - condWear);
          const modelRef = DEFAULT_VEHICLE_CATALOG_MAP[strField(vehicle, 'modelId')];
          const baseMarket = modelRef?.marketValue ?? numField(vehicle, 'marketValue', 250);
          const nextMarketValue = Math.min(
            numField(vehicle, 'marketValue', baseMarket),
            computeDepreciatedMarketValue(baseMarket, nextCond, nextMileage)
          );

          await backend.commit(
            [
              {
                path: `vehicles/${vehicleId}`,
                fields: {
                  mileageKm: nextMileage,
                  fuelLevel: nextFuel,
                  condition: nextCond,
                  marketValue: nextMarketValue,
                },
                updateMask: ['mileageKm', 'fuelLevel', 'condition', 'marketValue'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
            ],
            idToken
          );

          return {
            vehicleId,
            mileageKm: nextMileage,
            fuelLevel: nextFuel,
            condition: nextCond,
            marketValue: nextMarketValue,
          };
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao registrar rodagem do veículo.');
      }
    }
  );

  // =========================================================================
  // 4. P2P USED VEHICLE MARKETPLACE (LIST, CANCEL, DIRECT BUY, OFFERS)
  // =========================================================================

  app.post(
    '/api/vehicles/:vehicleId/list',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const sellerUid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const vehicleId = sanitizeId(req.params.vehicleId);
      if (!vehicleId) {
        res.status(400).json({ error: 'Veículo inválido.' });
        return;
      }

      try {
        const result = await withLock(`vehicle:${vehicleId}`, async () => {
          const [vehicle, sellerChar] = await Promise.all([
            backend.getDoc(`vehicles/${vehicleId}`, idToken),
            resolveCharacterInfo(sellerUid, idToken),
          ]);

          if (!vehicle) throw new Error('Veículo não encontrado.');
          if (strField(vehicle, 'ownerUid') !== sellerUid) {
            throw new FirestoreRestError(
              403,
              'PERMISSION_DENIED',
              'Apenas o proprietário atual pode anunciar este veículo.'
            );
          }
          if (worldVehicles?.getById(vehicleId)) {
            throw new FirestoreRestError(
              409,
              'FAILED_PRECONDITION',
              'Guarde o veículo na garagem antes de anunciá-lo à venda.'
            );
          }
          if (strField(vehicle, 'status') !== 'in_garage') {
            throw new FirestoreRestError(
              409,
              'FAILED_PRECONDITION',
              'Este veículo já possui anúncio ativo ou não está na garagem.'
            );
          }

          const askingPrice = parsePositiveMoney(req.body?.askingPrice, 15, 200_000_000);
          if (askingPrice === null) {
            throw new Error('Informe um preço de venda válido (mínimo R$ 15,00).');
          }

          const description = sanitizeText(
            req.body?.description,
            'Veículo particular bem conservado com documentação regular no Distrito Central.',
            3,
            200
          );

          const listingId = makeId('vlst', req.body?.listingId);
          const listingDoc: Record<string, unknown> = {
            id: listingId,
            vehicleId,
            sellerUid,
            sellerName: sellerChar.name,
            sellerAlias: sellerChar.alias,
            modelId: strField(vehicle, 'modelId'),
            manufacturer: strField(vehicle, 'manufacturer'),
            model: strField(vehicle, 'model'),
            year: Math.floor(numField(vehicle, 'year', 2025)),
            category: strField(vehicle, 'category', 'sedan'),
            imageKey: strField(vehicle, 'imageKey', 'sedan'),
            plate: strField(vehicle, 'plate', 'LCE-0000'),
            condition: Math.floor(numField(vehicle, 'condition', 100)),
            mileageKm: round2(numField(vehicle, 'mileageKm', 0)),
            fuelLevel: Math.floor(numField(vehicle, 'fuelLevel', 100)),
            topSpeed: Math.floor(numField(vehicle, 'topSpeed', 180)),
            acceleration: round2(numField(vehicle, 'acceleration', 6.5)),
            capacity: Math.floor(numField(vehicle, 'capacity', 4)),
            marketValue: round2(numField(vehicle, 'marketValue', askingPrice)),
            askingPrice,
            description,
            status: 'active',
          };

          await backend.commit(
            [
              {
                path: `vehicle_listings/${listingId}`,
                fields: listingDoc,
                transforms: [
                  { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                  { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
                precondition: { exists: false },
              },
              {
                path: `vehicles/${vehicleId}`,
                fields: {
                  status: 'listed',
                  activeListingId: listingId,
                },
                updateMask: ['status', 'activeListingId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
            ],
            idToken
          );

          return { listing: listingDoc };
        });

        res.status(201).json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao criar anúncio de veículo.');
      }
    }
  );

  app.post(
    '/api/vehicles/listings/:listingId/cancel',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const sellerUid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const listingId = sanitizeId(req.params.listingId);
      if (!listingId) {
        res.status(400).json({ error: 'Anúncio inválido.' });
        return;
      }

      try {
        const result = await withLock(`listing:${listingId}`, async () => {
          const listing = await backend.getDoc(`vehicle_listings/${listingId}`, idToken);
          if (!listing) throw new Error('Anúncio não encontrado.');
          if (strField(listing, 'sellerUid') !== sellerUid) {
            throw new Error('Apenas o anunciante pode cancelar este anúncio.');
          }
          if (strField(listing, 'status') !== 'active') {
            throw new FirestoreRestError(409, 'FAILED_PRECONDITION', 'Anúncio já encerrado.');
          }

          const vehicleId = strField(listing, 'vehicleId');
          await backend.commit(
            [
              {
                path: `vehicle_listings/${listingId}`,
                fields: { status: 'cancelled' },
                updateMask: ['status'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              {
                path: `vehicles/${vehicleId}`,
                fields: { status: 'in_garage', activeListingId: 'none' },
                updateMask: ['status', 'activeListingId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
            ],
            idToken
          );

          return { listingId, vehicleId, status: 'cancelled' };
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao cancelar anúncio.');
      }
    }
  );

  // Direct P2P Used Vehicle Purchase (Atomic Debit Buyer -> Credit Seller -> Transfer Ownership -> Close Listing)
  app.post(
    '/api/vehicles/listings/:listingId/buy',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const buyerUid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const listingId = sanitizeId(req.params.listingId);
      if (!listingId) {
        res.status(400).json({ error: 'Anúncio inválido.' });
        return;
      }

      try {
        const result = await withLocks([`listing:${listingId}`, `user:${buyerUid}`], async () => {
          const listing = await backend.getDoc(`vehicle_listings/${listingId}`, idToken);
          if (!listing) throw new Error('Anúncio não encontrado.');
          if (strField(listing, 'status') !== 'active') {
            throw new FirestoreRestError(
              409,
              'FAILED_PRECONDITION',
              'Este anúncio não está mais disponível para compra.'
            );
          }

          const sellerUid = strField(listing, 'sellerUid');
          const vehicleId = strField(listing, 'vehicleId');
          if (sellerUid === buyerUid) {
            throw new Error('Você não pode comprar o próprio veículo.');
          }

          return withLock(`vehicle:${vehicleId}`, async () => {
            const [vehicle, bank, wallet, buyerChar] = await Promise.all([
              backend.getDoc(`vehicles/${vehicleId}`, idToken),
              backend.getDoc(`bank_accounts/${buyerUid}`, idToken),
              backend.getDoc(`wallets/${buyerUid}`, idToken),
              resolveCharacterInfo(buyerUid, idToken),
            ]);

            if (!vehicle || strField(vehicle, 'ownerUid') !== sellerUid || strField(vehicle, 'status') !== 'listed') {
              throw new FirestoreRestError(
                409,
                'FAILED_PRECONDITION',
                'O veículo não pertence mais ao anunciante ou já foi negociado.'
              );
            }
            if (!bank || !wallet || strField(bank, 'status') !== 'active') {
              throw new Error('Conta bancária indisponível.');
            }

            const price = round2(numField(listing, 'askingPrice', 0));
            const buyerBalance = numField(bank, 'balance', 0);
            if (buyerBalance < price) {
              throw new Error(
                `Saldo bancário insuficiente (R$ ${buyerBalance.toFixed(2)} disponível; preço R$ ${price.toFixed(2)}).`
              );
            }

            const sellerName = clampStr(strField(listing, 'sellerName', 'Vendedor'), 64, 'Vendedor');
            const vehicleLabel = clampStr(
              `${strField(vehicle, 'manufacturer')} ${strField(vehicle, 'model')} (${numField(vehicle, 'year', 2025)})`,
              80,
              'Veículo LCE'
            );
            const bankTxId = makeId('tx_vp2p', req.body?.operationId);
            const vTxId = makeId('vtx_p2p');
            const newBuyerBalance = round2(buyerBalance - price);
            const newVehiclesValue = round2(
              numField(wallet, 'vehiclesValue', 0) + numField(vehicle, 'marketValue', price)
            );

            const writes: FirestoreCommitWrite[] = [
              {
                path: `transactions/${bankTxId}`,
                fields: {
                  id: bankTxId,
                  operationId: listingId,
                  type: 'vehicle_p2p_sale',
                  currencyCategory: 'bank',
                  amount: price,
                  fromUid: buyerUid,
                  fromLabel: buyerChar.name,
                  toUid: sellerUid,
                  toLabel: sellerName,
                  actorUid: buyerUid,
                  participants: [buyerUid, sellerUid],
                  description: clampStr(`Compra P2P de usado: ${vehicleLabel}`, 180, 'Compra P2P de veículo'),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `bank_accounts/${buyerUid}`,
                fields: { balance: newBuyerBalance, lastTxId: bankTxId },
                updateMask: ['balance', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              {
                path: `bank_accounts/${sellerUid}`,
                fields: { lastTxId: bankTxId },
                updateMask: ['lastTxId'],
                transforms: [
                  { fieldPath: 'balance', increment: toFsNumber(price) },
                  { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
                precondition: { exists: true },
              },
              {
                path: `wallets/${buyerUid}`,
                fields: { vehiclesValue: newVehiclesValue, lastTxId: bankTxId },
                updateMask: ['vehiclesValue', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              {
                path: `vehicles/${vehicleId}`,
                fields: {
                  ownerUid: buyerUid,
                  ownerName: buyerChar.name,
                  ownerAlias: buyerChar.alias,
                  purchasePrice: price,
                  status: 'in_garage',
                  activeListingId: 'none',
                  lastTxId: bankTxId,
                },
                updateMask: [
                  'ownerUid',
                  'ownerName',
                  'ownerAlias',
                  'purchasePrice',
                  'status',
                  'activeListingId',
                  'lastTxId',
                ],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              {
                path: `vehicle_listings/${listingId}`,
                fields: {
                  status: 'sold',
                  buyerUid,
                  soldTxId: bankTxId,
                },
                updateMask: ['status', 'buyerUid', 'soldTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
              {
                path: `vehicle_transactions/${vTxId}`,
                fields: {
                  id: vTxId,
                  operationId: bankTxId,
                  type: 'p2p_sale',
                  vehicleId,
                  modelId: strField(vehicle, 'modelId'),
                  vehicleLabel,
                  businessId: 'p2p_market',
                  fromUid: sellerUid,
                  fromLabel: sellerName,
                  toUid: buyerUid,
                  toLabel: buyerChar.name,
                  actorUid: buyerUid,
                  participants: [buyerUid, sellerUid],
                  amount: price,
                  description: clampStr(`Transferência P2P: ${vehicleLabel} de ${sellerName} para ${buyerChar.name}`, 180, 'Transferência P2P'),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
            ];

            await backend.commit(writes, idToken);

            return {
              listingId,
              vehicleId,
              newOwnerUid: buyerUid,
              previousOwnerUid: sellerUid,
              paidAmount: price,
              newBuyerBalance,
              bankTxId,
            };
          });
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao comprar veículo usado.');
      }
    }
  );

  // Send P2P Negotiation Offer
  app.post(
    '/api/vehicles/listings/:listingId/offers',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const buyerUid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const listingId = sanitizeId(req.params.listingId);
      if (!listingId) {
        res.status(400).json({ error: 'Anúncio inválido.' });
        return;
      }

      try {
        const [listing, buyerChar] = await Promise.all([
          backend.getDoc(`vehicle_listings/${listingId}`, idToken),
          resolveCharacterInfo(buyerUid, idToken),
        ]);

        if (!listing || strField(listing, 'status') !== 'active') {
          res.status(409).json({ error: 'Anúncio indisponível para propostas.' });
          return;
        }
        const sellerUid = strField(listing, 'sellerUid');
        if (sellerUid === buyerUid) {
          res.status(400).json({ error: 'Você não pode enviar proposta ao próprio anúncio.' });
          return;
        }

        const offerPrice = parsePositiveMoney(req.body?.offerPrice, 15, 200_000_000);
        if (offerPrice === null) {
          res.status(400).json({ error: 'Valor da proposta inválido.' });
          return;
        }

        const message = sanitizeText(
          req.body?.message,
          'Tenho interesse no veículo. Podemos fechar neste valor?',
          2,
          180
        );

        const offerId = makeId('voff');
        const vehicleLabel = clampStr(
          `${strField(listing, 'manufacturer')} ${strField(listing, 'model')} (${numField(listing, 'year', 2025)})`,
          80,
          'Veículo LCE'
        );

        const offerDoc: Record<string, unknown> = {
          id: offerId,
          listingId,
          vehicleId: strField(listing, 'vehicleId'),
          vehicleLabel,
          sellerUid,
          sellerName: clampStr(strField(listing, 'sellerName', 'Vendedor'), 64, 'Vendedor'),
          buyerUid,
          buyerName: buyerChar.name,
          buyerAlias: buyerChar.alias,
          askingPrice: round2(numField(listing, 'askingPrice', offerPrice)),
          offerPrice,
          message,
          status: 'pending',
        };

        await backend.commit(
          [
            {
              path: `vehicle_offers/${offerId}`,
              fields: offerDoc,
              transforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.status(201).json({ offer: offerDoc });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao enviar proposta.');
      }
    }
  );

  // Seller Accepts/Rejects OR Buyer Withdraws an Offer
  app.post(
    '/api/vehicles/offers/:offerId/respond',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const offerId = sanitizeId(req.params.offerId);
      const decision = strField(req.body, 'decision');
      if (!offerId || !['accept', 'reject', 'withdraw'].includes(decision)) {
        res.status(400).json({ error: 'Decisão inválida (use accept, reject ou withdraw).' });
        return;
      }

      try {
        const result = await withLock(`offer:${offerId}`, async () => {
          const offer = await backend.getDoc(`vehicle_offers/${offerId}`, idToken);
          if (!offer) throw new Error('Proposta não encontrada.');

          const curStatus = strField(offer, 'status');
          const sellerUid = strField(offer, 'sellerUid');
          const buyerUid = strField(offer, 'buyerUid');

          let nextStatus = '';
          if (decision === 'accept' || decision === 'reject') {
            if (sellerUid !== uid) throw new Error('Apenas o vendedor pode aceitar ou recusar esta proposta.');
            if (curStatus !== 'pending') {
              throw new FirestoreRestError(409, 'FAILED_PRECONDITION', 'Proposta não está mais pendente.');
            }
            nextStatus = decision === 'accept' ? 'accepted' : 'rejected';
          } else {
            if (buyerUid !== uid) throw new Error('Apenas o comprador pode retirar esta proposta.');
            if (curStatus !== 'pending' && curStatus !== 'accepted') {
              throw new FirestoreRestError(409, 'FAILED_PRECONDITION', 'Proposta já encerrada.');
            }
            nextStatus = 'withdrawn';
          }

          await backend.commit(
            [
              {
                path: `vehicle_offers/${offerId}`,
                fields: { status: nextStatus },
                updateMask: ['status'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
            ],
            idToken
          );

          return { offerId, status: nextStatus };
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao responder proposta.');
      }
    }
  );

  // Buyer Atomically Completes an Accepted Offer at the Agreed Offer Price
  app.post(
    '/api/vehicles/offers/:offerId/complete',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const buyerUid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const offerId = sanitizeId(req.params.offerId);
      if (!offerId) {
        res.status(400).json({ error: 'Proposta inválida.' });
        return;
      }

      try {
        const result = await withLocks([`offer:${offerId}`, `user:${buyerUid}`], async () => {
          const offer = await backend.getDoc(`vehicle_offers/${offerId}`, idToken);
          if (!offer) throw new Error('Proposta não encontrada.');
          if (strField(offer, 'buyerUid') !== buyerUid) {
            throw new Error('Apenas o autor da proposta pode concluir o pagamento.');
          }
          if (strField(offer, 'status') !== 'accepted') {
            throw new FirestoreRestError(
              409,
              'FAILED_PRECONDITION',
              'A proposta precisa estar aceita pelo vendedor para ser concluída.'
            );
          }

          const listingId = strField(offer, 'listingId');
          const vehicleId = strField(offer, 'vehicleId');
          const sellerUid = strField(offer, 'sellerUid');

          return withLocks([`listing:${listingId}`, `vehicle:${vehicleId}`], async () => {
            const [listing, vehicle, bank, wallet, buyerChar] = await Promise.all([
              backend.getDoc(`vehicle_listings/${listingId}`, idToken),
              backend.getDoc(`vehicles/${vehicleId}`, idToken),
              backend.getDoc(`bank_accounts/${buyerUid}`, idToken),
              backend.getDoc(`wallets/${buyerUid}`, idToken),
              resolveCharacterInfo(buyerUid, idToken),
            ]);

            if (!listing || strField(listing, 'status') !== 'active') {
              throw new FirestoreRestError(409, 'FAILED_PRECONDITION', 'O anúncio não está mais ativo.');
            }
            if (!vehicle || strField(vehicle, 'ownerUid') !== sellerUid || strField(vehicle, 'status') !== 'listed') {
              throw new FirestoreRestError(409, 'FAILED_PRECONDITION', 'O veículo já foi transferido.');
            }
            if (!bank || !wallet || strField(bank, 'status') !== 'active') {
              throw new Error('Conta bancária indisponível.');
            }

            const agreedPrice = round2(numField(offer, 'offerPrice', 0));
            const buyerBalance = numField(bank, 'balance', 0);
            if (buyerBalance < agreedPrice) {
              throw new Error(
                `Saldo bancário insuficiente (R$ ${buyerBalance.toFixed(2)} disponível; valor negociado R$ ${agreedPrice.toFixed(2)}).`
              );
            }

            const sellerName = clampStr(strField(offer, 'sellerName', 'Vendedor'), 64, 'Vendedor');
            const vehicleLabel = clampStr(strField(offer, 'vehicleLabel', 'Veículo LCE'), 80, 'Veículo LCE');
            const bankTxId = makeId('tx_voff');
            const vTxId = makeId('vtx_off');
            const newBuyerBalance = round2(buyerBalance - agreedPrice);
            const newVehiclesValue = round2(
              numField(wallet, 'vehiclesValue', 0) + numField(vehicle, 'marketValue', agreedPrice)
            );

            await backend.commit(
              [
                {
                  path: `transactions/${bankTxId}`,
                  fields: {
                    id: bankTxId,
                    operationId: offerId,
                    type: 'vehicle_p2p_sale',
                    currencyCategory: 'bank',
                    amount: agreedPrice,
                    fromUid: buyerUid,
                    fromLabel: buyerChar.name,
                    toUid: sellerUid,
                    toLabel: sellerName,
                    actorUid: buyerUid,
                    participants: [buyerUid, sellerUid],
                    description: clampStr(`Negociação P2P concluída: ${vehicleLabel}`, 180, 'Negociação P2P'),
                    status: 'completed',
                  },
                  transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: false },
                },
                {
                  path: `bank_accounts/${buyerUid}`,
                  fields: { balance: newBuyerBalance, lastTxId: bankTxId },
                  updateMask: ['balance', 'lastTxId'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: true },
                },
                {
                  path: `bank_accounts/${sellerUid}`,
                  fields: { lastTxId: bankTxId },
                  updateMask: ['lastTxId'],
                  transforms: [
                    { fieldPath: 'balance', increment: toFsNumber(agreedPrice) },
                    { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                  ],
                  precondition: { exists: true },
                },
                {
                  path: `wallets/${buyerUid}`,
                  fields: { vehiclesValue: newVehiclesValue, lastTxId: bankTxId },
                  updateMask: ['vehiclesValue', 'lastTxId'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: true },
                },
                {
                  path: `vehicles/${vehicleId}`,
                  fields: {
                    ownerUid: buyerUid,
                    ownerName: buyerChar.name,
                    ownerAlias: buyerChar.alias,
                    purchasePrice: agreedPrice,
                    status: 'in_garage',
                    activeListingId: 'none',
                    lastTxId: bankTxId,
                  },
                  updateMask: [
                    'ownerUid',
                    'ownerName',
                    'ownerAlias',
                    'purchasePrice',
                    'status',
                    'activeListingId',
                    'lastTxId',
                  ],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: true },
                },
                {
                  path: `vehicle_listings/${listingId}`,
                  fields: { status: 'sold', buyerUid, soldTxId: bankTxId },
                  updateMask: ['status', 'buyerUid', 'soldTxId'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: true },
                },
                {
                  path: `vehicle_offers/${offerId}`,
                  fields: { status: 'completed', completedTxId: bankTxId },
                  updateMask: ['status', 'completedTxId'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: true },
                },
                {
                  path: `vehicle_transactions/${vTxId}`,
                  fields: {
                    id: vTxId,
                    operationId: bankTxId,
                    type: 'p2p_sale',
                    vehicleId,
                    modelId: strField(vehicle, 'modelId'),
                    vehicleLabel,
                    businessId: 'p2p_market',
                    fromUid: sellerUid,
                    fromLabel: sellerName,
                    toUid: buyerUid,
                    toLabel: buyerChar.name,
                    actorUid: buyerUid,
                    participants: [buyerUid, sellerUid],
                    amount: agreedPrice,
                    description: clampStr(`Proposta aceita e liquidada: ${vehicleLabel}`, 180, 'Proposta P2P'),
                    status: 'completed',
                  },
                  transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                  precondition: { exists: false },
                },
              ],
              idToken
            );

            return {
              offerId,
              listingId,
              vehicleId,
              paidAmount: agreedPrice,
              newBuyerBalance,
              bankTxId,
            };
          });
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao concluir proposta aceita.');
      }
    }
  );

  // =========================================================================
  // 5. ADMIN VEHICLE GOVERNANCE ROUTES
  // =========================================================================

  app.get(
    '/api/admin/vehicles/overview',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        if (!(await resolveIsAdmin(req))) {
          res.status(403).json({ error: 'Acesso restrito à administração.' });
          return;
        }
        const idToken = req.rawIdToken!;
        const [catalog, vehicleDocs, stockDocs, listingDocs, txDocs, commDocs, bizDocs] =
          await Promise.all([
            loadMergedCatalog(idToken),
            backend.listCollection('vehicles', idToken, 100),
            backend.listCollection('dealership_inventory', idToken, 100),
            backend.listCollection('vehicle_listings', idToken, 100),
            backend.listCollection('vehicle_transactions', idToken, 100),
            backend.listCollection('vehicle_commissions', idToken, 100),
            backend.listCollection('businesses', idToken, 100),
          ]);

        const stock = stockDocs.map((d) => d.data);
        const dealerships = bizDocs
          .map((d) => d.data)
          .filter((b) => strField(b, 'templateType') === 'concessionaria')
          .map((b) => {
            const bid = strField(b, 'id');
            return {
              id: bid,
              name: strField(b, 'name'),
              ownerUid: strField(b, 'ownerUid'),
              ownerName: strField(b, 'ownerName'),
              status: strField(b, 'status'),
              availableCount: stock.filter(
                (s) => strField(s, 'businessId') === bid && strField(s, 'status') === 'available'
              ).length,
              soldCount: stock.filter(
                (s) => strField(s, 'businessId') === bid && strField(s, 'status') === 'sold'
              ).length,
            };
          });

        res.json({
          catalog,
          vehicles: vehicleDocs.map((d) => d.data),
          stock,
          listings: listingDocs.map((d) => d.data),
          transactions: txDocs.map((d) => d.data),
          commissions: commDocs.map((d) => d.data),
          dealerships,
        });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao carregar visão administrativa de veículos.');
      }
    }
  );

  app.post(
    '/api/admin/vehicles/seed-catalog',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        if (!(await resolveIsAdmin(req))) {
          res.status(403).json({ error: 'Acesso restrito à administração.' });
          return;
        }
        const adminUid = req.verifiedUser!.uid;
        const idToken = req.rawIdToken!;

        const writes: FirestoreCommitWrite[] = DEFAULT_VEHICLE_CATALOG.map((model) => ({
          path: `vehicle_catalog/${model.id}`,
          fields: buildCatalogModelFields(model, adminUid),
          transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        }));

        writes.push({
          path: `admin_logs/${makeId('alog')}`,
          fields: {
            actorUid: adminUid,
            action: 'admin_vehicle_action',
            targetUid: adminUid,
            summary: `Catálogo oficial de veículos sincronizado (${DEFAULT_VEHICLE_CATALOG.length} modelos).`,
          },
          transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          precondition: { exists: false },
        });

        await backend.commit(writes, idToken);
        res.json({ seededCount: DEFAULT_VEHICLE_CATALOG.length });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao sincronizar catálogo oficial de veículos.');
      }
    }
  );

  app.post(
    '/api/admin/vehicles/catalog',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        if (!(await resolveIsAdmin(req))) {
          res.status(403).json({ error: 'Acesso restrito à administração.' });
          return;
        }
        const adminUid = req.verifiedUser!.uid;
        const idToken = req.rawIdToken!;
        const body = req.body ?? {};

        const modelId = sanitizeId(body.id) ?? makeId('veh_mod');
        const category = strField(body, 'category') as VehicleCategory;
        if (!VALID_CATEGORIES.has(category)) {
          res.status(400).json({ error: 'Categoria de veículo inválida.' });
          return;
        }

        const basePrice = parsePositiveMoney(body.basePrice, 20, 100_000_000);
        const marketValue = parsePositiveMoney(body.marketValue ?? (basePrice ? basePrice * 1.2 : null), 20, 100_000_000);
        if (basePrice === null || marketValue === null) {
          res.status(400).json({ error: 'Preço-base ou valor de mercado inválido.' });
          return;
        }

        const model: VehicleCatalogModel = {
          id: modelId,
          manufacturer: sanitizeText(body.manufacturer, 'Veridia Motors', 2, 48),
          model: sanitizeText(body.model, 'Protótipo LCE', 2, 64),
          year: Math.floor(parseNumberInRange(body.year ?? 2026, 1980, 2035) ?? 2026),
          category,
          basePrice,
          marketValue,
          topSpeed: Math.floor(parseNumberInRange(body.topSpeed ?? 190, 40, 450) ?? 190),
          acceleration: parseNumberInRange(body.acceleration ?? 7.0, 1, 10) ?? 7.0,
          capacity: Math.floor(parseNumberInRange(body.capacity ?? 4, 1, 16) ?? 4),
          fuelConsumption: parseNumberInRange(body.fuelConsumption ?? 8.5, 0.5, 60) ?? 8.5,
          defaultCondition: 100,
          imageKey: VALID_CATEGORIES.has(body.imageKey) ? body.imageKey : category,
          minPriceMultiplier: parseNumberInRange(body.minPriceMultiplier ?? 1.0, 0.8, 5.0) ?? 1.0,
          maxPriceMultiplier: parseNumberInRange(body.maxPriceMultiplier ?? 2.4, 1.0, 10.0) ?? 2.4,
          maxCommissionPercent: parseNumberInRange(body.maxCommissionPercent ?? 15, 0, 35) ?? 15,
          description: sanitizeText(body.description, 'Novo modelo homologado pela administração LCE.', 4, 240),
          active: body.active !== false,
          isCatalogVehicle: true,
        };

        await backend.commit(
          [
            {
              path: `vehicle_catalog/${model.id}`,
              fields: buildCatalogModelFields(model, adminUid),
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `admin_logs/${makeId('alog')}`,
              fields: {
                actorUid: adminUid,
                action: 'create_vehicle_model',
                targetUid: adminUid,
                summary: clampStr(
                  `Modelo adicionado ao catálogo: ${model.manufacturer} ${model.model} (R$ ${model.basePrice.toFixed(2)})`,
                  240,
                  'Novo modelo de veículo'
                ),
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.status(201).json({ model });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao adicionar modelo ao catálogo.');
      }
    }
  );

  app.put(
    '/api/admin/vehicles/catalog/:modelId',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        if (!(await resolveIsAdmin(req))) {
          res.status(403).json({ error: 'Acesso restrito à administração.' });
          return;
        }
        const adminUid = req.verifiedUser!.uid;
        const idToken = req.rawIdToken!;
        const modelId = sanitizeId(req.params.modelId);
        if (!modelId) {
          res.status(400).json({ error: 'ID de modelo inválido.' });
          return;
        }

        const catalog = await loadMergedCatalog(idToken);
        const existing = catalog.find((m) => m.id === modelId);
        if (!existing) {
          res.status(404).json({ error: 'Modelo não encontrado.' });
          return;
        }

        const body = req.body ?? {};
        const nextCategory =
          typeof body.category === 'string' && VALID_CATEGORIES.has(body.category as VehicleCategory)
            ? (body.category as VehicleCategory)
            : existing.category;

        const minMult = parseNumberInRange(body.minPriceMultiplier ?? existing.minPriceMultiplier, 0.8, 5.0) ?? existing.minPriceMultiplier;
        const maxMult = Math.max(
          minMult,
          parseNumberInRange(body.maxPriceMultiplier ?? existing.maxPriceMultiplier, 1.0, 10.0) ?? existing.maxPriceMultiplier
        );

        const updated: VehicleCatalogModel = {
          ...existing,
          manufacturer: sanitizeText(body.manufacturer, existing.manufacturer, 2, 48),
          model: sanitizeText(body.model, existing.model, 2, 64),
          year: Math.floor(parseNumberInRange(body.year ?? existing.year, 1980, 2035) ?? existing.year),
          category: nextCategory,
          imageKey: nextCategory,
          basePrice: parsePositiveMoney(body.basePrice ?? existing.basePrice, 20, 100_000_000) ?? existing.basePrice,
          marketValue: parsePositiveMoney(body.marketValue ?? existing.marketValue, 20, 100_000_000) ?? existing.marketValue,
          minPriceMultiplier: minMult,
          maxPriceMultiplier: maxMult,
          maxCommissionPercent:
            parseNumberInRange(body.maxCommissionPercent ?? existing.maxCommissionPercent, 0, 35) ??
            existing.maxCommissionPercent,
          active: typeof body.active === 'boolean' ? body.active : existing.active,
          description: sanitizeText(body.description, existing.description, 4, 240),
        };

        await backend.commit(
          [
            {
              path: `vehicle_catalog/${modelId}`,
              fields: buildCatalogModelFields(updated, adminUid),
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `admin_logs/${makeId('alog')}`,
              fields: {
                actorUid: adminUid,
                action: 'update_vehicle_model',
                targetUid: adminUid,
                summary: clampStr(
                  `Modelo atualizado: ${updated.manufacturer} ${updated.model} — base R$ ${updated.basePrice.toFixed(2)}, comissão máx ${updated.maxCommissionPercent}%`,
                  240,
                  'Atualização de modelo veicular'
                ),
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.json({ model: updated });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao atualizar modelo do catálogo.');
      }
    }
  );

  app.put(
    '/api/admin/vehicles/listings/:listingId/suspend',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        if (!(await resolveIsAdmin(req))) {
          res.status(403).json({ error: 'Acesso restrito à administração.' });
          return;
        }
        const adminUid = req.verifiedUser!.uid;
        const idToken = req.rawIdToken!;
        const listingId = sanitizeId(req.params.listingId);
        if (!listingId) {
          res.status(400).json({ error: 'Anúncio inválido.' });
          return;
        }

        const listing = await backend.getDoc(`vehicle_listings/${listingId}`, idToken);
        if (!listing) {
          res.status(404).json({ error: 'Anúncio não encontrado.' });
          return;
        }
        if (strField(listing, 'status') !== 'active') {
          res.status(409).json({ error: 'Apenas anúncios ativos podem ser suspensos.' });
          return;
        }

        const vehicleId = strField(listing, 'vehicleId');
        const reason = sanitizeText(req.body?.reason, 'Anúncio suspenso por suspeita de fraude ou preço irregular.', 3, 140);

        await backend.commit(
          [
            {
              path: `vehicle_listings/${listingId}`,
              fields: { status: 'suspended' },
              updateMask: ['status'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `vehicles/${vehicleId}`,
              fields: { status: 'in_garage', activeListingId: 'none' },
              updateMask: ['status', 'activeListingId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `admin_logs/${makeId('alog')}`,
              fields: {
                actorUid: adminUid,
                action: 'suspend_vehicle_listing',
                targetUid: strField(listing, 'sellerUid', adminUid),
                summary: clampStr(`Anúncio ${listingId} suspenso: ${reason}`, 240, 'Suspensão de anúncio'),
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.json({ listingId, vehicleId, status: 'suspended' });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao suspender anúncio.');
      }
    }
  );

  // =========================================================================
  // SERVER-CONTROLLED INITIAL DEALERSHIP & STOCK BOOTSTRAP (NON-DESTRUCTIVE)
  // =========================================================================

  const ensureInitialDealershipStock = async (
    idToken: string,
    opts?: { adminReplenish?: boolean; adminUid?: string }
  ) => {
    return withLock(`vehicles:bootstrap:${DEMO_DEALERSHIP_ID}`, async () => {
      const [existingBiz, catalog, allBizDocs] = await Promise.all([
        backend.getDoc(`businesses/${DEMO_DEALERSHIP_ID}`, idToken),
        loadMergedCatalog(idToken),
        backend.queryByField('businesses', 'templateType', 'EQUAL', 'concessionaria', idToken, 100),
      ]);

      const catalogById = new Map<string, VehicleCatalogModel>();
      for (const m of catalog) catalogById.set(m.id, m);

      const targetModels: VehicleCatalogModel[] = INITIAL_LCE_VEHICLE_CATALOG.map(
        (base) => catalogById.get(base.id) ?? base
      );

      // Check existing deterministic initial stock slots (never resurrect sold units)
      const deterministicChecks = await Promise.all(
        targetModels.flatMap((model) =>
          ([1, 2] as const).map(async (unitIndex) => {
            const stockId = makeInitialDemoStockId(model.id, unitIndex);
            const doc = await backend.getDoc(`dealership_inventory/${stockId}`, idToken);
            return { model, unitIndex, stockId, exists: doc !== null, doc };
          })
        )
      );

      const writes: FirestoreCommitWrite[] = [];
      let createdDealership = false;
      let createdUnits = 0;

      if (!existingBiz) {
        createdDealership = true;
        writes.push({
          path: `businesses/${DEMO_DEALERSHIP_ID}`,
          fields: {
            id: DEMO_DEALERSHIP_ID,
            locationId: DEMO_DEALERSHIP_LOCATION_ID,
            templateType: 'concessionaria',
            name: DEMO_DEALERSHIP_NAME,
            category: 'Automotivo',
            description:
              'Concessionária oficial de demonstração da cidade com estoque inicial gerenciado pelo servidor LCE.',
            ownerUid: DEMO_DEALERSHIP_OWNER_UID,
            ownerName: DEMO_DEALERSHIP_OWNER_NAME,
            ownerAlias: DEMO_DEALERSHIP_OWNER_ALIAS,
            status: 'active',
            acquisitionPrice: 850,
            marketValue: 850,
            operatingExpense: 0,
            maxEmployees: 8,
            growthLevel: 1,
            employeeCount: 0,
            reputation: 92,
            reputationCount: 1,
            forSale: false,
            salePrice: 0,
            locationLabel: 'Quadra Sudoeste · LCE Motors Showroom',
            posX: -18,
            posZ: 14,
            lastTxId: 'seed_initial_dealership',
          },
          transforms: [
            { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
          ],
          precondition: { exists: false },
        });
        writes.push({
          path: `business_finances/${DEMO_DEALERSHIP_ID}`,
          fields: {
            businessId: DEMO_DEALERSHIP_ID,
            ownerUid: DEMO_DEALERSHIP_OWNER_UID,
            cashBalance: 0,
            totalRevenue: 0,
            totalExpenses: 0,
            totalPayrollPaid: 0,
            netProfit: 0,
            lastTxId: 'seed_initial_dealership',
          },
          transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          precondition: { exists: false },
        });
      }

      const buildDemoStockFields = (
        stockId: string,
        model: VehicleCatalogModel,
        lastTxId: string
      ): Record<string, unknown> => ({
        id: stockId,
        businessId: DEMO_DEALERSHIP_ID,
        businessName: DEMO_DEALERSHIP_NAME,
        ownerUid: DEMO_DEALERSHIP_OWNER_UID,
        ownerName: DEMO_DEALERSHIP_OWNER_NAME,
        modelId: model.id,
        manufacturer: clampStr(model.manufacturer, 48, 'LCE Motors'),
        model: clampStr(model.model, 64, model.id),
        year: Math.floor(model.year),
        category: model.category,
        imageKey: model.imageKey,
        purchaseCost: round2(model.basePrice),
        salePrice: round2(model.basePrice),
        promoDiscountPercent: 0,
        finalPrice: round2(model.basePrice),
        topSpeed: Math.floor(model.topSpeed),
        acceleration: round2(model.acceleration),
        capacity: Math.floor(model.capacity),
        fuelConsumption: round2(model.fuelConsumption),
        condition: Math.floor(model.defaultCondition),
        commissionPercent: 0,
        assignedSellerUid: 'none',
        assignedSellerName: 'Showroom Direto',
        status: 'available',
        lastTxId,
      });

      for (const entry of deterministicChecks) {
        if (!entry.exists) {
          writes.push({
            path: `dealership_inventory/${entry.stockId}`,
            fields: buildDemoStockFields(entry.stockId, entry.model, 'seed_initial_stock'),
            transforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
            precondition: { exists: false },
          });
          createdUnits += 1;
        }
      }

      if (opts?.adminReplenish && opts.adminUid) {
        // Sync official catalog models first
        for (const model of targetModels) {
          writes.push({
            path: `vehicle_catalog/${model.id}`,
            fields: buildCatalogModelFields(model, opts.adminUid),
            transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          });
        }

        // Top up any model in demo dealership that currently has fewer than 2 available units
        const demoStockDocs = await backend.queryByField(
          'dealership_inventory',
          'businessId',
          'EQUAL',
          DEMO_DEALERSHIP_ID,
          idToken,
          100
        );
        const availCountByModel = new Map<string, number>();
        for (const d of demoStockDocs) {
          if (strField(d.data, 'status') === 'available') {
            const mId = strField(d.data, 'modelId');
            availCountByModel.set(mId, (availCountByModel.get(mId) ?? 0) + 1);
          }
        }
        // Account for deterministic units queued in this same commit
        for (const entry of deterministicChecks) {
          if (!entry.exists) {
            availCountByModel.set(
              entry.model.id,
              (availCountByModel.get(entry.model.id) ?? 0) + 1
            );
          }
        }

        for (const model of targetModels) {
          const currentAvail = availCountByModel.get(model.id) ?? 0;
          const deficit = Math.max(0, INITIAL_STOCK_UNITS_PER_MODEL - currentAvail);
          for (let i = 0; i < deficit; i += 1) {
            const extraStockId = makeId('stk_repl');
            writes.push({
              path: `dealership_inventory/${extraStockId}`,
              fields: buildDemoStockFields(extraStockId, model, makeId('seed_repl')),
              transforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            });
            createdUnits += 1;
          }
        }

        writes.push({
          path: `admin_logs/${makeId('alog')}`,
          fields: {
            actorUid: opts.adminUid,
            action: 'admin_vehicle_action',
            targetUid: opts.adminUid,
            summary: clampStr(
              `Estoque inicial abastecido em ${DEMO_DEALERSHIP_NAME}: ${createdUnits} unidade(s) adicionada(s) (${targetModels.length} modelos).`,
              240,
              'Abastecimento inicial de veículos'
            ),
          },
          transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          precondition: { exists: false },
        });
      }

      if (writes.length > 0) {
        await backend.commit(writes, idToken);
      }

      const finalAvailDocs = await backend.queryByField(
        'dealership_inventory',
        'status',
        'EQUAL',
        'available',
        idToken,
        100
      );

      return {
        dealershipId: DEMO_DEALERSHIP_ID,
        dealershipName: DEMO_DEALERSHIP_NAME,
        createdDealership,
        createdUnits,
        availableUnits: finalAvailDocs.length,
        existingDealershipsCount: allBizDocs.length + (createdDealership ? 1 : 0),
        totalCatalogModels: targetModels.length,
      };
    });
  };

  // Non-destructive initial stock bootstrap (idempotent; never modifies player-owned businesses)
  app.post(
    '/api/vehicles/bootstrap-initial-stock',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        const result = await ensureInitialDealershipStock(req.rawIdToken!);
        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao inicializar estoque inicial da concessionária.');
      }
    }
  );

  // Admin explicit catalog sync + demo dealership initial stock replenishment
  app.post(
    '/api/admin/vehicles/seed-initial-stock',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        if (!(await resolveIsAdmin(req))) {
          res.status(403).json({ error: 'Acesso restrito à administração.' });
          return;
        }
        const result = await ensureInitialDealershipStock(req.rawIdToken!, {
          adminReplenish: true,
          adminUid: req.verifiedUser!.uid,
        });
        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao abastecer estoque inicial da concessionária.');
      }
    }
  );

  // =========================================================================
  // MODULE 5: PHYSICAL GARAGE SPAWN / STORE & 3D WORLD VEHICLE SESSIONS
  // =========================================================================

  // Withdraw an owned vehicle from the garage into the physical 3D exit bay
  app.post(
    '/api/vehicles/:vehicleId/spawn',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const vehicleId = sanitizeId(req.params.vehicleId);
      if (!vehicleId) {
        res.status(400).json({ error: 'Identificador de veículo inválido.' });
        return;
      }
      if (!worldVehicles) {
        res.status(503).json({ error: 'Serviço de mundo 3D indisponível.' });
        return;
      }

      try {
        const result = await withLocks([`vehicle:${vehicleId}`, `user:${uid}`], async () => {
          const vehicle = await backend.getDoc(`vehicles/${vehicleId}`, idToken);
          if (!vehicle) {
            throw new FirestoreRestError(404, 'NOT_FOUND', 'Veículo não encontrado na garagem.');
          }
          if (strField(vehicle, 'ownerUid') !== uid) {
            throw new FirestoreRestError(
              403,
              'PERMISSION_DENIED',
              'Somente o proprietário pode retirar este veículo da garagem.'
            );
          }
          if (strField(vehicle, 'status') === 'listed') {
            throw new FirestoreRestError(
              409,
              'FAILED_PRECONDITION',
              'Cancele o anúncio de venda antes de retirar este veículo para a cidade.'
            );
          }

          // Block simultaneous duplicate withdrawal of the same vehicle
          if (worldVehicles.getById(vehicleId)) {
            throw new FirestoreRestError(
              409,
              'ALREADY_EXISTS',
              'Este veículo já está retirado e ativo na cidade.'
            );
          }

          // Keep 1 active street vehicle per owner to prevent city clutter
          const otherActive = worldVehicles.getByOwner(uid);
          if (otherActive && otherActive.vehicleId !== vehicleId) {
            throw new FirestoreRestError(
              409,
              'FAILED_PRECONDITION',
              `Você já possui ${otherActive.model} [${otherActive.plate}] ativo na cidade. Guarde-o antes de retirar outro.`
            );
          }

          const bay = worldVehicles.pickAvailableBay();
          const now = Date.now();
          const categoryRaw = strField(vehicle, 'category', 'sedan') as VehicleCategory;
          const category: VehicleCategory = VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'sedan';
          const plate = clampStr(strField(vehicle, 'plate', 'LCE-0A00'), 16, 'LCE-0A00');
          issuedPlates.add(plate);

          // Persist parked street status & bay coordinates in Firestore
          await backend.commit(
            [
              {
                path: `vehicles/${vehicleId}`,
                fields: {
                  status: 'parked',
                  parkedZone: clampStr(bay.label, 64, 'Garagem Central'),
                  parkedX: round2(bay.x),
                  parkedZ: round2(bay.z),
                },
                updateMask: ['status', 'parkedZone', 'parkedX', 'parkedZ'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
            ],
            idToken
          );

          const sharedState: SharedVehicleState = {
            vehicleId,
            ownerUid: uid,
            ownerName: clampStr(strField(vehicle, 'ownerName', 'Cidadão LCE'), 64, 'Cidadão LCE'),
            ownerAlias: clampStr(strField(vehicle, 'ownerAlias', 'cidadao'), 32, 'cidadao'),
            driverUid: null,
            driverName: null,
            modelId: strField(vehicle, 'modelId', 'lce-sedan'),
            manufacturer: clampStr(strField(vehicle, 'manufacturer', 'LCE Motors'), 48, 'LCE Motors'),
            model: clampStr(strField(vehicle, 'model', 'LCE Sedan'), 64, 'LCE Sedan'),
            year: Math.floor(numField(vehicle, 'year', 2025)),
            category,
            plate,
            x: round2(bay.x),
            z: round2(bay.z),
            rotY: Math.round(bay.rotY * 1000) / 1000,
            speed: 0,
            steerAngle: 0,
            throttle: 0,
            braking: false,
            handbrake: false,
            boost: false,
            state: 'parked',
            fuelLevel: Math.max(0, Math.min(100, round2(numField(vehicle, 'fuelLevel', 100)))),
            condition: Math.max(0, Math.min(100, Math.round(numField(vehicle, 'condition', 100)))),
            mileageKm: Math.max(0, round2(numField(vehicle, 'mileageKm', 0))),
            sessionDistanceM: 0,
            spawnBayLabel: bay.label,
            updatedAt: now,
          };

          worldVehicles.spawnVehicle(sharedState);

          return {
            vehicle: sharedState,
            bay,
          };
        });

        res.status(201).json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao retirar veículo da garagem.');
      }
    }
  );

  // Store an active street vehicle back in the garage, persisting mileage, fuel & condition
  app.post(
    '/api/vehicles/:vehicleId/store',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const uid = req.verifiedUser!.uid;
      const idToken = req.rawIdToken!;
      const vehicleId = sanitizeId(req.params.vehicleId);
      if (!vehicleId) {
        res.status(400).json({ error: 'Identificador de veículo inválido.' });
        return;
      }
      if (!worldVehicles) {
        res.status(503).json({ error: 'Serviço de mundo 3D indisponível.' });
        return;
      }

      try {
        const result = await withLocks([`vehicle:${vehicleId}`, `user:${uid}`], async () => {
          const vehicle = await backend.getDoc(`vehicles/${vehicleId}`, idToken);
          if (!vehicle) {
            throw new FirestoreRestError(404, 'NOT_FOUND', 'Veículo não encontrado.');
          }
          if (strField(vehicle, 'ownerUid') !== uid) {
            throw new FirestoreRestError(
              403,
              'PERMISSION_DENIED',
              'Somente o proprietário pode guardar este veículo na garagem.'
            );
          }

          const live = worldVehicles.getById(vehicleId);
          const curMileage = Math.max(0, round2(numField(vehicle, 'mileageKm', 0)));
          const curFuel = Math.max(0, Math.min(100, round2(numField(vehicle, 'fuelLevel', 100))));
          const curCond = Math.max(0, Math.min(100, Math.round(numField(vehicle, 'condition', 100))));
          const curMarket = Math.max(15, round2(numField(vehicle, 'marketValue', 100)));

          const drivenKm = live ? Math.max(0, round2(live.sessionDistanceM * 0.004)) : 0;
          const nextMileage = round2(curMileage + drivenKm);
          const nextFuel = live
            ? Math.max(0, Math.min(curFuel, round2(live.fuelLevel)))
            : curFuel;
          const wearFromDrive = drivenKm >= 2 ? Math.min(5, Math.floor(drivenKm / 8)) : 0;
          const liveCond = live ? Math.min(curCond, Math.round(live.condition)) : curCond;
          const nextCond = Math.max(10, Math.min(curCond, liveCond - wearFromDrive));

          const modelRef = DEFAULT_VEHICLE_CATALOG_MAP[strField(vehicle, 'modelId')];
          const baseMarket = modelRef?.marketValue ?? curMarket;
          const nextMarketValue = Math.max(
            15,
            Math.min(curMarket, computeDepreciatedMarketValue(baseMarket, nextCond, nextMileage))
          );

          await backend.commit(
            [
              {
                path: `vehicles/${vehicleId}`,
                fields: {
                  status: 'in_garage',
                  mileageKm: nextMileage,
                  fuelLevel: nextFuel,
                  condition: nextCond,
                  marketValue: nextMarketValue,
                  parkedZone: 'Garagem Central',
                  parkedX: 0,
                  parkedZ: 0,
                },
                updateMask: [
                  'status',
                  'mileageKm',
                  'fuelLevel',
                  'condition',
                  'marketValue',
                  'parkedZone',
                  'parkedX',
                  'parkedZ',
                ],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
            ],
            idToken
          );

          worldVehicles.despawnVehicle(vehicleId, uid, 'store');

          return {
            vehicleId,
            status: 'in_garage' as const,
            plate: strField(vehicle, 'plate'),
            drivenKm,
            mileageKm: nextMileage,
            fuelLevel: nextFuel,
            condition: nextCond,
            marketValue: nextMarketValue,
            parkedZone: 'Garagem Central',
          };
        });

        res.json(result);
      } catch (err) {
        handleRouteError(res, err, 'Erro ao guardar veículo na garagem.');
      }
    }
  );

  // Admin read-only visibility into authoritative 3D vehicle world events
  app.get(
    '/api/admin/vehicles/world-events',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      try {
        if (!(await resolveIsAdmin(req))) {
          res.status(403).json({ error: 'Acesso restrito à administração.' });
          return;
        }
        res.json({
          activeVehicles: worldVehicles?.getAll() ?? [],
          events: worldVehicles?.getRecentEvents() ?? [],
        });
      } catch (err) {
        handleRouteError(res, err, 'Erro ao carregar eventos de veículos.');
      }
    }
  );
}
