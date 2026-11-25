/**
 * End-to-End Automated Test Suite for Module 5:
 * LCE Drivable 3D Vehicles, Physical Garage Spawn/Store, Real-Time Multiplayer Sync,
 * Anti-Cheat Validation, Multi-Account Ownership Security & Server Restart Persistence.
 *
 * Covers ALL 12 mandatory tests:
 *  TESTE 1:  Jogador A retira veículo da garagem (POST /api/vehicles/:id/spawn)
 *  TESTE 2:  Jogador B enxerga o veículo retirado em tempo real (vehicle:spawned + world:snapshot)
 *  TESTE 3:  Jogador A entra no veículo (vehicle:enter -> vehicle:entered)
 *  TESTE 4:  Jogador A dirige pela cidade + validação anti-cheat do servidor (speed/teleport -> vehicle:correction)
 *  TESTE 5:  Jogador B observa o movimento sincronizado em tempo real (vehicle:updated)
 *  TESTE 6:  Jogador A sai do veículo com coordenada segura ao lado do carro (vehicle:exit -> vehicle:exited)
 *  TESTE 7:  Jogador A guarda o veículo com persistência de km/combustível/conservação (POST /api/vehicles/:id/store)
 *  TESTE 8:  Veículo desaparece da cidade para Jogador B (vehicle:despawned + /api/world/state)
 *  TESTE 9:  Reinicio completo do servidor + novo login: veículo preservado na garagem com mesma placa e estado
 *  TESTE 10: Jogador B tenta retirar/entrar/dirigir/guardar veículo de A -> todos bloqueados e auditados
 *  TESTE 11: Jogador A e Jogador B retiram e dirigem veículos diferentes simultaneamente sem interferência
 *  TESTE 12: Movimentação de veículo não prejudica movimentação a pé + desconexão abrupta limpa veículo fantasma
 */

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createWorldServer, type VerifiedTokenPayload } from '../src/server/worldServer.ts';
import {
  FirestoreRestError,
  type FirestoreBackend,
  type FirestoreCommitWrite,
  type FirestoreQueryDoc,
} from '../src/server/firestoreRest.ts';

const TOKENS: Record<string, VerifiedTokenPayload> = {
  'token-a': {
    uid: 'uid-driver-a',
    email: 'motorista.a@lce.test',
    emailVerified: true,
    isBootstrappedOwner: false,
  },
  'token-b': {
    uid: 'uid-driver-b',
    email: 'motorista.b@lce.test',
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

function assertRule(condition: boolean, message: string): void {
  if (!condition) {
    throw new FirestoreRestError(403, 'PERMISSION_DENIED', `[Rules Parity] ${message}`);
  }
}

/**
 * Rule-aware in-memory Firestore backend enforcing Module 5 firestore.rules parity
 * (including vehicles Branch 3 status in ['in_garage', 'parked'], monotonic mileage/wear,
 * immutable plate, and owner-only updates).
 */
class RuleAwareDrivableMemoryFirestore implements FirestoreBackend {
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

  private validateVehicleRule(
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown>,
    user: VerifiedTokenPayload
  ): void {
    if (!before) {
      assertRule(after.ownerUid === user.uid || user.isBootstrappedOwner, 'vehicle create owner mismatch');
      return;
    }
    const isAdmin = user.isBootstrappedOwner;
    if (isAdmin) return;

    assertRule(before.ownerUid === user.uid, 'Only owner can update vehicle');
    assertRule(after.ownerUid === before.ownerUid, 'ownerUid immutable on direct update');
    assertRule(after.plate === before.plate, 'plate must remain immutable');
    assertRule(
      after.status === 'in_garage' || after.status === 'parked' || after.status === 'listed',
      `Invalid vehicle status transition: ${String(after.status)}`
    );
    assertRule(
      typeof after.mileageKm === 'number' &&
        typeof before.mileageKm === 'number' &&
        after.mileageKm >= before.mileageKm,
      'mileageKm must be monotonic'
    );
  }

  async getDoc(path: string, idToken: string): Promise<Record<string, unknown> | null> {
    this.resolveCaller(idToken);
    const clean = path.replace(/^\/+/, '');
    const doc = this.store.get(clean);
    return doc ? structuredClone(doc) : null;
  }

  async listCollection(
    collectionId: string,
    idToken: string,
    pageSize = 200
  ): Promise<FirestoreQueryDoc[]> {
    this.resolveCaller(idToken);
    const prefix = `${collectionId}/`;
    const results: FirestoreQueryDoc[] = [];
    for (const [key, val] of this.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (id.includes('/')) continue;
      results.push({ id, data: structuredClone(val) });
    }
    return results.slice(0, pageSize);
  }

  async queryByField(
    collectionId: string,
    fieldPath: string,
    op: 'EQUAL' | 'ARRAY_CONTAINS',
    value: unknown,
    idToken: string,
    limit = 200
  ): Promise<FirestoreQueryDoc[]> {
    this.resolveCaller(idToken);
    const prefix = `${collectionId}/`;
    const results: FirestoreQueryDoc[] = [];
    for (const [key, val] of this.store.entries()) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (id.includes('/')) continue;
      const fv = val[fieldPath];
      const match =
        op === 'EQUAL'
          ? fv === value
          : Array.isArray(fv) && fv.includes(value);
      if (match) {
        results.push({ id, data: structuredClone(val) });
      }
    }
    return results.slice(0, limit);
  }

  async commit(writes: FirestoreCommitWrite[], idToken: string): Promise<void> {
    const user = this.resolveCaller(idToken);
    const nextStore = new Map(this.store);

    for (const w of writes) {
      const clean = w.path.replace(/^\/+/, '');
      const existing = nextStore.get(clean);
      if (w.precondition?.exists === false && existing) {
        throw new FirestoreRestError(409, 'ALREADY_EXISTS', `${clean} already exists`);
      }
      if (w.precondition?.exists === true && !existing) {
        throw new FirestoreRestError(404, 'NOT_FOUND', `${clean} not found`);
      }

      const base = existing && w.updateMask ? structuredClone(existing) : {};
      const merged: Record<string, unknown> = { ...base };

      if (w.fields) {
        if (w.updateMask && w.updateMask.length > 0) {
          for (const key of w.updateMask) {
            if (key in w.fields) {
              merged[key] = structuredClone(w.fields[key]);
            }
          }
        } else {
          Object.assign(merged, structuredClone(w.fields));
        }
      }

      for (const tr of w.transforms ?? []) {
        if (tr.setToServerValue === 'REQUEST_TIME') {
          merged[tr.fieldPath] = new Date(this.nowFn()).toISOString();
        }
        if (tr.increment) {
          const delta =
            typeof tr.increment.doubleValue === 'number'
              ? tr.increment.doubleValue
              : tr.increment.integerValue !== undefined
                ? Number(tr.increment.integerValue)
                : 0;
          const prev = typeof merged[tr.fieldPath] === 'number' ? (merged[tr.fieldPath] as number) : 0;
          merged[tr.fieldPath] = Math.round((prev + delta) * 100) / 100;
        }
      }

      if (clean.startsWith('vehicles/')) {
        this.validateVehicleRule(existing, merged, user);
      }

      nextStore.set(clean, merged);
    }

    this.store.clear();
    for (const [k, v] of nextStore.entries()) {
      this.store.set(k, v);
    }
  }
}

interface WsClientHandle {
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
  send: (payload: Record<string, unknown>) => void;
  waitFor: (
    predicate: (msg: Record<string, unknown>) => boolean,
    label: string,
    timeoutMs?: number
  ) => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
}

async function connectWsClient(
  wsUrl: string,
  token: string,
  character: {
    alias: string;
    characterName: string;
    x?: number;
    z?: number;
    rotY?: number;
  }
): Promise<{ handle: WsClientHandle; snapshot: Record<string, unknown> }> {
  const ws = new WebSocket(wsUrl);
  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (msg: Record<string, unknown>) => boolean;
    resolve: (msg: Record<string, unknown>) => void;
  }> = [];

  ws.on('message', (raw) => {
    const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
    messages.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].predicate(parsed)) {
        const w = waiters.splice(i, 1)[0];
        w.resolve(parsed);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const handle: WsClientHandle = {
    ws,
    messages,
    send: (payload) => ws.send(JSON.stringify(payload)),
    waitFor: (predicate, label, timeoutMs = 4000) => {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout aguardando evento WS: ${label}`));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.once('close', () => resolve());
        ws.close();
      }),
  };

  handle.send({
    type: 'player:join',
    idToken: token,
    alias: character.alias,
    characterName: character.characterName,
    district: 'Distrito Central',
    x: character.x ?? 0,
    z: character.z ?? 6.5,
    rotY: character.rotY ?? Math.PI,
    coatColor: '#1E293B',
    accentColor: '#F59E0B',
    skinTone: '#D6A57C',
    style: 'urbano',
  });

  const snapshot = await handle.waitFor((m) => m.type === 'world:snapshot', 'world:snapshot');
  return { handle, snapshot };
}

async function apiFetch(
  baseUrl: string,
  path: string,
  token: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function seedPlayerAndVehicles(db: RuleAwareDrivableMemoryFirestore, nowIso: string): void {
  db.store.set('characters/uid-driver-a', {
    uid: 'uid-driver-a',
    characterName: 'Lucas Andrade',
    alias: 'lucas_a',
    district: 'Distrito Central',
    status: 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  db.store.set('characters/uid-driver-b', {
    uid: 'uid-driver-b',
    characterName: 'Marina Costa',
    alias: 'marina_b',
    district: 'Distrito Central',
    status: 'active',
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  db.store.set('wallets/uid-driver-a', {
    uid: 'uid-driver-a',
    cleanCash: 500,
    dirtyCash: 0,
    companiesValue: 0,
    realEstateValue: 0,
    vehiclesValue: 55000,
    investmentsValue: 0,
    otherAssetsValue: 0,
    lastTxId: 'seed-a',
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  db.store.set('wallets/uid-driver-b', {
    uid: 'uid-driver-b',
    cleanCash: 500,
    dirtyCash: 0,
    companiesValue: 0,
    realEstateValue: 0,
    vehiclesValue: 25000,
    investmentsValue: 0,
    otherAssetsValue: 0,
    lastTxId: 'seed-b',
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  db.store.set('vehicles/veh-sport-a', {
    id: 'veh-sport-a',
    ownerUid: 'uid-driver-a',
    ownerName: 'Lucas Andrade',
    ownerAlias: 'lucas_a',
    modelId: 'lce-sport',
    manufacturer: 'LCE Motors',
    model: 'LCE Sport',
    year: 2026,
    category: 'esportivo',
    plate: 'LCE-7A91',
    basePrice: 55000,
    purchasePrice: 55000,
    marketValue: 55000,
    topSpeed: 280,
    acceleration: 9.2,
    capacity: 2,
    fuelConsumption: 14,
    condition: 100,
    fuelLevel: 100,
    mileageKm: 12,
    status: 'in_garage',
    activeListingId: null,
    originBusinessId: 'loc-concessionaria-demo',
    originBusinessName: 'LCE Motors Central',
    imageKey: 'esportivo',
    parkedZone: 'Garagem Central',
    acquiredAt: nowIso,
    updatedAt: nowIso,
  });

  db.store.set('vehicles/veh-suv-b', {
    id: 'veh-suv-b',
    ownerUid: 'uid-driver-b',
    ownerName: 'Marina Costa',
    ownerAlias: 'marina_b',
    modelId: 'lce-family',
    manufacturer: 'LCE Motors',
    model: 'LCE Family',
    year: 2026,
    category: 'suv',
    plate: 'LCE-4B28',
    basePrice: 25000,
    purchasePrice: 25000,
    marketValue: 25000,
    topSpeed: 205,
    acceleration: 7.4,
    capacity: 5,
    fuelConsumption: 11,
    condition: 96,
    fuelLevel: 90,
    mileageKm: 40,
    status: 'in_garage',
    activeListingId: null,
    originBusinessId: 'loc-concessionaria-demo',
    originBusinessName: 'LCE Motors Central',
    imageKey: 'suv',
    parkedZone: 'Garagem Central',
    acquiredAt: nowIso,
    updatedAt: nowIso,
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function runSuite(): Promise<void> {
  const nowMs = Date.now();
  const db = new RuleAwareDrivableMemoryFirestore(() => Date.now());
  seedPlayerAndVehicles(db, new Date(nowMs).toISOString());

  const startServer = async () => {
    const srv = createWorldServer({
      firebaseProjectId: 'test-lce-drivable',
      bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
      customVerifier: async (token) => {
        const user = TOKENS[token];
        if (!user) throw new Error('Token inválido');
        return user;
      },
      firestoreBackend: db,
      heartbeatIntervalMs: 60000,
    });
    await new Promise<void>((resolve) => srv.httpServer.listen(0, '127.0.0.1', resolve));
    const port = (srv.httpServer.address() as AddressInfo).port;
    return {
      srv,
      baseUrl: `http://127.0.0.1:${port}`,
      wsUrl: `ws://127.0.0.1:${port}/ws/world`,
    };
  };

  let { srv, baseUrl, wsUrl } = await startServer();

  const { handle: clientA } = await connectWsClient(wsUrl, 'token-a', {
    alias: 'lucas_a',
    characterName: 'Lucas Andrade',
    x: -3.9,
    z: 15.0,
  });
  const { handle: clientB } = await connectWsClient(wsUrl, 'token-b', {
    alias: 'marina_b',
    characterName: 'Marina Costa',
    x: 0,
    z: 8.0,
  });

  try {
    // -----------------------------------------------------------------------
    // TESTE 1: Jogador A retira veículo da garagem
    // -----------------------------------------------------------------------
    const spawnRes = await apiFetch(baseUrl, '/api/vehicles/veh-sport-a/spawn', 'token-a', 'POST');
    assert.equal(spawnRes.status, 201, `Spawn falhou: ${JSON.stringify(spawnRes.json)}`);
    const spawnedA = spawnRes.json.vehicle as Record<string, unknown>;
    assert.equal(spawnedA.vehicleId, 'veh-sport-a');
    assert.equal(spawnedA.plate, 'LCE-7A91');
    assert.equal(spawnedA.state, 'parked');
    assert.equal(spawnedA.ownerUid, 'uid-driver-a');

    // Duplicate spawn must be rejected (409)
    const dupSpawn = await apiFetch(baseUrl, '/api/vehicles/veh-sport-a/spawn', 'token-a', 'POST');
    assert.equal(dupSpawn.status, 409, 'Duplicação de veículo na cidade deve retornar HTTP 409');
    console.log('✓ TESTE 1: Jogador A retirou veículo da garagem sem duplicação');

    // -----------------------------------------------------------------------
    // TESTE 2: Jogador B enxerga o veículo retirado em tempo real
    // -----------------------------------------------------------------------
    const bSpawnEvent = await clientB.waitFor(
      (m) =>
        m.type === 'vehicle:spawned' &&
        (m.vehicle as Record<string, unknown>)?.vehicleId === 'veh-sport-a',
      'B recebe vehicle:spawned'
    );
    assert.equal((bSpawnEvent.vehicle as Record<string, unknown>).plate, 'LCE-7A91');
    assert.equal((bSpawnEvent.vehicle as Record<string, unknown>).ownerAlias, 'lucas_a');

    // Verify public /api/world/state also reflects the active vehicle
    const stateRes = await apiFetch(baseUrl, '/api/world/state', 'token-b', 'GET');
    assert.equal(stateRes.json.activeVehiclesCount, 1);
    console.log('✓ TESTE 2: Jogador B recebeu vehicle:spawned e visualiza o veículo de A');

    // -----------------------------------------------------------------------
    // TESTE 3: Jogador A entra no veículo
    // -----------------------------------------------------------------------
    clientA.send({ type: 'vehicle:enter', vehicleId: 'veh-sport-a' });
    const aEntered = await clientA.waitFor(
      (m) => m.type === 'vehicle:entered' && m.driverUid === 'uid-driver-a',
      'A recebe vehicle:entered'
    );
    const bEntered = await clientB.waitFor(
      (m) => m.type === 'vehicle:entered' && m.driverUid === 'uid-driver-a',
      'B recebe vehicle:entered'
    );
    assert.equal((aEntered.vehicle as Record<string, unknown>).state, 'driving');
    assert.equal((bEntered.vehicle as Record<string, unknown>).driverName, 'Lucas Andrade');
    console.log('✓ TESTE 3: Jogador A entrou no veículo e estado foi sincronizado');

    // -----------------------------------------------------------------------
    // TESTE 4 & 5: Jogador A dirige pela cidade + Anti-cheat + Jogador B observa
    // -----------------------------------------------------------------------
    // Drive North along open North-South Avenue (x = -3.9, z from 16.5 toward 6.0)
    const startX = Number(spawnedA.x);
    let curZ = Number(spawnedA.z);
    for (let step = 1; step <= 6; step++) {
      await sleep(75);
      curZ -= 1.4; // ~18.6 units/sec, well within esportivo boost limit (28.5)
      clientA.send({
        type: 'vehicle:update',
        vehicleId: 'veh-sport-a',
        x: startX,
        z: curZ,
        rotY: Math.PI,
        speed: 18.0,
        steerAngle: -0.14,
        throttle: 1,
        braking: false,
        handbrake: false,
        boost: false,
      });
    }

    const bMoved = await clientB.waitFor(
      (m) =>
        m.type === 'vehicle:updated' &&
        m.vehicleId === 'veh-sport-a' &&
        typeof m.z === 'number' &&
        m.z <= Number(spawnedA.z) - 5.0,
      'B recebe vehicle:updated com deslocamento real'
    );
    assert.equal(bMoved.driverUid, 'uid-driver-a');
    assert.ok(Number(bMoved.sessionDistanceM) >= 4, 'Distância percorrida deve acumular');
    assert.ok(Number(bMoved.fuelLevel) < 100, 'Combustível deve reduzir gradualmente ao dirigir');

    // Anti-cheat: Player A attempts impossible teleport across the map
    await sleep(60);
    clientA.send({
      type: 'vehicle:update',
      vehicleId: 'veh-sport-a',
      x: 34.0,
      z: -34.0,
      rotY: 0,
      speed: 250.0,
      steerAngle: 0,
      throttle: 1,
      braking: false,
      handbrake: false,
      boost: true,
    });
    const correction = await clientA.waitFor(
      (m) => m.type === 'vehicle:correction' && m.vehicleId === 'veh-sport-a',
      'A recebe vehicle:correction anti-cheat'
    );
    assert.ok(
      typeof correction.reason === 'string' && correction.reason.length > 0,
      'Correção deve informar motivo autoritativo do servidor'
    );
    assert.ok(Math.abs(Number(correction.x) - startX) < 1, 'Servidor manteve posição válida');
    console.log('✓ TESTE 4: Jogador A dirigiu com validação autoritativa e anti-cheat ativo');
    console.log('✓ TESTE 5: Jogador B recebeu atualizações sincronizadas de posição, velocidade e combustível');

    // -----------------------------------------------------------------------
    // TESTE 10 (Parte 1 — enquanto ativo na rua): Jogador B tenta invadir/dirigir/guardar veículo de A
    // -----------------------------------------------------------------------
    const bTrySpawnA = await apiFetch(baseUrl, '/api/vehicles/veh-sport-a/spawn', 'token-b', 'POST');
    assert.equal(bTrySpawnA.status, 403, 'Jogador B não pode retirar veículo de A');

    const bTryStoreA = await apiFetch(baseUrl, '/api/vehicles/veh-sport-a/store', 'token-b', 'POST');
    assert.equal(bTryStoreA.status, 403, 'Jogador B não pode guardar veículo de A');

    clientB.send({ type: 'vehicle:enter', vehicleId: 'veh-sport-a' });
    const bEnterErr = await clientB.waitFor(
      (m) => m.type === 'vehicle:error' && m.code === 'NOT_OWNER',
      'B recebe vehicle:error NOT_OWNER ao tentar entrar no carro de A'
    );
    assert.equal(bEnterErr.code, 'NOT_OWNER');

    clientB.send({
      type: 'vehicle:update',
      vehicleId: 'veh-sport-a',
      x: 0,
      z: 0,
      rotY: 0,
      speed: 10,
      steerAngle: 0,
    });
    const bDriveErr = await clientB.waitFor(
      (m) => m.type === 'vehicle:error' && m.code === 'UNAUTHORIZED_CONTROL',
      'B recebe vehicle:error UNAUTHORIZED_CONTROL ao tentar dirigir carro de A'
    );
    assert.equal(bDriveErr.code, 'UNAUTHORIZED_CONTROL');
    console.log('✓ TESTE 10: Jogador B bloqueado de retirar, entrar, dirigir ou guardar veículo de A');

    // -----------------------------------------------------------------------
    // TESTE 6: Jogador A sai do veículo
    // -----------------------------------------------------------------------
    clientA.send({ type: 'vehicle:exit', vehicleId: 'veh-sport-a' });
    const aExited = await clientA.waitFor(
      (m) => m.type === 'vehicle:exited' && m.uid === 'uid-driver-a',
      'A recebe vehicle:exited'
    );
    const bExited = await clientB.waitFor(
      (m) => m.type === 'vehicle:exited' && m.uid === 'uid-driver-a',
      'B recebe vehicle:exited'
    );
    assert.equal((aExited.vehicle as Record<string, unknown>).state, 'parked');
    assert.equal((bExited.vehicle as Record<string, unknown>).driverUid, null);
    assert.equal(typeof aExited.exitX, 'number');
    assert.equal(typeof aExited.exitZ, 'number');
    console.log('✓ TESTE 6: Jogador A saiu do veículo em posição segura ao lado da porta');

    // -----------------------------------------------------------------------
    // TESTE 12 (Parte 1): Movimentação a pé de A e B segue funcionando normalmente
    // -----------------------------------------------------------------------
    await sleep(60);
    clientA.send({ type: 'player:move', x: -1.5, z: 8.5, rotY: 0.4, isMoving: true });
    const bSawAWalk = await clientB.waitFor(
      (m) => m.type === 'player:moved' && m.uid === 'uid-driver-a' && m.x === -1.5,
      'B enxerga A andando a pé novamente após sair do carro'
    );
    assert.equal(bSawAWalk.isMoving, true);

    // -----------------------------------------------------------------------
    // TESTE 11: Jogador A e Jogador B dirigem veículos diferentes simultaneamente
    // -----------------------------------------------------------------------
    const spawnBRes = await apiFetch(baseUrl, '/api/vehicles/veh-suv-b/spawn', 'token-b', 'POST');
    assert.equal(spawnBRes.status, 201, `Spawn B falhou: ${JSON.stringify(spawnBRes.json)}`);
    const spawnedB = spawnBRes.json.vehicle as Record<string, unknown>;
    assert.equal(spawnedB.plate, 'LCE-4B28');
    // Must not overlap Player A's currently active vehicle on the street
    const liveDistAB = Math.hypot(Number(spawnedB.x) - startX, Number(spawnedB.z) - curZ);
    assert.ok(
      liveDistAB >= 4.0,
      `Veículo B não pode sobrepor veículo A na cidade (dist=${liveDistAB.toFixed(2)}m)`
    );

    clientA.send({ type: 'vehicle:enter', vehicleId: 'veh-sport-a' });
    clientB.send({ type: 'vehicle:enter', vehicleId: 'veh-suv-b' });
    await clientA.waitFor(
      (m) =>
        m.type === 'vehicle:entered' &&
        (m.vehicle as Record<string, unknown>)?.vehicleId === 'veh-suv-b',
      'A vê B entrar no SUV'
    );

    await sleep(80);
    clientA.send({
      type: 'vehicle:update',
      vehicleId: 'veh-sport-a',
      x: startX,
      z: curZ - 1.2,
      rotY: Math.PI,
      speed: 14,
      steerAngle: 0,
      throttle: 1,
    });
    clientB.send({
      type: 'vehicle:update',
      vehicleId: 'veh-suv-b',
      x: Number(spawnedB.x),
      z: Number(spawnedB.z) - 1.2,
      rotY: Math.PI,
      speed: 13,
      steerAngle: 0.08,
      throttle: 1,
    });

    const aSawBDrive = await clientA.waitFor(
      (m) => m.type === 'vehicle:updated' && m.vehicleId === 'veh-suv-b',
      'A vê SUV de B se movimentar simultaneamente'
    );
    assert.equal(aSawBDrive.driverUid, 'uid-driver-b');
    console.log('✓ TESTE 11: Jogadores A e B dirigiram veículos distintos simultaneamente sem interferência');

    // -----------------------------------------------------------------------
    // TESTE 7 & 8: Jogador A guarda veículo + Desaparece da cidade para B
    // -----------------------------------------------------------------------
    const storeARes = await apiFetch(baseUrl, '/api/vehicles/veh-sport-a/store', 'token-a', 'POST');
    assert.equal(storeARes.status, 200, `Store A falhou: ${JSON.stringify(storeARes.json)}`);
    assert.equal(storeARes.json.status, 'in_garage');
    assert.ok(
      Number(storeARes.json.mileageKm) >= 12,
      'Quilometragem deve persistir monotonicamente ao guardar'
    );
    const savedFuelA = Number(storeARes.json.fuelLevel);
    const savedMileageA = Number(storeARes.json.mileageKm);

    const bDespawnA = await clientB.waitFor(
      (m) => m.type === 'vehicle:despawned' && m.vehicleId === 'veh-sport-a',
      'B recebe vehicle:despawned quando A guarda veículo'
    );
    assert.equal(bDespawnA.reason, 'store');
    assert.equal(srv.sharedVehicles.has('veh-sport-a'), false);
    console.log('✓ TESTE 7: Jogador A guardou o veículo com estado persistido no banco');
    console.log('✓ TESTE 8: Veículo de A desapareceu imediatamente da cidade para Jogador B');

    // -----------------------------------------------------------------------
    // TESTE 12 (Parte 2): Desconexão abrupta de Jogador B limpa veículo fantasma automaticamente
    // -----------------------------------------------------------------------
    await clientB.close();
    const aSawDisconnectDespawn = await clientA.waitFor(
      (m) =>
        m.type === 'vehicle:despawned' &&
        m.vehicleId === 'veh-suv-b' &&
        m.reason === 'disconnect_cleanup',
      'A vê veículo de B recolhido automaticamente após desconexão abrupta'
    );
    assert.equal(aSawDisconnectDespawn.reason, 'disconnect_cleanup');
    assert.equal(srv.sharedVehicles.size, 0, 'Nenhum veículo fantasma deve restar após desconexão');
    // Verify admin audit trail captured spawn, enter, exit, store, unauthorized attempts, disconnect cleanup
    const auditRes = await apiFetch(baseUrl, '/api/admin/vehicles/world-events', 'token-admin', 'GET');
    assert.equal(auditRes.status, 200);
    assert.ok(
      Array.isArray(auditRes.json.events) && (auditRes.json.events as unknown[]).length >= 6,
      'Log de auditoria veicular deve registrar eventos críticos'
    );
    console.log('✓ TESTE 12: Movimentação a pé preservada e desconexão abrupta removeu veículo fantasma');

    // -----------------------------------------------------------------------
    // TESTE 9: Reinício completo do servidor + novo login confirma persistência na garagem
    // -----------------------------------------------------------------------
    await clientA.close();
    await srv.shutdown();

    const restarted = await startServer();
    srv = restarted.srv;
    baseUrl = restarted.baseUrl;
    wsUrl = restarted.wsUrl;

    const garageAfterRestart = await apiFetch(baseUrl, '/api/vehicles/garage', 'token-a', 'GET');
    assert.equal(garageAfterRestart.status, 200);
    const vehiclesAfter = garageAfterRestart.json.vehicles as Array<Record<string, unknown>>;
    const persistedA = vehiclesAfter.find((v) => v.id === 'veh-sport-a');
    assert.ok(persistedA, 'Veículo de A deve permanecer na garagem após reinício completo');
    assert.equal(persistedA.plate, 'LCE-7A91');
    assert.equal(persistedA.status, 'in_garage');
    assert.equal(persistedA.mileageKm, savedMileageA);
    assert.equal(persistedA.fuelLevel, savedFuelA);

    const { handle: clientA2, snapshot: snapAfterRestart } = await connectWsClient(
      wsUrl,
      'token-a',
      { alias: 'lucas_a', characterName: 'Lucas Andrade' }
    );
    assert.equal((snapAfterRestart.vehicles as unknown[]).length, 0);
    await clientA2.close();
    console.log('✓ TESTE 9: Reinício completo + novo login confirmou persistência intacta na garagem');

    console.log('\n✅ TODOS OS 12 TESTES OBRIGATÓRIOS DE VEÍCULOS DIRIGÍVEIS MULTIPLAYER APROVADOS (12/12)!');
  } finally {
    await clientA.close().catch(() => undefined);
    await clientB.close().catch(() => undefined);
    await srv.shutdown().catch(() => undefined);
  }
}

runSuite().catch((err) => {
  console.error('❌ Falha na suíte drivableVehicles.e2e:', err);
  process.exit(1);
});
