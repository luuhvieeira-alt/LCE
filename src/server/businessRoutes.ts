import crypto from 'crypto';
import type { Express, NextFunction, Response } from 'express';
import {
  BUSINESS_TEMPLATE_TYPES,
  DEFAULT_BUSINESS_LOCATIONS,
  DEFAULT_BUSINESS_LOCATIONS_MAP,
  DEFAULT_PRODUCTS_BY_TYPE,
} from '../config/businessCatalog.ts';
import type { BusinessLocation, BusinessTemplateType } from '../types/business.ts';
import type { EconomyAuthedRequest } from './economyRoutes.ts';
import {
  FirestoreRestError,
  toFsNumber,
  type FirestoreBackend,
  type FirestoreCommitWrite,
} from './firestoreRest.ts';
import type { VerifiedTokenPayload } from './worldServer.ts';

export interface RegisterBusinessRoutesOptions {
  app: Express;
  backend: FirestoreBackend;
  requireAuth: (req: EconomyAuthedRequest, res: Response, next: NextFunction) => Promise<void>;
  nowFn?: () => number;
}

const VALID_TEMPLATES = new Set<BusinessTemplateType>(BUSINESS_TEMPLATE_TYPES);
const ID_PATTERN = /^[a-zA-Z0-9_-]{3,80}$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parsePositiveMoney(value: unknown, min = 0.01, max = 100_000_000): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = round2(value);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function parsePositiveInt(value: unknown, min = 1, max = 1000): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const intVal = Math.floor(value);
  if (intVal !== value || intVal < min || intVal > max) return null;
  return intVal;
}

function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

function sanitizeText(raw: unknown, fallback: string, minLen: number, maxLen: number): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, maxLen);
  return cleaned.length >= minLen ? cleaned : fallback;
}

function clampStr(value: string, maxLen: number, fallback = 'LCE'): string {
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function buildLocationFields(loc: BusinessLocation, updatedBy: string): Record<string, unknown> {
  return {
    id: loc.id,
    templateType: loc.templateType,
    name: clampStr(loc.name, 64, loc.id),
    category: clampStr(loc.category, 48, 'Comércio'),
    description: clampStr(loc.description, 240, 'Estabelecimento comercial oficial do Distrito Central.'),
    acquisitionPrice: round2(loc.acquisitionPrice),
    initialCapital: round2(loc.initialCapital),
    operatingExpense: round2(loc.operatingExpense),
    maxEmployees: Math.floor(loc.maxEmployees),
    revenuePotential: round2(loc.revenuePotential),
    minPriceMultiplier: round2(loc.minPriceMultiplier),
    maxPriceMultiplier: round2(loc.maxPriceMultiplier),
    locationLabel: clampStr(loc.locationLabel, 80, 'Distrito Central'),
    posX: loc.posX,
    posZ: loc.posZ,
    available: Boolean(loc.available),
    isCatalogLocation: true,
    updatedBy,
  };
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

function makeOpId(raw: unknown, prefix: string): string {
  const clean = sanitizeId(raw);
  if (clean) return clean;
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

export function registerBusinessRoutes(options: RegisterBusinessRoutesOptions): void {
  const { app, backend, requireAuth, nowFn = () => Date.now() } = options;

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

  const requireVerifiedCitizen = async (
    req: EconomyAuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    await requireAuth(req, res, async () => {
      if (!req.verifiedUser?.emailVerified) {
        res.status(403).json({
          error: 'Verifique seu e-mail antes de acessar ou operar empresas.',
        });
        return;
      }
      next();
    });
  };

  const assertAdmin = async (user: VerifiedTokenPayload, idToken: string): Promise<boolean> => {
    if (!user.emailVerified) return false;
    if (user.isBootstrappedOwner) return true;
    try {
      const adminDoc = await backend.getDoc(`admins/${user.uid}`, idToken);
      return adminDoc !== null;
    } catch {
      return false;
    }
  };

  const handleError = (
    res: Response,
    err: unknown,
    fallback: string,
    label: string
  ): void => {
    if (err instanceof FirestoreRestError) {
      console.error(`[LCE Business][${label}] Firestore ${err.status} ${err.code}: ${err.message}`);
      if (err.code === 'ALREADY_EXISTS' || err.code === 'FAILED_PRECONDITION') {
        res.status(409).json({
          error: 'Operação recusada por duplicidade ou estado desatualizado.',
          code: err.code,
        });
        return;
      }
      if (err.code === 'PERMISSION_DENIED' || err.status === 403) {
        res.status(403).json({
          error: 'Operação recusada pelas regras de segurança do servidor.',
          code: err.code,
        });
        return;
      }
      res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
        error: err.message || fallback,
        code: err.code,
      });
      return;
    }
    const message = err instanceof Error ? err.message : fallback;
    console.error(`[LCE Business][${label}] Unexpected error: ${message}`);
    res.status(500).json({ error: message });
  };

  const resolveLocationsCatalog = async (idToken: string): Promise<BusinessLocation[]> => {
    const merged = new Map<string, BusinessLocation>();
    for (const loc of DEFAULT_BUSINESS_LOCATIONS) {
      merged.set(loc.id, { ...loc });
    }
    try {
      const stored = await backend.queryByField(
        'business_locations',
        'isCatalogLocation',
        'EQUAL',
        true,
        idToken,
        100
      );
      for (const row of stored) {
        const d = row.data;
        const tpl = strField(d, 'templateType', 'supermercado') as BusinessTemplateType;
        if (!VALID_TEMPLATES.has(tpl)) continue;
        merged.set(row.id, {
          id: row.id,
          templateType: tpl,
          name: strField(d, 'name', row.id),
          category: strField(d, 'category', 'Comércio'),
          description: strField(d, 'description', ''),
          acquisitionPrice: numField(d, 'acquisitionPrice', 600),
          initialCapital: numField(d, 'initialCapital', 200),
          operatingExpense: numField(d, 'operatingExpense', 80),
          maxEmployees: numField(d, 'maxEmployees', 6),
          revenuePotential: numField(d, 'revenuePotential', 700),
          minPriceMultiplier: numField(d, 'minPriceMultiplier', 1.05),
          maxPriceMultiplier: numField(d, 'maxPriceMultiplier', 2.5),
          locationLabel: strField(d, 'locationLabel', 'Distrito Central'),
          posX: numField(d, 'posX', 0),
          posZ: numField(d, 'posZ', 0),
          available: boolField(d, 'available', true),
          isCatalogLocation: true,
          updatedBy: strField(d, 'updatedBy', ''),
          updatedAt: strField(d, 'updatedAt', ''),
        });
      }
    } catch {
      // Fallback safely to default catalog when business_locations is unseeded
    }
    return Array.from(merged.values());
  };

  const resolveSingleLocation = async (
    locationId: string,
    idToken: string
  ): Promise<BusinessLocation | null> => {
    const stored = await backend.getDoc(`business_locations/${locationId}`, idToken).catch(() => null);
    if (stored) {
      const tpl = strField(stored, 'templateType', 'supermercado') as BusinessTemplateType;
      return {
        id: locationId,
        templateType: VALID_TEMPLATES.has(tpl) ? tpl : 'supermercado',
        name: strField(stored, 'name', locationId),
        category: strField(stored, 'category', 'Comércio'),
        description: strField(stored, 'description', ''),
        acquisitionPrice: numField(stored, 'acquisitionPrice', 600),
        initialCapital: numField(stored, 'initialCapital', 200),
        operatingExpense: numField(stored, 'operatingExpense', 80),
        maxEmployees: numField(stored, 'maxEmployees', 6),
        revenuePotential: numField(stored, 'revenuePotential', 700),
        minPriceMultiplier: numField(stored, 'minPriceMultiplier', 1.05),
        maxPriceMultiplier: numField(stored, 'maxPriceMultiplier', 2.5),
        locationLabel: strField(stored, 'locationLabel', 'Distrito Central'),
        posX: numField(stored, 'posX', 0),
        posZ: numField(stored, 'posZ', 0),
        available: boolField(stored, 'available', true),
        isCatalogLocation: true,
      };
    }
    return DEFAULT_BUSINESS_LOCATIONS_MAP[locationId] ?? null;
  };

  // =========================================================================
  // 1. PUBLIC MARKET SNAPSHOT (10 Catalog Locations, Player Businesses, Open Vacancies)
  // =========================================================================
  app.get('/api/businesses/public', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const idToken = req.rawIdToken!;
    try {
      const [locations, businessesDocs, vacancyDocs] = await Promise.all([
        resolveLocationsCatalog(idToken),
        backend.listCollection('businesses', idToken, 100),
        backend.queryByField('business_vacancies', 'status', 'EQUAL', 'open', idToken, 100),
      ]);

      res.json({
        locations,
        businesses: businessesDocs.map((d) => ({ ...d.data, id: d.id })),
        vacancies: vacancyDocs.map((d) => ({ ...d.data, id: d.id })),
      });
    } catch (err) {
      handleError(res, err, 'Erro ao consultar o mercado empresarial.', 'public');
    }
  });

  // =========================================================================
  // 2. INDIVIDUAL BUSINESS DASHBOARD (Strictly Owner/Admin for Finances & Full Ledger)
  // =========================================================================
  app.get(
    '/api/businesses/:businessId/dashboard',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'Identificador de empresa inválido.' });
        return;
      }

      try {
        const business = await backend.getDoc(`businesses/${businessId}`, idToken);
        if (!business) {
          res.status(404).json({ error: 'Empresa não encontrada no universo LCE.' });
          return;
        }

        const ownerUid = strField(business, 'ownerUid');
        const isOwner = ownerUid === user.uid;
        const isAdmin = isOwner ? false : await assertAdmin(user, idToken);
        const canSeeFinances = isOwner || isAdmin;

        const [vacanciesDocs, productsDocs, inventoryDocs, reviewsDocs] = await Promise.all([
          backend.queryByField('business_vacancies', 'businessId', 'EQUAL', businessId, idToken, 100),
          backend.queryByField('business_products', 'businessId', 'EQUAL', businessId, idToken, 100),
          backend.queryByField('business_inventory', 'businessId', 'EQUAL', businessId, idToken, 100),
          backend.queryByField('business_reviews', 'businessId', 'EQUAL', businessId, idToken, 100),
        ]);

        let finances: Record<string, unknown> | null = null;
        let employees: Record<string, unknown>[] = [];
        let applications: Record<string, unknown>[] = [];
        let transactions: Record<string, unknown>[] = [];
        let payroll: Record<string, unknown>[] = [];

        if (canSeeFinances) {
          const [finDoc, empDocs, appDocs, txDocs, payDocs] = await Promise.all([
            backend.getDoc(`business_finances/${businessId}`, idToken),
            isOwner
              ? backend.queryByField('business_employees', 'ownerUid', 'EQUAL', user.uid, idToken, 100)
              : backend.listCollection('business_employees', idToken, 100),
            isOwner
              ? backend.queryByField('business_applications', 'ownerUid', 'EQUAL', user.uid, idToken, 100)
              : backend.listCollection('business_applications', idToken, 100),
            isOwner
              ? backend.queryByField('business_transactions', 'ownerUid', 'EQUAL', user.uid, idToken, 100)
              : backend.listCollection('business_transactions', idToken, 100),
            isOwner
              ? backend.queryByField('business_payroll', 'ownerUid', 'EQUAL', user.uid, idToken, 100)
              : backend.listCollection('business_payroll', idToken, 100),
          ]);

          finances = finDoc;
          employees = empDocs
            .filter((d) => strField(d.data, 'businessId') === businessId)
            .map((d) => ({ ...d.data, id: d.id }));
          applications = appDocs
            .filter((d) => strField(d.data, 'businessId') === businessId)
            .map((d) => ({ ...d.data, id: d.id }));
          transactions = txDocs
            .filter((d) => strField(d.data, 'businessId') === businessId)
            .map((d): Record<string, unknown> => ({ ...d.data, id: d.id }))
            .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
          payroll = payDocs
            .filter((d) => strField(d.data, 'businessId') === businessId)
            .map((d): Record<string, unknown> => ({ ...d.data, id: d.id }))
            .sort((a, b) => String(b.paidAt ?? '').localeCompare(String(a.paidAt ?? '')));
        } else {
          // Citizen / Employee only receives their OWN contract, applications, and payroll receipts — NEVER company cash!
          const [myEmpDocs, myAppDocs, myPayDocs] = await Promise.all([
            backend.queryByField('business_employees', 'employeeUid', 'EQUAL', user.uid, idToken, 50),
            backend.queryByField('business_applications', 'applicantUid', 'EQUAL', user.uid, idToken, 50),
            backend.queryByField('business_payroll', 'employeeUid', 'EQUAL', user.uid, idToken, 50),
          ]);

          employees = myEmpDocs
            .filter((d) => strField(d.data, 'businessId') === businessId)
            .map((d) => ({ ...d.data, id: d.id }));
          applications = myAppDocs
            .filter((d) => strField(d.data, 'businessId') === businessId)
            .map((d) => ({ ...d.data, id: d.id }));
          payroll = myPayDocs
            .filter((d) => strField(d.data, 'businessId') === businessId)
            .map((d): Record<string, unknown> => ({ ...d.data, id: d.id }))
            .sort((a, b) => String(b.paidAt ?? '').localeCompare(String(a.paidAt ?? '')));
        }

        const isEmployee = employees.some(
          (e) => strField(e, 'employeeUid') === user.uid && strField(e, 'status') === 'active'
        );

        res.json({
          business: { ...business, id: businessId },
          isOwner,
          isEmployee,
          finances,
          vacancies: vacanciesDocs.map((d) => ({ ...d.data, id: d.id })),
          employees,
          applications,
          products: productsDocs.map((d) => ({ ...d.data, id: d.id })),
          inventory: inventoryDocs.map((d) => ({ ...d.data, id: d.id })),
          transactions,
          payroll,
          reviews: reviewsDocs
            .map((d): Record<string, unknown> => ({ ...d.data, id: d.id }))
            .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
        });
      } catch (err) {
        handleError(res, err, 'Erro ao carregar o painel da empresa.', 'dashboard');
      }
    }
  );

  // =========================================================================
  // 3. ACQUIRE / OPEN AN AVAILABLE ESTABLISHMENT FROM CATALOG
  // =========================================================================
  app.post('/api/businesses/acquire', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;
    const locationId = sanitizeId(req.body?.locationId);
    if (!locationId) {
      res.status(400).json({ error: 'Localização de empresa inválida.' });
      return;
    }

    const opId = makeOpId(req.body?.operationId, 'acq');
    const businessId = `biz_${locationId}`;

    try {
      const outcome = await withLock(`biz:${businessId}`, async () =>
        withLock(`user:${user.uid}`, async () => {
          const [location, existingBiz, profile, wallet, bank] = await Promise.all([
            resolveSingleLocation(locationId, idToken),
            backend.getDoc(`businesses/${businessId}`, idToken),
            backend.getDoc(`users/${user.uid}`, idToken),
            backend.getDoc(`wallets/${user.uid}`, idToken),
            backend.getDoc(`bank_accounts/${user.uid}`, idToken),
          ]);

          if (!location) {
            return { status: 404 as const, error: 'Estabelecimento não encontrado no catálogo oficial.' };
          }
          if (!location.available) {
            return { status: 409 as const, error: 'Este estabelecimento não está disponível para abertura.' };
          }
          if (existingBiz) {
            return {
              status: 409 as const,
              error: 'Este estabelecimento já pertence a um jogador. Verifique se está à venda no mercado P2P.',
            };
          }
          if (!profile || !wallet || !bank) {
            return {
              status: 404 as const,
              error: 'Perfil, carteira ou conta bancária não inicializados.',
            };
          }
          if (strField(bank, 'status', 'active') !== 'active') {
            return { status: 403 as const, error: 'Sua conta bancária está congelada.' };
          }

          const price = round2(location.acquisitionPrice);
          const bankBalance = numField(bank, 'balance', 0);
          if (bankBalance < price) {
            return {
              status: 400 as const,
              error: `Saldo bancário insuficiente. Necessário R$ ${price.toFixed(2)}, disponível R$ ${bankBalance.toFixed(2)}.`,
            };
          }

          const customName = sanitizeText(req.body?.customName, location.name, 3, 64);
          const ownerName = strField(profile, 'characterName', 'Cidadão LCE');
          const ownerAlias = strField(profile, 'alias', 'cidadao');
          const newBankBalance = round2(bankBalance - price);
          const newCompaniesValue = round2(numField(wallet, 'companiesValue', 0) + price);
          const initialCash = round2(location.initialCapital);

          const bankTxId = `bpur_${opId}`;
          const bizTxId = `btx_acq_${opId}`;

          const writes: FirestoreCommitWrite[] = [
            {
              path: `transactions/${bankTxId}`,
              fields: {
                id: bankTxId,
                operationId: opId,
                type: 'business_purchase',
                currencyCategory: 'bank',
                amount: price,
                fromUid: user.uid,
                fromLabel: clampStr(ownerName, 64, 'Cidadão LCE'),
                toUid: 'city_treasury',
                toLabel: clampStr(`Registro Empresarial · ${customName}`, 64, 'Registro Empresarial'),
                actorUid: user.uid,
                participants: [user.uid],
                description: clampStr(`Aquisição empresarial: ${customName} (${location.category})`, 180),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `bank_accounts/${user.uid}`,
              fields: {
                balance: newBankBalance,
                lastTxId: bankTxId,
              },
              updateMask: ['balance', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `wallets/${user.uid}`,
              fields: {
                companiesValue: newCompaniesValue,
                lastTxId: bankTxId,
              },
              updateMask: ['companiesValue', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `businesses/${businessId}`,
              fields: {
                id: businessId,
                locationId: location.id,
                templateType: location.templateType,
                name: customName,
                category: location.category,
                description: location.description,
                ownerUid: user.uid,
                ownerName,
                ownerAlias,
                status: 'active',
                acquisitionPrice: price,
                marketValue: price,
                operatingExpense: round2(location.operatingExpense),
                maxEmployees: location.maxEmployees,
                growthLevel: 1,
                employeeCount: 0,
                reputation: 60,
                reputationCount: 0,
                forSale: false,
                salePrice: 0,
                locationLabel: location.locationLabel,
                posX: location.posX,
                posZ: location.posZ,
                lastTxId: bankTxId,
              },
              transforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            },
            {
              path: `business_finances/${businessId}`,
              fields: {
                businessId,
                ownerUid: user.uid,
                cashBalance: initialCash,
                totalRevenue: 0,
                totalExpenses: 0,
                totalPayrollPaid: 0,
                netProfit: 0,
                lastTxId: bizTxId,
              },
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `business_transactions/${bizTxId}`,
              fields: {
                id: bizTxId,
                operationId: opId,
                businessId,
                ownerUid: user.uid,
                actorUid: user.uid,
                type: 'acquisition',
                direction: 'in',
                amount: initialCash > 0 ? initialCash : price,
                description: clampStr(`Abertura e capital inicial de ${customName}`, 180),
                counterpartyUid: user.uid,
                counterpartyLabel: clampStr(ownerName, 64, 'Cidadão LCE'),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ];

          await backend.commit(writes, idToken);

          // Seed 2 starter products + inventory slots in a lightweight follow-up owner commit
          const starterTemplates = DEFAULT_PRODUCTS_BY_TYPE[location.templateType] ?? [];
          if (starterTemplates.length > 0) {
            const productWrites: FirestoreCommitWrite[] = [];
            for (let i = 0; i < starterTemplates.length; i++) {
              const tpl = starterTemplates[i];
              const productId = `prod_${location.id}_${i + 1}`;
              const minAllowed = round2(tpl.unitCost * location.minPriceMultiplier);
              const maxAllowed = round2(tpl.unitCost * location.maxPriceMultiplier);
              const salePrice = Math.min(maxAllowed, Math.max(minAllowed, round2(tpl.salePrice)));
              const marginPercent = round2(((salePrice - tpl.unitCost) / tpl.unitCost) * 100);

              productWrites.push({
                path: `business_products/${productId}`,
                fields: {
                  id: productId,
                  businessId,
                  ownerUid: user.uid,
                  name: tpl.name,
                  sku: tpl.sku,
                  category: tpl.category,
                  unitCost: tpl.unitCost,
                  salePrice,
                  minAllowedPrice: minAllowed,
                  maxAllowedPrice: maxAllowed,
                  marginPercent,
                  active: true,
                },
                transforms: [
                  { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                  { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
                precondition: { exists: false },
              });
              productWrites.push({
                path: `business_inventory/${productId}`,
                fields: {
                  id: productId,
                  businessId,
                  ownerUid: user.uid,
                  productName: tpl.name,
                  quantity: 0,
                  unitCost: tpl.unitCost,
                  salePrice,
                  lastMovementType: 'init',
                  lastMovementQty: 0,
                },
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              });
            }
            await backend.commit(productWrites, idToken).catch(() => {
              // Non-fatal if starter products already exist
            });
          }

          return {
            status: 201 as const,
            data: {
              businessId,
              name: customName,
              ownerUid: user.uid,
              acquisitionPrice: price,
              initialCapital: initialCash,
              newBankBalance,
              transactionId: bankTxId,
            },
          };
        })
      );

      if ('error' in outcome) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.status(outcome.status).json(outcome.data);
    } catch (err) {
      handleError(res, err, 'Erro ao adquirir estabelecimento.', 'acquire');
    }
  });

  // =========================================================================
  // 4. LIST / UNLIST BUSINESS FOR P2P SALE (Owner Only)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/listing',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'ID de empresa inválido.' });
        return;
      }

      const forSale = req.body?.forSale === true;
      const salePrice = forSale ? parsePositiveMoney(req.body?.salePrice, 50, 500_000_000) : 0;
      if (forSale && salePrice === null) {
        res.status(400).json({ error: 'Informe um preço de venda válido (mínimo R$ 50,00).' });
        return;
      }

      try {
        const business = await backend.getDoc(`businesses/${businessId}`, idToken);
        if (!business) {
          res.status(404).json({ error: 'Empresa não encontrada.' });
          return;
        }
        if (strField(business, 'ownerUid') !== user.uid) {
          res.status(403).json({ error: 'Apenas o proprietário pode anunciar ou retirar a empresa da venda.' });
          return;
        }
        if (strField(business, 'status') === 'suspended') {
          res.status(403).json({ error: 'Empresas suspensas não podem ser anunciadas para venda.' });
          return;
        }

        await backend.commit(
          [
            {
              path: `businesses/${businessId}`,
              fields: {
                forSale,
                salePrice: forSale ? (salePrice as number) : 0,
              },
              updateMask: ['forSale', 'salePrice'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
          idToken
        );

        res.json({ businessId, forSale, salePrice: forSale ? salePrice : 0 });
      } catch (err) {
        handleError(res, err, 'Erro ao atualizar anúncio de venda da empresa.', 'listing');
      }
    }
  );

  // =========================================================================
  // 5. P2P BUY PLAYER-OWNED BUSINESS (Atomic Ownership & Bank Transfer)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/buy-from-owner',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'ID de empresa inválido.' });
        return;
      }

      const opId = makeOpId(req.body?.operationId, 'p2p');

      try {
        const outcome = await withLock(`biz:${businessId}`, async () =>
          withLock(`user:${user.uid}`, async () => {
            const [business, buyerProfile, buyerWallet, buyerBank] = await Promise.all([
              backend.getDoc(`businesses/${businessId}`, idToken),
              backend.getDoc(`users/${user.uid}`, idToken),
              backend.getDoc(`wallets/${user.uid}`, idToken),
              backend.getDoc(`bank_accounts/${user.uid}`, idToken),
            ]);

            if (!business) {
              return { status: 404 as const, error: 'Empresa não encontrada.' };
            }
            const sellerUid = strField(business, 'ownerUid');
            if (sellerUid === user.uid) {
              return { status: 400 as const, error: 'Você já é o proprietário desta empresa.' };
            }
            if (!boolField(business, 'forSale', false)) {
              return { status: 409 as const, error: 'Esta empresa não está à venda no momento.' };
            }
            if (strField(business, 'status') === 'suspended') {
              return { status: 403 as const, error: 'Empresa suspensa pela administração.' };
            }

            const salePrice = round2(numField(business, 'salePrice', 0));
            if (salePrice < 50) {
              return { status: 400 as const, error: 'Valor de venda inválido.' };
            }
            if (!buyerProfile || !buyerWallet || !buyerBank) {
              return { status: 404 as const, error: 'Conta bancária ou perfil não inicializados.' };
            }
            if (strField(buyerBank, 'status', 'active') !== 'active') {
              return { status: 403 as const, error: 'Sua conta bancária está congelada.' };
            }

            const buyerBalance = numField(buyerBank, 'balance', 0);
            if (buyerBalance < salePrice) {
              return {
                status: 400 as const,
                error: `Saldo bancário insuficiente. Necessário R$ ${salePrice.toFixed(2)}.`,
              };
            }

            const buyerName = strField(buyerProfile, 'characterName', 'Cidadão LCE');
            const buyerAlias = strField(buyerProfile, 'alias', 'cidadao');
            const sellerName = strField(business, 'ownerName', 'Ex-Proprietário');
            const bizName = strField(business, 'name', businessId);
            const newBuyerBalance = round2(buyerBalance - salePrice);
            const newCompaniesValue = round2(numField(buyerWallet, 'companiesValue', 0) + salePrice);
            const nextMarketValue = Math.max(round2(numField(business, 'marketValue', salePrice)), salePrice);

            const bankTxId = `bsale_${opId}`;
            const bizTxId = `btx_p2p_${opId}`;

            const writes: FirestoreCommitWrite[] = [
              {
                path: `transactions/${bankTxId}`,
                fields: {
                  id: bankTxId,
                  operationId: businessId,
                  type: 'business_sale',
                  currencyCategory: 'bank',
                  amount: salePrice,
                  fromUid: user.uid,
                  fromLabel: clampStr(buyerName, 64, 'Comprador LCE'),
                  toUid: sellerUid,
                  toLabel: clampStr(sellerName, 64, 'Vendedor LCE'),
                  actorUid: user.uid,
                  participants: [user.uid, sellerUid],
                  description: clampStr(`Compra P2P da empresa ${bizName}`, 180),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `bank_accounts/${user.uid}`,
                fields: {
                  balance: newBuyerBalance,
                  lastTxId: bankTxId,
                },
                updateMask: ['balance', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `bank_accounts/${sellerUid}`,
                fields: {
                  lastTxId: bankTxId,
                },
                updateMask: ['lastTxId'],
                transforms: [
                  { fieldPath: 'balance', increment: toFsNumber(salePrice) },
                  { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
                ],
              },
              {
                path: `wallets/${user.uid}`,
                fields: {
                  companiesValue: newCompaniesValue,
                  lastTxId: bankTxId,
                },
                updateMask: ['companiesValue', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `businesses/${businessId}`,
                fields: {
                  ownerUid: user.uid,
                  ownerName: buyerName,
                  ownerAlias: buyerAlias,
                  forSale: false,
                  salePrice: 0,
                  marketValue: nextMarketValue,
                  lastTxId: bankTxId,
                },
                updateMask: [
                  'ownerUid',
                  'ownerName',
                  'ownerAlias',
                  'forSale',
                  'salePrice',
                  'marketValue',
                  'lastTxId',
                ],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `business_finances/${businessId}`,
                fields: {
                  ownerUid: user.uid,
                },
                updateMask: ['ownerUid'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `business_transactions/${bizTxId}`,
                fields: {
                  id: bizTxId,
                  operationId: opId,
                  businessId,
                  ownerUid: user.uid,
                  actorUid: user.uid,
                  type: 'p2p_sale',
                  direction: 'in',
                  amount: salePrice,
                  description: clampStr(`Transferência societária de ${sellerName} para ${buyerName}`, 180),
                  counterpartyUid: sellerUid,
                  counterpartyLabel: clampStr(sellerName, 64, 'Vendedor LCE'),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
            ];

            await backend.commit(writes, idToken);

            // Transfer ownership on inherited public sub-resources (products, inventory, vacancies)
            const [prodDocs, invDocs, vacDocs] = await Promise.all([
              backend.queryByField('business_products', 'businessId', 'EQUAL', businessId, idToken, 50),
              backend.queryByField('business_inventory', 'businessId', 'EQUAL', businessId, idToken, 50),
              backend.queryByField('business_vacancies', 'businessId', 'EQUAL', businessId, idToken, 50),
            ]);
            const syncWrites: FirestoreCommitWrite[] = [];
            for (const p of prodDocs) {
              syncWrites.push({
                path: `business_products/${p.id}`,
                fields: { ownerUid: user.uid },
                updateMask: ['ownerUid'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              });
            }
            for (const inv of invDocs) {
              syncWrites.push({
                path: `business_inventory/${inv.id}`,
                fields: { ownerUid: user.uid },
                updateMask: ['ownerUid'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              });
            }
            for (const v of vacDocs) {
              syncWrites.push({
                path: `business_vacancies/${v.id}`,
                fields: { ownerUid: user.uid },
                updateMask: ['ownerUid'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              });
            }
            if (syncWrites.length > 0) {
              await backend.commit(syncWrites, idToken).catch(() => {});
            }

            return {
              status: 200 as const,
              data: {
                businessId,
                newOwnerUid: user.uid,
                previousOwnerUid: sellerUid,
                salePrice,
                newBuyerBalance,
                transactionId: bankTxId,
              },
            };
          })
        );

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao concluir compra P2P da empresa.', 'buy-from-owner');
      }
    }
  );

  // =========================================================================
  // 6. CAPITAL INJECTION / PROFIT WITHDRAWAL (Strictly Owner Only — Employees Blocked!)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/capital',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const direction = req.body?.direction;
      const amount = parsePositiveMoney(req.body?.amount, 1, 100_000_000);

      if (!businessId || (direction !== 'inject' && direction !== 'withdraw') || amount === null) {
        res.status(400).json({ error: 'Parâmetros de movimentação de caixa inválidos.' });
        return;
      }

      const opId = makeOpId(req.body?.operationId, 'cap');

      try {
        const outcome = await withLock(`biz:${businessId}`, async () =>
          withLock(`user:${user.uid}`, async () => {
            const business = await backend.getDoc(`businesses/${businessId}`, idToken);
            if (!business) {
              return { status: 404 as const, error: 'Empresa não encontrada.' };
            }
            if (strField(business, 'ownerUid') !== user.uid) {
              return {
                status: 403 as const,
                error: 'Acesso negado: apenas o proprietário pode movimentar o caixa da empresa.',
              };
            }
            if (strField(business, 'status') === 'suspended') {
              return { status: 403 as const, error: 'Empresa suspensa pela administração.' };
            }

            const [finances, bank, profile] = await Promise.all([
              backend.getDoc(`business_finances/${businessId}`, idToken),
              backend.getDoc(`bank_accounts/${user.uid}`, idToken),
              backend.getDoc(`users/${user.uid}`, idToken),
            ]);

            if (!finances || !bank) {
              return { status: 404 as const, error: 'Registros financeiros não encontrados.' };
            }
            if (strField(bank, 'status', 'active') !== 'active') {
              return { status: 403 as const, error: 'Conta bancária congelada.' };
            }

            const ownerName = strField(profile, 'characterName', strField(business, 'ownerName', 'Proprietário'));
            const bizName = strField(business, 'name', businessId);
            const currentCash = numField(finances, 'cashBalance', 0);
            const currentBank = numField(bank, 'balance', 0);

            if (direction === 'inject' && currentBank < amount) {
              return { status: 400 as const, error: 'Saldo bancário insuficiente para o aporte.' };
            }
            if (direction === 'withdraw' && currentCash < amount) {
              return { status: 400 as const, error: 'Caixa da empresa insuficiente para a retirada.' };
            }

            const nextCash = round2(direction === 'inject' ? currentCash + amount : currentCash - amount);
            const nextBank = round2(direction === 'inject' ? currentBank - amount : currentBank + amount);

            const bankTxId = `bcap_${opId}`;
            const bizTxId = `btx_cap_${opId}`;

            const writes: FirestoreCommitWrite[] = [
              {
                path: `transactions/${bankTxId}`,
                fields: {
                  id: bankTxId,
                  operationId: businessId,
                  type: 'business_capital',
                  currencyCategory: 'bank',
                  amount,
                  fromUid: direction === 'inject' ? user.uid : businessId,
                  fromLabel: clampStr(direction === 'inject' ? ownerName : bizName, 64),
                  toUid: direction === 'inject' ? businessId : user.uid,
                  toLabel: clampStr(direction === 'inject' ? bizName : ownerName, 64),
                  actorUid: user.uid,
                  participants: [user.uid],
                  description: clampStr(
                    direction === 'inject'
                      ? `Aporte de capital em ${bizName}`
                      : `Retirada de caixa de ${bizName}`,
                    180
                  ),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `bank_accounts/${user.uid}`,
                fields: {
                  balance: nextBank,
                  lastTxId: bankTxId,
                },
                updateMask: ['balance', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `business_transactions/${bizTxId}`,
                fields: {
                  id: bizTxId,
                  operationId: opId,
                  businessId,
                  ownerUid: user.uid,
                  actorUid: user.uid,
                  type: direction === 'inject' ? 'capital_inject' : 'capital_withdraw',
                  direction: direction === 'inject' ? 'in' : 'out',
                  amount,
                  description: clampStr(
                    direction === 'inject'
                      ? `Aporte de capital do proprietário (${ownerName})`
                      : `Retirada de lucros para conta bancária (${ownerName})`,
                    180
                  ),
                  counterpartyUid: user.uid,
                  counterpartyLabel: clampStr(ownerName, 64),
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `business_finances/${businessId}`,
                fields: {
                  cashBalance: nextCash,
                  lastTxId: bizTxId,
                },
                updateMask: ['cashBalance', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
            ];

            // Automatically reactivate business if it was inactive due to funds and now covers operatingExpense
            let nextStatus = strField(business, 'status', 'active');
            if (
              direction === 'inject' &&
              nextStatus === 'inactive_funds' &&
              nextCash >= numField(business, 'operatingExpense', 0)
            ) {
              nextStatus = 'active';
              writes.push({
                path: `businesses/${businessId}`,
                fields: { status: 'active' },
                updateMask: ['status'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              });
            }

            await backend.commit(writes, idToken);

            return {
              status: 200 as const,
              data: {
                businessId,
                direction,
                amount,
                cashBalance: nextCash,
                bankBalance: nextBank,
                businessStatus: nextStatus,
                transactionId: bizTxId,
              },
            };
          })
        );

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao movimentar caixa da empresa.', 'capital');
      }
    }
  );

  // =========================================================================
  // 7. OPEN / UPDATE JOB VACANCIES (Owner Only)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/vacancies',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'ID de empresa inválido.' });
        return;
      }

      const roleTitle = sanitizeText(req.body?.roleTitle, '', 2, 48);
      const salary = parsePositiveMoney(req.body?.salary, 10, 1_000_000);
      const schedule = sanitizeText(req.body?.schedule, 'Turno Comercial (8h)', 2, 48);
      const requirements = sanitizeText(req.body?.requirements, 'Comprometimento e postura profissional.', 2, 160);
      const slots = parsePositiveInt(req.body?.slots, 1, 50);
      const description = sanitizeText(req.body?.description, 'Atuação operacional na unidade.', 4, 240);

      if (!roleTitle || salary === null || slots === null) {
        res.status(400).json({ error: 'Preencha cargo, salário (mínimo R$ 10) e quantidade de vagas.' });
        return;
      }

      try {
        const business = await backend.getDoc(`businesses/${businessId}`, idToken);
        if (!business) {
          res.status(404).json({ error: 'Empresa não encontrada.' });
          return;
        }
        if (strField(business, 'ownerUid') !== user.uid) {
          res.status(403).json({ error: 'Apenas o proprietário pode abrir vagas de emprego.' });
          return;
        }
        if (strField(business, 'status') === 'suspended') {
          res.status(403).json({ error: 'Empresas suspensas não podem publicar vagas.' });
          return;
        }

        const maxEmployees = numField(business, 'maxEmployees', 1);
        const employeeCount = numField(business, 'employeeCount', 0);
        if (employeeCount >= maxEmployees) {
          res.status(409).json({
            error: `Capacidade máxima de funcionários atingida (${employeeCount}/${maxEmployees}).`,
          });
          return;
        }

        const vacancyId = makeOpId(req.body?.vacancyId, 'vac');
        const bizName = strField(business, 'name', businessId);

        await backend.commit(
          [
            {
              path: `business_vacancies/${vacancyId}`,
              fields: {
                id: vacancyId,
                businessId,
                businessName: bizName,
                ownerUid: user.uid,
                roleTitle,
                salary,
                schedule,
                requirements,
                slots: Math.min(slots, Math.max(1, maxEmployees - employeeCount)),
                filledSlots: 0,
                description,
                status: 'open',
              },
              transforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.status(201).json({
          id: vacancyId,
          businessId,
          businessName: bizName,
          roleTitle,
          salary,
          schedule,
          requirements,
          slots: Math.min(slots, Math.max(1, maxEmployees - employeeCount)),
          filledSlots: 0,
          description,
          status: 'open',
        });
      } catch (err) {
        handleError(res, err, 'Erro ao publicar vaga de emprego.', 'create-vacancy');
      }
    }
  );

  app.put(
    '/api/businesses/:businessId/vacancies/:vacancyId',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const vacancyId = sanitizeId(req.params.vacancyId);
      if (!businessId || !vacancyId) {
        res.status(400).json({ error: 'Identificadores inválidos.' });
        return;
      }

      try {
        const vacancy = await backend.getDoc(`business_vacancies/${vacancyId}`, idToken);
        if (!vacancy || strField(vacancy, 'businessId') !== businessId) {
          res.status(404).json({ error: 'Vaga não encontrada.' });
          return;
        }
        if (strField(vacancy, 'ownerUid') !== user.uid) {
          res.status(403).json({ error: 'Apenas o proprietário pode editar ou encerrar esta vaga.' });
          return;
        }

        const nextStatus = req.body?.status === 'closed' ? 'closed' : 'open';
        const nextSalary =
          req.body?.salary !== undefined
            ? parsePositiveMoney(req.body.salary, 10, 1_000_000) ?? numField(vacancy, 'salary', 100)
            : numField(vacancy, 'salary', 100);

        await backend.commit(
          [
            {
              path: `business_vacancies/${vacancyId}`,
              fields: {
                status: nextStatus,
                salary: nextSalary,
              },
              updateMask: ['status', 'salary'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
          idToken
        );

        res.json({ id: vacancyId, status: nextStatus, salary: nextSalary });
      } catch (err) {
        handleError(res, err, 'Erro ao atualizar vaga.', 'update-vacancy');
      }
    }
  );

  // =========================================================================
  // 8. APPLY TO A VACANCY (Non-Owner Citizen)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/apply',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const vacancyId = sanitizeId(req.body?.vacancyId);
      if (!businessId || !vacancyId) {
        res.status(400).json({ error: 'Empresa ou vaga inválida.' });
        return;
      }

      const coverNote = sanitizeText(
        req.body?.coverNote,
        'Tenho disponibilidade imediata e experiência no Distrito Central.',
        2,
        200
      );

      try {
        const [business, vacancy, profile, existingContract] = await Promise.all([
          backend.getDoc(`businesses/${businessId}`, idToken),
          backend.getDoc(`business_vacancies/${vacancyId}`, idToken),
          backend.getDoc(`users/${user.uid}`, idToken),
          backend.getDoc(`business_employees/emp_${businessId}_${user.uid}`, idToken),
        ]);

        if (!business || !vacancy || strField(vacancy, 'businessId') !== businessId) {
          res.status(404).json({ error: 'Vaga ou empresa não encontrada.' });
          return;
        }
        const ownerUid = strField(business, 'ownerUid');
        if (ownerUid === user.uid) {
          res.status(400).json({ error: 'O proprietário não pode se candidatar à própria empresa.' });
          return;
        }
        if (strField(vacancy, 'status') !== 'open') {
          res.status(409).json({ error: 'Esta vaga não está mais aberta.' });
          return;
        }
        if (numField(vacancy, 'filledSlots', 0) >= numField(vacancy, 'slots', 1)) {
          res.status(409).json({ error: 'Todas as posições desta vaga já foram preenchidas.' });
          return;
        }
        if (existingContract && strField(existingContract, 'status') === 'active') {
          res.status(409).json({ error: 'Você já possui vínculo ativo nesta empresa.' });
          return;
        }

        const appId = `app_${vacancyId}_${user.uid}`;
        const existingApp = await backend.getDoc(`business_applications/${appId}`, idToken);
        if (existingApp && ['pending', 'offer_sent', 'hired'].includes(strField(existingApp, 'status'))) {
          res.status(409).json({ error: 'Você já enviou uma candidatura ativa para esta vaga.' });
          return;
        }

        const applicantName = strField(profile, 'characterName', 'Cidadão LCE');
        const applicantAlias = strField(profile, 'alias', 'cidadao');
        const finalAppId = existingApp ? `${appId}_${crypto.randomUUID().slice(0, 6)}` : appId;

        await backend.commit(
          [
            {
              path: `business_applications/${finalAppId}`,
              fields: {
                id: finalAppId,
                businessId,
                businessName: strField(business, 'name', businessId),
                ownerUid,
                vacancyId,
                applicantUid: user.uid,
                applicantName,
                applicantAlias,
                roleTitle: strField(vacancy, 'roleTitle', 'Colaborador'),
                offeredSalary: numField(vacancy, 'salary', 100),
                schedule: strField(vacancy, 'schedule', 'Turno Comercial'),
                coverNote,
                status: 'pending',
              },
              transforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.status(201).json({
          id: finalAppId,
          businessId,
          vacancyId,
          applicantUid: user.uid,
          status: 'pending',
        });
      } catch (err) {
        handleError(res, err, 'Erro ao enviar candidatura.', 'apply');
      }
    }
  );

  // =========================================================================
  // 9. APPLICATION DECISION (Owner: send_offer / hire / reject; Applicant: accept_offer / decline_offer / withdraw)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/applications/:appId/decision',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const appId = sanitizeId(req.params.appId);
      const action = strField(req.body as Record<string, unknown>, 'action');

      if (
        !businessId ||
        !appId ||
        !['send_offer', 'hire', 'reject', 'accept_offer', 'decline_offer', 'withdraw'].includes(action)
      ) {
        res.status(400).json({ error: 'Ação de candidatura inválida.' });
        return;
      }

      try {
        const outcome = await withLock(`biz:${businessId}`, async () => {
          const [business, appDoc] = await Promise.all([
            backend.getDoc(`businesses/${businessId}`, idToken),
            backend.getDoc(`business_applications/${appId}`, idToken),
          ]);

          if (!business || !appDoc || strField(appDoc, 'businessId') !== businessId) {
            return { status: 404 as const, error: 'Candidatura ou empresa não encontrada.' };
          }

          const ownerUid = strField(business, 'ownerUid');
          const applicantUid = strField(appDoc, 'applicantUid');
          const currentStatus = strField(appDoc, 'status');
          const isOwner = ownerUid === user.uid;
          const isApplicant = applicantUid === user.uid;

          if (['send_offer', 'hire', 'reject'].includes(action)) {
            if (!isOwner) {
              return { status: 403 as const, error: 'Apenas o proprietário pode avaliar candidaturas.' };
            }
            if (!['pending', 'offer_sent'].includes(currentStatus)) {
              return { status: 409 as const, error: 'Esta candidatura já foi finalizada.' };
            }
          } else {
            if (!isApplicant) {
              return { status: 403 as const, error: 'Apenas o candidato pode responder à proposta.' };
            }
            if (action === 'withdraw' && currentStatus !== 'pending') {
              return { status: 409 as const, error: 'Só é possível cancelar candidaturas pendentes.' };
            }
            if ((action === 'accept_offer' || action === 'decline_offer') && currentStatus !== 'offer_sent') {
              return { status: 409 as const, error: 'Não há proposta pendente para responder.' };
            }
          }

          // Non-hiring transitions
          if (action === 'reject' || action === 'decline_offer' || action === 'withdraw' || action === 'send_offer') {
            const nextStatus =
              action === 'send_offer'
                ? 'offer_sent'
                : action === 'reject'
                ? 'rejected'
                : action === 'decline_offer'
                ? 'declined'
                : 'withdrawn';

            const updateFields: Record<string, unknown> = { status: nextStatus };
            const mask = ['status'];

            if (action === 'send_offer') {
              const customSalary = parsePositiveMoney(req.body?.offeredSalary, 10, 1_000_000);
              if (customSalary !== null) {
                updateFields.offeredSalary = customSalary;
                mask.push('offeredSalary');
              }
              if (typeof req.body?.roleTitle === 'string' && req.body.roleTitle.trim().length >= 2) {
                updateFields.roleTitle = sanitizeText(req.body.roleTitle, strField(appDoc, 'roleTitle'), 2, 48);
                mask.push('roleTitle');
              }
            }

            await backend.commit(
              [
                {
                  path: `business_applications/${appId}`,
                  fields: updateFields,
                  updateMask: mask,
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                },
              ],
              idToken
            );

            return { status: 200 as const, data: { applicationId: appId, status: nextStatus } };
          }

          // Hiring transition ('hire' by owner OR 'accept_offer' by applicant)
          if (strField(business, 'status') === 'suspended') {
            return { status: 403 as const, error: 'Empresa suspensa não pode contratar funcionários.' };
          }
          const employeeCount = numField(business, 'employeeCount', 0);
          const maxEmployees = numField(business, 'maxEmployees', 1);
          if (employeeCount >= maxEmployees) {
            return { status: 409 as const, error: 'Limite máximo de funcionários atingido.' };
          }

          const vacancyId = strField(appDoc, 'vacancyId');
          const contractId = `emp_${businessId}_${applicantUid}`;
          const [vacancyDoc, existingContract] = await Promise.all([
            backend.getDoc(`business_vacancies/${vacancyId}`, idToken),
            backend.getDoc(`business_employees/${contractId}`, idToken),
          ]);

          if (existingContract && strField(existingContract, 'status') === 'active') {
            return { status: 409 as const, error: 'Este jogador já é funcionário ativo desta empresa.' };
          }

          const agreedSalary =
            isOwner && req.body?.offeredSalary !== undefined
              ? parsePositiveMoney(req.body.offeredSalary, 10, 1_000_000) ?? numField(appDoc, 'offeredSalary', 100)
              : numField(appDoc, 'offeredSalary', 100);
          const agreedRole =
            isOwner && typeof req.body?.roleTitle === 'string' && req.body.roleTitle.trim().length >= 2
              ? sanitizeText(req.body.roleTitle, strField(appDoc, 'roleTitle', 'Colaborador'), 2, 48)
              : strField(appDoc, 'roleTitle', 'Colaborador');
          const agreedSchedule = strField(appDoc, 'schedule', 'Turno Comercial');
          const nextPaymentIso = new Date(nowFn() + 24 * 60 * 60 * 1000).toISOString();

          const writes: FirestoreCommitWrite[] = [
            {
              path: `business_applications/${appId}`,
              fields: {
                status: 'hired',
                offeredSalary: agreedSalary,
                roleTitle: agreedRole,
              },
              updateMask: ['status', 'offeredSalary', 'roleTitle'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ];

          if (existingContract) {
            // Reactivate previously terminated/resigned contract (owner only)
            if (!isOwner) {
              return { status: 403 as const, error: 'A recontratação deve ser efetivada pelo proprietário.' };
            }
            writes.push({
              path: `business_employees/${contractId}`,
              fields: {
                vacancyId,
                roleTitle: agreedRole,
                salary: agreedSalary,
                schedule: agreedSchedule,
                status: 'active',
                nextPaymentAt: { __timestamp: nextPaymentIso },
              },
              updateMask: ['vacancyId', 'roleTitle', 'salary', 'schedule', 'status', 'nextPaymentAt'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            });
          } else {
            writes.push({
              path: `business_employees/${contractId}`,
              fields: {
                id: contractId,
                businessId,
                businessName: strField(business, 'name', businessId),
                ownerUid,
                employeeUid: applicantUid,
                employeeName: strField(appDoc, 'applicantName', 'Cidadão LCE'),
                employeeAlias: strField(appDoc, 'applicantAlias', 'cidadao'),
                vacancyId,
                roleTitle: agreedRole,
                salary: agreedSalary,
                schedule: agreedSchedule,
                status: 'active',
                nextPaymentAt: { __timestamp: nextPaymentIso },
                totalPaid: 0,
                paymentsCount: 0,
              },
              transforms: [
                { fieldPath: 'hiredAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            });
          }

          if (isOwner) {
            const nextRep = Math.min(100, numField(business, 'reputation', 60) + 3);
            writes.push({
              path: `businesses/${businessId}`,
              fields: {
                employeeCount: employeeCount + 1,
                reputation: nextRep,
              },
              updateMask: ['employeeCount', 'reputation'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            });
          } else {
            // Applicant accepting offer updates ONLY employeeCount & updatedAt per security rule
            writes.push({
              path: `businesses/${businessId}`,
              fields: {
                employeeCount: employeeCount + 1,
              },
              updateMask: ['employeeCount'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            });
          }

          if (vacancyDoc) {
            const slots = numField(vacancyDoc, 'slots', 1);
            const nextFilled = Math.min(slots, numField(vacancyDoc, 'filledSlots', 0) + 1);
            writes.push({
              path: `business_vacancies/${vacancyId}`,
              fields: {
                filledSlots: nextFilled,
                status: nextFilled >= slots ? 'closed' : strField(vacancyDoc, 'status', 'open'),
              },
              updateMask: ['filledSlots', 'status'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            });
          }

          await backend.commit(writes, idToken);

          return {
            status: 200 as const,
            data: {
              applicationId: appId,
              contractId,
              status: 'hired',
              employeeUid: applicantUid,
              roleTitle: agreedRole,
              salary: agreedSalary,
              employeeCount: employeeCount + 1,
            },
          };
        });

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao processar decisão de candidatura.', 'application-decision');
      }
    }
  );

  // =========================================================================
  // 10. MANAGE EMPLOYEE CONTRACT (Owner: update/promote/terminate; Employee: resign ONLY)
  // =========================================================================
  app.put(
    '/api/businesses/:businessId/employees/:contractId',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const contractId = sanitizeId(req.params.contractId);
      const action = strField(req.body as Record<string, unknown>, 'action', 'update');

      if (!businessId || !contractId || !['update', 'terminate', 'resign'].includes(action)) {
        res.status(400).json({ error: 'Ação de contrato inválida.' });
        return;
      }

      try {
        const outcome = await withLock(`biz:${businessId}`, async () => {
          const [business, contract] = await Promise.all([
            backend.getDoc(`businesses/${businessId}`, idToken),
            backend.getDoc(`business_employees/${contractId}`, idToken),
          ]);

          if (!business || !contract || strField(contract, 'businessId') !== businessId) {
            return { status: 404 as const, error: 'Contrato de funcionário não encontrado.' };
          }

          const isOwner = strField(business, 'ownerUid') === user.uid;
          const isEmployee = strField(contract, 'employeeUid') === user.uid;
          const currentStatus = strField(contract, 'status');

          if (action === 'resign') {
            if (!isEmployee) {
              return { status: 403 as const, error: 'Apenas o próprio funcionário pode pedir demissão.' };
            }
            if (currentStatus !== 'active') {
              return { status: 409 as const, error: 'Este contrato já foi encerrado.' };
            }

            const nextCount = Math.max(0, numField(business, 'employeeCount', 1) - 1);
            await backend.commit(
              [
                {
                  path: `business_employees/${contractId}`,
                  fields: { status: 'resigned' },
                  updateMask: ['status'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                },
                {
                  path: `businesses/${businessId}`,
                  fields: { employeeCount: nextCount },
                  updateMask: ['employeeCount'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                },
              ],
              idToken
            );

            return { status: 200 as const, data: { contractId, status: 'resigned', employeeCount: nextCount } };
          }

          // Owner-only actions: 'update' (promote/change role/salary) or 'terminate'
          if (!isOwner) {
            return {
              status: 403 as const,
              error: 'Acesso negado: funcionários não podem alterar salários, cargos ou demitir colegas.',
            };
          }

          if (action === 'terminate') {
            if (currentStatus !== 'active') {
              return { status: 409 as const, error: 'Este contrato já não está ativo.' };
            }

            const nextCount = Math.max(0, numField(business, 'employeeCount', 1) - 1);
            await backend.commit(
              [
                {
                  path: `business_employees/${contractId}`,
                  fields: { status: 'terminated' },
                  updateMask: ['status'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                },
                {
                  path: `businesses/${businessId}`,
                  fields: { employeeCount: nextCount },
                  updateMask: ['employeeCount'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                },
              ],
              idToken
            );

            return { status: 200 as const, data: { contractId, status: 'terminated', employeeCount: nextCount } };
          }

          // action === 'update'
          if (currentStatus !== 'active') {
            return { status: 409 as const, error: 'Não é possível editar um contrato encerrado.' };
          }

          const nextRole = sanitizeText(req.body?.roleTitle, strField(contract, 'roleTitle', 'Colaborador'), 2, 48);
          const nextSalary =
            req.body?.salary !== undefined
              ? parsePositiveMoney(req.body.salary, 10, 1_000_000)
              : numField(contract, 'salary', 100);
          const nextSchedule = sanitizeText(req.body?.schedule, strField(contract, 'schedule', 'Turno Comercial'), 2, 48);

          if (nextSalary === null) {
            return { status: 400 as const, error: 'Salário informado fora dos limites permitidos.' };
          }

          await backend.commit(
            [
              {
                path: `business_employees/${contractId}`,
                fields: {
                  roleTitle: nextRole,
                  salary: nextSalary,
                  schedule: nextSchedule,
                },
                updateMask: ['roleTitle', 'salary', 'schedule'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
            ],
            idToken
          );

          return {
            status: 200 as const,
            data: { contractId, roleTitle: nextRole, salary: nextSalary, schedule: nextSchedule },
          };
        });

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao atualizar contrato do funcionário.', 'employee-update');
      }
    }
  );

  // =========================================================================
  // 11. PAY EMPLOYEE SALARY FROM BUSINESS CASH (Strictly Owner Only, Atomic & Idempotent)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/payroll/pay',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const contractId = sanitizeId(req.body?.contractId);
      if (!businessId || !contractId) {
        res.status(400).json({ error: 'Empresa ou contrato de funcionário inválido.' });
        return;
      }

      const opId = makeOpId(req.body?.operationId, 'pay');
      const payrollId = `pay_${opId}`;

      try {
        const outcome = await withLock(`biz:${businessId}`, async () => {
          const business = await backend.getDoc(`businesses/${businessId}`, idToken);
          if (!business) {
            return { status: 404 as const, error: 'Empresa não encontrada.' };
          }
          if (strField(business, 'ownerUid') !== user.uid) {
            return {
              status: 403 as const,
              error: 'Acesso negado: apenas o proprietário pode processar a folha salarial.',
            };
          }
          if (strField(business, 'status') === 'suspended') {
            return { status: 403 as const, error: 'Empresa suspensa pela administração.' };
          }

          const [finances, contract, existingPay] = await Promise.all([
            backend.getDoc(`business_finances/${businessId}`, idToken),
            backend.getDoc(`business_employees/${contractId}`, idToken),
            backend.getDoc(`business_payroll/${payrollId}`, idToken),
          ]);

          if (existingPay) {
            return { status: 409 as const, error: 'Este pagamento salarial já foi processado (duplicidade bloqueada).' };
          }
          if (!finances) {
            return { status: 404 as const, error: 'Registro financeiro da empresa não encontrado.' };
          }
          if (!contract || strField(contract, 'businessId') !== businessId) {
            return { status: 404 as const, error: 'Contrato de funcionário inexistente nesta empresa.' };
          }
          if (strField(contract, 'status') !== 'active') {
            return {
              status: 409 as const,
              error: 'Não é possível pagar salário a um funcionário demitido ou desligado.',
            };
          }

          // Server ALWAYS reads authoritative contracted salary (ignores any client-submitted amount!)
          const salary = round2(numField(contract, 'salary', 0));
          if (salary < 10) {
            return { status: 400 as const, error: 'Salário contratual inválido.' };
          }

          const currentCash = numField(finances, 'cashBalance', 0);
          if (currentCash < salary) {
            return {
              status: 400 as const,
              error: `Caixa da empresa insuficiente. Necessário R$ ${salary.toFixed(2)}, disponível R$ ${currentCash.toFixed(2)}.`,
            };
          }

          const bizName = strField(business, 'name', businessId);
          const employeeUid = strField(contract, 'employeeUid');
          const employeeName = strField(contract, 'employeeName', 'Funcionário');
          const roleTitle = strField(contract, 'roleTitle', 'Colaborador');

          const nextCash = round2(currentCash - salary);
          const totalRevenue = numField(finances, 'totalRevenue', 0);
          const nextTotalExpenses = round2(numField(finances, 'totalExpenses', 0) + salary);
          const nextTotalPayroll = round2(numField(finances, 'totalPayrollPaid', 0) + salary);
          const nextNetProfit = round2(totalRevenue - nextTotalExpenses);
          const nextTotalPaid = round2(numField(contract, 'totalPaid', 0) + salary);
          const nextPaymentsCount = numField(contract, 'paymentsCount', 0) + 1;
          const nextPaymentIso = new Date(nowFn() + 24 * 60 * 60 * 1000).toISOString();

          const bTxId = `btx_pay_${opId}`;
          const bankTxId = `bpay_${opId}`;

          // 6-document atomic commit (strictly <= 10 Firestore Security Rules lookups!)
          const writes: FirestoreCommitWrite[] = [
            {
              path: `business_payroll/${payrollId}`,
              fields: {
                id: payrollId,
                operationId: opId,
                businessId,
                businessName: bizName,
                contractId,
                ownerUid: user.uid,
                employeeUid,
                employeeName,
                roleTitle,
                amount: salary,
                bankTxId,
                businessTxId: bTxId,
                status: 'paid',
              },
              transforms: [{ fieldPath: 'paidAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `business_transactions/${bTxId}`,
              fields: {
                id: bTxId,
                operationId: payrollId,
                businessId,
                ownerUid: user.uid,
                actorUid: user.uid,
                type: 'payroll',
                direction: 'out',
                amount: salary,
                description: `Folha salarial: ${employeeName} (${roleTitle})`,
                counterpartyUid: employeeUid,
                counterpartyLabel: employeeName,
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `business_finances/${businessId}`,
              fields: {
                cashBalance: nextCash,
                totalExpenses: nextTotalExpenses,
                totalPayrollPaid: nextTotalPayroll,
                netProfit: nextNetProfit,
                lastTxId: bTxId,
              },
              updateMask: [
                'cashBalance',
                'totalExpenses',
                'totalPayrollPaid',
                'netProfit',
                'lastTxId',
              ],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `business_employees/${contractId}`,
              fields: {
                totalPaid: nextTotalPaid,
                paymentsCount: nextPaymentsCount,
                lastPayrollId: payrollId,
                nextPaymentAt: { __timestamp: nextPaymentIso },
              },
              updateMask: ['totalPaid', 'paymentsCount', 'lastPayrollId', 'nextPaymentAt'],
              transforms: [
                { fieldPath: 'lastPaidAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
            {
              path: `transactions/${bankTxId}`,
              fields: {
                id: bankTxId,
                operationId: payrollId,
                type: 'business_payroll',
                currencyCategory: 'bank',
                amount: salary,
                fromUid: businessId,
                fromLabel: clampStr(bizName, 64),
                toUid: employeeUid,
                toLabel: clampStr(employeeName, 64),
                actorUid: user.uid,
                participants: [user.uid, employeeUid],
                description: clampStr(`Salário empresarial · ${bizName} (${roleTitle})`, 180),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              // Credits employee's bank account via atomic increment WITHOUT reading employee private balance!
              path: `bank_accounts/${employeeUid}`,
              fields: {
                lastTxId: bankTxId,
              },
              updateMask: ['lastTxId'],
              transforms: [
                { fieldPath: 'balance', increment: toFsNumber(salary) },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
            },
          ];

          await backend.commit(writes, idToken);

          // Bump business reputation for punctual payroll fulfillment (+2 up to 100)
          const nextRep = Math.min(100, numField(business, 'reputation', 60) + 2);
          await backend
            .commit(
              [
                {
                  path: `businesses/${businessId}`,
                  fields: { reputation: nextRep },
                  updateMask: ['reputation'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                },
              ],
              idToken
            )
            .catch(() => {});

          return {
            status: 200 as const,
            data: {
              payrollId,
              businessId,
              contractId,
              employeeUid,
              employeeName,
              amount: salary,
              businessCashBalance: nextCash,
              totalPayrollPaid: nextTotalPayroll,
              bankTxId,
              businessTxId: bTxId,
              reputation: nextRep,
            },
          };
        });

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao processar pagamento salarial.', 'payroll-pay');
      }
    }
  );

  // =========================================================================
  // 12. PRODUCTS & PRICING (Within Admin Margin Bounds)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/products',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'ID de empresa inválido.' });
        return;
      }

      const name = sanitizeText(req.body?.name, '', 2, 64);
      const sku = sanitizeText(req.body?.sku, `SKU-${crypto.randomUUID().slice(0, 5).toUpperCase()}`, 2, 24);
      const category = sanitizeText(req.body?.category, 'Geral', 2, 40);
      const unitCost = parsePositiveMoney(req.body?.unitCost, 1, 1_000_000);
      const salePrice = parsePositiveMoney(req.body?.salePrice, 1, 10_000_000);

      if (!name || unitCost === null || salePrice === null) {
        res.status(400).json({ error: 'Informe nome, custo unitário e preço de venda válidos.' });
        return;
      }

      try {
        const business = await backend.getDoc(`businesses/${businessId}`, idToken);
        if (!business) {
          res.status(404).json({ error: 'Empresa não encontrada.' });
          return;
        }
        if (strField(business, 'ownerUid') !== user.uid) {
          res.status(403).json({ error: 'Apenas o proprietário pode cadastrar produtos.' });
          return;
        }

        const location = await resolveSingleLocation(strField(business, 'locationId'), idToken);
        const minMult = location?.minPriceMultiplier ?? 1.05;
        const maxMult = location?.maxPriceMultiplier ?? 2.5;
        const minAllowed = round2(unitCost * minMult);
        const maxAllowed = round2(unitCost * maxMult);

        if (salePrice < minAllowed || salePrice > maxAllowed) {
          res.status(400).json({
            error: `Preço de venda fora da faixa regulada pela administração (R$ ${minAllowed.toFixed(2)} a R$ ${maxAllowed.toFixed(2)}).`,
          });
          return;
        }

        const marginPercent = round2(((salePrice - unitCost) / unitCost) * 100);
        const productId = makeOpId(req.body?.productId, 'prod');

        await backend.commit(
          [
            {
              path: `business_products/${productId}`,
              fields: {
                id: productId,
                businessId,
                ownerUid: user.uid,
                name,
                sku,
                category,
                unitCost,
                salePrice,
                minAllowedPrice: minAllowed,
                maxAllowedPrice: maxAllowed,
                marginPercent,
                active: true,
              },
              transforms: [
                { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: false },
            },
            {
              path: `business_inventory/${productId}`,
              fields: {
                id: productId,
                businessId,
                ownerUid: user.uid,
                productName: name,
                quantity: 0,
                unitCost,
                salePrice,
                lastMovementType: 'init',
                lastMovementQty: 0,
              },
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.status(201).json({
          id: productId,
          businessId,
          name,
          sku,
          category,
          unitCost,
          salePrice,
          minAllowedPrice: minAllowed,
          maxAllowedPrice: maxAllowed,
          marginPercent,
          active: true,
        });
      } catch (err) {
        handleError(res, err, 'Erro ao cadastrar produto.', 'create-product');
      }
    }
  );

  app.put(
    '/api/businesses/:businessId/products/:productId',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const productId = sanitizeId(req.params.productId);
      if (!businessId || !productId) {
        res.status(400).json({ error: 'Identificadores inválidos.' });
        return;
      }

      try {
        const product = await backend.getDoc(`business_products/${productId}`, idToken);
        if (!product || strField(product, 'businessId') !== businessId) {
          res.status(404).json({ error: 'Produto não encontrado.' });
          return;
        }
        if (strField(product, 'ownerUid') !== user.uid) {
          res.status(403).json({ error: 'Apenas o proprietário pode ajustar preços.' });
          return;
        }

        const unitCost = numField(product, 'unitCost', 1);
        const minAllowed = numField(product, 'minAllowedPrice', round2(unitCost * 1.05));
        const maxAllowed = numField(product, 'maxAllowedPrice', round2(unitCost * 2.5));
        const salePrice =
          req.body?.salePrice !== undefined
            ? parsePositiveMoney(req.body.salePrice, 1, 10_000_000)
            : numField(product, 'salePrice', minAllowed);

        if (salePrice === null || salePrice < minAllowed || salePrice > maxAllowed) {
          res.status(400).json({
            error: `Preço permitido entre R$ ${minAllowed.toFixed(2)} e R$ ${maxAllowed.toFixed(2)}.`,
          });
          return;
        }

        const marginPercent = round2(((salePrice - unitCost) / unitCost) * 100);
        const active = typeof req.body?.active === 'boolean' ? req.body.active : boolField(product, 'active', true);

        await backend.commit(
          [
            {
              path: `business_products/${productId}`,
              fields: { salePrice, marginPercent, active },
              updateMask: ['salePrice', 'marginPercent', 'active'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `business_inventory/${productId}`,
              fields: { salePrice },
              updateMask: ['salePrice'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
          idToken
        );

        res.json({ id: productId, salePrice, marginPercent, active });
      } catch (err) {
        handleError(res, err, 'Erro ao atualizar produto.', 'update-product');
      }
    }
  );

  // =========================================================================
  // 13. RESTOCK INVENTORY (Deducts Wholesale Cost Atomically from Business Cash)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/inventory/restock',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const productId = sanitizeId(req.body?.productId);
      const quantity = parsePositiveInt(req.body?.quantity, 1, 500);

      if (!businessId || !productId || quantity === null) {
        res.status(400).json({ error: 'Produto ou quantidade de compra inválidos.' });
        return;
      }

      const opId = makeOpId(req.body?.operationId, 'rst');

      try {
        const outcome = await withLock(`biz:${businessId}`, async () => {
          const [business, finances, product, inv] = await Promise.all([
            backend.getDoc(`businesses/${businessId}`, idToken),
            backend.getDoc(`business_finances/${businessId}`, idToken),
            backend.getDoc(`business_products/${productId}`, idToken),
            backend.getDoc(`business_inventory/${productId}`, idToken),
          ]);

          if (!business || !finances || !product || !inv) {
            return { status: 404 as const, error: 'Empresa, produto ou estoque não encontrado.' };
          }
          if (strField(business, 'ownerUid') !== user.uid) {
            return { status: 403 as const, error: 'Apenas o proprietário pode comprar estoque.' };
          }
          if (strField(business, 'status') === 'suspended') {
            return { status: 403 as const, error: 'Empresa suspensa pela administração.' };
          }
          if (strField(product, 'businessId') !== businessId) {
            return { status: 400 as const, error: 'Produto não pertence a esta empresa.' };
          }

          const unitCost = numField(product, 'unitCost', 1);
          const totalCost = round2(unitCost * quantity);
          const currentCash = numField(finances, 'cashBalance', 0);

          if (currentCash < totalCost) {
            return {
              status: 400 as const,
              error: `Caixa insuficiente para compra de estoque (necessário R$ ${totalCost.toFixed(2)}).`,
            };
          }

          const nextCash = round2(currentCash - totalCost);
          const totalRevenue = numField(finances, 'totalRevenue', 0);
          const nextExpenses = round2(numField(finances, 'totalExpenses', 0) + totalCost);
          const nextNetProfit = round2(totalRevenue - nextExpenses);
          const nextQty = numField(inv, 'quantity', 0) + quantity;
          const bTxId = `btx_rst_${opId}`;

          await backend.commit(
            [
              {
                path: `business_transactions/${bTxId}`,
                fields: {
                  id: bTxId,
                  operationId: opId,
                  businessId,
                  ownerUid: user.uid,
                  actorUid: user.uid,
                  type: 'inventory_purchase',
                  direction: 'out',
                  amount: totalCost,
                  description: `Reposição de estoque: ${quantity}x ${strField(product, 'name', productId)}`,
                  counterpartyUid: 'wholesale_supplier',
                  counterpartyLabel: 'Distribuidora Oficial LCE',
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `business_finances/${businessId}`,
                fields: {
                  cashBalance: nextCash,
                  totalExpenses: nextExpenses,
                  netProfit: nextNetProfit,
                  lastTxId: bTxId,
                },
                updateMask: ['cashBalance', 'totalExpenses', 'netProfit', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `business_inventory/${productId}`,
                fields: {
                  quantity: nextQty,
                  lastMovementType: 'restock',
                  lastMovementQty: quantity,
                },
                updateMask: ['quantity', 'lastMovementType', 'lastMovementQty'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
            ],
            idToken
          );

          return {
            status: 200 as const,
            data: {
              productId,
              quantityAdded: quantity,
              newQuantity: nextQty,
              totalCost,
              cashBalance: nextCash,
              transactionId: bTxId,
            },
          };
        });

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao comprar estoque.', 'restock');
      }
    }
  );

  // =========================================================================
  // 14. SELL STOCK / COMMERCIALIZATION (Generates Real Revenue & Updates Market Value/Reputation)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/inventory/sell',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const productId = sanitizeId(req.body?.productId);
      const quantity = parsePositiveInt(req.body?.quantity, 1, 500);

      if (!businessId || !productId || quantity === null) {
        res.status(400).json({ error: 'Produto ou quantidade de venda inválidos.' });
        return;
      }

      const opId = makeOpId(req.body?.operationId, 'sale');
      const buyerLabel = sanitizeText(req.body?.buyerLabel, 'Cliente Distrito Central', 2, 64);

      try {
        const outcome = await withLock(`biz:${businessId}`, async () => {
          const [business, finances, product, inv] = await Promise.all([
            backend.getDoc(`businesses/${businessId}`, idToken),
            backend.getDoc(`business_finances/${businessId}`, idToken),
            backend.getDoc(`business_products/${productId}`, idToken),
            backend.getDoc(`business_inventory/${productId}`, idToken),
          ]);

          if (!business || !finances || !product || !inv) {
            return { status: 404 as const, error: 'Empresa, produto ou estoque não encontrado.' };
          }
          if (strField(business, 'ownerUid') !== user.uid) {
            return { status: 403 as const, error: 'Apenas o proprietário pode registrar vendas comerciais.' };
          }
          if (strField(business, 'status') !== 'active') {
            return {
              status: 409 as const,
              error: 'Empresa inoperante ou suspensa não pode comercializar produtos.',
            };
          }
          if (strField(product, 'businessId') !== businessId) {
            return { status: 400 as const, error: 'Produto não pertence a esta empresa.' };
          }

          const currentQty = numField(inv, 'quantity', 0);
          if (currentQty < quantity) {
            return {
              status: 400 as const,
              error: `Estoque insuficiente (${currentQty} unidade(s) disponíveis).`,
            };
          }

          const salePrice = numField(product, 'salePrice', 1);
          const revenueDelta = round2(salePrice * quantity);
          const nextCash = round2(numField(finances, 'cashBalance', 0) + revenueDelta);
          const nextRevenue = round2(numField(finances, 'totalRevenue', 0) + revenueDelta);
          const totalExpenses = numField(finances, 'totalExpenses', 0);
          const nextNetProfit = round2(nextRevenue - totalExpenses);
          const nextQty = currentQty - quantity;
          const nextRep = Math.min(100, numField(business, 'reputation', 60) + 1);
          const nextMarketValue = round2(numField(business, 'marketValue', 500) + revenueDelta * 0.15);
          const bTxId = `btx_sell_${opId}`;

          await backend.commit(
            [
              {
                path: `business_transactions/${bTxId}`,
                fields: {
                  id: bTxId,
                  operationId: opId,
                  businessId,
                  ownerUid: user.uid,
                  actorUid: user.uid,
                  type: 'product_sale',
                  direction: 'in',
                  amount: revenueDelta,
                  description: `Venda comercial: ${quantity}x ${strField(product, 'name', productId)}`,
                  counterpartyUid: 'city_customer',
                  counterpartyLabel: buyerLabel,
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `business_finances/${businessId}`,
                fields: {
                  cashBalance: nextCash,
                  totalRevenue: nextRevenue,
                  netProfit: nextNetProfit,
                  lastTxId: bTxId,
                },
                updateMask: ['cashBalance', 'totalRevenue', 'netProfit', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `business_inventory/${productId}`,
                fields: {
                  quantity: nextQty,
                  lastMovementType: 'sale',
                  lastMovementQty: quantity,
                },
                updateMask: ['quantity', 'lastMovementType', 'lastMovementQty'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `businesses/${businessId}`,
                fields: {
                  reputation: nextRep,
                  marketValue: nextMarketValue,
                },
                updateMask: ['reputation', 'marketValue'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
            ],
            idToken
          );

          return {
            status: 200 as const,
            data: {
              productId,
              quantitySold: quantity,
              newQuantity: nextQty,
              revenue: revenueDelta,
              cashBalance: nextCash,
              totalRevenue: nextRevenue,
              netProfit: nextNetProfit,
              reputation: nextRep,
              marketValue: nextMarketValue,
              transactionId: bTxId,
            },
          };
        });

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao registrar venda comercial.', 'sell');
      }
    }
  );

  // =========================================================================
  // 15. OPERATING EXPENSES CYCLE (Rent, Energy, Water, Maintenance, Taxes)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/expenses/pay',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'ID de empresa inválido.' });
        return;
      }

      const opId = makeOpId(req.body?.operationId, 'exp');

      try {
        const outcome = await withLock(`biz:${businessId}`, async () => {
          const [business, finances] = await Promise.all([
            backend.getDoc(`businesses/${businessId}`, idToken),
            backend.getDoc(`business_finances/${businessId}`, idToken),
          ]);

          if (!business || !finances) {
            return { status: 404 as const, error: 'Empresa ou registros financeiros não encontrados.' };
          }
          if (strField(business, 'ownerUid') !== user.uid) {
            return { status: 403 as const, error: 'Apenas o proprietário pode quitar despesas operacionais.' };
          }
          if (strField(business, 'status') === 'suspended') {
            return { status: 403 as const, error: 'Empresa suspensa pela administração.' };
          }

          const expenseAmount = round2(numField(business, 'operatingExpense', 0));
          const currentCash = numField(finances, 'cashBalance', 0);

          const breakdown = {
            rent: round2(expenseAmount * 0.35),
            energy: round2(expenseAmount * 0.2),
            water: round2(expenseAmount * 0.15),
            maintenance: round2(expenseAmount * 0.15),
            taxes: round2(
              expenseAmount -
                round2(expenseAmount * 0.35) -
                round2(expenseAmount * 0.2) -
                round2(expenseAmount * 0.15) -
                round2(expenseAmount * 0.15)
            ),
          };

          if (currentCash < expenseAmount) {
            await backend.commit(
              [
                {
                  path: `businesses/${businessId}`,
                  fields: {
                    status: 'inactive_funds',
                    reputation: Math.max(0, numField(business, 'reputation', 60) - 5),
                  },
                  updateMask: ['status', 'reputation'],
                  transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                },
              ],
              idToken
            );

            return {
              status: 200 as const,
              data: {
                paid: false,
                status: 'inactive_funds',
                requiredAmount: expenseAmount,
                cashBalance: currentCash,
                breakdown,
                message:
                  'Caixa insuficiente para quitar despesas operacionais. A empresa ficou temporariamente inoperante até receber aporte.',
              },
            };
          }

          const nextCash = round2(currentCash - expenseAmount);
          const totalRevenue = numField(finances, 'totalRevenue', 0);
          const nextExpenses = round2(numField(finances, 'totalExpenses', 0) + expenseAmount);
          const nextNetProfit = round2(totalRevenue - nextExpenses);
          const nextRep = Math.min(100, numField(business, 'reputation', 60) + 1);
          const bTxId = `btx_exp_${opId}`;

          await backend.commit(
            [
              {
                path: `business_transactions/${bTxId}`,
                fields: {
                  id: bTxId,
                  operationId: opId,
                  businessId,
                  ownerUid: user.uid,
                  actorUid: user.uid,
                  type: 'operating_expense',
                  direction: 'out',
                  amount: expenseAmount,
                  description: clampStr(
                    `Despesas operacionais (Aluguel R$${breakdown.rent}, Energia R$${breakdown.energy}, Água R$${breakdown.water}, Manut. R$${breakdown.maintenance}, Impostos R$${breakdown.taxes})`,
                    180
                  ),
                  counterpartyUid: 'city_utilities',
                  counterpartyLabel: 'Prefeitura & Concessionárias LCE',
                  status: 'completed',
                },
                transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: false },
              },
              {
                path: `business_finances/${businessId}`,
                fields: {
                  cashBalance: nextCash,
                  totalExpenses: nextExpenses,
                  netProfit: nextNetProfit,
                  lastTxId: bTxId,
                },
                updateMask: ['cashBalance', 'totalExpenses', 'netProfit', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
              {
                path: `businesses/${businessId}`,
                fields: {
                  status: 'active',
                  reputation: nextRep,
                },
                updateMask: ['status', 'reputation'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              },
            ],
            idToken
          );

          return {
            status: 200 as const,
            data: {
              paid: true,
              status: 'active',
              amount: expenseAmount,
              cashBalance: nextCash,
              totalExpenses: nextExpenses,
              netProfit: nextNetProfit,
              reputation: nextRep,
              breakdown,
              transactionId: bTxId,
            },
          };
        });

        if ('error' in outcome) {
          res.status(outcome.status).json({ error: outcome.error });
          return;
        }
        res.json(outcome.data);
      } catch (err) {
        handleError(res, err, 'Erro ao processar despesas operacionais.', 'expenses-pay');
      }
    }
  );

  // =========================================================================
  // 16. CITIZEN REVIEW & REPUTATION SYSTEM (Non-Owner Citizen)
  // =========================================================================
  app.post(
    '/api/businesses/:businessId/reviews',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      const rating = parsePositiveInt(req.body?.rating, 1, 5);
      const comment = sanitizeText(req.body?.comment, '', 3, 200);

      if (!businessId || rating === null || !comment) {
        res.status(400).json({ error: 'Informe uma nota de 1 a 5 e um comentário válido.' });
        return;
      }

      try {
        const [business, profile] = await Promise.all([
          backend.getDoc(`businesses/${businessId}`, idToken),
          backend.getDoc(`users/${user.uid}`, idToken),
        ]);

        if (!business) {
          res.status(404).json({ error: 'Empresa não encontrada.' });
          return;
        }
        if (strField(business, 'ownerUid') === user.uid) {
          res.status(403).json({ error: 'O proprietário não pode avaliar a própria empresa.' });
          return;
        }

        const reviewId = makeOpId(req.body?.reviewId, 'rev');
        const currentRep = numField(business, 'reputation', 60);
        const currentCount = numField(business, 'reputationCount', 0);
        const score100 = rating * 20;
        const nextRep = Math.max(
          0,
          Math.min(100, Math.round((currentRep * (currentCount + 2) + score100) / (currentCount + 3)))
        );

        await backend.commit(
          [
            {
              path: `business_reviews/${reviewId}`,
              fields: {
                id: reviewId,
                businessId,
                authorUid: user.uid,
                authorName: strField(profile, 'characterName', 'Cidadão LCE'),
                rating,
                comment,
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `businesses/${businessId}`,
              fields: {
                reputation: nextRep,
                reputationCount: currentCount + 1,
              },
              updateMask: ['reputation', 'reputationCount'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
          ],
          idToken
        );

        res.status(201).json({
          id: reviewId,
          businessId,
          rating,
          comment,
          reputation: nextRep,
          reputationCount: currentCount + 1,
        });
      } catch (err) {
        handleError(res, err, 'Erro ao registrar avaliação da empresa.', 'review');
      }
    }
  );

  // =========================================================================
  // 17. ADMIN BUSINESS GOVERNANCE ROUTES (All Verified Admin + Audit Logged)
  // =========================================================================
  app.get(
    '/api/admin/businesses/overview',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;

      try {
        if (!(await assertAdmin(user, idToken))) {
          res.status(403).json({ error: 'Acesso restrito a administradores.' });
          return;
        }

        const [locations, bizDocs, finDocs, empDocs, txDocs, payDocs] = await Promise.all([
          resolveLocationsCatalog(idToken),
          backend.listCollection('businesses', idToken, 100),
          backend.listCollection('business_finances', idToken, 100),
          backend.listCollection('business_employees', idToken, 100),
          backend.listCollection('business_transactions', idToken, 100),
          backend.listCollection('business_payroll', idToken, 100),
        ]);

        res.json({
          locations,
          businesses: bizDocs.map((d) => ({ ...d.data, id: d.id })),
          finances: finDocs.map((d) => ({ ...d.data, businessId: d.id })),
          employees: empDocs.map((d) => ({ ...d.data, id: d.id })),
          transactions: txDocs
            .map((d): Record<string, unknown> => ({ ...d.data, id: d.id }))
            .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
          payroll: payDocs
            .map((d): Record<string, unknown> => ({ ...d.data, id: d.id }))
            .sort((a, b) => String(b.paidAt ?? '').localeCompare(String(a.paidAt ?? ''))),
        });
      } catch (err) {
        handleError(res, err, 'Erro ao carregar visão administrativa de empresas.', 'admin-overview');
      }
    }
  );

  app.post(
    '/api/admin/businesses/seed-locations',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;

      try {
        if (!(await assertAdmin(user, idToken))) {
          res.status(403).json({ error: 'Acesso restrito a administradores.' });
          return;
        }

        const logId = makeOpId(undefined, 'alog_bseed');
        const writes: FirestoreCommitWrite[] = DEFAULT_BUSINESS_LOCATIONS.map((loc) => ({
          path: `business_locations/${loc.id}`,
          fields: buildLocationFields(loc, user.uid),
          transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        }));

        writes.push({
          path: `admin_logs/${logId}`,
          fields: {
            actorUid: user.uid,
            action: 'create_business_location',
            targetUid: 'catalog_10_businesses',
            summary: 'Sincronização oficial do catálogo de 10 estabelecimentos legais no Firestore.',
          },
          transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
          precondition: { exists: false },
        });

        await backend.commit(writes, idToken);
        res.json({ seededCount: DEFAULT_BUSINESS_LOCATIONS.length, logId });
      } catch (err) {
        handleError(res, err, 'Erro ao sincronizar catálogo empresarial.', 'admin-seed');
      }
    }
  );

  app.post(
    '/api/admin/businesses/locations',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;

      try {
        if (!(await assertAdmin(user, idToken))) {
          res.status(403).json({ error: 'Acesso restrito a administradores.' });
          return;
        }

        const locationId = sanitizeId(req.body?.id) ?? makeOpId(undefined, 'loc');
        const templateType = strField(req.body as Record<string, unknown>, 'templateType') as BusinessTemplateType;
        if (!VALID_TEMPLATES.has(templateType)) {
          res.status(400).json({ error: 'Tipo de empresa inválido.' });
          return;
        }

        const name = sanitizeText(req.body?.name, '', 3, 64);
        const category = sanitizeText(req.body?.category, 'Comércio', 2, 48);
        const description = sanitizeText(req.body?.description, 'Estabelecimento comercial oficial do Distrito Central.', 6, 240);
        const acquisitionPrice = parsePositiveMoney(req.body?.acquisitionPrice, 50, 100_000_000);
        const initialCapital = parsePositiveMoney(req.body?.initialCapital, 0, 50_000_000) ?? 0;
        const operatingExpense = parsePositiveMoney(req.body?.operatingExpense, 0, 10_000_000) ?? 0;
        const maxEmployees = parsePositiveInt(req.body?.maxEmployees, 1, 100);
        const revenuePotential = parsePositiveMoney(req.body?.revenuePotential, 10, 100_000_000) ?? 500;
        const minPriceMultiplier = parsePositiveMoney(req.body?.minPriceMultiplier, 1.0, 5.0) ?? 1.05;
        const maxPriceMultiplier = parsePositiveMoney(req.body?.maxPriceMultiplier, minPriceMultiplier, 10.0) ?? 2.5;
        const locationLabel = sanitizeText(req.body?.locationLabel, 'Distrito Central', 3, 80);
        const posX = typeof req.body?.posX === 'number' && Number.isFinite(req.body.posX) ? Math.max(-40, Math.min(40, req.body.posX)) : 0;
        const posZ = typeof req.body?.posZ === 'number' && Number.isFinite(req.body.posZ) ? Math.max(-40, Math.min(40, req.body.posZ)) : 0;

        if (!name || acquisitionPrice === null || maxEmployees === null) {
          res.status(400).json({ error: 'Preencha nome, valor de aquisição e limite de funcionários.' });
          return;
        }

        const logId = makeOpId(undefined, 'alog_bloc');
        await backend.commit(
          [
            {
              path: `business_locations/${locationId}`,
              fields: {
                id: locationId,
                templateType,
                name,
                category,
                description,
                acquisitionPrice,
                initialCapital,
                operatingExpense,
                maxEmployees,
                revenuePotential,
                minPriceMultiplier,
                maxPriceMultiplier,
                locationLabel,
                posX,
                posZ,
                available: true,
                isCatalogLocation: true,
                updatedBy: user.uid,
              },
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `admin_logs/${logId}`,
              fields: {
                actorUid: user.uid,
                action: 'create_business_location',
                targetUid: locationId,
                summary: clampStr(`Admin criou estabelecimento ${name} (R$ ${acquisitionPrice.toFixed(2)}).`, 240),
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.status(201).json({ id: locationId, name, acquisitionPrice, logId });
      } catch (err) {
        handleError(res, err, 'Erro ao criar estabelecimento.', 'admin-create-location');
      }
    }
  );

  app.put(
    '/api/admin/businesses/locations/:locationId',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const locationId = sanitizeId(req.params.locationId);
      if (!locationId) {
        res.status(400).json({ error: 'ID de estabelecimento inválido.' });
        return;
      }

      try {
        if (!(await assertAdmin(user, idToken))) {
          res.status(403).json({ error: 'Acesso restrito a administradores.' });
          return;
        }

        const existing = await resolveSingleLocation(locationId, idToken);
        if (!existing) {
          res.status(404).json({ error: 'Estabelecimento não encontrado.' });
          return;
        }

        const acquisitionPrice =
          req.body?.acquisitionPrice !== undefined
            ? parsePositiveMoney(req.body.acquisitionPrice, 50, 100_000_000) ?? existing.acquisitionPrice
            : existing.acquisitionPrice;
        const initialCapital =
          req.body?.initialCapital !== undefined
            ? parsePositiveMoney(req.body.initialCapital, 0, 50_000_000) ?? existing.initialCapital
            : existing.initialCapital;
        const operatingExpense =
          req.body?.operatingExpense !== undefined
            ? parsePositiveMoney(req.body.operatingExpense, 0, 10_000_000) ?? existing.operatingExpense
            : existing.operatingExpense;
        const maxEmployees =
          req.body?.maxEmployees !== undefined
            ? parsePositiveInt(req.body.maxEmployees, 1, 100) ?? existing.maxEmployees
            : existing.maxEmployees;
        const minPriceMultiplier =
          req.body?.minPriceMultiplier !== undefined
            ? parsePositiveMoney(req.body.minPriceMultiplier, 1.0, 5.0) ?? existing.minPriceMultiplier
            : existing.minPriceMultiplier;
        const maxPriceMultiplier =
          req.body?.maxPriceMultiplier !== undefined
            ? parsePositiveMoney(req.body.maxPriceMultiplier, minPriceMultiplier, 10.0) ?? existing.maxPriceMultiplier
            : Math.max(minPriceMultiplier, existing.maxPriceMultiplier);
        const available = typeof req.body?.available === 'boolean' ? req.body.available : existing.available;

        const logId = makeOpId(undefined, 'alog_bupd');
        await backend.commit(
          [
            {
              path: `business_locations/${locationId}`,
              fields: buildLocationFields(
                {
                  ...existing,
                  acquisitionPrice,
                  initialCapital,
                  operatingExpense,
                  maxEmployees,
                  minPriceMultiplier,
                  maxPriceMultiplier,
                  available,
                  isCatalogLocation: true,
                },
                user.uid
              ),
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `admin_logs/${logId}`,
              fields: {
                actorUid: user.uid,
                action: 'update_business_location',
                targetUid: locationId,
                summary: clampStr(
                  `Admin atualizou ${existing.name}: aquisição R$ ${acquisitionPrice}, despesa R$ ${operatingExpense}, máx. ${maxEmployees} func.`,
                  240
                ),
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.json({
          id: locationId,
          acquisitionPrice,
          initialCapital,
          operatingExpense,
          maxEmployees,
          minPriceMultiplier,
          maxPriceMultiplier,
          available,
          logId,
        });
      } catch (err) {
        handleError(res, err, 'Erro ao atualizar parâmetros do estabelecimento.', 'admin-update-location');
      }
    }
  );

  app.put(
    '/api/admin/businesses/:businessId/admin-update',
    requireVerifiedCitizen,
    async (req: EconomyAuthedRequest, res: Response) => {
      const user = req.verifiedUser!;
      const idToken = req.rawIdToken!;
      const businessId = sanitizeId(req.params.businessId);
      if (!businessId) {
        res.status(400).json({ error: 'ID de empresa inválido.' });
        return;
      }

      try {
        if (!(await assertAdmin(user, idToken))) {
          res.status(403).json({ error: 'Acesso restrito a administradores.' });
          return;
        }

        const business = await backend.getDoc(`businesses/${businessId}`, idToken);
        if (!business) {
          res.status(404).json({ error: 'Empresa não encontrada.' });
          return;
        }

        const nextStatus = ['active', 'inactive_funds', 'suspended'].includes(String(req.body?.status))
          ? String(req.body.status)
          : strField(business, 'status', 'active');
        const nextOperatingExpense =
          req.body?.operatingExpense !== undefined
            ? parsePositiveMoney(req.body.operatingExpense, 0, 10_000_000) ?? numField(business, 'operatingExpense', 80)
            : numField(business, 'operatingExpense', 80);
        const nextMaxEmployees =
          req.body?.maxEmployees !== undefined
            ? parsePositiveInt(req.body.maxEmployees, Math.max(1, numField(business, 'employeeCount', 0)), 100) ??
              numField(business, 'maxEmployees', 6)
            : numField(business, 'maxEmployees', 6);
        const reason = sanitizeText(req.body?.reason, 'Ajuste regulatório da administração', 3, 180);

        const logId = makeOpId(undefined, 'alog_biz');
        await backend.commit(
          [
            {
              path: `businesses/${businessId}`,
              fields: {
                status: nextStatus,
                operatingExpense: nextOperatingExpense,
                maxEmployees: nextMaxEmployees,
              },
              updateMask: ['status', 'operatingExpense', 'maxEmployees'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            {
              path: `admin_logs/${logId}`,
              fields: {
                actorUid: user.uid,
                action: 'admin_business_action',
                targetUid: businessId,
                summary: clampStr(
                  `${strField(business, 'name', businessId)} -> status=${nextStatus}, despesa=R$${nextOperatingExpense}, vagas=${nextMaxEmployees} (${reason})`,
                  240
                ),
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        res.json({
          businessId,
          status: nextStatus,
          operatingExpense: nextOperatingExpense,
          maxEmployees: nextMaxEmployees,
          logId,
        });
      } catch (err) {
        handleError(res, err, 'Erro ao aplicar intervenção administrativa.', 'admin-business-update');
      }
    }
  );
}
