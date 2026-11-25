import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import {
  DEFAULT_JOBS_CATALOG,
  DEFAULT_JOBS_MAP,
  LCE_BANK_NAME,
  computeExpectedSalary,
  deriveAccountNumber,
  resolveProfessionalTier,
} from '../config/economyCatalog.ts';
import type { LegalJobId } from '../types/economy.ts';
import {
  FirestoreRestError,
  toFsNumber,
  timestampToMs,
  type FirestoreBackend,
  type FirestoreCommitWrite,
} from './firestoreRest.ts';
import type { VerifiedTokenPayload } from './worldServer.ts';

export interface EconomyAuthedRequest extends Request {
  verifiedUser?: VerifiedTokenPayload;
  rawIdToken?: string;
}

export interface RegisterEconomyRoutesOptions {
  app: Express;
  backend: FirestoreBackend;
  requireAuth: (req: EconomyAuthedRequest, res: Response, next: NextFunction) => Promise<void>;
  nowFn?: () => number;
}

const VALID_JOB_IDS = new Set<LegalJobId>([
  'entregador',
  'supermercado',
  'motorista',
  'mecanico',
]);

const ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;

function roundMoney(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  if (rounded <= 0 || rounded > 100_000_000) return null;
  return rounded;
}

function roundSignedDelta(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0 || Math.abs(rounded) > 100_000_000) return null;
  return rounded;
}

function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function sanitizeDescription(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.trim().replace(/\s+/g, ' ').slice(0, 180);
  return cleaned.length >= 3 ? cleaned : fallback;
}

function numField(doc: Record<string, unknown> | null, key: string, fallback = 0): number {
  const val = doc?.[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function strField(doc: Record<string, unknown> | null, key: string, fallback = ''): string {
  const val = doc?.[key];
  return typeof val === 'string' ? val : fallback;
}

function jobXpFieldName(jobId: LegalJobId): string {
  switch (jobId) {
    case 'entregador':
      return 'entregadorXp';
    case 'supermercado':
      return 'supermercadoXp';
    case 'motorista':
      return 'motoristaXp';
    case 'mecanico':
    default:
      return 'mecanicoXp';
  }
}

export function registerEconomyRoutes(options: RegisterEconomyRoutesOptions): void {
  const { app, backend, requireAuth, nowFn = () => Date.now() } = options;

  // Per-user & per-operation in-flight mutex to stop parallel double-submission races
  const activeLocks = new Map<string, Promise<void>>();

  const withUserLock = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
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
          error: 'Verifique seu e-mail antes de realizar operações financeiras ou profissionais.',
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

  const handleRouteError = (
    res: Response,
    err: unknown,
    fallbackMessage: string,
    routeLabel = 'economy'
  ): void => {
    if (err instanceof FirestoreRestError) {
      console.error(`[LCE Economy][${routeLabel}] Firestore ${err.status} ${err.code}: ${err.message}`);
      if (err.code === 'ALREADY_EXISTS' || err.code === 'FAILED_PRECONDITION') {
        res.status(409).json({
          error: 'Operação rejeitada por condição de concorrência ou duplicidade.',
          code: err.code,
        });
        return;
      }
      if (err.code === 'PERMISSION_DENIED') {
        res.status(403).json({
          error: 'Operação recusada pelas regras de segurança do banco de dados.',
          code: err.code,
        });
        return;
      }
      res.status(err.status >= 400 && err.status < 600 ? err.status : 500).json({
        error: err.message || fallbackMessage,
        code: err.code,
      });
      return;
    }

    const message = err instanceof Error ? err.message : fallbackMessage;
    console.error(`[LCE Economy][${routeLabel}] Unexpected error: ${message}`);
    res.status(500).json({ error: message });
  };

  // Explicit block against legacy / arbitrary balance tampering attempts
  app.post('/api/economy/mutate', requireVerifiedCitizen, (_req: EconomyAuthedRequest, res: Response) => {
    res.status(403).json({
      error: 'Alteração arbitrária de saldo é proibida.',
      policy:
        'Todas as movimentações passam exclusivamente por endpoints validados (/api/economy/deposit, /withdraw, /transfer e /api/jobs/complete) com transações atômicas auditáveis.',
    });
  });

  // 1. Bootstrap citizen wallet, bank account, public bank directory, and job experience
  app.post('/api/economy/bootstrap', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;

    try {
      const result = await withUserLock(`user:${user.uid}`, async () => {
        const [profile, ecoCfg, existingWallet, existingBank, existingDir, existingJobXp] =
          await Promise.all([
            backend.getDoc(`users/${user.uid}`, idToken),
            backend.getDoc('economyConfig/global', idToken).catch(() => null),
            backend.getDoc(`wallets/${user.uid}`, idToken),
            backend.getDoc(`bank_accounts/${user.uid}`, idToken),
            backend.getDoc(`bank_directory/${user.uid}`, idToken),
            backend.getDoc(`job_experience/${user.uid}`, idToken),
          ]);

        if (!profile) {
          return { missingProfile: true as const };
        }

        const initialCleanCash = numField(ecoCfg, 'initialCleanCash', 500);
        const initialBankBalance = numField(ecoCfg, 'initialBankBalance', 1000);
        const characterName = strField(profile, 'characterName', 'Cidadão LCE');
        const alias = strField(profile, 'alias', 'cidadao');
        const accountNumber =
          strField(existingBank, 'accountNumber', '') || deriveAccountNumber(user.uid);

        const writes: FirestoreCommitWrite[] = [];

        if (!existingWallet) {
          writes.push({
            path: `wallets/${user.uid}`,
            fields: {
              uid: user.uid,
              cleanCash: initialCleanCash,
              dirtyCash: 0,
              companiesValue: 0,
              realEstateValue: 0,
              vehiclesValue: 0,
              investmentsValue: 0,
              otherAssetsValue: 0,
              lastTxId: 'init',
            },
            transforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
            precondition: { exists: false },
          });
        }

        if (!existingBank) {
          writes.push({
            path: `bank_accounts/${user.uid}`,
            fields: {
              uid: user.uid,
              accountNumber,
              bankName: LCE_BANK_NAME,
              balance: initialBankBalance,
              status: 'active',
              lastTxId: 'init',
            },
            transforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
            precondition: { exists: false },
          });
        }

        const shouldSyncDirectory =
          !existingDir ||
          strField(existingDir, 'characterName') !== characterName ||
          strField(existingDir, 'alias') !== alias ||
          strField(existingDir, 'accountNumber') !== accountNumber;

        if (shouldSyncDirectory) {
          writes.push({
            path: `bank_directory/${user.uid}`,
            fields: {
              uid: user.uid,
              characterName,
              alias,
              accountNumber,
              active: strField(profile, 'status', 'active') === 'active',
            },
            transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          });
        }

        if (!existingJobXp) {
          writes.push({
            path: `job_experience/${user.uid}`,
            fields: {
              uid: user.uid,
              totalXp: 0,
              entregadorXp: 0,
              supermercadoXp: 0,
              motoristaXp: 0,
              mecanicoXp: 0,
              lastSessionId: 'init',
            },
            transforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
            precondition: { exists: false },
          });
        }

        if (writes.length > 0) {
          await backend.commit(writes, idToken);
        }

        return {
          missingProfile: false as const,
          createdCount: writes.length,
          accountNumber,
        };
      });

      if (result.missingProfile) {
        res.status(404).json({ error: 'Personagem não encontrado para inicializar a carteira.' });
        return;
      }

      res.json({
        ok: true,
        accountNumber: result.accountNumber,
        createdDocuments: result.createdCount,
      });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao inicializar conta financeira do personagem.');
    }
  });

  // 2. Deposit clean cash into legal bank account (Dirty cash explicitly blocked)
  app.post('/api/economy/deposit', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.source === 'dirty_cash' || body.currencyCategory === 'dirty_cash') {
      res.status(403).json({
        error:
          'Dinheiro sujo de origem clandestina não pode ser depositado no sistema bancário legal.',
      });
      return;
    }

    const amount = roundMoney(body.amount);
    const operationId = sanitizeId(body.operationId);
    if (!amount || !operationId) {
      res.status(400).json({ error: 'Informe um valor positivo válido e um identificador de operação.' });
      return;
    }

    const txId = `dep_${operationId}`;
    const description = sanitizeDescription(
      body.description,
      `Depósito em espécie no ${LCE_BANK_NAME}`
    );

    try {
      const outcome = await withUserLock(`user:${user.uid}`, async () => {
        const [wallet, bank, profile] = await Promise.all([
          backend.getDoc(`wallets/${user.uid}`, idToken),
          backend.getDoc(`bank_accounts/${user.uid}`, idToken),
          backend.getDoc(`users/${user.uid}`, idToken),
        ]);

        if (!wallet || !bank) {
          return { status: 400, error: 'Carteira ou conta bancária não inicializada.' };
        }
        if (strField(bank, 'status') !== 'active') {
          return { status: 403, error: 'Sua conta bancária está congelada pela administração.' };
        }

        const currentCash = numField(wallet, 'cleanCash');
        const currentBank = numField(bank, 'balance');
        if (currentCash < amount) {
          return { status: 400, error: 'Saldo insuficiente de dinheiro limpo na carteira física.' };
        }

        const nextCash = Math.round((currentCash - amount) * 100) / 100;
        const nextBank = Math.round((currentBank + amount) * 100) / 100;
        const charLabel = `${strField(profile, 'characterName', 'Cidadão')} (@${strField(profile, 'alias', 'lce')})`.slice(0, 64);

        await backend.commit(
          [
            {
              path: `transactions/${txId}`,
              fields: {
                id: txId,
                operationId,
                type: 'deposit',
                currencyCategory: 'clean_cash',
                amount,
                fromUid: user.uid,
                fromLabel: `Carteira — ${charLabel}`.slice(0, 64),
                toUid: user.uid,
                toLabel: `${LCE_BANK_NAME} (${strField(bank, 'accountNumber')})`.slice(0, 64),
                actorUid: user.uid,
                participants: [user.uid],
                description,
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `wallets/${user.uid}`,
              fields: {
                cleanCash: nextCash,
                lastTxId: txId,
              },
              updateMask: ['cleanCash', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `bank_accounts/${user.uid}`,
              fields: {
                balance: nextBank,
                lastTxId: txId,
              },
              updateMask: ['balance', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
          ],
          idToken
        );

        return { status: 200, txId, cleanCash: nextCash, bankBalance: nextBank };
      });

      if (outcome.status !== 200) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      res.json({
        ok: true,
        txId: outcome.txId,
        cleanCash: outcome.cleanCash,
        bankBalance: outcome.bankBalance,
      });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao processar depósito bancário.');
    }
  });

  // 3. Withdraw clean cash from legal bank account
  app.post('/api/economy/withdraw', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const amount = roundMoney(body.amount);
    const operationId = sanitizeId(body.operationId);
    if (!amount || !operationId) {
      res.status(400).json({ error: 'Informe um valor positivo válido e um identificador de operação.' });
      return;
    }

    const txId = `wdr_${operationId}`;
    const description = sanitizeDescription(
      body.description,
      `Saque em espécie no ${LCE_BANK_NAME}`
    );

    try {
      const outcome = await withUserLock(`user:${user.uid}`, async () => {
        const [wallet, bank, profile] = await Promise.all([
          backend.getDoc(`wallets/${user.uid}`, idToken),
          backend.getDoc(`bank_accounts/${user.uid}`, idToken),
          backend.getDoc(`users/${user.uid}`, idToken),
        ]);

        if (!wallet || !bank) {
          return { status: 400, error: 'Carteira ou conta bancária não inicializada.' };
        }
        if (strField(bank, 'status') !== 'active') {
          return { status: 403, error: 'Sua conta bancária está congelada pela administração.' };
        }

        const currentCash = numField(wallet, 'cleanCash');
        const currentBank = numField(bank, 'balance');
        if (currentBank < amount) {
          return { status: 400, error: 'Saldo bancário insuficiente para este saque.' };
        }

        const nextCash = Math.round((currentCash + amount) * 100) / 100;
        const nextBank = Math.round((currentBank - amount) * 100) / 100;
        const charLabel = `${strField(profile, 'characterName', 'Cidadão')} (@${strField(profile, 'alias', 'lce')})`.slice(0, 64);

        await backend.commit(
          [
            {
              path: `transactions/${txId}`,
              fields: {
                id: txId,
                operationId,
                type: 'withdraw',
                currencyCategory: 'bank',
                amount,
                fromUid: user.uid,
                fromLabel: `${LCE_BANK_NAME} (${strField(bank, 'accountNumber')})`.slice(0, 64),
                toUid: user.uid,
                toLabel: `Carteira — ${charLabel}`.slice(0, 64),
                actorUid: user.uid,
                participants: [user.uid],
                description,
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `bank_accounts/${user.uid}`,
              fields: {
                balance: nextBank,
                lastTxId: txId,
              },
              updateMask: ['balance', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `wallets/${user.uid}`,
              fields: {
                cleanCash: nextCash,
                lastTxId: txId,
              },
              updateMask: ['cleanCash', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
          ],
          idToken
        );

        return { status: 200, txId, cleanCash: nextCash, bankBalance: nextBank };
      });

      if (outcome.status !== 200) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      res.json({
        ok: true,
        txId: outcome.txId,
        cleanCash: outcome.cleanCash,
        bankBalance: outcome.bankBalance,
      });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao processar saque bancário.');
    }
  });

  // 4. Atomic P2P Bank Transfer (Zero exposure of recipient private balance)
  app.post('/api/economy/transfer', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const recipientUid = sanitizeId(body.recipientUid);
    const amount = roundMoney(body.amount);
    const operationId = sanitizeId(body.operationId);

    if (!recipientUid || !amount || !operationId) {
      res.status(400).json({
        error: 'Informe destinatário válido, valor positivo e identificador único da operação.',
      });
      return;
    }

    if (recipientUid === user.uid) {
      res.status(400).json({ error: 'Não é permitido transferir para a própria conta.' });
      return;
    }

    const txId = `trf_${operationId}`;
    const description = sanitizeDescription(body.description, 'Transferência bancária entre cidadãos');

    try {
      const outcome = await withUserLock(`user:${user.uid}`, async () => {
        const [senderBank, senderProfile, recipientDir] = await Promise.all([
          backend.getDoc(`bank_accounts/${user.uid}`, idToken),
          backend.getDoc(`users/${user.uid}`, idToken),
          backend.getDoc(`bank_directory/${recipientUid}`, idToken),
        ]);

        if (!senderBank) {
          return { status: 400, error: 'Conta bancária do remetente não encontrada.' };
        }
        if (strField(senderBank, 'status') !== 'active') {
          return { status: 403, error: 'Sua conta bancária está congelada.' };
        }
        if (!recipientDir || recipientDir.active !== true) {
          return { status: 404, error: 'Destinatário não encontrado ou inativo no Banco Central LCE.' };
        }

        const currentSenderBalance = numField(senderBank, 'balance');
        if (currentSenderBalance < amount) {
          return { status: 400, error: 'Saldo bancário insuficiente para concluir a transferência.' };
        }

        const nextSenderBalance = Math.round((currentSenderBalance - amount) * 100) / 100;
        const senderLabel = `${strField(senderProfile, 'characterName', 'Cidadão')} (@${strField(senderProfile, 'alias', 'lce')})`.slice(0, 64);
        const recipientLabel = `${strField(recipientDir, 'characterName', 'Destinatário')} (@${strField(recipientDir, 'alias', 'lce')})`.slice(0, 64);

        await backend.commit(
          [
            {
              path: `transactions/${txId}`,
              fields: {
                id: txId,
                operationId,
                type: 'transfer',
                currencyCategory: 'bank',
                amount,
                fromUid: user.uid,
                fromLabel: senderLabel,
                toUid: recipientUid,
                toLabel: recipientLabel,
                actorUid: user.uid,
                participants: [user.uid, recipientUid],
                description,
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `bank_accounts/${user.uid}`,
              fields: {
                balance: nextSenderBalance,
                lastTxId: txId,
              },
              updateMask: ['balance', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              // Recipient account is credited atomically via server-side increment WITHOUT reading their private balance
              path: `bank_accounts/${recipientUid}`,
              fields: {
                lastTxId: txId,
              },
              updateMask: ['lastTxId'],
              transforms: [
                { fieldPath: 'balance', increment: toFsNumber(amount) },
                { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
              ],
              precondition: { exists: true },
            },
          ],
          idToken
        );

        return {
          status: 200,
          txId,
          bankBalance: nextSenderBalance,
          recipientLabel,
        };
      });

      if (outcome.status !== 200) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      res.json({
        ok: true,
        txId: outcome.txId,
        bankBalance: outcome.bankBalance,
        recipientLabel: outcome.recipientLabel,
      });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao processar transferência bancária.');
    }
  });

  // 5. Start Legal Work Shift (Server-controlled duration, cooldown, daily cap & progression)
  app.post('/api/jobs/start', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const jobId = typeof body.jobId === 'string' ? (body.jobId.trim() as LegalJobId) : null;
    if (!jobId || !VALID_JOB_IDS.has(jobId)) {
      res.status(400).json({ error: 'Profissão inválida.' });
      return;
    }

    try {
      const outcome = await withUserLock(`user:${user.uid}`, async () => {
        const [profile, remoteJob, bank, jobXpDoc, userSessions, userPayments] = await Promise.all([
          backend.getDoc(`users/${user.uid}`, idToken),
          backend.getDoc(`jobs/${jobId}`, idToken).catch(() => null),
          backend.getDoc(`bank_accounts/${user.uid}`, idToken),
          backend.getDoc(`job_experience/${user.uid}`, idToken),
          backend.queryByField('work_sessions', 'uid', 'EQUAL', user.uid, idToken, 50),
          backend.queryByField('salary_payments', 'uid', 'EQUAL', user.uid, idToken, 100),
        ]);

        if (!profile) {
          return { status: 404, error: 'Perfil do personagem não encontrado.' };
        }
        if (strField(profile, 'status', 'active') !== 'active') {
          return { status: 403, error: 'Personagem suspenso não pode iniciar expedientes.' };
        }
        if (!bank || strField(bank, 'status') !== 'active') {
          return {
            status: 403,
            error: 'Conta bancária ativa necessária para iniciar expediente legal.',
          };
        }
        if (!jobXpDoc) {
          return {
            status: 400,
            error: 'Registro profissional ainda sincronizando. Tente novamente em instantes.',
          };
        }

        const fallbackJob = DEFAULT_JOBS_MAP[jobId];
        const job = {
          id: jobId,
          name: strField(remoteJob, 'name', fallbackJob.name),
          baseSalary: numField(remoteJob, 'baseSalary', fallbackJob.baseSalary),
          durationSeconds: Math.max(
            10,
            Math.round(numField(remoteJob, 'durationSeconds', fallbackJob.durationSeconds))
          ),
          cooldownSeconds: Math.max(
            5,
            Math.round(numField(remoteJob, 'cooldownSeconds', fallbackJob.cooldownSeconds))
          ),
          maxDailyPayouts: Math.max(
            1,
            Math.round(numField(remoteJob, 'maxDailyPayouts', fallbackJob.maxDailyPayouts))
          ),
          minLevel: Math.max(1, Math.round(numField(remoteJob, 'minLevel', fallbackJob.minLevel))),
          requiredExperience: Math.max(
            0,
            Math.round(
              numField(remoteJob, 'requiredExperience', fallbackJob.requiredExperience)
            )
          ),
          xpReward: Math.max(1, Math.round(numField(remoteJob, 'xpReward', fallbackJob.xpReward))),
          available: remoteJob ? remoteJob.available !== false : fallbackJob.available,
        };

        if (!job.available) {
          return { status: 403, error: 'Esta profissão está temporariamente indisponível pela administração.' };
        }

        const level = numField(profile, 'level', 1);
        if (level < job.minLevel) {
          return {
            status: 403,
            error: `Nível insuficiente. Requer nível ${job.minLevel} (atual: ${level}).`,
          };
        }

        const totalXp = numField(jobXpDoc, 'totalXp', 0);
        if (totalXp < job.requiredExperience) {
          return {
            status: 403,
            error: `Experiência profissional insuficiente. Requer ${job.requiredExperience} XP acumulados (atual: ${totalXp} XP).`,
          };
        }

        const activeSession = userSessions.find((s) => s.data.status === 'in_progress');
        if (activeSession) {
          return {
            status: 409,
            error: 'Você já possui um expediente em andamento. Conclua ou cancele antes de iniciar outro.',
          };
        }

        const nowMs = nowFn();
        const oneDayAgoMs = nowMs - 24 * 60 * 60 * 1000;
        let lastJobPaidMs = 0;
        let payoutsLast24hForJob = 0;

        for (const p of userPayments) {
          if (p.data.jobId === jobId) {
            const paidMs = timestampToMs(p.data.paidAt);
            if (paidMs > lastJobPaidMs) lastJobPaidMs = paidMs;
            if (paidMs >= oneDayAgoMs) payoutsLast24hForJob += 1;
          }
        }

        if (payoutsLast24hForJob >= job.maxDailyPayouts) {
          return {
            status: 429,
            error: `Limite diário atingido para ${job.name} (${job.maxDailyPayouts} pagamentos nas últimas 24h).`,
          };
        }

        if (lastJobPaidMs > 0) {
          const elapsedSinceLastSec = Math.floor((nowMs - lastJobPaidMs) / 1000);
          if (elapsedSinceLastSec < job.cooldownSeconds) {
            const waitSec = job.cooldownSeconds - elapsedSinceLastSec;
            return {
              status: 429,
              error: `Aguarde ${waitSec}s de intervalo antes de iniciar novo expediente em ${job.name}.`,
              retryAfterSeconds: waitSec,
            };
          }
        }

        const professionXp = numField(jobXpDoc, jobXpFieldName(jobId), 0);
        const tier = resolveProfessionalTier(professionXp);
        const expectedSalary = computeExpectedSalary(job.baseSalary, professionXp);

        const sessionId = `ws_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
        await backend.commit(
          [
            {
              path: `work_sessions/${sessionId}`,
              fields: {
                id: sessionId,
                uid: user.uid,
                jobId,
                jobName: job.name,
                status: 'in_progress',
                durationSeconds: job.durationSeconds,
                expectedSalary,
                xpReward: job.xpReward,
              },
              transforms: [{ fieldPath: 'startedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
          ],
          idToken
        );

        return {
          status: 200,
          session: {
            id: sessionId,
            uid: user.uid,
            jobId,
            jobName: job.name,
            status: 'in_progress',
            durationSeconds: job.durationSeconds,
            expectedSalary,
            xpReward: job.xpReward,
            tierLabel: tier.name,
            startedAtMs: nowMs,
          },
        };
      });

      if (outcome.status !== 200) {
        res.status(outcome.status).json({
          error: outcome.error,
          retryAfterSeconds: outcome.retryAfterSeconds,
        });
        return;
      }

      res.json({ ok: true, session: outcome.session });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao iniciar expediente de trabalho.');
    }
  });

  // 6. Complete Legal Work Shift & Pay Clean Salary Atomically (1-to-1 keyed anti-duplication)
  app.post('/api/jobs/complete', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const sessionId = sanitizeId(body.sessionId);
    if (!sessionId) {
      res.status(400).json({ error: 'Identificador de expediente inválido.' });
      return;
    }

    try {
      const outcome = await withUserLock(`user:${user.uid}`, async () => {
        // Read work_sessions first; ownership is enforced both by Firestore rules and explicitly below.
        // Do NOT pre-read non-existent salary_payments/{sessionId} — atomic precondition { exists: false }
        // plus session.status === 'in_progress' guarantee strict 1-to-1 idempotency without null-doc reads.
        const [session, bank, jobXpDoc, profile] = await Promise.all([
          backend.getDoc(`work_sessions/${sessionId}`, idToken),
          backend.getDoc(`bank_accounts/${user.uid}`, idToken),
          backend.getDoc(`job_experience/${user.uid}`, idToken),
          backend.getDoc(`users/${user.uid}`, idToken),
        ]);

        if (!session) {
          return { status: 404, error: 'Expediente não encontrado.' };
        }
        if (strField(session, 'uid') !== user.uid) {
          return { status: 403, error: 'Você não tem permissão para concluir este expediente.' };
        }
        if (strField(session, 'status') !== 'in_progress' || Boolean(session.payoutTxId)) {
          return {
            status: 409,
            error: 'Este expediente já foi encerrado ou pago anteriormente (proteção antiduplicação).',
          };
        }
        if (!bank || strField(bank, 'status') !== 'active') {
          return { status: 403, error: 'Conta bancária ativa necessária para receber salário legal.' };
        }
        if (!jobXpDoc) {
          return { status: 400, error: 'Registro de experiência profissional não inicializado.' };
        }

        // Enforce server-side shift duration with a 1000ms clock-skew safety buffer
        // so Node.js never commits milliseconds ahead of Cloud Firestore's request.time.
        const durationSeconds = Math.max(10, Math.round(numField(session, 'durationSeconds', 30)));
        const startedAtMs = timestampToMs(session.startedAt);
        const nowMs = nowFn();
        const elapsedMs = nowMs - startedAtMs;
        const requiredElapsedMs = durationSeconds * 1000 + 1000;
        if (startedAtMs > 0 && elapsedMs < requiredElapsedMs) {
          const remainingSeconds = Math.max(1, Math.ceil((requiredElapsedMs - elapsedMs) / 1000));
          return {
            status: 400,
            error: `Tempo mínimo de expediente ainda não concluído. Faltam ${remainingSeconds}s.`,
            remainingSeconds,
          };
        }

        const jobId = strField(session, 'jobId') as LegalJobId;
        if (!VALID_JOB_IDS.has(jobId)) {
          return { status: 400, error: 'Profissão da sessão inválida.' };
        }

        const jobName = strField(session, 'jobName', DEFAULT_JOBS_MAP[jobId].name);
        // Salary is ALWAYS determined exclusively from server-persisted session state (never from req.body)
        const paidAmount = Math.round(numField(session, 'expectedSalary', 0) * 100) / 100;
        if (paidAmount < 10) {
          return { status: 400, error: 'Valor de salário da sessão inválido.' };
        }
        const xpReward = Math.max(1, Math.round(numField(session, 'xpReward', 10)));
        const currentBank = numField(bank, 'balance');
        const nextBank = Math.round((currentBank + paidAmount) * 100) / 100;

        const xpField = jobXpFieldName(jobId);
        const prevJobXp = numField(jobXpDoc, xpField, 0);
        const nextJobXp = prevJobXp + xpReward;
        const prevTotalXp = numField(jobXpDoc, 'totalXp', 0);
        const nextTotalXp = prevTotalXp + xpReward;
        const newTier = resolveProfessionalTier(nextJobXp);

        const txId = `sal_${sessionId}`;
        const charLabel = `${strField(profile, 'characterName', 'Cidadão')} (@${strField(profile, 'alias', 'lce')})`.slice(0, 64);

        await backend.commit(
          [
            {
              path: `work_sessions/${sessionId}`,
              fields: {
                status: 'completed',
                payoutTxId: txId,
              },
              updateMask: ['status', 'payoutTxId'],
              transforms: [{ fieldPath: 'completedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `salary_payments/${sessionId}`,
              fields: {
                id: sessionId,
                sessionId,
                uid: user.uid,
                jobId,
                jobName,
                amount: paidAmount,
                xpAwarded: xpReward,
                tierLabel: newTier.name,
                txId,
              },
              transforms: [{ fieldPath: 'paidAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `transactions/${txId}`,
              fields: {
                id: txId,
                operationId: sessionId,
                type: 'salary',
                currencyCategory: 'bank',
                amount: paidAmount,
                fromUid: 'city_treasury',
                fromLabel: 'Agência Metropolitana LCE',
                toUid: user.uid,
                toLabel: charLabel,
                actorUid: user.uid,
                participants: [user.uid],
                description: `Salário legal — ${jobName} (${newTier.name})`.slice(0, 180),
                status: 'completed',
              },
              transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: false },
            },
            {
              path: `bank_accounts/${user.uid}`,
              fields: {
                balance: nextBank,
                lastTxId: txId,
              },
              updateMask: ['balance', 'lastTxId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
            {
              path: `job_experience/${user.uid}`,
              fields: {
                totalXp: nextTotalXp,
                [xpField]: nextJobXp,
                lastSessionId: sessionId,
              },
              updateMask: ['totalXp', xpField, 'lastSessionId'],
              transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
              precondition: { exists: true },
            },
          ],
          idToken
        );

        return {
          status: 200,
          txId,
          paidAmount,
          xpAwarded: xpReward,
          bankBalance: nextBank,
          totalXp: nextTotalXp,
          jobXp: nextJobXp,
          tierLabel: newTier.name,
        };
      });

      if (outcome.status !== 200) {
        res.status(outcome.status).json({
          error: outcome.error,
          remainingSeconds: outcome.remainingSeconds,
        });
        return;
      }

      res.json({
        ok: true,
        txId: outcome.txId,
        paidAmount: outcome.paidAmount,
        xpAwarded: outcome.xpAwarded,
        bankBalance: outcome.bankBalance,
        totalXp: outcome.totalXp,
        jobXp: outcome.jobXp,
        tierLabel: outcome.tierLabel,
      });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao concluir expediente e creditar salário.', 'jobs/complete');
    }
  });

  // 7. Cancel an active in_progress shift cleanly
  app.post('/api/jobs/cancel', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sessionId = sanitizeId(body.sessionId);

    if (!sessionId) {
      res.status(400).json({ error: 'Identificador de expediente inválido.' });
      return;
    }

    try {
      const session = await backend.getDoc(`work_sessions/${sessionId}`, idToken);
      if (!session || strField(session, 'uid') !== user.uid) {
        res.status(404).json({ error: 'Expediente não encontrado.' });
        return;
      }
      if (strField(session, 'status') !== 'in_progress') {
        res.status(409).json({ error: 'Expediente já finalizado.' });
        return;
      }

      await backend.commit(
        [
          {
            path: `work_sessions/${sessionId}`,
            fields: { status: 'cancelled' },
            updateMask: ['status'],
            transforms: [{ fieldPath: 'completedAt', setToServerValue: 'REQUEST_TIME' }],
            precondition: { exists: true },
          },
        ],
        idToken
      );

      res.json({ ok: true, sessionId });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao cancelar expediente.');
    }
  });

  // 8. Admin: Seed or reset the 4 official legal jobs into /jobs/{jobId}
  app.post('/api/admin/economy/seed-jobs', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;

    if (!(await assertAdmin(user, idToken))) {
      res.status(403).json({ error: 'Acesso administrativo obrigatório.' });
      return;
    }

    try {
      const logId = `adm_${nowFn()}_${crypto.randomBytes(3).toString('hex')}`;
      const writes: FirestoreCommitWrite[] = DEFAULT_JOBS_CATALOG.map((job) => ({
        path: `jobs/${job.id}`,
        fields: {
          id: job.id,
          name: job.name,
          description: job.description,
          baseSalary: job.baseSalary,
          durationSeconds: job.durationSeconds,
          cooldownSeconds: job.cooldownSeconds,
          maxDailyPayouts: job.maxDailyPayouts,
          minLevel: job.minLevel,
          requiredExperience: job.requiredExperience,
          xpReward: job.xpReward,
          reputationReward: job.reputationReward,
          available: job.available,
          isCatalogJob: true,
          updatedBy: user.uid,
        },
        transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      }));

      writes.push({
        path: `admin_logs/${logId}`,
        fields: {
          actorUid: user.uid,
          action: 'update_job_config',
          summary: 'Catálogo oficial de 4 profissões legais sincronizado na coleção /jobs.',
        },
        transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
        precondition: { exists: false },
      });

      await backend.commit(writes, idToken);
      res.json({ ok: true, seededCount: DEFAULT_JOBS_CATALOG.length });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao sincronizar catálogo de profissões.');
    }
  });

  // 9. Admin: Update a single legal job's parameters
  app.put('/api/admin/economy/jobs/:jobId', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;

    if (!(await assertAdmin(user, idToken))) {
      res.status(403).json({ error: 'Acesso administrativo obrigatório.' });
      return;
    }

    const jobId = req.params.jobId as LegalJobId;
    if (!VALID_JOB_IDS.has(jobId)) {
      res.status(400).json({ error: 'Profissão inválida.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const fallback = DEFAULT_JOBS_MAP[jobId];

    const name = typeof body.name === 'string' && body.name.trim().length >= 3
      ? body.name.trim().slice(0, 64)
      : fallback.name;
    const description = typeof body.description === 'string' && body.description.trim().length >= 6
      ? body.description.trim().slice(0, 240)
      : fallback.description;
    const baseSalary = Math.max(10, Math.min(50000, Number(body.baseSalary ?? fallback.baseSalary)));
    const durationSeconds = Math.max(
      10,
      Math.min(3600, Math.round(Number(body.durationSeconds ?? fallback.durationSeconds)))
    );
    const cooldownSeconds = Math.max(
      5,
      Math.min(86400, Math.round(Number(body.cooldownSeconds ?? fallback.cooldownSeconds)))
    );
    const maxDailyPayouts = Math.max(
      1,
      Math.min(100, Math.round(Number(body.maxDailyPayouts ?? fallback.maxDailyPayouts)))
    );
    const minLevel = Math.max(1, Math.min(100, Math.round(Number(body.minLevel ?? fallback.minLevel))));
    const requiredExperience = Math.max(
      0,
      Math.min(100000, Math.round(Number(body.requiredExperience ?? fallback.requiredExperience)))
    );
    const xpReward = Math.max(1, Math.min(5000, Math.round(Number(body.xpReward ?? fallback.xpReward))));
    const reputationReward = Math.max(
      0,
      Math.min(500, Math.round(Number(body.reputationReward ?? fallback.reputationReward)))
    );
    const available = typeof body.available === 'boolean' ? body.available : fallback.available;

    if (
      !Number.isFinite(baseSalary) ||
      !Number.isFinite(durationSeconds) ||
      !Number.isFinite(cooldownSeconds)
    ) {
      res.status(400).json({ error: 'Parâmetros numéricos inválidos para a profissão.' });
      return;
    }

    try {
      const logId = `adm_${nowFn()}_${crypto.randomBytes(3).toString('hex')}`;
      await backend.commit(
        [
          {
            path: `jobs/${jobId}`,
            fields: {
              id: jobId,
              name,
              description,
              baseSalary: Math.round(baseSalary * 100) / 100,
              durationSeconds,
              cooldownSeconds,
              maxDailyPayouts,
              minLevel,
              requiredExperience,
              xpReward,
              reputationReward,
              available,
              isCatalogJob: true,
              updatedBy: user.uid,
            },
            transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          },
          {
            path: `admin_logs/${logId}`,
            fields: {
              actorUid: user.uid,
              action: 'update_job_config',
              summary: `Profissão ${name}: salário R$ ${baseSalary}, duração ${durationSeconds}s, cooldown ${cooldownSeconds}s, limite ${maxDailyPayouts}/dia, ativa: ${available ? 'sim' : 'não'}.`.slice(
                0,
                240
              ),
            },
            transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            precondition: { exists: false },
          },
        ],
        idToken
      );

      res.json({ ok: true, jobId });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao atualizar configuração da profissão.');
    }
  });

  // 10. Admin: Audited Balance Adjustment (clean_cash, dirty_cash, or bank)
  app.post('/api/admin/economy/adjust', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;

    if (!(await assertAdmin(user, idToken))) {
      res.status(403).json({ error: 'Acesso administrativo obrigatório.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const targetUid = sanitizeId(body.targetUid);
    const operationId = sanitizeId(body.operationId);
    const delta = roundSignedDelta(body.delta);
    const targetAccount =
      body.targetAccount === 'clean_cash' ||
      body.targetAccount === 'dirty_cash' ||
      body.targetAccount === 'bank'
        ? body.targetAccount
        : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 140) : '';

    if (!targetUid || !operationId || !delta || !targetAccount || reason.length < 5) {
      res.status(400).json({
        error:
          'Informe cidadão, conta (clean_cash/dirty_cash/bank), valor diferente de zero, operationId e justificativa (mín. 5 caracteres).',
      });
      return;
    }

    const txId = `adj_${operationId}`;
    const logId = `adm_${operationId}`;

    try {
      const outcome = await withUserLock(`user:${targetUid}`, async () => {
        const [existingTx, wallet, bank, targetProfile] = await Promise.all([
          backend.getDoc(`transactions/${txId}`, idToken),
          backend.getDoc(`wallets/${targetUid}`, idToken),
          backend.getDoc(`bank_accounts/${targetUid}`, idToken),
          backend.getDoc(`users/${targetUid}`, idToken),
        ]);

        if (existingTx) {
          return { status: 409, error: 'Ajuste administrativo duplicado.' };
        }
        if (!wallet || !bank) {
          return {
            status: 404,
            error: 'O cidadão selecionado ainda não inicializou sua carteira/conta bancária.',
          };
        }

        const currentVal =
          targetAccount === 'bank'
            ? numField(bank, 'balance')
            : targetAccount === 'dirty_cash'
            ? numField(wallet, 'dirtyCash')
            : numField(wallet, 'cleanCash');

        const nextVal = Math.round((currentVal + delta) * 100) / 100;
        if (nextVal < 0) {
          return {
            status: 400,
            error: `O ajuste resultaria em saldo negativo (saldo atual: R$ ${currentVal.toFixed(2)}).`,
          };
        }

        const absAmount = Math.abs(delta);
        const targetLabel = `${strField(targetProfile, 'characterName', 'Cidadão')} (@${strField(targetProfile, 'alias', targetUid.slice(0, 8))})`.slice(0, 64);
        const accountLabel =
          targetAccount === 'bank'
            ? 'Conta Bancária'
            : targetAccount === 'dirty_cash'
            ? 'Dinheiro Sujo'
            : 'Dinheiro Limpo';

        const writes: FirestoreCommitWrite[] = [
          {
            path: `transactions/${txId}`,
            fields: {
              id: txId,
              operationId,
              type: 'admin_adjustment',
              currencyCategory: targetAccount,
              amount: absAmount,
              fromUid: delta >= 0 ? 'admin_treasury' : targetUid,
              fromLabel: delta >= 0 ? 'Administração LCE' : targetLabel,
              toUid: delta >= 0 ? targetUid : 'admin_treasury',
              toLabel: delta >= 0 ? targetLabel : 'Administração LCE',
              actorUid: user.uid,
              participants: [targetUid],
              description: `Ajuste administrativo (${delta >= 0 ? '+' : '-'}R$ ${absAmount.toFixed(2)} em ${accountLabel}): ${reason}`.slice(
                0,
                180
              ),
              status: 'completed',
            },
            transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            precondition: { exists: false },
          },
          targetAccount === 'bank'
            ? {
                path: `bank_accounts/${targetUid}`,
                fields: {
                  balance: nextVal,
                  lastTxId: txId,
                },
                updateMask: ['balance', 'lastTxId'],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              }
            : {
                path: `wallets/${targetUid}`,
                fields: {
                  [targetAccount === 'dirty_cash' ? 'dirtyCash' : 'cleanCash']: nextVal,
                  lastTxId: txId,
                },
                updateMask: [
                  targetAccount === 'dirty_cash' ? 'dirtyCash' : 'cleanCash',
                  'lastTxId',
                ],
                transforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
                precondition: { exists: true },
              },
          {
            path: `admin_logs/${logId}`,
            fields: {
              actorUid: user.uid,
              action: 'admin_balance_adjustment',
              targetUid,
              summary: `Ajuste ${delta >= 0 ? '+' : '-'}R$ ${absAmount.toFixed(2)} (${accountLabel}) para ${targetLabel}. Motivo: ${reason}`.slice(
                0,
                240
              ),
            },
            transforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
            precondition: { exists: false },
          },
        ];

        await backend.commit(writes, idToken);
        return { status: 200, txId, logId, newBalance: nextVal };
      });

      if (outcome.status !== 200) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      res.json({
        ok: true,
        txId: outcome.txId,
        logId: outcome.logId,
        newBalance: outcome.newBalance,
      });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao executar ajuste financeiro auditado.');
    }
  });

  // 11. Admin: Consolidated Economy Overview (Wallets, Bank Accounts, Global Transactions, Jobs, Logs)
  app.get('/api/admin/economy/overview', requireVerifiedCitizen, async (req: EconomyAuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    const idToken = req.rawIdToken!;

    if (!(await assertAdmin(user, idToken))) {
      res.status(403).json({ error: 'Acesso administrativo obrigatório.' });
      return;
    }

    try {
      const [users, wallets, bankAccounts, transactions, salaryPayments, jobs, adminLogs] =
        await Promise.all([
          backend.listCollection('users', idToken, 50).catch(() => []),
          backend.listCollection('wallets', idToken, 50).catch(() => []),
          backend.listCollection('bank_accounts', idToken, 50).catch(() => []),
          backend.listCollection('transactions', idToken, 60).catch(() => []),
          backend.listCollection('salary_payments', idToken, 50).catch(() => []),
          backend.listCollection('jobs', idToken, 20).catch(() => []),
          backend.listCollection('admin_logs', idToken, 40).catch(() => []),
        ]);

      const sortDescBy = (field: string) => (a: { data: Record<string, unknown> }, b: { data: Record<string, unknown> }) =>
        timestampToMs(b.data[field]) - timestampToMs(a.data[field]);

      res.json({
        users: users.map((d) => ({ id: d.id, ...d.data })),
        wallets: wallets.map((d) => ({ id: d.id, ...d.data })),
        bankAccounts: bankAccounts.map((d) => ({ id: d.id, ...d.data })),
        transactions: transactions.sort(sortDescBy('createdAt')).map((d) => ({ id: d.id, ...d.data })),
        salaryPayments: salaryPayments.sort(sortDescBy('paidAt')).map((d) => ({ id: d.id, ...d.data })),
        jobs: jobs.map((d) => ({ id: d.id, ...d.data })),
        adminLogs: adminLogs.sort(sortDescBy('createdAt')).map((d) => ({ id: d.id, ...d.data })),
      });
    } catch (err) {
      handleRouteError(res, err, 'Falha ao carregar visão administrativa da economia.');
    }
  });
}
