import type {
  ConnectionState,
  PlayerPositionPayload,
  RemotePlayerState,
  SharedVehicleState,
  VehicleCorrectionPayload,
  VehicleMotionPayload,
} from '../types/multiplayer';
import type { CharacterProfile, UpdateAppearanceInput } from '../types/character';

export interface VehicleStatePatch {
  vehicleId: string;
  x: number;
  z: number;
  rotY: number;
  speed: number;
  steerAngle: number;
  throttle: number;
  braking: boolean;
  handbrake: boolean;
  boost: boolean;
  state: 'parked' | 'driving';
  fuelLevel: number;
  condition: number;
  sessionDistanceM: number;
  driverUid: string | null;
  driverName: string | null;
  updatedAt: number;
}

export interface MultiplayerCallbacks {
  onConnectionChange: (state: ConnectionState) => void;
  onSnapshot: (
    players: RemotePlayerState[],
    vehicles: SharedVehicleState[],
    selfUid: string
  ) => void;
  onPlayerJoined: (player: RemotePlayerState) => void;
  onPlayerUpdated: (player: RemotePlayerState) => void;
  onPlayerMoved: (uid: string, x: number, z: number, rotY: number, isMoving: boolean) => void;
  onPlayerLeft: (uid: string) => void;
  onVehicleSpawned: (vehicle: SharedVehicleState) => void;
  onVehicleEntered: (vehicle: SharedVehicleState, driverUid: string) => void;
  onVehicleUpdated: (patch: VehicleStatePatch) => void;
  onVehicleExited: (
    vehicle: SharedVehicleState,
    uid: string,
    exitX: number,
    exitZ: number
  ) => void;
  onVehicleDespawned: (vehicleId: string, reason: string) => void;
  onVehicleCorrection: (correction: VehicleCorrectionPayload) => void;
  onVehicleError: (message: string) => void;
}

export class SharedWorldClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private lastSentAt = 0;
  private lastVehicleSentAt = 0;
  private wasMoving = false;
  private wasVehicleMoving = false;
  private lastKnownPos: { x: number; z: number; rotY: number };
  private getToken: () => Promise<string | null>;
  private character: CharacterProfile;
  private callbacks: MultiplayerCallbacks;

  constructor(
    character: CharacterProfile,
    getToken: () => Promise<string | null>,
    callbacks: MultiplayerCallbacks
  ) {
    this.character = character;
    this.getToken = getToken;
    this.callbacks = callbacks;
    this.lastKnownPos = {
      x: typeof character.lastX === 'number' ? character.lastX : 0,
      z: typeof character.lastZ === 'number' ? character.lastZ : 6.5,
      rotY: typeof character.lastRotY === 'number' ? character.lastRotY : Math.PI,
    };
  }

  public updateCharacterMeta(character: CharacterProfile): void {
    this.character = character;
  }

  public connect(): void {
    if (this.destroyed) return;
    this.cleanupSocket();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/world`;

    this.callbacks.onConnectionChange(
      this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting'
    );

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = async () => {
      if (this.destroyed || this.ws !== ws) return;
      this.reconnectAttempts = 0;

      // Force-refresh token on reconnect if needed so auth never fails due to expiry
      const idToken = await this.getToken();
      if (!idToken || ws.readyState !== WebSocket.OPEN) {
        ws.close();
        return;
      }

      ws.send(
        JSON.stringify({
          type: 'player:join',
          idToken,
          alias: this.character.alias,
          characterName: this.character.characterName,
          coatColor: this.character.coatColor,
          accentColor: this.character.accentColor,
          skinTone: this.character.skinTone,
          style: this.character.style,
          x: this.lastKnownPos.x,
          z: this.lastKnownPos.z,
          rotY: this.lastKnownPos.rotY,
        })
      );

      this.callbacks.onConnectionChange('connected');
      this.startHeartbeat();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        switch (msg.type) {
          case 'world:snapshot': {
            const players = Array.isArray(msg.players)
              ? (msg.players as RemotePlayerState[])
              : [];
            const vehicles = Array.isArray(msg.vehicles)
              ? (msg.vehicles as SharedVehicleState[])
              : [];
            const selfUid = typeof msg.selfUid === 'string' ? msg.selfUid : this.character.uid;
            this.callbacks.onSnapshot(players, vehicles, selfUid);
            break;
          }
          case 'player:joined': {
            if (msg.player && typeof msg.player === 'object') {
              this.callbacks.onPlayerJoined(msg.player as RemotePlayerState);
            }
            break;
          }
          case 'player:updated': {
            if (msg.player && typeof msg.player === 'object') {
              this.callbacks.onPlayerUpdated(msg.player as RemotePlayerState);
            }
            break;
          }
          case 'player:moved': {
            if (
              typeof msg.uid === 'string' &&
              typeof msg.x === 'number' &&
              typeof msg.z === 'number' &&
              typeof msg.rotY === 'number'
            ) {
              this.callbacks.onPlayerMoved(
                msg.uid,
                msg.x,
                msg.z,
                msg.rotY,
                msg.isMoving === true
              );
            }
            break;
          }
          case 'player:left': {
            if (typeof msg.uid === 'string') {
              this.callbacks.onPlayerLeft(msg.uid);
            }
            break;
          }
          case 'vehicle:spawned': {
            if (msg.vehicle && typeof msg.vehicle === 'object') {
              this.callbacks.onVehicleSpawned(msg.vehicle as SharedVehicleState);
            }
            break;
          }
          case 'vehicle:entered': {
            if (
              msg.vehicle &&
              typeof msg.vehicle === 'object' &&
              typeof msg.driverUid === 'string'
            ) {
              this.callbacks.onVehicleEntered(
                msg.vehicle as SharedVehicleState,
                msg.driverUid
              );
            }
            break;
          }
          case 'vehicle:updated': {
            if (
              typeof msg.vehicleId === 'string' &&
              typeof msg.x === 'number' &&
              typeof msg.z === 'number' &&
              typeof msg.rotY === 'number'
            ) {
              this.callbacks.onVehicleUpdated({
                vehicleId: msg.vehicleId,
                x: msg.x,
                z: msg.z,
                rotY: msg.rotY,
                speed: typeof msg.speed === 'number' ? msg.speed : 0,
                steerAngle: typeof msg.steerAngle === 'number' ? msg.steerAngle : 0,
                throttle: typeof msg.throttle === 'number' ? msg.throttle : 0,
                braking: msg.braking === true,
                handbrake: msg.handbrake === true,
                boost: msg.boost === true,
                state: msg.state === 'driving' ? 'driving' : 'parked',
                fuelLevel: typeof msg.fuelLevel === 'number' ? msg.fuelLevel : 100,
                condition: typeof msg.condition === 'number' ? msg.condition : 100,
                sessionDistanceM:
                  typeof msg.sessionDistanceM === 'number' ? msg.sessionDistanceM : 0,
                driverUid: typeof msg.driverUid === 'string' ? msg.driverUid : null,
                driverName: typeof msg.driverName === 'string' ? msg.driverName : null,
                updatedAt: typeof msg.updatedAt === 'number' ? msg.updatedAt : Date.now(),
              });
            }
            break;
          }
          case 'vehicle:exited': {
            if (
              msg.vehicle &&
              typeof msg.vehicle === 'object' &&
              typeof msg.uid === 'string' &&
              typeof msg.exitX === 'number' &&
              typeof msg.exitZ === 'number'
            ) {
              this.callbacks.onVehicleExited(
                msg.vehicle as SharedVehicleState,
                msg.uid,
                msg.exitX,
                msg.exitZ
              );
            }
            break;
          }
          case 'vehicle:despawned': {
            if (typeof msg.vehicleId === 'string') {
              this.callbacks.onVehicleDespawned(
                msg.vehicleId,
                typeof msg.reason === 'string' ? msg.reason : 'store'
              );
            }
            break;
          }
          case 'vehicle:correction': {
            if (
              typeof msg.vehicleId === 'string' &&
              typeof msg.x === 'number' &&
              typeof msg.z === 'number' &&
              typeof msg.rotY === 'number'
            ) {
              this.callbacks.onVehicleCorrection({
                vehicleId: msg.vehicleId,
                x: msg.x,
                z: msg.z,
                rotY: msg.rotY,
                speed: typeof msg.speed === 'number' ? msg.speed : 0,
                reason:
                  typeof msg.reason === 'string'
                    ? msg.reason
                    : 'Posição sincronizada pelo servidor.',
              });
            }
            break;
          }
          case 'vehicle:error': {
            if (typeof msg.message === 'string') {
              this.callbacks.onVehicleError(msg.message);
            }
            break;
          }
          default:
            break;
        }
      } catch {
        // Ignore malformed packets
      }
    };

    ws.onclose = (event) => {
      this.stopHeartbeat();
      if (this.destroyed) {
        this.callbacks.onConnectionChange('disconnected');
        return;
      }
      // Do not spin-loop if server explicitly rejected authorization (1008)
      if (event.code === 1008 && this.reconnectAttempts >= 3) {
        this.callbacks.onConnectionChange('disconnected');
        return;
      }
      this.callbacks.onConnectionChange('reconnecting');
      const delay = Math.min(12000, 1200 * Math.pow(1.6, this.reconnectAttempts));
      this.reconnectAttempts += 1;
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };

    ws.onerror = () => {
      // Handled cleanly via onclose
    };
  }

  public sendPosition(pos: PlayerPositionPayload): void {
    this.lastKnownPos = {
      x: Math.round(pos.x * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      rotY: Math.round(pos.rotY * 1000) / 1000,
    };

    const stoppedTransition = this.wasMoving && !pos.isMoving;
    this.wasMoving = pos.isMoving;

    const now = performance.now();
    // Always flush the stop transition immediately; throttle continuous movement to ~15Hz
    if (!stoppedTransition && now - this.lastSentAt < 65) return;
    if (!pos.isMoving && !stoppedTransition && now - this.lastSentAt < 1000) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.lastSentAt = now;
    this.ws.send(
      JSON.stringify({
        type: 'player:move',
        x: this.lastKnownPos.x,
        z: this.lastKnownPos.z,
        rotY: this.lastKnownPos.rotY,
        isMoving: pos.isMoving,
      })
    );
  }

  public sendAppearance(input: UpdateAppearanceInput): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'player:appearance',
        coatColor: input.coatColor,
        accentColor: input.accentColor,
        skinTone: input.skinTone,
        style: input.style,
      })
    );
  }

  public sendVehicleEnter(vehicleId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'vehicle:enter', vehicleId }));
  }

  public sendVehicleExit(vehicleId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'vehicle:exit', vehicleId }));
  }

  public sendVehicleMotion(payload: VehicleMotionPayload): void {
    const movingNow =
      Math.abs(payload.speed) > 0.08 ||
      Math.abs(payload.throttle) > 0.05 ||
      Math.abs(payload.steerAngle) > 0.04;
    const stoppedTransition = this.wasVehicleMoving && !movingNow;
    this.wasVehicleMoving = movingNow;

    const now = performance.now();
    // Smooth ~18Hz vehicle sync while driving, immediate flush on full stop, 650ms keepalive when idling
    if (!stoppedTransition && now - this.lastVehicleSentAt < 54) return;
    if (!movingNow && !stoppedTransition && now - this.lastVehicleSentAt < 650) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.lastVehicleSentAt = now;
    this.ws.send(
      JSON.stringify({
        type: 'vehicle:update',
        vehicleId: payload.vehicleId,
        x: Math.round(payload.x * 100) / 100,
        z: Math.round(payload.z * 100) / 100,
        rotY: Math.round(payload.rotY * 1000) / 1000,
        speed: Math.round(payload.speed * 100) / 100,
        steerAngle: Math.round(payload.steerAngle * 1000) / 1000,
        throttle: Math.round(payload.throttle * 100) / 100,
        braking: payload.braking,
        handbrake: payload.handbrake,
        boost: payload.boost,
      })
    );
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 12000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanupSocket(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client cleanup');
      }
      this.ws = null;
    }
  }

  public disconnect(): void {
    this.destroyed = true;
    this.cleanupSocket();
    this.callbacks.onConnectionChange('disconnected');
  }
}
