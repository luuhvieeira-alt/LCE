import type { VehicleCategory } from '../types/vehicle';

export interface VehicleHandlingProfile {
  category: VehicleCategory;
  label: string;
  /** Maximum forward world speed (units/sec) without boost */
  maxSpeed: number;
  /** Maximum forward world speed (units/sec) with Shift boost */
  boostSpeed: number;
  /** Maximum reverse speed (units/sec) */
  reverseSpeed: number;
  /** Forward acceleration (units/sec^2) */
  acceleration: number;
  /** Additional boost acceleration (units/sec^2) */
  boostAcceleration: number;
  /** Standard braking deceleration (units/sec^2) */
  brakeForce: number;
  /** Spacebar handbrake deceleration (units/sec^2) */
  handbrakeForce: number;
  /** Passive rolling friction when coasting */
  coastDrag: number;
  /** Maximum visual front wheel steering angle (radians) */
  maxSteerAngle: number;
  /** Steering input ramp speed (rad/sec) */
  steerResponse: number;
  /** Turning yaw angular velocity factor */
  turnRate: number;
  /** Relative vehicle mass (1.0 = compact, 2.4 = heavy truck) */
  mass: number;
  /** Stability factor (0..1; higher = less body roll / tighter grip) */
  stability: number;
  /** Collision circle radius in world meters */
  collisionRadius: number;
  /** Visual speedometer multiplier (world units/sec -> HUD km/h) */
  kmhScale: number;
  /** Visual suspension pitch/roll scale */
  suspensionScale: number;
  /** Fuel percentage consumed per simulated km */
  fuelBurnPerKm: number;
}

export const VEHICLE_HANDLING_PROFILES: Record<VehicleCategory, VehicleHandlingProfile> = {
  popular: {
    category: 'popular',
    label: 'Popular',
    maxSpeed: 16.5,
    boostSpeed: 19.5,
    reverseSpeed: 6.2,
    acceleration: 9.8,
    boostAcceleration: 12.2,
    brakeForce: 19.0,
    handbrakeForce: 26.0,
    coastDrag: 4.8,
    maxSteerAngle: 0.48,
    steerResponse: 5.2,
    turnRate: 2.45,
    mass: 1.0,
    stability: 0.84,
    collisionRadius: 1.38,
    kmhScale: 8.6,
    suspensionScale: 1.0,
    fuelBurnPerKm: 0.22,
  },
  sedan: {
    category: 'sedan',
    label: 'Sedã',
    maxSpeed: 19.5,
    boostSpeed: 23.0,
    reverseSpeed: 6.8,
    acceleration: 11.4,
    boostAcceleration: 14.5,
    brakeForce: 21.0,
    handbrakeForce: 28.0,
    coastDrag: 4.5,
    maxSteerAngle: 0.45,
    steerResponse: 5.0,
    turnRate: 2.32,
    mass: 1.2,
    stability: 0.88,
    collisionRadius: 1.52,
    kmhScale: 9.0,
    suspensionScale: 0.9,
    fuelBurnPerKm: 0.27,
  },
  suv: {
    category: 'suv',
    label: 'SUV',
    maxSpeed: 18.5,
    boostSpeed: 21.5,
    reverseSpeed: 6.5,
    acceleration: 10.4,
    boostAcceleration: 13.0,
    brakeForce: 20.0,
    handbrakeForce: 26.5,
    coastDrag: 5.0,
    maxSteerAngle: 0.44,
    steerResponse: 4.6,
    turnRate: 2.18,
    mass: 1.55,
    stability: 0.94,
    collisionRadius: 1.62,
    kmhScale: 9.1,
    suspensionScale: 1.15,
    fuelBurnPerKm: 0.34,
  },
  picape: {
    category: 'picape',
    label: 'Picape',
    maxSpeed: 18.0,
    boostSpeed: 21.0,
    reverseSpeed: 6.4,
    acceleration: 9.9,
    boostAcceleration: 12.6,
    brakeForce: 18.5,
    handbrakeForce: 24.5,
    coastDrag: 5.1,
    maxSteerAngle: 0.43,
    steerResponse: 4.2,
    turnRate: 2.02,
    mass: 1.75,
    stability: 0.86,
    collisionRadius: 1.66,
    kmhScale: 9.0,
    suspensionScale: 1.2,
    fuelBurnPerKm: 0.39,
  },
  esportivo: {
    category: 'esportivo',
    label: 'Esportivo',
    maxSpeed: 24.5,
    boostSpeed: 28.5,
    reverseSpeed: 7.8,
    acceleration: 16.5,
    boostAcceleration: 21.0,
    brakeForce: 27.0,
    handbrakeForce: 34.0,
    coastDrag: 4.2,
    maxSteerAngle: 0.46,
    steerResponse: 6.2,
    turnRate: 2.62,
    mass: 1.15,
    stability: 0.92,
    collisionRadius: 1.52,
    kmhScale: 10.2,
    suspensionScale: 0.65,
    fuelBurnPerKm: 0.46,
  },
  luxo: {
    category: 'luxo',
    label: 'Luxuoso',
    maxSpeed: 23.0,
    boostSpeed: 26.8,
    reverseSpeed: 7.4,
    acceleration: 14.6,
    boostAcceleration: 18.5,
    brakeForce: 25.0,
    handbrakeForce: 32.0,
    coastDrag: 4.3,
    maxSteerAngle: 0.44,
    steerResponse: 5.5,
    turnRate: 2.38,
    mass: 1.45,
    stability: 0.96,
    collisionRadius: 1.6,
    kmhScale: 10.1,
    suspensionScale: 0.72,
    fuelBurnPerKm: 0.42,
  },
  caminhao: {
    category: 'caminhao',
    label: 'Caminhão',
    maxSpeed: 13.8,
    boostSpeed: 15.8,
    reverseSpeed: 5.0,
    acceleration: 6.4,
    boostAcceleration: 8.0,
    brakeForce: 14.5,
    handbrakeForce: 19.5,
    coastDrag: 5.6,
    maxSteerAngle: 0.38,
    steerResponse: 3.3,
    turnRate: 1.62,
    mass: 2.4,
    stability: 0.82,
    collisionRadius: 1.85,
    kmhScale: 8.7,
    suspensionScale: 1.35,
    fuelBurnPerKm: 0.62,
  },
  moto: {
    category: 'moto',
    label: 'Moto',
    maxSpeed: 23.5,
    boostSpeed: 27.0,
    reverseSpeed: 4.5,
    acceleration: 15.8,
    boostAcceleration: 19.8,
    brakeForce: 25.5,
    handbrakeForce: 30.0,
    coastDrag: 4.0,
    maxSteerAngle: 0.52,
    steerResponse: 6.8,
    turnRate: 2.85,
    mass: 0.55,
    stability: 0.85,
    collisionRadius: 1.0,
    kmhScale: 9.8,
    suspensionScale: 0.85,
    fuelBurnPerKm: 0.16,
  },
};

export function getVehicleHandling(category: string): VehicleHandlingProfile {
  return (
    VEHICLE_HANDLING_PROFILES[category as VehicleCategory] ?? VEHICLE_HANDLING_PROFILES.sedan
  );
}

export interface GarageExitBay {
  id: string;
  label: string;
  x: number;
  z: number;
  rotY: number;
}

/**
 * Physical Garage Exit Bays situated cleanly along the Apex Motors Garagem apron
 * so multiple players can spawn different vehicles simultaneously without overlapping.
 */
export const GARAGE_EXIT_BAYS: GarageExitBay[] = [
  { id: 'bay-1', label: 'Garagem Central · Baia 01', x: -3.9, z: 16.5, rotY: Math.PI },
  { id: 'bay-2', label: 'Garagem Central · Baia 02', x: -3.9, z: 23.2, rotY: Math.PI },
  { id: 'bay-3', label: 'Garagem Central · Baia 03', x: -16.5, z: 3.9, rotY: Math.PI / 2 },
  { id: 'bay-4', label: 'Garagem Central · Baia 04', x: -23.2, z: 3.9, rotY: Math.PI / 2 },
  { id: 'bay-5', label: 'Avenida Sul · Baia Auxiliar', x: 3.9, z: 19.5, rotY: Math.PI },
  { id: 'bay-6', label: 'Avenida Oeste · Baia Auxiliar', x: -19.5, z: -3.9, rotY: Math.PI / 2 },
];

export type WorldServiceZoneType =
  | 'garage'
  | 'fuel_station'
  | 'workshop'
  | 'dealership'
  | 'parking';

export interface WorldServiceZone {
  id: string;
  type: WorldServiceZoneType;
  name: string;
  subtitle: string;
  x: number;
  z: number;
  radius: number;
  rotY?: number;
}

/**
 * Integrated World Vehicle Zones prepared across the existing Distrito Central
 * without rebuilding the city or blocking the main avenues.
 */
export const WORLD_VEHICLE_ZONES: WorldServiceZone[] = [
  {
    id: 'garagem-central',
    type: 'garage',
    name: 'Garagem Física Central',
    subtitle: 'Retirada e devolução de veículos da frota pessoal',
    x: -4.2,
    z: 19.5,
    radius: 8.5,
    rotY: Math.PI,
  },
  {
    id: 'posto-combustivel-lce',
    type: 'fuel_station',
    name: 'Posto de Combustível LCE',
    subtitle: 'Abastecimento expresso integrado ao sistema econômico',
    x: 29.5,
    z: -10.5,
    radius: 6.2,
    rotY: 0,
  },
  {
    id: 'oficina-mecanica-lce',
    type: 'workshop',
    name: 'Oficina Mecânica LCE',
    subtitle: 'Reparo estrutural, motor e revisão preventiva',
    x: 29.5,
    z: 10.5,
    radius: 6.2,
    rotY: Math.PI,
  },
  {
    id: 'concessionaria-central',
    type: 'dealership',
    name: 'LCE Motors Showroom',
    subtitle: 'Concessionária e pátio de exposição de veículos',
    x: -17.5,
    z: 9.6,
    radius: 7.0,
  },
  {
    id: 'estacionamento-banco',
    type: 'parking',
    name: 'Estacionamento · Banco Central',
    subtitle: 'Vagas públicas próximas à sede bancária',
    x: -19.5,
    z: -8.6,
    radius: 4.8,
    rotY: Math.PI / 2,
  },
  {
    id: 'estacionamento-agencia',
    type: 'parking',
    name: 'Estacionamento · Agência Trabalho',
    subtitle: 'Vagas públicas próximas à Agência Metropolitana',
    x: 19.5,
    z: -8.6,
    radius: 4.8,
    rotY: -Math.PI / 2,
  },
  {
    id: 'estacionamento-galeria',
    type: 'parking',
    name: 'Estacionamento · Galeria Comercial',
    subtitle: 'Vagas públicas para negócios e comércio',
    x: 19.5,
    z: 8.6,
    radius: 4.8,
    rotY: -Math.PI / 2,
  },
];

// Shared city static obstacles (used identically on BOTH client physics and authoritative server validation)
export const VEHICLE_WORLD_BOUND = 35.0;

const ESTABLISHMENT_BOXES = [
  { x: -18, z: -18, hw: 7.75, hd: 6.75 }, // Banco Central
  { x: 18, z: -18, hw: 7.25, hd: 6.25 }, // Agência Metropolitana
  { x: -18, z: 18, hw: 7.75, hd: 6.75 }, // Apex Motors Garagem
  { x: 18, z: 18, hw: 7.75, hd: 6.75 }, // Galeria Comercial
];

// Dealership outdoor plinths (prevent driving over display cars)
const SHOWCASE_PAD_BOXES = [
  { x: -23.6, z: 9.6, hw: 1.45, hd: 2.65 },
  { x: -19.2, z: 9.6, hw: 1.45, hd: 2.65 },
  { x: -10.6, z: 9.6, hw: 1.45, hd: 2.65 },
  { x: -9.6, z: 21.0, hw: 2.65, hd: 1.45 },
];

// Solid canopies / service islands (Fuel station pumps & Workshop bay back-wall)
const SERVICE_STRUCTURE_BOXES = [
  { x: 32.8, z: -12.5, hw: 1.6, hd: 3.4 }, // Posto pumps & kiosk
  { x: 32.8, z: 12.5, hw: 1.6, hd: 3.4 }, // Oficina back wall & lift
];

// Solid tree planters (lightweight obstacle detection)
const TREE_PLANTER_CIRCLES = [
  { x: -9.5, z: -15, r: 0.9 },
  { x: 9.5, z: -15, r: 0.9 },
  { x: -9.5, z: 15, r: 0.9 },
  { x: 9.5, z: 15, r: 0.9 },
  { x: -15, z: -9.5, r: 0.9 },
  { x: 15, z: -9.5, r: 0.9 },
  { x: -15, z: 9.5, r: 0.9 },
  { x: 15, z: 9.5, r: 0.9 },
];

export function collidesVehicleWithCity(x: number, z: number, radius = 1.45): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return true;
  if (Math.abs(x) > VEHICLE_WORLD_BOUND - radius * 0.4 || Math.abs(z) > VEHICLE_WORLD_BOUND - radius * 0.4) {
    return true;
  }
  // Central roundabout curb (radius 2.45)
  const rRoundabout = 2.45 + radius * 0.72;
  if (x * x + z * z < rRoundabout * rRoundabout) {
    return true;
  }
  // Main buildings
  for (const b of ESTABLISHMENT_BOXES) {
    if (Math.abs(x - b.x) < b.hw + radius * 0.78 && Math.abs(z - b.z) < b.hd + radius * 0.78) {
      return true;
    }
  }
  // Dealership showcase plinths
  for (const p of SHOWCASE_PAD_BOXES) {
    if (Math.abs(x - p.x) < p.hw + radius * 0.55 && Math.abs(z - p.z) < p.hd + radius * 0.55) {
      return true;
    }
  }
  // Service station structures
  for (const s of SERVICE_STRUCTURE_BOXES) {
    if (Math.abs(x - s.x) < s.hw + radius * 0.6 && Math.abs(z - s.z) < s.hd + radius * 0.6) {
      return true;
    }
  }
  // Tree planters
  for (const t of TREE_PLANTER_CIRCLES) {
    const dx = x - t.x;
    const dz = z - t.z;
    const minDist = t.r + radius * 0.62;
    if (dx * dx + dz * dz < minDist * minDist) {
      return true;
    }
  }
  return false;
}

export function findNearestWorldVehicleZone(x: number, z: number): WorldServiceZone | null {
  let closest: WorldServiceZone | null = null;
  let bestDist = Infinity;
  for (const zone of WORLD_VEHICLE_ZONES) {
    const dist = Math.hypot(x - zone.x, z - zone.z);
    if (dist <= zone.radius && dist < bestDist) {
      bestDist = dist;
      closest = zone;
    }
  }
  return closest;
}

/**
 * Computes a collision-safe pedestrian exit coordinate beside the driver door
 * (tries left door, right door, rear, front, and finally central safe avenue).
 */
export function findSafeVehicleExitPosition(
  vx: number,
  vz: number,
  rotY: number,
  offsetDist = 2.35
): { x: number; z: number } {
  // Local +X is right side of car, local -X is left (driver) side when facing +Z at rotY=0
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const candidates: Array<{ x: number; z: number }> = [
    // Driver side (left)
    { x: vx + cos * offsetDist, z: vz - sin * offsetDist },
    // Passenger side (right)
    { x: vx - cos * offsetDist, z: vz + sin * offsetDist },
    // Behind vehicle
    { x: vx - sin * (offsetDist + 0.9), z: vz - cos * (offsetDist + 0.9) },
    // In front of vehicle
    { x: vx + sin * (offsetDist + 0.9), z: vz + cos * (offsetDist + 0.9) },
  ];

  for (const c of candidates) {
    if (
      Math.abs(c.x) <= 35.2 &&
      Math.abs(c.z) <= 35.2 &&
      !collidesVehicleWithCity(c.x, c.z, 0.65)
    ) {
      return {
        x: Math.round(c.x * 100) / 100,
        z: Math.round(c.z * 100) / 100,
      };
    }
  }

  return { x: 0, z: 6.5 };
}
