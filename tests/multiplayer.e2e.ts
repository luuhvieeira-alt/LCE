/**
 * Automated End-to-End Multiplayer & Security Verification Suite (Etapa 6)
 * Tests two real simultaneous WebSocket clients against createWorldServer.
 */
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createWorldServer, type VerifiedTokenPayload } from '../src/server/worldServer.ts';

interface QueuedWs {
  ws: WebSocket;
  messages: Record<string, unknown>[];
  waitFor: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  waitClose: (timeoutMs?: number) => Promise<{ code: number; reason: string }>;
}

function connectClient(url: string): Promise<QueuedWs> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: Record<string, unknown>[] = [];
    const waiters: Array<{
      predicate: (msg: Record<string, unknown>) => boolean;
      resolve: (msg: Record<string, unknown>) => void;
    }> = [];

    let closeInfo: { code: number; reason: string } | null = null;
    const closeWaiters: Array<(info: { code: number; reason: string }) => void> = [];

    ws.on('message', (data) => {
      const parsed = JSON.parse(String(data)) as Record<string, unknown>;
      const idx = waiters.findIndex((w) => w.predicate(parsed));
      if (idx >= 0) {
        const [matched] = waiters.splice(idx, 1);
        matched.resolve(parsed);
      } else {
        messages.push(parsed);
      }
    });

    ws.on('close', (code, reasonBuf) => {
      closeInfo = { code, reason: reasonBuf.toString() };
      while (closeWaiters.length) {
        closeWaiters.shift()!(closeInfo);
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        messages,
        waitFor(predicate, timeoutMs = 3000) {
          const existingIdx = messages.findIndex(predicate);
          if (existingIdx >= 0) {
            const [found] = messages.splice(existingIdx, 1);
            return Promise.resolve(found);
          }
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              rej(new Error(`Timeout aguardando evento WebSocket (${timeoutMs}ms)`));
            }, timeoutMs);
            waiters.push({
              predicate,
              resolve: (msg) => {
                clearTimeout(timer);
                res(msg);
              },
            });
          });
        },
        waitClose(timeoutMs = 3000) {
          if (closeInfo) return Promise.resolve(closeInfo);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error('Timeout aguardando fechamento WS')), timeoutMs);
            closeWaiters.push((info) => {
              clearTimeout(timer);
              res(info);
            });
          });
        },
      });
    });

    ws.on('error', (err) => reject(err));
  });
}

async function runTests() {
  const tokenMap = new Map<string, VerifiedTokenPayload>([
    [
      'token-alpha',
      {
        uid: 'uid-alpha',
        email: 'alpha@lce.test',
        emailVerified: true,
        isBootstrappedOwner: false,
      },
    ],
    [
      'token-beta',
      {
        uid: 'uid-beta',
        email: 'beta@lce.test',
        emailVerified: true,
        isBootstrappedOwner: false,
      },
    ],
    [
      'token-unverified',
      {
        uid: 'uid-unverified',
        email: 'unverified@lce.test',
        emailVerified: false,
        isBootstrappedOwner: false,
      },
    ],
  ]);

  const server = createWorldServer({
    firebaseProjectId: 'lce-test-project',
    bootstrappedAdminEmail: 'luuhvieeira@gmail.com',
    heartbeatIntervalMs: 60000,
    customVerifier: async (token) => {
      const payload = tokenMap.get(token);
      if (!payload) throw new Error('Invalid token');
      return payload;
    },
  });

  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const address = server.httpServer.address();
  assert(address && typeof address === 'object', 'Servidor não obteve porta');
  const baseHttp = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws/world`;

  try {
    // 1. Reject forged & unverified tokens
    const badClient = await connectClient(wsUrl);
    badClient.ws.send(JSON.stringify({ type: 'player:join', idToken: 'forged-token' }));
    const badClose = await badClient.waitClose();
    assert.equal(badClose.code, 1008, 'Token inválido deve ser recusado com código 1008');

    const unverifiedClient = await connectClient(wsUrl);
    unverifiedClient.ws.send(JSON.stringify({ type: 'player:join', idToken: 'token-unverified' }));
    const unvClose = await unverifiedClient.waitClose();
    assert.equal(unvClose.code, 1008, 'E-mail não verificado deve ser recusado com código 1008');
    console.log('[PASS] 1. Autenticação e rejeição de tokens inválidos/não verificados');

    // 2. Two simultaneous authenticated clients join same city
    const clientA = await connectClient(wsUrl);
    clientA.ws.send(
      JSON.stringify({
        type: 'player:join',
        idToken: 'token-alpha',
        characterName: 'Henrique Valente',
        alias: 'HValente',
        coatColor: '#181C24',
        accentColor: '#D97706',
        skinTone: '#D4A373',
        style: 'executivo',
        x: 0,
        z: 6.5,
        rotY: Math.PI,
      })
    );
    const snapA = await clientA.waitFor((m) => m.type === 'world:snapshot');
    assert.equal(snapA.selfUid, 'uid-alpha');
    assert.equal((snapA.players as unknown[]).length, 1);

    const clientB = await connectClient(wsUrl);
    clientB.ws.send(
      JSON.stringify({
        type: 'player:join',
        idToken: 'token-beta',
        characterName: 'Clara Rocha',
        alias: 'CRocha',
        coatColor: '#2B3445',
        accentColor: '#B48A3E',
        skinTone: '#E6BC9A',
        style: 'urbano',
        x: 3.5,
        z: 8.0,
        rotY: 0,
      })
    );
    const snapB = await clientB.waitFor((m) => m.type === 'world:snapshot');
    assert.equal(snapB.selfUid, 'uid-beta');
    assert.equal((snapB.players as unknown[]).length, 2, 'Client B deve receber ambos os jogadores no snapshot');

    const joinedOnA = await clientA.waitFor((m) => m.type === 'player:joined');
    assert.equal((joinedOnA.player as { uid: string }).uid, 'uid-beta');
    assert.equal((joinedOnA.player as { characterName: string }).characterName, 'Clara Rocha');

    const stateRes = await fetch(`${baseHttp}/api/world/state`);
    const worldState = (await stateRes.json()) as { onlineCount: number };
    assert.equal(worldState.onlineCount, 2, '/api/world/state deve mostrar 2 jogadores online');
    console.log('[PASS] 2. Dois jogadores simultâneos na mesma cidade com IDs únicos');

    // 3. Independent movement + anti-spoofing (Client A tries to send uid-beta!)
    clientA.ws.send(
      JSON.stringify({
        type: 'player:move',
        uid: 'uid-beta', // Attempted identity spoof — server MUST ignore
        x: 1.5,
        z: 7.5,
        rotY: 1.2,
        isMoving: true,
      })
    );
    const moveOnB = await clientB.waitFor((m) => m.type === 'player:moved');
    assert.equal(moveOnB.uid, 'uid-alpha', 'Servidor deve forçar uid-alpha (impedir controle de outro jogador)');
    assert.equal(moveOnB.x, 1.5);
    assert.equal(moveOnB.z, 7.5);

    clientB.ws.send(
      JSON.stringify({
        type: 'player:move',
        x: 4.5,
        z: 9.2,
        rotY: -0.5,
        isMoving: true,
      })
    );
    const moveOnA = await clientA.waitFor((m) => m.type === 'player:moved');
    assert.equal(moveOnA.uid, 'uid-beta');
    assert.equal(moveOnA.x, 4.5);
    assert.equal(moveOnA.z, 9.2);
    console.log('[PASS] 3. Movimentação independente e bloqueio de controle de outro personagem');

    // 4. Live appearance synchronization
    clientA.ws.send(
      JSON.stringify({
        type: 'player:appearance',
        coatColor: '#5C2229',
        accentColor: '#94A3B8',
        skinTone: '#A9744F',
        style: 'tatico',
      })
    );
    const updatedOnB = await clientB.waitFor((m) => m.type === 'player:updated');
    const updatedPlayer = updatedOnB.player as { uid: string; coatColor: string; style: string };
    assert.equal(updatedPlayer.uid, 'uid-alpha');
    assert.equal(updatedPlayer.coatColor, '#5C2229');
    assert.equal(updatedPlayer.style, 'tatico');
    console.log('[PASS] 4. Sincronização de personalização de aparência em tempo real');

    // 5. Disconnect recognition & immediate cleanup
    clientA.ws.close(1000, 'Logout test');
    const leftOnB = await clientB.waitFor((m) => m.type === 'player:left');
    assert.equal(leftOnB.uid, 'uid-alpha', 'Client B deve remover Client A ao desconectar');

    const afterLeaveRes = await fetch(`${baseHttp}/api/world/state`);
    const afterLeaveState = (await afterLeaveRes.json()) as { onlineCount: number };
    assert.equal(afterLeaveState.onlineCount, 1, 'Servidor deve manter apenas 1 jogador ativo');
    console.log('[PASS] 5. Desconexão reconhecida imediatamente sem fantasmas na cena');

    // 6. Reconnection receives fresh positions (zero stale positions from closed session)
    await new Promise((r) => setTimeout(r, 40));
    clientB.ws.send(
      JSON.stringify({
        type: 'player:move',
        x: 5.2,
        z: 10.4,
        rotY: 0.4,
        isMoving: false,
      })
    );
    await new Promise((r) => setTimeout(r, 40));

    const clientAReconnected = await connectClient(wsUrl);
    clientAReconnected.ws.send(
      JSON.stringify({
        type: 'player:join',
        idToken: 'token-alpha',
        characterName: 'Henrique Valente',
        alias: 'HValente',
        coatColor: '#5C2229',
        accentColor: '#94A3B8',
        skinTone: '#A9744F',
        style: 'tatico',
        x: 1.5,
        z: 7.5,
        rotY: 1.2,
      })
    );
    const freshSnap = await clientAReconnected.waitFor((m) => m.type === 'world:snapshot');
    const snapPlayers = freshSnap.players as Array<{ uid: string; x: number; z: number }>;
    const betaInSnap = snapPlayers.find((p) => p.uid === 'uid-beta');
    assert(betaInSnap, 'Client B deve estar no snapshot de reconexão');
    assert.equal(betaInSnap.x, 5.2, 'Posição de Client B deve ser a mais recente, sem estado antigo');
    assert.equal(betaInSnap.z, 10.4);
    console.log('[PASS] 6. Reconexão sincronizada com estado atual (zero posições antigas)');

    // 7. Rate-limit abuse protection
    const flooder = await connectClient(wsUrl);
    for (let i = 0; i < 90; i++) {
      if (flooder.ws.readyState === WebSocket.OPEN) {
        flooder.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }
    const floodClose = await flooder.waitClose();
    assert.equal(floodClose.code, 1008, 'Excesso de mensagens deve encerrar a conexão com código 1008');
    console.log('[PASS] 7. Limite de frequência (rate limiting) validado no WebSocket');

    clientB.ws.close();
    clientAReconnected.ws.close();
  } finally {
    await server.shutdown();
  }

  console.log('\nTodos os 7 testes E2E do multiplayer compartilhado passaram com sucesso.');
}

runTests().catch((err) => {
  console.error('[FAIL] Erro no teste E2E multiplayer:', err);
  process.exit(1);
});
