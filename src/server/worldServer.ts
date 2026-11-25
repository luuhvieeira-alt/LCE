import crypto from 'crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { FirestoreRestClient, type FirestoreBackend } from './firestoreRest.ts';
import { registerEconomyRoutes } from './economyRoutes.ts';
import { registerBusinessRoutes } from './businessRoutes.ts';
import { registerVehicleRoutes } from './vehicleRoutes.ts';
import {
  GARAGE_EXIT_BAYS,
  VEHICLE_WORLD_BOUND,
  collidesVehicleWithCity,
  findSafeVehicleExitPosition,
  getVehicleHandling,
  type GarageExitBay,
} from '../config/vehiclePhysics.ts';
import type { SharedVehicleState, WorldVehicleEvent } from '../types/multiplayer.ts';

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
  drivingVehicleId: string | null;
  updatedAt: number;
}

export interface WorldVehiclesController {
  getAll: () => SharedVehicleState[];
  getById: (vehicleId: string) => SharedVehicleState | undefined;
  getByOwner: (ownerUid: string) => SharedVehicleState | undefined;
  pickAvailableBay: () => GarageExitBay;
  spawnVehicle: (vehicle: SharedVehicleState) => void;
  despawnVehicle: (
    vehicleId: string,
    actorUid: string,
    reason: 'store' | 'disconnect_cleanup'
  ) => SharedVehicleState | null;
  updateLiveMetrics: (
    vehicleId: string,
    patch: { fuelLevel?: number; condition?: number }
  ) => void;
  getRecentEvents: () => WorldVehicleEvent[];
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
  sharedVehicles: Map<string, SharedVehicleState>;
  vehicleWorldEvents: WorldVehicleEvent[];
  shutdown: () => Promise<void>;
}

const WORLD_BOUND = 36;
const SAFE_SPAWN = { x: 0, z: 6.5, rotY: Math.PI };
const VALID_STYLES = new Set(['executivo', 'urbano', 'tatico']);
const MAX_WORLD_EVENTS = 250;
const ESTABLISHMENT_FOOTPRINTS = [
  { x: -18, z: -18, hw: 8.3, hd: 7.3 },
  { x: 18, z: -18, hw: 7.8, hd: 6.8 },
  { x: -18, z: 18, hw: 8.3, hd: 7.3 },
  { x: 18, z: 18, hw: 8.3, hd: 7.3 },
];

function clampCoord(value: unknown, fallback: number, bound = WORLD_BOUND): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(-bound, Math.min(bound, value));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampRotY(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const wrapped = ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return Number.isFinite(wrapped) ? wrapped : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
  lastVehicleUpdateTs: number;
  lastSpeedWarnTs: number;
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

  const getNow = () => (nowFn ? nowFn() : Date.now());

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
  const sharedVehicles = new Map<string, SharedVehicleState>();
  const vehicleWorldEvents: WorldVehicleEvent[] = [];
  const socketMeta = new Map<WebSocket, SocketMeta>();
  const uidToSocket = new Map<string, WebSocket>();

  const recordVehicleEvent = (
    type: WorldVehicleEvent['type'],
    vehicleId: string,
    plate: string,
    actorUid: string,
    ownerUid: string,
    detail: string
  ): void => {
    vehicleWorldEvents.unshift({
      id: `wev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      type,
      vehicleId,
      plate,
      actorUid,
      ownerUid,
      detail: detail.slice(0, 180),
      timestamp: getNow(),
    });
    if (vehicleWorldEvents.length > MAX_WORLD_EVENTS) {
      vehicleWorldEvents.length = MAX_WORLD_EVENTS;
    }
  };

  const broadcastJson = (payload: Record<string, unknown>, excludeSocket?: WebSocket): void => {
    const serialized = JSON.stringify(payload);
    for (const [client, meta] of socketMeta.entries()) {
      // Broadcast ONLY to authenticated active citizens
      if (meta.uid && client !== excludeSocket && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  const sendToUid = (uid: string, payload: Record<string, unknown>): void => {
    const sock = uidToSocket.get(uid);
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(payload));
    }
  };

  const worldVehiclesController: WorldVehiclesController = {
    getAll: () => Array.from(sharedVehicles.values()),
    getById: (vehicleId: string) => sharedVehicles.get(vehicleId),
    getByOwner: (ownerUid: string) => {
      for (const v of sharedVehicles.values()) {
        if (v.ownerUid === ownerUid) return v;
      }
      return undefined;
    },
    pickAvailableBay: (): GarageExitBay => {
      for (const bay of GARAGE_EXIT_BAYS) {
        let occupied = false;
        for (const v of sharedVehicles.values()) {
          if (Math.hypot(v.x - bay.x, v.z - bay.z) < 4.2) {
            occupied = true;
            break;
          }
        }
        if (!occupied) return bay;
      }
      return GARAGE_EXIT_BAYS[sharedVehicles.size % GARAGE_EXIT_BAYS.length];
    },
    spawnVehicle: (vehicle: SharedVehicleState) => {
      sharedVehicles.set(vehicle.vehicleId, vehicle);
      recordVehicleEvent(
        'spawn',
        vehicle.vehicleId,
        vehicle.plate,
        vehicle.ownerUid,
        vehicle.ownerUid,
        `${vehicle.model} [${vehicle.plate}] retirado em ${vehicle.spawnBayLabel}`
      );
      broadcastJson({ type: 'vehicle:spawned', vehicle });
    },
    despawnVehicle: (
      vehicleId: string,
      actorUid: string,
      reason: 'store' | 'disconnect_cleanup'
    ): SharedVehicleState | null => {
      const existing = sharedVehicles.get(vehicleId);
      if (!existing) return null;

      // If driver is seated inside, cleanly restore pedestrian state before despawning
      if (existing.driverUid) {
        const driver = sharedPlayers.get(existing.driverUid);
        if (driver) {
          const exitPos = findSafeVehicleExitPosition(existing.x, existing.z, existing.rotY);
          driver.drivingVehicleId = null;
          driver.x = exitPos.x;
          driver.z = exitPos.z;
          driver.isMoving = false;
          driver.updatedAt = getNow();
          broadcastJson({
            type: 'vehicle:exited',
            vehicleId,
            uid: driver.uid,
            exitX: exitPos.x,
            exitZ: exitPos.z,
            vehicle: {
              ...existing,
              driverUid: null,
              driverName: null,
              speed: 0,
              state: 'parked',
            },
          });
        }
      }

      sharedVehicles.delete(vehicleId);
      recordVehicleEvent(
        reason,
        vehicleId,
        existing.plate,
        actorUid,
        existing.ownerUid,
        reason === 'store'
          ? `${existing.model} [${existing.plate}] guardado na garagem (${Math.round(existing.sessionDistanceM)}m percorridos)`
          : `${existing.model} [${existing.plate}] recolhido automaticamente após desconexão do proprietário`
      );
      broadcastJson({
        type: 'vehicle:despawned',
        vehicleId,
        ownerUid: existing.ownerUid,
        reason,
      });
      return existing;
    },
    updateLiveMetrics: (
      vehicleId: string,
      patch: { fuelLevel?: number; condition?: number }
    ) => {
      const existing = sharedVehicles.get(vehicleId);
      if (!existing) return;
      if (typeof patch.fuelLevel === 'number' && Number.isFinite(patch.fuelLevel)) {
        existing.fuelLevel = Math.max(0, Math.min(100, round2(patch.fuelLevel)));
      }
      if (typeof patch.condition === 'number' && Number.isFinite(patch.condition)) {
        existing.condition = Math.max(0, Math.min(100, Math.round(patch.condition)));
      }
      existing.updatedAt = getNow();
      broadcastJson({
        type: 'vehicle:updated',
        vehicleId: existing.vehicleId,
        x: existing.x,
        z: existing.z,
        rotY: existing.rotY,
        speed: existing.speed,
        steerAngle: existing.steerAngle,
        throttle: existing.throttle,
        braking: existing.braking,
        handbrake: existing.handbrake,
        boost: existing.boost,
        state: existing.state,
        fuelLevel: existing.fuelLevel,
        condition: existing.condition,
        sessionDistanceM: existing.sessionDistanceM,
        driverUid: existing.driverUid,
        driverName: existing.driverName,
        updatedAt: existing.updatedAt,
      });
    },
    getRecentEvents: () => [...vehicleWorldEvents],
  };

  const removePlayerForSocket = (ws: WebSocket): void => {
    const meta = socketMeta.get(ws);
    socketMeta.delete(ws);
    if (!meta?.uid) return;

    const uid = meta.uid;
    if (uidToSocket.get(uid) === ws) {
      uidToSocket.delete(uid);

      // Clean up any active vehicle owned or driven by the disconnecting citizen
      // so vehicles never remain permanently abandoned and cannot be hijacked.
      const toDespawn: string[] = [];
      for (const v of sharedVehicles.values()) {
        if (v.ownerUid === uid) {
          toDespawn.push(v.vehicleId);
        } else if (v.driverUid === uid) {
          v.driverUid = null;
          v.driverName = null;
          v.speed = 0;
          v.throttle = 0;
          v.braking = false;
          v.handbrake = false;
          v.boost = false;
          v.state = 'parked';
          v.updatedAt = getNow();
          broadcastJson({
            type: 'vehicle:exited',
            vehicleId: v.vehicleId,
            uid,
            exitX: v.x,
            exitZ: v.z,
            vehicle: v,
          });
        }
      }

      sharedPlayers.delete(uid);
      for (const vid of toDespawn) {
        worldVehiclesController.despawnVehicle(vid, uid, 'disconnect_cleanup');
      }

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
      activeVehicles: sharedVehicles.size,
      timestamp: Date.now(),
    });
  });

  // Shared world snapshot summary
  app.get('/api/world/state', (_req, res) => {
    res.json({
      universe: 'LIFE CRIMINAL EXPERIENCE',
      activeDistrict: 'distrito-central',
      onlineCount: sharedPlayers.size,
      activeVehiclesCount: sharedVehicles.size,
      players: Array.from(sharedPlayers.values()).map((p) => ({
        uid: p.uid,
        alias: p.alias,
        characterName: p.characterName,
        district: p.district,
        x: Math.round(p.x * 10) / 10,
        z: Math.round(p.z * 10) / 10,
        drivingVehicleId: p.drivingVehicleId,
      })),
      vehicles: Array.from(sharedVehicles.values()).map((v) => ({
        vehicleId: v.vehicleId,
        model: v.model,
        category: v.category,
        plate: v.plate,
        ownerUid: v.ownerUid,
        ownerAlias: v.ownerAlias,
        driverUid: v.driverUid,
        state: v.state,
        x: Math.round(v.x * 10) / 10,
        z: Math.round(v.z * 10) / 10,
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
        activeVehicles: sharedVehicles.size,
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

  // Mount authoritative Module 4 & 5 vehicles, dealerships, garage, P2P, drivable spawn/store, and admin routes
  registerVehicleRoutes({
    app,
    backend: economyBackend,
    requireAuth: requireAuthMiddleware,
    nowFn,
    worldVehicles: worldVehiclesController,
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
      lastVehicleUpdateTs: 0,
      lastSpeedWarnTs: 0,
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
      if (meta.msgCountInWindow > 40) {
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
          const existingPlayer = sharedPlayers.get(authenticatedUid);
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
            drivingVehicleId: existingPlayer?.drivingVehicleId ?? null,
            updatedAt: now,
          };

          uidToSocket.set(authenticatedUid, ws);
          sharedPlayers.set(authenticatedUid, state);

          // Send complete fresh snapshot (players + active street vehicles) to the newly connected citizen
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'world:snapshot',
                selfUid: authenticatedUid,
                players: Array.from(sharedPlayers.values()),
                vehicles: Array.from(sharedVehicles.values()),
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
        // Ignore on-foot move packets while seated inside a vehicle
        if (current.drivingVehicleId) return;

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
        return;
      }

      // =====================================================================
      // MODULE 5: AUTHORITATIVE REAL-TIME VEHICLE CONTROL & SYNCHRONIZATION
      // =====================================================================

      if (type === 'vehicle:enter') {
        const vehicleId = typeof msg.vehicleId === 'string' ? msg.vehicleId.trim() : '';
        const vehicle = sharedVehicles.get(vehicleId);
        const player = sharedPlayers.get(authenticatedUid);
        if (!player || !vehicle) {
          sendToUid(authenticatedUid, {
            type: 'vehicle:error',
            code: 'NOT_FOUND',
            vehicleId,
            message: 'Veículo não encontrado na cidade.',
          });
          return;
        }

        // Strict ownership & anti-hijack enforcement
        if (vehicle.ownerUid !== authenticatedUid) {
          recordVehicleEvent(
            'rejected_control',
            vehicle.vehicleId,
            vehicle.plate,
            authenticatedUid,
            vehicle.ownerUid,
            `Tentativa bloqueada de entrar no veículo de @${vehicle.ownerAlias}`
          );
          sendToUid(authenticatedUid, {
            type: 'vehicle:error',
            code: 'NOT_OWNER',
            vehicleId,
            message: 'Apenas o proprietário pode entrar e dirigir este veículo.',
          });
          return;
        }

        // Prevent simultaneous control by two players or entering while driving another car
        if (vehicle.driverUid && vehicle.driverUid !== authenticatedUid) {
          recordVehicleEvent(
            'rejected_control',
            vehicle.vehicleId,
            vehicle.plate,
            authenticatedUid,
            vehicle.ownerUid,
            'Tentativa bloqueada de controle simultâneo'
          );
          sendToUid(authenticatedUid, {
            type: 'vehicle:error',
            code: 'ALREADY_OCCUPIED',
            vehicleId,
            message: 'Este veículo já possui um motorista ativo.',
          });
          return;
        }

        if (player.drivingVehicleId && player.drivingVehicleId !== vehicleId) {
          sendToUid(authenticatedUid, {
            type: 'vehicle:error',
            code: 'ALREADY_DRIVING',
            vehicleId,
            message: 'Saia do veículo atual antes de entrar em outro.',
          });
          return;
        }

        vehicle.driverUid = authenticatedUid;
        vehicle.driverName = player.characterName;
        vehicle.state = 'driving';
        vehicle.updatedAt = now;

        player.drivingVehicleId = vehicleId;
        player.x = vehicle.x;
        player.z = vehicle.z;
        player.rotY = vehicle.rotY;
        player.isMoving = false;
        player.updatedAt = now;

        recordVehicleEvent(
          'enter',
          vehicle.vehicleId,
          vehicle.plate,
          authenticatedUid,
          vehicle.ownerUid,
          `${player.characterName} assumiu a direção de ${vehicle.model} [${vehicle.plate}]`
        );

        // Broadcast to ALL clients (including driver) so everyone transitions atomically
        broadcastJson({
          type: 'vehicle:entered',
          vehicleId,
          driverUid: authenticatedUid,
          driverName: player.characterName,
          vehicle,
        });
        return;
      }

      if (type === 'vehicle:exit') {
        const requestedId = typeof msg.vehicleId === 'string' ? msg.vehicleId.trim() : '';
        const player = sharedPlayers.get(authenticatedUid);
        const vehicleId = requestedId || player?.drivingVehicleId || '';
        const vehicle = sharedVehicles.get(vehicleId);

        if (!player || !vehicle) return;

        if (vehicle.driverUid !== authenticatedUid) {
          recordVehicleEvent(
            'rejected_control',
            vehicle.vehicleId,
            vehicle.plate,
            authenticatedUid,
            vehicle.ownerUid,
            'Tentativa bloqueada de sair de veículo não controlado pelo jogador'
          );
          sendToUid(authenticatedUid, {
            type: 'vehicle:error',
            code: 'NOT_DRIVER',
            vehicleId,
            message: 'Você não está dirigindo este veículo.',
          });
          return;
        }

        const exitPos = findSafeVehicleExitPosition(vehicle.x, vehicle.z, vehicle.rotY);

        vehicle.driverUid = null;
        vehicle.driverName = null;
        vehicle.speed = 0;
        vehicle.throttle = 0;
        vehicle.steerAngle = 0;
        vehicle.braking = false;
        vehicle.handbrake = false;
        vehicle.boost = false;
        vehicle.state = 'parked';
        vehicle.updatedAt = now;

        player.drivingVehicleId = null;
        player.x = exitPos.x;
        player.z = exitPos.z;
        player.isMoving = false;
        player.updatedAt = now;

        recordVehicleEvent(
          'exit',
          vehicle.vehicleId,
          vehicle.plate,
          authenticatedUid,
          vehicle.ownerUid,
          `${player.characterName} saiu de ${vehicle.model} [${vehicle.plate}] em (${exitPos.x}, ${exitPos.z})`
        );

        broadcastJson({
          type: 'vehicle:exited',
          vehicleId,
          uid: authenticatedUid,
          exitX: exitPos.x,
          exitZ: exitPos.z,
          vehicle,
        });
        return;
      }

      if (type === 'vehicle:update') {
        const vehicleId = typeof msg.vehicleId === 'string' ? msg.vehicleId.trim() : '';
        const vehicle = sharedVehicles.get(vehicleId);
        const player = sharedPlayers.get(authenticatedUid);
        if (!vehicle || !player) return;

        // Strictly enforce single authoritative driver & owner
        if (vehicle.driverUid !== authenticatedUid || vehicle.ownerUid !== authenticatedUid) {
          recordVehicleEvent(
            'rejected_control',
            vehicle.vehicleId,
            vehicle.plate,
            authenticatedUid,
            vehicle.ownerUid,
            'Pacote vehicle:update rejeitado — remetente não é o motorista autorizado'
          );
          sendToUid(authenticatedUid, {
            type: 'vehicle:error',
            code: 'UNAUTHORIZED_CONTROL',
            vehicleId,
            message: 'Controle de veículo negado pelo servidor.',
          });
          return;
        }

        const rawSpeed = typeof msg.speed === 'number' && Number.isFinite(msg.speed) ? msg.speed : 0;
        const isStopping = Math.abs(rawSpeed) < 0.05;
        if (!isStopping && now - meta.lastVehicleUpdateTs < 26) {
          return;
        }
        meta.lastVehicleUpdateTs = now;

        // Validate numeric inputs
        if (
          typeof msg.x !== 'number' ||
          !Number.isFinite(msg.x) ||
          typeof msg.z !== 'number' ||
          !Number.isFinite(msg.z) ||
          typeof msg.rotY !== 'number' ||
          !Number.isFinite(msg.rotY)
        ) {
          return;
        }

        const profile = getVehicleHandling(vehicle.category);
        const nextX = clampCoord(msg.x, vehicle.x, VEHICLE_WORLD_BOUND);
        const nextZ = clampCoord(msg.z, vehicle.z, VEHICLE_WORLD_BOUND);
        const nextRotY = clampRotY(msg.rotY, vehicle.rotY);
        const nextSteer = clampNumber(
          msg.steerAngle,
          0,
          -profile.maxSteerAngle * 1.15,
          profile.maxSteerAngle * 1.15
        );
        const nextThrottle = clampNumber(msg.throttle, 0, -1, 1);
        const braking = msg.braking === true;
        const handbrake = msg.handbrake === true;
        const boost = msg.boost === true;

        // Server-side anti-cheat speed & displacement verification
        const dtSec = Math.max(0.05, Math.min(1.5, (now - vehicle.updatedAt) / 1000));
        const maxLegalSpeed = profile.boostSpeed * 1.18;
        const dist = Math.hypot(nextX - vehicle.x, nextZ - vehicle.z);
        const maxLegalDist = maxLegalSpeed * dtSec + 2.8;

        const speedViolation =
          Math.abs(rawSpeed) > maxLegalSpeed ||
          dist > maxLegalDist ||
          collidesVehicleWithCity(nextX, nextZ, profile.collisionRadius * 0.7);

        if (speedViolation) {
          if (now - meta.lastSpeedWarnTs > 1200) {
            meta.lastSpeedWarnTs = now;
            recordVehicleEvent(
              'rejected_speed',
              vehicle.vehicleId,
              vehicle.plate,
              authenticatedUid,
              vehicle.ownerUid,
              `Deslocamento/velocidade inválido bloqueado (dist=${dist.toFixed(1)}m, vel=${rawSpeed.toFixed(1)}m/s)`
            );
          }
          sendToUid(authenticatedUid, {
            type: 'vehicle:correction',
            vehicleId: vehicle.vehicleId,
            x: vehicle.x,
            z: vehicle.z,
            rotY: vehicle.rotY,
            speed: 0,
            reason: 'Posição corrigida pelo servidor.',
          });
          return;
        }

        // Fuel guard: if tank is completely empty (0%), cap speed gently to crawl
        const effectiveSpeed =
          vehicle.fuelLevel <= 0 && Math.abs(rawSpeed) > 3.5
            ? Math.sign(rawSpeed) * 3.5
            : round2(rawSpeed);

        vehicle.x = round2(nextX);
        vehicle.z = round2(nextZ);
        vehicle.rotY = Math.round(nextRotY * 1000) / 1000;
        vehicle.speed = effectiveSpeed;
        vehicle.steerAngle = Math.round(nextSteer * 1000) / 1000;
        vehicle.throttle = round2(nextThrottle);
        vehicle.braking = braking;
        vehicle.handbrake = handbrake;
        vehicle.boost = boost && vehicle.fuelLevel > 0;
        vehicle.state = 'driving';
        vehicle.sessionDistanceM = round2(vehicle.sessionDistanceM + dist);

        // Authoritative gradual fuel consumption proportional to real distance driven
        if (dist > 0.02 && vehicle.fuelLevel > 0) {
          // 40 world meters ≈ 1 simulated city km for realistic district driving & refueling loop
          const simKm = dist * 0.025;
          const burn = simKm * profile.fuelBurnPerKm * (vehicle.boost ? 1.35 : 1);
          vehicle.fuelLevel = Math.max(0, Math.round((vehicle.fuelLevel - burn) * 10000) / 10000);
        }

        vehicle.updatedAt = now;

        // Keep driver's server coordinates synced to vehicle position
        player.x = vehicle.x;
        player.z = vehicle.z;
        player.rotY = vehicle.rotY;
        player.isMoving = false;
        player.updatedAt = now;

        broadcastJson(
          {
            type: 'vehicle:updated',
            vehicleId: vehicle.vehicleId,
            x: vehicle.x,
            z: vehicle.z,
            rotY: vehicle.rotY,
            speed: vehicle.speed,
            steerAngle: vehicle.steerAngle,
            throttle: vehicle.throttle,
            braking: vehicle.braking,
            handbrake: vehicle.handbrake,
            boost: vehicle.boost,
            state: vehicle.state,
            fuelLevel: vehicle.fuelLevel,
            condition: vehicle.condition,
            sessionDistanceM: vehicle.sessionDistanceM,
            driverUid: vehicle.driverUid,
            driverName: vehicle.driverName,
            updatedAt: vehicle.updatedAt,
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

  return {
    app,
    httpServer,
    wss,
    sharedPlayers,
    sharedVehicles,
    vehicleWorldEvents,
    shutdown,
  };
}
