import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  SharedVehicleState,
  VehicleCorrectionPayload,
  VehicleMotionPayload,
} from '../../types/multiplayer';
import type { CameraPreset } from '../../context/GameContext';
import {
  collidesVehicleWithCity,
  findNearestWorldVehicleZone,
  getVehicleHandling,
  type WorldServiceZone,
} from '../../config/vehiclePhysics';
import { VehicleMesh3D } from './VehicleMesh3D';

export interface MobileDrivingInputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (left = +1, right = -1 in yaw)
  handbrake: boolean;
  boost: boolean;
}

export interface LocalDrivingTelemetry {
  vehicleId: string;
  speedKmh: number;
  gear: 'R' | 'N' | 'D' | 'BOOST';
  fuelLevel: number;
  condition: number;
  handbrake: boolean;
  boost: boolean;
  nearbyZone: WorldServiceZone | null;
}

interface WorldVehiclesProps {
  vehicles: Record<string, SharedVehicleState>;
  selfUid: string;
  drivingVehicleId: string | null;
  controlsEnabled: boolean;
  cameraPreset: CameraPreset;
  vehicleCorrection: (VehicleCorrectionPayload & { seq: number }) | null;
  mobileDrivingRef: React.RefObject<MobileDrivingInputState>;
  onReportVehicleMotion: (payload: VehicleMotionPayload) => void;
  onLocalTelemetry: (telemetry: LocalDrivingTelemetry | null) => void;
  onSelectVehicle?: (vehicle: SharedVehicleState) => void;
}

// Pre-allocated math helpers at module scope (zero GC inside useFrame)
const _camTarget = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

function collidesWithOtherVehicles(
  selfId: string,
  x: number,
  z: number,
  radius: number,
  allVehicles: Record<string, SharedVehicleState>
): boolean {
  for (const other of Object.values(allVehicles)) {
    if (other.vehicleId === selfId) continue;
    const otherR = getVehicleHandling(other.category).collisionRadius;
    const minDist = (radius + otherR) * 0.84;
    const dx = x - other.x;
    const dz = z - other.z;
    if (dx * dx + dz * dz < minDist * minDist) {
      return true;
    }
  }
  return false;
}

interface DrivenVehicleNodeProps {
  vehicle: SharedVehicleState;
  allVehiclesRef: React.RefObject<Record<string, SharedVehicleState>>;
  controlsEnabled: boolean;
  cameraPreset: CameraPreset;
  vehicleCorrection: (VehicleCorrectionPayload & { seq: number }) | null;
  mobileDrivingRef: React.RefObject<MobileDrivingInputState>;
  onReportVehicleMotion: (payload: VehicleMotionPayload) => void;
  onLocalTelemetry: (telemetry: LocalDrivingTelemetry | null) => void;
}

function DrivenVehicleNode({
  vehicle,
  allVehiclesRef,
  controlsEnabled,
  cameraPreset,
  vehicleCorrection,
  mobileDrivingRef,
  onReportVehicleMotion,
  onLocalTelemetry,
}: DrivenVehicleNodeProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const chassisRef = useRef<THREE.Group>(null);
  const wheelSpinRefs = useRef<Array<THREE.Group | null>>([]);
  const frontSteerRefs = useRef<Array<THREE.Group | null>>([]);

  const handling = useMemo(() => getVehicleHandling(vehicle.category), [vehicle.category]);

  // Authoritative local physics state (mutated inside useFrame without React re-renders)
  const physRef = useRef({
    x: vehicle.x,
    z: vehicle.z,
    rotY: vehicle.rotY,
    speed: vehicle.speed,
    steerAngle: vehicle.steerAngle,
    wheelSpin: 0,
    pitch: 0,
    roll: 0,
    camOrbitOffset: 0,
  });

  const fuelRef = useRef(vehicle.fuelLevel);
  const conditionRef = useRef(vehicle.condition);
  useEffect(() => {
    fuelRef.current = vehicle.fuelLevel;
    conditionRef.current = vehicle.condition;
  }, [vehicle.fuelLevel, vehicle.condition]);

  // Apply authoritative server correction immediately if triggered
  const lastCorrectionSeqRef = useRef(0);
  useEffect(() => {
    if (
      vehicleCorrection &&
      vehicleCorrection.vehicleId === vehicle.vehicleId &&
      vehicleCorrection.seq !== lastCorrectionSeqRef.current
    ) {
      lastCorrectionSeqRef.current = vehicleCorrection.seq;
      physRef.current.x = vehicleCorrection.x;
      physRef.current.z = vehicleCorrection.z;
      physRef.current.rotY = vehicleCorrection.rotY;
      physRef.current.speed = vehicleCorrection.speed;
      if (groupRef.current) {
        groupRef.current.position.set(vehicleCorrection.x, 0, vehicleCorrection.z);
        groupRef.current.rotation.y = vehicleCorrection.rotY;
      }
    }
  }, [vehicleCorrection, vehicle.vehicleId]);

  const keysRef = useRef<Set<string>>(new Set());
  const draggingRef = useRef(false);
  const lastPointerXRef = useRef(0);
  const lastTelemetryMsRef = useRef(0);

  const [lightState, setLightState] = useState({ braking: false, reversing: false, boost: false });
  const lightStateRef = useRef(lightState);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space' && controlsEnabled) {
        e.preventDefault();
      }
      keysRef.current.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };
    const onBlur = () => {
      keysRef.current.clear();
      draggingRef.current = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'CANVAS') {
        draggingRef.current = true;
        lastPointerXRef.current = e.clientX;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastPointerXRef.current;
      lastPointerXRef.current = e.clientX;
      physRef.current.camOrbitOffset -= dx * 0.006;
    };
    const onPointerUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      onLocalTelemetry(null);
    };
  }, [controlsEnabled, onLocalTelemetry]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const p = physRef.current;
    const keys = keysRef.current;
    const mobile = mobileDrivingRef.current;

    let throttleInput = 0;
    let brakeInput = 0;
    let steerInput = 0;
    let handbrake = false;
    let boost = false;

    if (controlsEnabled) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) throttleInput = 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) brakeInput = 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) steerInput += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) steerInput -= 1;
      if (keys.has('Space')) handbrake = true;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) boost = true;

      if (keys.has('KeyQ')) p.camOrbitOffset += dt * 1.8;
      if (keys.has('KeyE')) p.camOrbitOffset -= dt * 1.8;

      if (mobile) {
        if (mobile.throttle > 0.05) throttleInput = Math.max(throttleInput, mobile.throttle);
        if (mobile.brake > 0.05) brakeInput = Math.max(brakeInput, mobile.brake);
        if (Math.abs(mobile.steer) > 0.05) steerInput = THREE.MathUtils.clamp(steerInput + mobile.steer, -1, 1);
        if (mobile.handbrake) handbrake = true;
        if (mobile.boost) boost = true;
      }
    }

    const outOfFuel = fuelRef.current <= 0.1;
    const effectiveMaxSpeed = outOfFuel
      ? 3.2
      : boost
        ? handling.boostSpeed
        : handling.maxSpeed;
    const effectiveAccel = outOfFuel
      ? 3.2
      : boost
        ? handling.boostAcceleration
        : handling.acceleration;
    const effectiveReverseMax = outOfFuel ? 2.2 : handling.reverseSpeed;

    const prevSpeed = p.speed;
    let brakingVisual = false;

    // Longitudinal arcade acceleration, braking, reverse & handbrake
    if (handbrake) {
      brakingVisual = true;
      if (Math.abs(p.speed) > 0.08) {
        const decel = handling.handbrakeForce * dt;
        p.speed = Math.sign(p.speed) * Math.max(0, Math.abs(p.speed) - decel);
      } else {
        p.speed = 0;
      }
    } else if (throttleInput > 0 && brakeInput === 0) {
      if (p.speed < -0.25) {
        brakingVisual = true;
        p.speed = Math.min(0, p.speed + handling.brakeForce * dt);
      } else {
        p.speed = Math.min(effectiveMaxSpeed, p.speed + effectiveAccel * throttleInput * dt);
      }
    } else if (brakeInput > 0 && throttleInput === 0) {
      if (p.speed > 0.25) {
        brakingVisual = true;
        p.speed = Math.max(0, p.speed - handling.brakeForce * brakeInput * dt);
      } else {
        p.speed = Math.max(
          -effectiveReverseMax,
          p.speed - handling.acceleration * 0.65 * brakeInput * dt
        );
      }
    } else {
      // Natural coasting drag
      const drag = handling.coastDrag * dt;
      if (Math.abs(p.speed) <= drag) {
        p.speed = 0;
      } else {
        p.speed -= Math.sign(p.speed) * drag;
      }
    }

    // Progressive steering with high-speed stability attenuation
    const speedRatio = Math.min(1, Math.abs(p.speed) / Math.max(1, handling.maxSpeed));
    const speedAttenuation = 1 - speedRatio * (0.42 * handling.stability);
    const targetSteer = steerInput * handling.maxSteerAngle * speedAttenuation;
    p.steerAngle = THREE.MathUtils.damp(p.steerAngle, targetSteer, handling.steerResponse, dt);

    // Yaw turning (only turns when moving, reverses smoothly when backing up)
    if (Math.abs(p.speed) > 0.16) {
      const dirSign = p.speed >= 0 ? 1 : -1;
      const lowSpeedFactor = Math.min(1, Math.abs(p.speed) / 3.6);
      const driftBonus = handbrake ? 1.32 : 1.0;
      const yawDelta =
        (p.steerAngle / Math.max(0.1, handling.maxSteerAngle)) *
        handling.turnRate *
        lowSpeedFactor *
        driftBonus *
        dirSign *
        dt;
      p.rotY += yawDelta;
    }

    // World displacement with axis-separated sliding collision (city + other active vehicles)
    const forwardX = Math.sin(p.rotY);
    const forwardZ = Math.cos(p.rotY);
    const nextX = p.x + forwardX * p.speed * dt;
    const nextZ = p.z + forwardZ * p.speed * dt;

    const others = allVehiclesRef.current ?? {};
    let hitWall = false;

    if (
      !collidesVehicleWithCity(nextX, p.z, handling.collisionRadius) &&
      !collidesWithOtherVehicles(vehicle.vehicleId, nextX, p.z, handling.collisionRadius, others)
    ) {
      p.x = nextX;
    } else {
      hitWall = true;
    }

    if (
      !collidesVehicleWithCity(p.x, nextZ, handling.collisionRadius) &&
      !collidesWithOtherVehicles(vehicle.vehicleId, p.x, nextZ, handling.collisionRadius, others)
    ) {
      p.z = nextZ;
    } else {
      hitWall = true;
    }

    if (hitWall) {
      // Gentle collision energy absorption without locking the car into the curb
      p.speed *= 0.35;
    }

    // Apply transform to root group
    if (groupRef.current) {
      groupRef.current.position.set(p.x, 0, p.z);
      groupRef.current.rotation.y = p.rotY;
    }

    // Visual wheel spin & front wheel steering
    p.wheelSpin += (p.speed * dt) / 0.34;
    for (const w of wheelSpinRefs.current) {
      if (w) w.rotation.x = p.wheelSpin;
    }
    for (const fw of frontSteerRefs.current) {
      if (fw) fw.rotation.y = p.steerAngle;
    }

    // Subtle visual suspension pitch & lateral cornering roll
    const accelDelta = (p.speed - prevSpeed) / Math.max(0.008, dt);
    const targetPitch = THREE.MathUtils.clamp(
      -accelDelta * 0.0032 * handling.suspensionScale,
      -0.065,
      0.065
    );
    const targetRoll = THREE.MathUtils.clamp(
      p.steerAngle * (p.speed / Math.max(1, handling.maxSpeed)) * 0.16 * (1.25 - handling.stability) * handling.suspensionScale,
      -0.09,
      0.09
    );
    p.pitch = THREE.MathUtils.damp(p.pitch, targetPitch, 9, dt);
    p.roll = THREE.MathUtils.damp(p.roll, targetRoll, 9, dt);
    if (chassisRef.current) {
      chassisRef.current.rotation.x = p.pitch;
      chassisRef.current.rotation.z = p.roll;
    }

    // Update light state only on boolean transitions (no per-frame React re-renders)
    const reversingNow = p.speed < -0.35;
    const boostVisual = boost && throttleInput > 0 && p.speed > 4 && !outOfFuel;
    const ls = lightStateRef.current;
    if (
      ls.braking !== brakingVisual ||
      ls.reversing !== reversingNow ||
      ls.boost !== boostVisual
    ) {
      const nextLights = { braking: brakingVisual, reversing: reversingNow, boost: boostVisual };
      lightStateRef.current = nextLights;
      setLightState(nextLights);
    }

    // Smooth Chase Camera behind vehicle (auto-recenters gently while driving)
    if (!draggingRef.current && Math.abs(p.speed) > 1.2) {
      p.camOrbitOffset = THREE.MathUtils.damp(p.camOrbitOffset, 0, 2.6, dt);
    }

    const baseDist = cameraPreset === 'orbital' ? 12.2 : 8.4;
    const speedPullback = Math.min(2.6, Math.abs(p.speed) * 0.11);
    const camDist = baseDist + speedPullback;
    const camHeight = cameraPreset === 'orbital' ? 6.8 : 3.65 + speedPullback * 0.25;
    const camAngle = p.rotY + p.camOrbitOffset;

    _camTarget.set(
      p.x - Math.sin(camAngle) * camDist,
      camHeight,
      p.z - Math.cos(camAngle) * camDist
    );

    camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTarget.x, 7.2, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTarget.y, 7.2, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTarget.z, 7.2, dt);

    _lookTarget.set(p.x + forwardX * 2.2, 1.35, p.z + forwardZ * 2.2);
    camera.lookAt(_lookTarget);

    // Send motion telemetry to authoritative WebSocket client
    onReportVehicleMotion({
      vehicleId: vehicle.vehicleId,
      x: p.x,
      z: p.z,
      rotY: p.rotY,
      speed: p.speed,
      steerAngle: p.steerAngle,
      throttle: throttleInput,
      braking: brakingVisual,
      handbrake,
      boost: boostVisual,
    });

    // Throttled HUD telemetry update (~10Hz)
    const now = performance.now();
    if (now - lastTelemetryMsRef.current >= 100) {
      lastTelemetryMsRef.current = now;
      const speedKmh = Math.round(Math.abs(p.speed) * handling.kmhScale);
      const gear: LocalDrivingTelemetry['gear'] =
        p.speed < -0.3
          ? 'R'
          : Math.abs(p.speed) < 0.3
            ? 'N'
            : boostVisual
              ? 'BOOST'
              : 'D';
      onLocalTelemetry({
        vehicleId: vehicle.vehicleId,
        speedKmh,
        gear,
        fuelLevel: fuelRef.current,
        condition: conditionRef.current,
        handbrake,
        boost: boostVisual,
        nearbyZone: findNearestWorldVehicleZone(p.x, p.z),
      });
    }
  });

  return (
    <group
      ref={groupRef}
      position={[vehicle.x, 0, vehicle.z]}
      rotation={[0, vehicle.rotY, 0]}
    >
      <VehicleMesh3D
        category={vehicle.category}
        plate={vehicle.plate}
        braking={lightState.braking}
        reversing={lightState.reversing}
        boost={lightState.boost}
        hasDriver
        chassisRef={chassisRef}
        wheelSpinRefs={wheelSpinRefs}
        frontSteerRefs={frontSteerRefs}
        labelInfo={{
          model: vehicle.model,
          plate: vehicle.plate,
          ownerAlias: vehicle.ownerAlias,
          driverName: vehicle.driverName,
          isOwnedBySelf: true,
          isDrivenBySelf: true,
        }}
      />
    </group>
  );
}

interface SyncedVehicleNodeProps {
  vehicle: SharedVehicleState;
  isOwnedBySelf: boolean;
  onSelectVehicle?: (vehicle: SharedVehicleState) => void;
}

function SyncedVehicleNode({
  vehicle,
  isOwnedBySelf,
  onSelectVehicle,
}: SyncedVehicleNodeProps) {
  const groupRef = useRef<THREE.Group>(null);
  const chassisRef = useRef<THREE.Group>(null);
  const wheelSpinRefs = useRef<Array<THREE.Group | null>>([]);
  const frontSteerRefs = useRef<Array<THREE.Group | null>>([]);

  const smoothRef = useRef({
    x: vehicle.x,
    z: vehicle.z,
    rotY: vehicle.rotY,
    speed: vehicle.speed,
    steerAngle: vehicle.steerAngle,
    wheelSpin: 0,
    roll: 0,
  });

  const handling = useMemo(() => getVehicleHandling(vehicle.category), [vehicle.category]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = smoothRef.current;

    s.x = THREE.MathUtils.damp(s.x, vehicle.x, 11.5, dt);
    s.z = THREE.MathUtils.damp(s.z, vehicle.z, 11.5, dt);
    s.speed = THREE.MathUtils.damp(s.speed, vehicle.speed, 10, dt);
    s.steerAngle = THREE.MathUtils.damp(s.steerAngle, vehicle.steerAngle, 10, dt);

    let diff = vehicle.rotY - s.rotY;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    s.rotY += diff * (1 - Math.exp(-11.5 * dt));

    if (groupRef.current) {
      groupRef.current.position.set(s.x, 0, s.z);
      groupRef.current.rotation.y = s.rotY;
    }

    s.wheelSpin += (s.speed * dt) / 0.34;
    for (const w of wheelSpinRefs.current) {
      if (w) w.rotation.x = s.wheelSpin;
    }
    for (const fw of frontSteerRefs.current) {
      if (fw) fw.rotation.y = s.steerAngle;
    }

    const targetRoll = THREE.MathUtils.clamp(
      s.steerAngle * (s.speed / Math.max(1, handling.maxSpeed)) * 0.14 * handling.suspensionScale,
      -0.08,
      0.08
    );
    s.roll = THREE.MathUtils.damp(s.roll, targetRoll, 9, dt);
    if (chassisRef.current) {
      chassisRef.current.rotation.z = s.roll;
    }
  });

  return (
    <group
      ref={groupRef}
      position={[vehicle.x, 0, vehicle.z]}
      rotation={[0, vehicle.rotY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelectVehicle?.(vehicle);
      }}
    >
      <VehicleMesh3D
        category={vehicle.category}
        plate={vehicle.plate}
        braking={vehicle.braking}
        reversing={vehicle.speed < -0.35}
        boost={vehicle.boost}
        hasDriver={Boolean(vehicle.driverUid)}
        chassisRef={chassisRef}
        wheelSpinRefs={wheelSpinRefs}
        frontSteerRefs={frontSteerRefs}
        labelInfo={{
          model: vehicle.model,
          plate: vehicle.plate,
          ownerAlias: vehicle.ownerAlias,
          driverName: vehicle.driverName,
          isOwnedBySelf,
          isDrivenBySelf: false,
        }}
      />
    </group>
  );
}

/**
 * Renders all active shared multiplayer vehicles in the 3D city:
 * - The locally driven vehicle runs arcade physics, collisions, chase camera & WS sync.
 * - All parked & remote-driven vehicles smoothly interpolate positions, steering & wheels.
 */
export function WorldVehicles({
  vehicles,
  selfUid,
  drivingVehicleId,
  controlsEnabled,
  cameraPreset,
  vehicleCorrection,
  mobileDrivingRef,
  onReportVehicleMotion,
  onLocalTelemetry,
  onSelectVehicle,
}: WorldVehiclesProps) {
  const allVehiclesRef = useRef(vehicles);
  allVehiclesRef.current = vehicles;

  const list = Object.values(vehicles);
  if (list.length === 0) return null;

  return (
    <group name="shared-world-vehicles">
      {list.map((v) =>
        v.vehicleId === drivingVehicleId ? (
          <DrivenVehicleNode
            key={v.vehicleId}
            vehicle={v}
            allVehiclesRef={allVehiclesRef}
            controlsEnabled={controlsEnabled}
            cameraPreset={cameraPreset}
            vehicleCorrection={vehicleCorrection}
            mobileDrivingRef={mobileDrivingRef}
            onReportVehicleMotion={onReportVehicleMotion}
            onLocalTelemetry={onLocalTelemetry}
          />
        ) : (
          <SyncedVehicleNode
            key={v.vehicleId}
            vehicle={v}
            isOwnedBySelf={v.ownerUid === selfUid}
            onSelectVehicle={onSelectVehicle}
          />
        )
      )}
    </group>
  );
}
