import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { FirestoreRestClient, type FirestoreBackend } from './firestoreRest.ts';
import { registerEconomyRoutes } from './economyRoutes.ts';
import { registerBusinessRoutes } from './businessRoutes.ts';
import { registerVehicleRoutes } from './vehicleRoutes.ts';

export interface VerifiedTokenPayload {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  isBootstrappedOwner: boolean;
}

export interface SharedPlayerState {
  uid: string;
  alias: string;
  characterName: string;
  district: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  coatColor: string;
  accentColor: string;
  skinTone: string;
  style: string;
  isMoving: boolean;
  updatedAt: number;
}

export interface WorldServerOptions {
  firebaseProjectId: string;
  firestoreDatabaseId?: string;
  bootstrappedAdminEmail: string;
  customVerifier?: (token: string) => Promise<VerifiedTokenPayload>;
  firestoreBackend?: FirestoreBackend;
  nowFn?: () => number;
  heartbeatIntervalMs?: number;
}

export interface WorldServerInstance {
  app: express.Express;
  httpServer: http.Server;
  wss: WebSocketServer;
  sharedPlayers: Map<string, SharedPlayerState>;
  shutdown: () => Promise<void>;
}

const WORLD_BOUND = 36;
const SAFE_SPAWN = { x: 0, z: 6.5, rotY: Math.PI };
const VALID_STYLES = new Set(['executivo', 'urbano', 'tatico']);
const ESTABLISHMENT_FOOTPRINTS = [
  { x: -18, z: -18, hw: 8.3, hd: 7.3 },
  { x: 18, z: -18, hw: 7.8, hd: 6.8 },
  { x: -18, z: 18, hw: 8.3, hd: 7.3 },
  { x: 18, z: 18, hw: 8.3, hd: 7.3 },
];

function clampCoord(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, value));
}

function clampRotY(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const wrapped = ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Number.isFinite(wrapped) ? wrapped : fallback;
}

function isInsideBlockedZone(x: number, z: number): boolean {
  if (x * x + z * z < 2.55 * 2.55) return true;
  for (const b of ESTABLISHMENT_FOOTPRINTS) {
    if (Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd) {
      return true;
    }
  }
  return false;
}

function sanitizeSpawn(xRaw: unknown, zRaw: unknown): { x: number; z: number } {
  const x = clampCoord(xRaw, SAFE_SPAWN.x);
  const z = clampCoord(zRaw, SAFE_SPAWN.z);
  if (isInsideBlockedZone(x, z)) {
    return { x: SAFE_SPAWN.x, z: SAFE_SPAWN.z };
  }
  return { x, z };
}

function sanitizeHex(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value;
  }
  return fallback;
}

function sanitizeStyle(value: unknown, fallback: string): string {
  if (typeof value === 'string' && VALID_STYLES.has(value)) {
    return value;
  }
  return fallback;
}

function sanitizeShortString(
  value: unknown,
  fallback: string,
  maxLen: number,
  regex?: RegExp
): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().slice(0, maxLen);
  if (trimmed.length === 0) return fallback;
  if (regex && !regex.test(trimmed)) return fallback;
  return trimmed;
}

interface AuthedRequest extends Request {
  verifiedUser?: VerifiedTokenPayload;
  rawIdToken?: string;
}

interface SocketMeta {
  uid: string | null;
  isAlive: boolean;
  windowStart: number;
  msgCountInWindow: number;
  lastMoveTs: number;
}

export function createWorldServer(options: WorldServerOptions): WorldServerInstance {
  const {
    firebaseProjectId,
    firestoreDatabaseId = '(default)',
    bootstrappedAdminEmail,
    customVerifier,
    firestoreBackend,
    nowFn,
    heartbeatIntervalMs = 15000,
  } = options;

  const economyBackend: FirestoreBackend =
    firestoreBackend ?? new FirestoreRestClient(firebaseProjectId, firestoreDatabaseId);

  let jwks: JWTVerifyGetKey | null = null;
  const verifyToken = async (token: string): Promise<VerifiedTokenPayload> => {
    if (customVerifier) {
      return customVerifier(token);
    }
    if (!token || token.length > 8192) {
      throw new Error('Token inválido.');
    }
    if (!jwks) {
      jwks = createRemoteJWKSet(
        new URL(
          'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
        )
      );
    }

    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
    });

    const uid = typeof payload.sub === 'string' && payload.sub.length > 0 ? payload.sub : null;
    if (!uid) {
      throw new Error('Subject (uid) ausente no token.');
    }

    const email = typeof payload.email === 'string' ? payload.email : null;
    const emailVerified = payload.email_verified === true;
    const isBootstrappedOwner = Boolean(
      emailVerified && email && email.toLowerCase() === bootstrappedAdminEmail.toLowerCase()
    );

    return { uid, email, emailVerified, isBootstrappedOwner };
  };

  const sharedPlayers = new Map<string, SharedPlayerState>();
  const socketMeta = new Map<WebSocket, SocketMeta>();
  const uidToSocket = new Map<string, WebSocket>();

  const broadcastJson = (payload: Record<string, unknown>, excludeSocket?: WebSocket): void => {
    const serialized = JSON.stringify(payload);
    for (const [client, meta] of socketMeta.entries()) {
      // Broadcast ONLY to authenticated active citizens
      if (meta.uid && client !== excludeSocket && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  const removePlayerForSocket = (ws: WebSocket): void => {
    const meta = socketMeta.get(ws);
    socketMeta.delete(ws);
    if (!meta?.uid) return;

    const uid = meta.uid;
    if (uidToSocket.get(uid) === ws) {
      uidToSocket.delete(uid);
      sharedPlayers.delete(uid);
      broadcastJson({ type: 'player:left', uid });
    }
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const requireAuthMiddleware = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token de autenticação ausente.' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    try {
      req.verifiedUser = await verifyToken(token);
      req.rawIdToken = token;
      next();
    } catch {
      res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
    }
  };

  // Health & shared universe telemetry (public safe metadata only)
  app.get('/api/health', (_req, res) => {
    res.json({
      service: 'lce-universe-server',
      status: 'operational',
      shard: 'distrito-central',
      onlinePlayers: sharedPlayers.size,
      timestamp: Date.now(),
    });
  });

  // Shared world snapshot summary
  app.get('/api/world/state', (_req, res) => {
    res.json({
      universe: 'LIFE CRIMINAL EXPERIENCE',
      activeDistrict: 'distrito-central',
      onlineCount: sharedPlayers.size,
      players: Array.from(sharedPlayers.values()).map((p) => ({
        uid: p.uid,
        alias: p.alias,
        characterName: p.characterName,
        district: p.district,
        x: Math.round(p.x * 10) / 10,
        z: Math.round(p.z * 10) / 10,
      })),
    });
  });

  // Cryptographic Firebase ID Token verification endpoint
  app.post('/api/auth/verify', requireAuthMiddleware, (req: AuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    res.json({
      verified: true,
      uid: user.uid,
      emailVerified: user.emailVerified,
      isBootstrappedOwner: user.isBootstrappedOwner,
    });
  });

  // Protected Administrative session endpoint
  app.get('/api/admin/session', requireAuthMiddleware, (req: AuthedRequest, res: Response) => {
    const user = req.verifiedUser!;
    if (!user.emailVerified) {
      res.status(403).json({
        authorized: false,
        reason: 'E-mail não verificado para sessão administrativa.',
      });
      return;
    }

    res.json({
      authorized: true,
      uid: user.uid,
      isBootstrappedOwner: user.isBootstrappedOwner,
      serverTimestamp: Date.now(),
      shardStats: {
        onlinePlayers: sharedPlayers.size,
        activeDistricts: ['distrito-central'],
        economyMode: 'mixed_authoritative_v2',
      },
    });
  });

  // Mount authoritative LCE economic, banking, work, and admin economy routes
  registerEconomyRoutes({
    app,
    backend: economyBackend,
    requireAuth: requireAuthMiddleware,
    nowFn,
  });

  // Mount authoritative Module 3 business, hiring, payroll, inventory, and admin business routes
  registerBusinessRoutes({
    app,
    backend: economyBackend,
    requireAuth: requireAuthMiddleware,
    nowFn,
  });

  // Mount authoritative Module 4 vehicles, dealerships, garage, P2P marketplace, and admin routes
  registerVehicleRoutes({
    app,
    backend: economyBackend,
    requireAuth: requireAuthMiddleware,
    nowFn,
  });

  const httpServer = http.createServer(app);

  // Authoritative WebSocket Server with maxPayload protection
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws/world',
    maxPayload: 4096,
  });

  wss.on('connection', (ws: WebSocket) => {
    const meta: SocketMeta = {
      uid: null,
      isAlive: true,
      windowStart: Date.now(),
      msgCountInWindow: 0,
      lastMoveTs: 0,
    };
    socketMeta.set(ws, meta);

    // Require authentication within 10 seconds to prevent idle unauthenticated sockets
    const authTimeout = setTimeout(() => {
      if (!meta.uid && ws.readyState === WebSocket.OPEN) {
        ws.close(1008, 'Authentication timeout');
      }
    }, 10000);

    ws.on('pong', () => {
      meta.isAlive = true;
    });

    ws.on('message', async (rawData) => {
      meta.isAlive = true;

      // Per-socket sliding-window rate limiter (1 second window)
      const now = Date.now();
      if (now - meta.windowStart >= 1000) {
        meta.windowStart = now;
        meta.msgCountInWindow = 0;
      }
      meta.msgCountInWindow += 1;

      if (meta.msgCountInWindow > 75) {
        ws.close(1008, 'Rate limit exceeded');
        return;
      }
      if (meta.msgCountInWindow > 35) {
        return;
      }

      let msg: Record<string, unknown>;
      try {
        const parsed = JSON.parse(String(rawData));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return;
        }
        msg = parsed as Record<string, unknown>;
      } catch {
        return;
      }

      const type = msg.type;

      if (type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong', ts: now }));
        }
        return;
      }

      if (type === 'player:join') {
        const idToken = typeof msg.idToken === 'string' ? msg.idToken : '';
        try {
          const verified = await verifyToken(idToken);
          if (!verified.emailVerified) {
            throw new Error('E-mail não verificado.');
          }

          clearTimeout(authTimeout);
          const authenticatedUid = verified.uid;
          meta.uid = authenticatedUid;

          // Replace prior socket if same user reconnected (prevents duplicate ghost sessions)
          const existingSock = uidToSocket.get(authenticatedUid);
          if (existingSock && existingSock !== ws) {
            const oldMeta = socketMeta.get(existingSock);
            if (oldMeta) oldMeta.uid = null;
            socketMeta.delete(existingSock);
            try {
              existingSock.close(1000, 'Reconnected from another session');
            } catch {
              // ignore close error
            }
          }

          const spawn = sanitizeSpawn(msg.x, msg.z);
          const state: SharedPlayerState = {
            uid: authenticatedUid,
            alias: sanitizeShortString(msg.alias, 'Cidadao', 24, /^[a-zA-Z0-9_-]+$/),
            characterName: sanitizeShortString(
              msg.characterName,
              'Cidadão LCE',
              32,
              /^[a-zA-Z0-9À-ÿ _-]+$/
            ),
            district: 'distrito-central',
            x: spawn.x,
            y: 0,
            z: spawn.z,
            rotY: clampRotY(msg.rotY, SAFE_SPAWN.rotY),
            coatColor: sanitizeHex(msg.coatColor, '#1E293B'),
            accentColor: sanitizeHex(msg.accentColor, '#D97706'),
            skinTone: sanitizeHex(msg.skinTone, '#D4A373'),
            style: sanitizeStyle(msg.style, 'urbano'),
            isMoving: false,
            updatedAt: now,
          };

          uidToSocket.set(authenticatedUid, ws);
          sharedPlayers.set(authenticatedUid, state);

          // Send complete fresh snapshot to the newly connected citizen
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'world:snapshot',
                selfUid: authenticatedUid,
                players: Array.from(sharedPlayers.values()),
              })
            );
          }

          // Broadcast idempotent join/rejoin to all other authenticated citizens
          broadcastJson({ type: 'player:joined', player: state }, ws);
        } catch {
          clearTimeout(authTimeout);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: 'Falha na autenticação multiplayer.' }));
            ws.close(1008, 'Unauthorized');
          }
        }
        return;
      }

      // Reject all gameplay messages from unauthenticated sockets
      const authenticatedUid = meta.uid;
      if (!authenticatedUid) {
        return;
      }

      if (type === 'player:move') {
        const isStopping = msg.isMoving === false;
        // Allow immediate stop packet so remote animations settle cleanly; throttle moving packets
        if (!isStopping && now - meta.lastMoveTs < 30) return;
        meta.lastMoveTs = now;

        const current = sharedPlayers.get(authenticatedUid);
        if (!current) return;

        const nextX = clampCoord(msg.x, current.x);
        const nextZ = clampCoord(msg.z, current.z);
        const nextRotY = clampRotY(msg.rotY, current.rotY);

        // Anti-teleport & building collision guard
        const dx = nextX - current.x;
        const dz = nextZ - current.z;
        if (dx * dx + dz * dz > 64) {
          return;
        }
        if (isInsideBlockedZone(nextX, nextZ)) {
          return;
        }

        current.x = nextX;
        current.z = nextZ;
        current.rotY = nextRotY;
        current.isMoving = msg.isMoving === true;
        current.updatedAt = now;

        // Server always stamps authenticatedUid (ignores any client-supplied uid)
        broadcastJson(
          {
            type: 'player:moved',
            uid: authenticatedUid,
            x: current.x,
            z: current.z,
            rotY: current.rotY,
            isMoving: current.isMoving,
          },
          ws
        );
        return;
      }

      if (type === 'player:appearance') {
        const current = sharedPlayers.get(authenticatedUid);
        if (!current) return;

        current.coatColor = sanitizeHex(msg.coatColor, current.coatColor);
        current.accentColor = sanitizeHex(msg.accentColor, current.accentColor);
        current.skinTone = sanitizeHex(msg.skinTone, current.skinTone);
        current.style = sanitizeStyle(msg.style, current.style);
        current.updatedAt = now;

        broadcastJson(
          {
            type: 'player:updated',
            player: current,
          },
          ws
        );
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      removePlayerForSocket(ws);
    });

    ws.on('error', () => {
      clearTimeout(authTimeout);
      removePlayerForSocket(ws);
    });
  });

  // Liveness reaper: detects half-open / crashed browser tabs and evicts stale sessions cleanly
  const livenessTimer = setInterval(() => {
    for (const [ws, meta] of socketMeta.entries()) {
      if (!meta.isAlive) {
        removePlayerForSocket(ws);
        try {
          ws.terminate();
        } catch {
          // ignore terminate error
        }
        continue;
      }
      meta.isAlive = false;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {
          removePlayerForSocket(ws);
        }
      }
    }
  }, heartbeatIntervalMs);

  const shutdown = async (): Promise<void> => {
    clearInterval(livenessTimer);
    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { app, httpServer, wss, sharedPlayers, shutdown };
}
