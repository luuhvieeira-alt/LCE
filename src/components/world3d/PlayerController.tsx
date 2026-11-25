import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CITY_ESTABLISHMENTS, type CityEstablishment } from '../../config/gameModules';
import type { CharacterProfile } from '../../types/character';
import type { PlayerPositionPayload } from '../../types/multiplayer';
import type { CameraPreset } from '../../context/GameContext';
import { CharacterAvatar3D } from './CharacterAvatar3D';

export interface MobileInputState {
  moveX: number; // -1..1
  moveY: number; // -1..1 (forward is +1)
  turnYaw: number; // -1..1
  sprint: boolean;
}

interface PlayerControllerProps {
  character: CharacterProfile;
  cameraPreset: CameraPreset;
  controlsEnabled: boolean;
  isOnline: boolean;
  mobileInputRef: React.RefObject<MobileInputState>;
  onReportPosition: (pos: PlayerPositionPayload) => void;
  onNearEstablishment: (est: CityEstablishment | null) => void;
}

// Pre-allocated math helpers at module scope (zero GC inside useFrame)
const _camTargetPos = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _moveDir = new THREE.Vector3();

const WORLD_LIMIT = 36;
const PLAYER_RADIUS = 0.55;

function collidesWithCity(x: number, z: number): boolean {
  // World perimeter
  if (Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) {
    return true;
  }
  // Central roundabout pillar
  if (x * x + z * z < 2.55 * 2.55) {
    return true;
  }
  // Establishment footprints
  for (const est of CITY_ESTABLISHMENTS) {
    const halfW = est.size[0] / 2 + 0.75 + PLAYER_RADIUS;
    const halfD = est.size[2] / 2 + 0.75 + PLAYER_RADIUS;
    if (
      Math.abs(x - est.position[0]) < halfW &&
      Math.abs(z - est.position[2]) < halfD
    ) {
      return true;
    }
  }
  return false;
}

function resolveInitialSpawn(character: CharacterProfile): { x: number; z: number; rotY: number } {
  const x = typeof character.lastX === 'number' && Number.isFinite(character.lastX) ? character.lastX : 0;
  const z = typeof character.lastZ === 'number' && Number.isFinite(character.lastZ) ? character.lastZ : 6.5;
  const rotY =
    typeof character.lastRotY === 'number' && Number.isFinite(character.lastRotY)
      ? character.lastRotY
      : Math.PI;
  if (collidesWithCity(x, z)) {
    return { x: 0, z: 6.5, rotY: Math.PI };
  }
  return { x, z, rotY };
}

function findNearestEstablishment(x: number, z: number): CityEstablishment | null {
  let closest: CityEstablishment | null = null;
  let minDist = 11.5;
  for (const est of CITY_ESTABLISHMENTS) {
    const dx = x - est.position[0];
    const dz = z - est.position[2];
    const dist = Math.hypot(dx, dz);
    if (dist < minDist) {
      minDist = dist;
      closest = est;
    }
  }
  return closest;
}

export function PlayerController({
  character,
  cameraPreset,
  controlsEnabled,
  isOnline,
  mobileInputRef,
  onReportPosition,
  onNearEstablishment,
}: PlayerControllerProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const initialSpawnRef = useRef(resolveInitialSpawn(character));
  const posRef = useRef({ ...initialSpawnRef.current });
  const camYawRef = useRef(0);
  const keysRef = useRef<Set<string>>(new Set());
  const draggingRef = useRef(false);
  const lastPointerXRef = useRef(0);
  const lastNearIdRef = useRef<string | null>(null);

  const [isMoving, setIsMoving] = useState(false);
  const [isSprinting, setIsSprinting] = useState(false);
  const movingFlagRef = useRef(false);
  const sprintFlagRef = useRef(false);

  // Keyboard and pointer-drag camera rotation listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
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
      camYawRef.current -= dx * 0.0065;
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
    };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const keys = keysRef.current;
    const mobile = mobileInputRef.current;

    // Camera yaw rotation via Q/E or mobile buttons
    if (controlsEnabled) {
      if (keys.has('KeyQ')) camYawRef.current += dt * 1.9;
      if (keys.has('KeyE')) camYawRef.current -= dt * 1.9;
      if (mobile && Math.abs(mobile.turnYaw) > 0.05) {
        camYawRef.current -= mobile.turnYaw * dt * 2.1;
      }
    }

    // Gather movement intent
    let inputX = 0;
    let inputForward = 0;

    if (controlsEnabled) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) inputForward += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) inputForward -= 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) inputX -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) inputX += 1;

      if (mobile && (Math.abs(mobile.moveX) > 0.08 || Math.abs(mobile.moveY) > 0.08)) {
        inputX += mobile.moveX;
        inputForward += mobile.moveY;
      }
    }

    const sprint =
      controlsEnabled && (keys.has('ShiftLeft') || keys.has('ShiftRight') || Boolean(mobile?.sprint));

    const movingNow = Math.hypot(inputX, inputForward) > 0.08;
    if (movingNow !== movingFlagRef.current) {
      movingFlagRef.current = movingNow;
      setIsMoving(movingNow);
    }
    if (sprint !== sprintFlagRef.current) {
      sprintFlagRef.current = sprint;
      setIsSprinting(sprint);
    }

    if (movingNow) {
      const yaw = camYawRef.current;
      // Forward vector relative to camera yaw (camera sits behind +Z at yaw=0, looking toward -Z)
      const sinY = Math.sin(yaw);
      const cosY = Math.cos(yaw);

      const worldX = -sinY * inputForward + cosY * inputX;
      const worldZ = -cosY * inputForward - sinY * inputX;

      _moveDir.set(worldX, 0, worldZ).normalize();
      const speed = sprint ? 10.2 : 6.1;

      const nextX = posRef.current.x + _moveDir.x * speed * dt;
      const nextZ = posRef.current.z + _moveDir.z * speed * dt;

      // Axis-separated sliding collision
      if (!collidesWithCity(nextX, posRef.current.z)) {
        posRef.current.x = nextX;
      }
      if (!collidesWithCity(posRef.current.x, nextZ)) {
        posRef.current.z = nextZ;
      }

      // Smoothly orient character toward velocity vector
      const targetRot = Math.atan2(_moveDir.x, _moveDir.z);
      let diff = targetRot - posRef.current.rotY;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      posRef.current.rotY += diff * (1 - Math.exp(-12 * dt));
    }

    if (groupRef.current) {
      groupRef.current.position.set(posRef.current.x, 0, posRef.current.z);
      groupRef.current.rotation.y = posRef.current.rotY;
    }

    // Smooth third-person / orbital follow camera using exponential damping
    const dist = cameraPreset === 'orbital' ? 12.5 : 7.6;
    const height = cameraPreset === 'orbital' ? 7.8 : 4.2;
    const yaw = camYawRef.current;

    _camTargetPos.set(
      posRef.current.x + Math.sin(yaw) * dist,
      height,
      posRef.current.z + Math.cos(yaw) * dist
    );

    camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 7.5, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 7.5, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 7.5, dt);

    _lookTarget.set(posRef.current.x, 1.6, posRef.current.z);
    camera.lookAt(_lookTarget);

    // Check nearby interactive establishment
    const nearest = findNearestEstablishment(posRef.current.x, posRef.current.z);
    const nearestId = nearest?.id ?? null;
    if (nearestId !== lastNearIdRef.current) {
      lastNearIdRef.current = nearestId;
      onNearEstablishment(nearest);
    }

    // Report position to multiplayer client & HUD coordinates
    onReportPosition({
      x: posRef.current.x,
      z: posRef.current.z,
      rotY: posRef.current.rotY,
      isMoving: movingNow,
    });
  });

  const initSpawn = initialSpawnRef.current;

  return (
    <group
      ref={groupRef}
      position={[initSpawn.x, 0, initSpawn.z]}
      rotation={[0, initSpawn.rotY, 0]}
    >
      <CharacterAvatar3D
        coatColor={character.coatColor}
        accentColor={character.accentColor}
        skinTone={character.skinTone}
        style={character.style}
        characterName={character.characterName}
        alias={character.alias}
        isMoving={isMoving}
        isSprinting={isSprinting}
        showLabel
        isLocalPlayer
        isOnline={isOnline}
      />
    </group>
  );
}
