export interface RemotePlayerState {
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

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface PlayerPositionPayload {
  x: number;
  z: number;
  rotY: number;
  isMoving: boolean;
}
