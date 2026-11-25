/**
 * End-to-End Automated Test Suite for the LCE Economic & Legal Work System.
 *
 * Tests real Express routes mounted in `createWorldServer` using two independent
 * player accounts (Alpha & Beta) plus an authenticated Admin account, backed by
 * an atomic, rule-aware in-memory Firestore backend simulator.
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

class RuleAwareAtomicMemoryFirestore implements FirestoreBackend {
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
    if (!existing) {
      // Simulates firestore.rules `resource == null` guard on getDoc -> 404 (null)
      return;
    }
    if (col === 'work_sessions' || col === 'salary_payments') {
      if (existing.uid !== user.uid && !this.isAdmin(user)) {
        throw new FirestoreRestError(
          403,
          'PERMISSION_DENIED',
          `Acesso negado ao documento ${path} de outro jogador (${String(existing.uid)}) por ${user.uid}`
        );
      }
    }
    if (col === 'transactions') {
      const participants = Array.isArray(existing.participants) ? existing.participants : [];
      if (!participants.includes(user.uid) && !this.isAdmin(user)) {
        throw new FirestoreRestError(
          403,
          'PERMISSION_DENIED',
          `Acesso negado à transação ${path} por ${user.uid}`
        );
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
    if (
      ['wallets', 'bank_accounts', 'transactions', 'admin_logs', 'users', 'salary_payments'].includes(
        collectionId
      ) &&
      !this.isAdmin(user)
    ) {
      throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Listagem restrita a administradores');
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
    this.resolveCaller(idToken);
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
    // Stage all writes atomically on a snapshot before committing
    const staged = new Map(this.store);
    const nowMs = this.nowFn();
    const nowIso = new Date(nowMs).toISOString();

    for (const w of writes) {
      const current = staged.get(w.path);
      if (w.precondition?.exists === false && current !== undefined) {
        throw new FirestoreRestError(409, 'ALREADY_EXISTS', `Documento já existe: ${w.path}`);
      }
      if (w.precondition?.exists === true && current === undefined) {
        throw new FirestoreRestError(
          412,
          'FAILED_PRECONDITION',
          `Documento não existe: ${w.path}`
        );
      }

      let nextDoc: Record<string, unknown>;
      if (w.updateMask) {
        nextDoc = current ? structuredClone(current) : {};
        for (const fp of w.updateMask) {
          if (w.fields && fp in w.fields) {
            nextDoc[fp] = structuredClone(w.fields[fp]);
          }
        }
      } else {
        nextDoc = structuredClone(w.fields ?? {});
      }

      for (const t of w.transforms ?? []) {
        if (t.setToServerValue === 'REQUEST_TIME') {
          nextDoc[t.fieldPath] = nowIso;
        }
        if (t.increment) {
          const delta =
            'doubleValue' in t.increment
              ? Number(t.increment.doubleValue)
              : Number(t.increment.integerValue ?? 0);
          const prevNum = typeof nextDoc[t.fieldPath] === 'number' ? Number(nextDoc[t.fieldPath]) : 0;
          nextDoc[t.fieldPath] = Math.round((prevNum + delta) * 100) / 100;
        }
      }

      // Mirror critical Firestore Security Rules invariants on commit
      const [col, docId] = w.path.split('/');
      if (col === 'work_sessions' && current !== undefined) {
        if (current.uid !== user.uid) {
          throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Sessão pertence a outro jogador');
        }
        if (current.status !== 'in_progress') {
          throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Sessão já encerrada');
        }
        if (nextDoc.status === 'completed') {
          const startedAtMs = Date.parse(String(current.startedAt ?? ''));
          const durationSec = Number(current.durationSeconds ?? 0);
          if (!Number.isInteger(durationSec)) {
            throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'durationSeconds precisa ser inteiro');
          }
          if (nowMs < startedAtMs + durationSec * 1000) {
            throw new FirestoreRestError(
              403,
              'PERMISSION_DENIED',
              'request.time menor que startedAt + durationSeconds'
            );
          }
        }
      }
      if (col === 'salary_payments') {
        if (current !== undefined) {
          throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'salary_payments é imutável');
        }
        if (nextDoc.uid !== user.uid || nextDoc.id !== docId || nextDoc.sessionId !== docId) {
          throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'salary_payment inválido');
        }
      }

      staged.set(w.path, nextDoc);
    }

    // Post-commit cross-document invariant check for salary payouts
    for (const w of writes) {
      const [col, docId] = w.path.split('/');
      if (col === 'work_sessions' && staged.get(w.path)?.status === 'completed') {
        const sp = staged.get(`salary_payments/${docId}`);
        if (!sp || sp.uid !== user.uid) {
          throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'salary_payments ausente no batch');
        }
      }
      if (col === 'transactions' && staged.get(w.path)?.type === 'salary') {
        const tx = staged.get(w.path)!;
        const sp = staged.get(`salary_payments/${String(tx.operationId)}`);
        if (!sp || sp.txId !== docId || sp.uid !== user.uid || sp.amount !== tx.amount) {
          throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Transação de salário dessincronizada');
        }
      }
      if (col === 'job_experience' && !this.isAdmin(user)) {
        const xp = staged.get(w.path)!;
        const sum =
          Number(xp.entregadorXp ?? 0) +
          Number(xp.supermercadoXp ?? 0) +
          Number(xp.motoristaXp ?? 0) +
          Number(xp.mecanicoXp ?? 0);
        if (sum !== Number(xp.totalXp ?? -1)) {
          throw new FirestoreRestError(403, 'PERMISSION_DENIED', 'Soma de XP divergente de totalXp');
        }
      }
    }

    this.store.clear();
    for (const [k, v] of staged.entries()) {
      this.store.set(k, v);
    }
  }
}

async function apiFetch(
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
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function runTests() {
  let virtualClockMs = Date.now();
  const backend = new RuleAwareAtomicMemoryFirestore(() => virtualClockMs);

  // Seed two independent registered characters + economy config
  backend.store.set('economyConfig/global', {
    id: 'global',
    cityName: 'Nova Veridia — Distrito Central',
    taxRatePercent: 8.5,
    baseSalaryHourly: 120,
    baseFuelPrice: 6.5,
    basePropertyPrice: 85000,
    initialCleanCash: 500,
    initialBankBalance: 1000,
    defaultMaxDailyPayouts: 12,
    marketOpen: true,
  });

  backend.store.set('users/uid-alpha', {
    uid: 'uid-alpha',
    characterName: 'Carlos Alpha',
    alias: 'alpha',
    origin: 'comerciante',
    level: 1,
    reputation: 0,
    status: 'active',
  });

  backend.store.set('users/uid-beta', {
    uid: 'uid-beta',
    characterName: 'Marina Beta',
    alias: 'beta',
    origin: 'operario',
    level: 1,
    reputation: 0,
    status: 'active',
  });

  const server = createWorldServer({
    firebaseProjectId: 'test-project',
    bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
    customVerifier: async (token) => {
      const user = TOKENS[token];
      if (!user) throw new Error('Unauthorized');
      return user;
    },
    firestoreBackend: backend,
    nowFn: () => virtualClockMs,
  });

  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const port = (server.httpServer.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  };

  try {
    console.log('Iniciando suíte E2E do Sistema Econômico e Empregos LCE...');

    await test('1. Bootstrap independente de carteiras e contas bancárias (Alpha e Beta)', async () => {
      const a = await apiFetch(baseUrl, 'POST', '/api/economy/bootstrap', 'token-alpha', {});
      const b = await apiFetch(baseUrl, 'POST', '/api/economy/bootstrap', 'token-beta', {});
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.notEqual(a.json.accountNumber, b.json.accountNumber);

      const walletA = backend.store.get('wallets/uid-alpha')!;
      const walletB = backend.store.get('wallets/uid-beta')!;
      const bankA = backend.store.get('bank_accounts/uid-alpha')!;
      const bankB = backend.store.get('bank_accounts/uid-beta')!;
      assert.equal(walletA.cleanCash, 500);
      assert.equal(walletA.dirtyCash, 0);
      assert.equal(bankA.balance, 1000);
      assert.equal(walletB.cleanCash, 500);
      assert.equal(bankB.balance, 1000);
    });

    await test('2. Isolamento privado de saldos e bloqueio contra adulteração/acesso não-admin', async () => {
      // Alpha cannot read Beta's private wallet or bank account
      await assert.rejects(
        () => backend.getDoc('wallets/uid-beta', 'token-alpha'),
        /Acesso privado negado/
      );
      await assert.rejects(
        () => backend.getDoc('bank_accounts/uid-beta', 'token-alpha'),
        /Acesso privado negado/
      );

      // Direct arbitrary balance mutation is rejected
      const mutate = await apiFetch(baseUrl, 'POST', '/api/economy/mutate', 'token-alpha', {
        attemptedBalance: 999999,
      });
      assert.equal(mutate.status, 403);

      // Non-admin blocked from admin endpoints
      const overview = await apiFetch(baseUrl, 'GET', '/api/admin/economy/overview', 'token-alpha');
      assert.equal(overview.status, 403);
    });

    await test('3. Depósito de dinheiro limpo, bloqueio de dinheiro sujo, saque e antiduplicação', async () => {
      // Dirty cash deposit blocked
      const dirtyAttempt = await apiFetch(baseUrl, 'POST', '/api/economy/deposit', 'token-alpha', {
        amount: 100,
        operationId: 'op_dirty_1',
        source: 'dirty_cash',
      });
      assert.equal(dirtyAttempt.status, 403);

      // Clean deposit R$ 200.50
      const dep = await apiFetch(baseUrl, 'POST', '/api/economy/deposit', 'token-alpha', {
        amount: 200.5,
        operationId: 'op_dep_001',
        source: 'clean_cash',
      });
      assert.equal(dep.status, 200);
      assert.equal(dep.json.cleanCash, 299.5);
      assert.equal(dep.json.bankBalance, 1200.5);

      // Duplicate deposit operationId blocked
      const depDup = await apiFetch(baseUrl, 'POST', '/api/economy/deposit', 'token-alpha', {
        amount: 200.5,
        operationId: 'op_dep_001',
        source: 'clean_cash',
      });
      assert.equal(depDup.status, 409);

      // Withdraw R$ 50.25
      const wdr = await apiFetch(baseUrl, 'POST', '/api/economy/withdraw', 'token-alpha', {
        amount: 50.25,
        operationId: 'op_wdr_001',
      });
      assert.equal(wdr.status, 200);
      assert.equal(wdr.json.cleanCash, 349.75);
      assert.equal(wdr.json.bankBalance, 1150.25);

      // Overdraft blocked
      const overdraft = await apiFetch(baseUrl, 'POST', '/api/economy/withdraw', 'token-alpha', {
        amount: 99999,
        operationId: 'op_wdr_over',
      });
      assert.equal(overdraft.status, 400);
    });

    await test('4. Transferência bancária P2P (Alpha -> Beta), extrato mútuo e bloqueio de duplicidade', async () => {
      // Self-transfer rejected
      const selfTrf = await apiFetch(baseUrl, 'POST', '/api/economy/transfer', 'token-alpha', {
        recipientUid: 'uid-alpha',
        amount: 50,
        operationId: 'op_self_1',
      });
      assert.equal(selfTrf.status, 400);

      // Transfer R$ 350.00 Alpha -> Beta (without ever reading Beta's private bank_accounts!)
      const trf = await apiFetch(baseUrl, 'POST', '/api/economy/transfer', 'token-alpha', {
        recipientUid: 'uid-beta',
        amount: 350,
        operationId: 'op_trf_001',
        description: 'Pagamento de contrato comercial',
      });
      assert.equal(trf.status, 200);
      assert.equal(trf.json.bankBalance, 800.25);

      // Verify exact recipient credit
      const bankB = backend.store.get('bank_accounts/uid-beta')!;
      assert.equal(bankB.balance, 1350);

      // Verify immutable transaction recorded with both participants
      const tx = backend.store.get('transactions/trf_op_trf_001')!;
      assert.equal(tx.type, 'transfer');
      assert.equal(tx.amount, 350);
      assert.equal(tx.fromUid, 'uid-alpha');
      assert.equal(tx.toUid, 'uid-beta');
      assert.deepEqual(tx.participants, ['uid-alpha', 'uid-beta']);

      // Duplicate P2P transfer blocked
      const trfDup = await apiFetch(baseUrl, 'POST', '/api/economy/transfer', 'token-alpha', {
        recipientUid: 'uid-beta',
        amount: 350,
        operationId: 'op_trf_001',
      });
      assert.equal(trfDup.status, 409);
      assert.equal(backend.store.get('bank_accounts/uid-beta')!.balance, 1350);
    });

    await test('5. Expediente legal em duas contas independentes (Alpha e Beta), antiduplicação, antifraude e isolamento entre jogadores', async () => {
      // Account Alpha starts Entregador (20s, R$ 140, +25 XP)
      const startA = await apiFetch(baseUrl, 'POST', '/api/jobs/start', 'token-alpha', {
        jobId: 'entregador',
      });
      assert.equal(startA.status, 200);
      const sessionA = startA.json.session as { id: string; durationSeconds: number; expectedSalary: number };
      assert.equal(sessionA.durationSeconds, 20);
      assert.equal(sessionA.expectedSalary, 140);

      // Account Beta independently starts Supermercado (25s, R$ 175, +30 XP)
      const startB = await apiFetch(baseUrl, 'POST', '/api/jobs/start', 'token-beta', {
        jobId: 'supermercado',
      });
      assert.equal(startB.status, 200);
      const sessionB = startB.json.session as { id: string; durationSeconds: number; expectedSalary: number };
      assert.equal(sessionB.durationSeconds, 25);
      assert.equal(sessionB.expectedSalary, 175);

      // Concurrent second shift blocked for Alpha
      const concurrent = await apiFetch(baseUrl, 'POST', '/api/jobs/start', 'token-alpha', {
        jobId: 'supermercado',
      });
      assert.equal(concurrent.status, 409);

      // Premature completion blocked (returns 400, NOT 403)
      const early = await apiFetch(baseUrl, 'POST', '/api/jobs/complete', 'token-alpha', {
        sessionId: sessionA.id,
      });
      assert.equal(early.status, 400);

      // Cross-player hijack attempt #1: Alpha tries to complete Beta's active shift -> MUST return 403!
      virtualClockMs += 27_000;
      const hijackAB = await apiFetch(baseUrl, 'POST', '/api/jobs/complete', 'token-alpha', {
        sessionId: sessionB.id,
      });
      assert.equal(hijackAB.status, 403);
      assert.equal(backend.store.get(`work_sessions/${sessionB.id}`)!.status, 'in_progress');
      assert.equal(backend.store.get('bank_accounts/uid-alpha')!.balance, 800.25);
      assert.equal(backend.store.get('bank_accounts/uid-beta')!.balance, 1350);

      // Cross-player hijack attempt #2: Beta tries to complete Alpha's active shift -> MUST return 403!
      const hijackBA = await apiFetch(baseUrl, 'POST', '/api/jobs/complete', 'token-beta', {
        sessionId: sessionA.id,
      });
      assert.equal(hijackBA.status, 403);
      assert.equal(backend.store.get(`work_sessions/${sessionA.id}`)!.status, 'in_progress');

      // Alpha completes own shift — also sending tampered salary fields that MUST be ignored by server
      const doneA = await apiFetch(baseUrl, 'POST', '/api/jobs/complete', 'token-alpha', {
        sessionId: sessionA.id,
        expectedSalary: 999999,
        amount: 999999,
        paidAmount: 999999,
      });
      assert.equal(doneA.status, 200);
      assert.equal(doneA.json.paidAmount, 140);
      assert.equal(doneA.json.bankBalance, 940.25);
      assert.equal(doneA.json.xpAwarded, 25);
      assert.equal(doneA.json.totalXp, 25);

      // Verify Alpha's auditable records in /transactions and /salary_payments
      const spA = backend.store.get(`salary_payments/${sessionA.id}`)!;
      const txA = backend.store.get(`transactions/sal_${sessionA.id}`)!;
      assert.equal(spA.uid, 'uid-alpha');
      assert.equal(spA.amount, 140);
      assert.equal(txA.type, 'salary');
      assert.equal(txA.toUid, 'uid-alpha');
      assert.equal(txA.amount, 140);
      assert.equal(backend.store.get('bank_accounts/uid-alpha')!.balance, 940.25);

      // Beta completes own shift independently
      const doneB = await apiFetch(baseUrl, 'POST', '/api/jobs/complete', 'token-beta', {
        sessionId: sessionB.id,
        amount: 500000, // tampered client value MUST be ignored
      });
      assert.equal(doneB.status, 200);
      assert.equal(doneB.json.paidAmount, 175);
      assert.equal(doneB.json.bankBalance, 1525);
      assert.equal(doneB.json.xpAwarded, 30);
      assert.equal(doneB.json.totalXp, 30);

      // Verify Beta's auditable records in /transactions and /salary_payments
      const spB = backend.store.get(`salary_payments/${sessionB.id}`)!;
      const txB = backend.store.get(`transactions/sal_${sessionB.id}`)!;
      assert.equal(spB.uid, 'uid-beta');
      assert.equal(spB.amount, 175);
      assert.equal(txB.type, 'salary');
      assert.equal(txB.toUid, 'uid-beta');
      assert.equal(txB.amount, 175);
      assert.equal(backend.store.get('bank_accounts/uid-beta')!.balance, 1525);

      // Duplicate payout on same sessionId strictly blocked for BOTH Alpha and Beta (idempotent protection)
      const dupPayA = await apiFetch(baseUrl, 'POST', '/api/jobs/complete', 'token-alpha', {
        sessionId: sessionA.id,
      });
      assert.equal(dupPayA.status, 409);
      assert.equal(backend.store.get('bank_accounts/uid-alpha')!.balance, 940.25);

      const dupPayB = await apiFetch(baseUrl, 'POST', '/api/jobs/complete', 'token-beta', {
        sessionId: sessionB.id,
      });
      assert.equal(dupPayB.status, 409);
      assert.equal(backend.store.get('bank_accounts/uid-beta')!.balance, 1525);

      // Cooldown immediately blocks starting entregador again for Alpha
      const cooldownHit = await apiFetch(baseUrl, 'POST', '/api/jobs/start', 'token-alpha', {
        jobId: 'entregador',
      });
      assert.equal(cooldownHit.status, 429);
    });

    await test('6. Persistência entre logout e novo login (re-bootstrap idempotente preserva saldos e XP)', async () => {
      const reA = await apiFetch(baseUrl, 'POST', '/api/economy/bootstrap', 'token-alpha', {});
      const reB = await apiFetch(baseUrl, 'POST', '/api/economy/bootstrap', 'token-beta', {});
      assert.equal(reA.status, 200);
      assert.equal(reB.status, 200);
      assert.equal(reA.json.createdDocuments, 0);
      assert.equal(reB.json.createdDocuments, 0);

      assert.equal(backend.store.get('wallets/uid-alpha')!.cleanCash, 349.75);
      assert.equal(backend.store.get('bank_accounts/uid-alpha')!.balance, 940.25);
      assert.equal(backend.store.get('bank_accounts/uid-beta')!.balance, 1525);
      assert.equal(backend.store.get('job_experience/uid-alpha')!.totalXp, 25);
      assert.equal(backend.store.get('job_experience/uid-beta')!.totalXp, 30);
    });

    await test('7. Painel Administrativo: consulta global, edição de profissões e ajuste auditado em /admin_logs', async () => {
      const seed = await apiFetch(baseUrl, 'POST', '/api/admin/economy/seed-jobs', 'token-admin', {});
      assert.equal(seed.status, 200);
      assert.equal(seed.json.seededCount, 4);

      const editJob = await apiFetch(baseUrl, 'PUT', '/api/admin/economy/jobs/entregador', 'token-admin', {
        baseSalary: 185,
        durationSeconds: 30,
        cooldownSeconds: 20,
      });
      assert.equal(editJob.status, 200);
      assert.equal(backend.store.get('jobs/entregador')!.baseSalary, 185);

      // Audited positive adjustment on Alpha's dirtyCash (remains strictly separate from legal bank)
      const adjDirty = await apiFetch(baseUrl, 'POST', '/api/admin/economy/adjust', 'token-admin', {
        targetUid: 'uid-alpha',
        targetAccount: 'dirty_cash',
        delta: 250,
        reason: 'Teste de auditoria de dinheiro sujo separado',
        operationId: 'op_adj_dirty_1',
      });
      assert.equal(adjDirty.status, 200);
      assert.equal(adjDirty.json.newBalance, 250);
      assert.equal(backend.store.get('wallets/uid-alpha')!.dirtyCash, 250);
      assert.equal(backend.store.get('wallets/uid-alpha')!.cleanCash, 349.75);

      // Adjustment that would produce negative balance is rejected
      const negAdj = await apiFetch(baseUrl, 'POST', '/api/admin/economy/adjust', 'token-admin', {
        targetUid: 'uid-alpha',
        targetAccount: 'dirty_cash',
        delta: -500,
        reason: 'Tentativa negativa deve falhar',
        operationId: 'op_adj_neg_1',
      });
      assert.equal(negAdj.status, 400);

      // Admin overview sees all players, transactions, jobs, and admin_logs
      const overview = await apiFetch(baseUrl, 'GET', '/api/admin/economy/overview', 'token-admin');
      assert.equal(overview.status, 200);
      const txs = overview.json.transactions as Array<Record<string, unknown>>;
      const logs = overview.json.adminLogs as Array<Record<string, unknown>>;
      assert.ok(txs.length >= 6, `Esperado >= 6 transações, obtido ${txs.length}`);
      assert.ok(logs.length >= 3, `Esperado >= 3 logs administrativos, obtido ${logs.length}`);
    });

    console.log(`\nSUCESSO: Todos os ${passed}/7 testes E2E do Sistema Econômico passaram.`);
  } finally {
    await server.shutdown();
  }
}

runTests().catch((err) => {
  console.error('\nFALHA NOS TESTES E2E DE ECONOMIA:', err);
  process.exit(1);
});
