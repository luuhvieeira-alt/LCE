import type {
  ConnectionState,
  PlayerPositionPayload,
  RemotePlayerState,
} from '../types/multiplayer';
import type { CharacterProfile, UpdateAppearanceInput } from '../types/character';

export interface MultiplayerCallbacks {
  onConnectionChange: (state: ConnectionState) => void;
  onSnapshot: (players: RemotePlayerState[], selfUid: string) => void;
  onPlayerJoined: (player: RemotePlayerState) => void;
  onPlayerUpdated: (player: RemotePlayerState) => void;
  onPlayerMoved: (uid: string, x: number, z: number, rotY: number, isMoving: boolean) => void;
  onPlayerLeft: (uid: string) => void;
}

export class SharedWorldClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  private lastSentAt = 0;
  private wasMoving = false;
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
            const selfUid = typeof msg.selfUid === 'string' ? msg.selfUid : this.character.uid;
            this.callbacks.onSnapshot(players, selfUid);
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
