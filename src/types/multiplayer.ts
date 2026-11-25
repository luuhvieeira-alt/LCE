import type { VehicleCategory } from './vehicle';

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
  drivingVehicleId?: string | null;
  updatedAt: number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface PlayerPositionPayload {
  x: number;
  z: number;
  rotY: number;
  isMoving: boolean;
}

export type ActiveVehicleWorldStatus = 'parked' | 'driving';

export interface SharedVehicleState {
  vehicleId: string;
  ownerUid: string;
  ownerName: string;
  ownerAlias: string;
  driverUid: string | null;
  driverName: string | null;
  modelId: string;
  manufacturer: string;
  model: string;
  year: number;
  category: VehicleCategory;
  plate: string;
  x: number;
  z: number;
  rotY: number;
  speed: number;
  steerAngle: number;
  throttle: number;
  braking: boolean;
  handbrake: boolean;
  boost: boolean;
  state: ActiveVehicleWorldStatus;
  fuelLevel: number;
  condition: number;
  mileageKm: number;
  sessionDistanceM: number;
  spawnBayLabel: string;
  updatedAt: number;
}

export interface VehicleMotionPayload {
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
}

export interface VehicleCorrectionPayload {
  vehicleId: string;
  x: number;
  z: number;
  rotY: number;
  speed: number;
  reason: string;
}

export interface WorldVehicleEvent {
  id: string;
  type:
    | 'spawn'
    | 'enter'
    | 'exit'
    | 'store'
    | 'disconnect_cleanup'
    | 'rejected_control'
    | 'rejected_speed';
  vehicleId: string;
  plate: string;
  actorUid: string;
  ownerUid: string;
  detail: string;
  timestamp: number;
}
