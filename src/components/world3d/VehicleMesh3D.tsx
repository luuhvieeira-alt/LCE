import { useEffect, useMemo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { VehicleCategory } from '../../types/vehicle';
import { createContactShadowTexture } from './proceduralTextures';

export interface VehicleLabelInfo {
  model: string;
  plate: string;
  ownerName?: string;
  ownerAlias?: string;
  driverName?: string | null;
  isOwnedBySelf?: boolean;
  isDrivenBySelf?: boolean;
}

export interface VehicleMesh3DProps {
  category: VehicleCategory;
  plate?: string;
  braking?: boolean;
  reversing?: boolean;
  hasDriver?: boolean;
  boost?: boolean;
  showContactShadow?: boolean;
  labelInfo?: VehicleLabelInfo;
  /** Optional ref attached to the sprung upper body group for suspension pitch/roll */
  chassisRef?: React.RefObject<THREE.Group | null>;
  /** Optional refs array populated with each wheel's rolling mesh group */
  wheelSpinRefs?: React.MutableRefObject<Array<THREE.Group | null>>;
  /** Optional refs array populated with the front steerable wheel pivot groups */
  frontSteerRefs?: React.MutableRefObject<Array<THREE.Group | null>>;
}

const CATEGORY_FINISH: Record<
  VehicleCategory,
  { body: string; accent: string; roughness: number; metalness: number }
> = {
  popular: { body: '#2B3A4E', accent: '#94A3B8', roughness: 0.34, metalness: 0.68 },
  sedan: { body: '#1F2937', accent: '#CBD5E1', roughness: 0.24, metalness: 0.82 },
  suv: { body: '#23332C', accent: '#D97706', roughness: 0.32, metalness: 0.72 },
  picape: { body: '#3B2F26', accent: '#B45309', roughness: 0.38, metalness: 0.64 },
  esportivo: { body: '#8F1D24', accent: '#F59E0B', roughness: 0.18, metalness: 0.88 },
  luxo: { body: '#161B26', accent: '#EAB308', roughness: 0.16, metalness: 0.92 },
  moto: { body: '#27303F', accent: '#F59E0B', roughness: 0.25, metalness: 0.85 },
  caminhao: { body: '#2E3744', accent: '#D97706', roughness: 0.44, metalness: 0.55 },
};

interface WheelSpec {
  pos: [number, number, number];
  radius: number;
  width: number;
  isFront: boolean;
}

function WheelAssembly({
  spec,
  index,
  frontIndex,
  wheelSpinRefs,
  frontSteerRefs,
}: {
  spec: WheelSpec;
  index: number;
  frontIndex: number;
  wheelSpinRefs?: React.MutableRefObject<Array<THREE.Group | null>>;
  frontSteerRefs?: React.MutableRefObject<Array<THREE.Group | null>>;
}) {
  return (
    <group
      position={spec.pos}
      ref={(el) => {
        if (spec.isFront && frontSteerRefs && frontIndex >= 0) {
          frontSteerRefs.current[frontIndex] = el;
        }
      }}
    >
      <group
        ref={(el) => {
          if (wheelSpinRefs) {
            wheelSpinRefs.current[index] = el;
          }
        }}
      >
        {/* Rubber tire aligned along X axle */}
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[spec.radius, spec.radius, spec.width, 14]} />
          <meshStandardMaterial color="#101216" roughness={0.86} metalness={0.08} />
        </mesh>
        {/* Metallic alloy rim */}
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry
            args={[spec.radius * 0.58, spec.radius * 0.58, spec.width + 0.02, 10]}
          />
          <meshStandardMaterial color="#CBD5E1" roughness={0.22} metalness={0.92} />
        </mesh>
        {/* Rim spoke bar so wheel spin is visibly unmistakable when driving */}
        <mesh>
          <boxGeometry args={[spec.width + 0.035, spec.radius * 1.05, 0.06]} />
          <meshStandardMaterial color="#1F2937" roughness={0.35} metalness={0.78} />
        </mesh>
      </group>
    </group>
  );
}

function LicensePlateBadge({
  plate,
  position,
  rotationY = 0,
}: {
  plate: string;
  position: [number, number, number];
  rotationY?: number;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh>
        <boxGeometry args={[0.64, 0.19, 0.025]} />
        <meshStandardMaterial color="#E2E8F0" roughness={0.35} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.068, 0.015]}>
        <boxGeometry args={[0.62, 0.042, 0.008]} />
        <meshStandardMaterial color="#1D4ED8" roughness={0.4} metalness={0.2} />
      </mesh>
      <Text
        position={[0, -0.012, 0.018]}
        fontSize={0.1}
        color="#0F172A"
        anchorX="center"
        anchorY="middle"
      >
        {plate}
      </Text>
    </group>
  );
}

function DriverSilhouette({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Torso */}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.38, 0.38, 0.24]} />
        <meshStandardMaterial color="#1E293B" roughness={0.75} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.34, 0.02]}>
        <boxGeometry args={[0.24, 0.25, 0.24]} />
        <meshStandardMaterial color="#C6956E" roughness={0.62} />
      </mesh>
      {/* Dark cap / hair */}
      <mesh position={[0, 0.45, 0.01]}>
        <boxGeometry args={[0.26, 0.08, 0.26]} />
        <meshStandardMaterial color="#0F172A" roughness={0.7} />
      </mesh>
    </group>
  );
}

/**
 * Reusable composite procedural 3D vehicle grounded at y = 0.
 * Shared across live drivable multiplayer vehicles and dealership showroom pedestals.
 */
export function VehicleMesh3D({
  category,
  plate,
  braking = false,
  reversing = false,
  hasDriver = false,
  boost = false,
  showContactShadow = true,
  labelInfo,
  chassisRef,
  wheelSpinRefs,
  frontSteerRefs,
}: VehicleMesh3DProps) {
  const finish = CATEGORY_FINISH[category] ?? CATEGORY_FINISH.sedan;
  const shadowTexture = useMemo(
    () => (showContactShadow ? createContactShadowTexture() : null),
    [showContactShadow]
  );

  useEffect(() => {
    return () => {
      shadowTexture?.dispose();
    };
  }, [shadowTexture]);

  const tailIntensity = braking ? 3.4 : 1.35;
  const tailColor = braking ? '#EF4444' : '#DC2626';
  const headIntensity = hasDriver ? 2.4 : 1.1;

  // Dimensions for contact shadow & label height
  const isMoto = category === 'moto';
  const isTruck = category === 'caminhao';
  const shadowScale: [number, number] = isMoto
    ? [1.5, 2.9]
    : isTruck
      ? [3.1, 6.2]
      : [2.75, 5.45];
  const labelHeight = isTruck ? 3.25 : isMoto ? 2.15 : 2.45;

  const renderVehicleParts = () => {
    if (category === 'moto') {
      const wheels: WheelSpec[] = [
        { pos: [0, 0.34, 0.88], radius: 0.34, width: 0.16, isFront: true },
        { pos: [0, 0.34, -0.84], radius: 0.34, width: 0.19, isFront: false },
      ];
      return (
        <>
          <group ref={chassisRef}>
            {/* Frame & Engine Block */}
            <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.36, 0.42, 1.45]} />
              <meshStandardMaterial color="#141821" roughness={0.45} metalness={0.72} />
            </mesh>
            {/* Sculpted Fuel Tank */}
            <mesh position={[0, 0.9, 0.18]} castShadow>
              <boxGeometry args={[0.46, 0.28, 0.68]} />
              <meshStandardMaterial
                color={finish.body}
                roughness={finish.roughness}
                metalness={finish.metalness}
              />
            </mesh>
            {/* Accent Side Fairing */}
            <mesh position={[0, 0.72, 0.42]} castShadow>
              <boxGeometry args={[0.52, 0.34, 0.56]} />
              <meshStandardMaterial color={finish.accent} roughness={0.28} metalness={0.75} />
            </mesh>
            {/* Seat & Tail */}
            <mesh position={[0, 0.84, -0.44]} castShadow>
              <boxGeometry args={[0.38, 0.14, 0.78]} />
              <meshStandardMaterial color="#111319" roughness={0.85} metalness={0.1} />
            </mesh>
            {/* Front Fork & Handlebar */}
            <mesh position={[0, 0.86, 0.72]} rotation={[0.34, 0, 0]} castShadow>
              <boxGeometry args={[0.14, 0.78, 0.12]} />
              <meshStandardMaterial color="#CBD5E1" roughness={0.25} metalness={0.9} />
            </mesh>
            <mesh position={[0, 1.14, 0.62]}>
              <boxGeometry args={[0.78, 0.06, 0.08]} />
              <meshStandardMaterial color="#0F172A" roughness={0.35} metalness={0.8} />
            </mesh>
            {/* Headlight */}
            <mesh position={[0, 0.92, 0.92]}>
              <boxGeometry args={[0.24, 0.16, 0.08]} />
              <meshStandardMaterial
                color="#FEF3C7"
                emissive="#F59E0B"
                emissiveIntensity={headIntensity}
              />
            </mesh>
            {/* Taillight */}
            <mesh position={[0, 0.84, -0.92]}>
              <boxGeometry args={[0.24, 0.1, 0.06]} />
              <meshStandardMaterial
                color="#FCA5A5"
                emissive={tailColor}
                emissiveIntensity={tailIntensity}
              />
            </mesh>
            {plate && <LicensePlateBadge plate={plate} position={[0, 0.64, -0.95]} rotationY={Math.PI} />}
            {hasDriver && <DriverSilhouette position={[0, 1.16, -0.18]} />}
          </group>
          {wheels.map((w, idx) => (
            <WheelAssembly
              key={idx}
              spec={w}
              index={idx}
              frontIndex={w.isFront ? 0 : -1}
              wheelSpinRefs={wheelSpinRefs}
              frontSteerRefs={frontSteerRefs}
            />
          ))}
        </>
      );
    }

    if (category === 'caminhao') {
      const wheels: WheelSpec[] = [
        { pos: [-0.95, 0.38, 1.45], radius: 0.38, width: 0.28, isFront: true },
        { pos: [0.95, 0.38, 1.45], radius: 0.38, width: 0.28, isFront: true },
        { pos: [-0.95, 0.38, -0.75], radius: 0.38, width: 0.28, isFront: false },
        { pos: [0.95, 0.38, -0.75], radius: 0.38, width: 0.28, isFront: false },
        { pos: [-0.95, 0.38, -1.65], radius: 0.38, width: 0.28, isFront: false },
        { pos: [0.95, 0.38, -1.65], radius: 0.38, width: 0.28, isFront: false },
      ];
      return (
        <>
          <group ref={chassisRef}>
            {/* Heavy steel frame */}
            <mesh position={[0, 0.52, -0.15]} castShadow receiveShadow>
              <boxGeometry args={[1.95, 0.24, 4.65]} />
              <meshStandardMaterial color="#161A22" roughness={0.75} metalness={0.45} />
            </mesh>
            {/* Cab forward */}
            <mesh position={[0, 1.28, 1.42]} castShadow>
              <boxGeometry args={[1.92, 1.32, 1.38]} />
              <meshStandardMaterial
                color={finish.body}
                roughness={finish.roughness}
                metalness={finish.metalness}
              />
            </mesh>
            {/* Cab windshield */}
            <mesh position={[0, 1.46, 2.09]}>
              <boxGeometry args={[1.66, 0.58, 0.08]} />
              <meshStandardMaterial color="#0F172A" roughness={0.14} metalness={0.9} />
            </mesh>
            {/* Cargo box container */}
            <mesh position={[0, 1.56, -0.82]} castShadow receiveShadow>
              <boxGeometry args={[2.02, 1.84, 3.05]} />
              <meshStandardMaterial color="#D6DCE5" roughness={0.52} metalness={0.28} />
            </mesh>
            {/* Side accent stripe */}
            <mesh position={[0, 1.55, -0.82]}>
              <boxGeometry args={[2.06, 0.22, 2.75]} />
              <meshStandardMaterial color={finish.accent} roughness={0.35} metalness={0.6} />
            </mesh>
            {/* Front headlights */}
            <mesh position={[-0.68, 0.86, 2.13]}>
              <boxGeometry args={[0.36, 0.16, 0.06]} />
              <meshStandardMaterial
                color="#FEF3C7"
                emissive="#F59E0B"
                emissiveIntensity={headIntensity}
              />
            </mesh>
            <mesh position={[0.68, 0.86, 2.13]}>
              <boxGeometry args={[0.36, 0.16, 0.06]} />
              <meshStandardMaterial
                color="#FEF3C7"
                emissive="#F59E0B"
                emissiveIntensity={headIntensity}
              />
            </mesh>
            {/* Rear brake & reverse cluster */}
            <mesh position={[-0.68, 0.62, -2.49]}>
              <boxGeometry args={[0.42, 0.14, 0.06]} />
              <meshStandardMaterial
                color="#FCA5A5"
                emissive={tailColor}
                emissiveIntensity={tailIntensity}
              />
            </mesh>
            <mesh position={[0.68, 0.62, -2.49]}>
              <boxGeometry args={[0.42, 0.14, 0.06]} />
              <meshStandardMaterial
                color="#FCA5A5"
                emissive={tailColor}
                emissiveIntensity={tailIntensity}
              />
            </mesh>
            {reversing && (
              <mesh position={[0, 0.62, -2.49]}>
                <boxGeometry args={[0.32, 0.11, 0.06]} />
                <meshStandardMaterial color="#FFFFFF" emissive="#E2E8F0" emissiveIntensity={2.5} />
              </mesh>
            )}
            {plate && (
              <>
                <LicensePlateBadge plate={plate} position={[0, 0.66, 2.15]} rotationY={0} />
                <LicensePlateBadge plate={plate} position={[0, 0.56, -2.51]} rotationY={Math.PI} />
              </>
            )}
            {hasDriver && <DriverSilhouette position={[-0.38, 1.38, 1.56]} />}
          </group>
          {wheels.map((w, idx) => (
            <WheelAssembly
              key={idx}
              spec={w}
              index={idx}
              frontIndex={w.isFront ? idx : -1}
              wheelSpinRefs={wheelSpinRefs}
              frontSteerRefs={frontSteerRefs}
            />
          ))}
        </>
      );
    }

    if (category === 'picape') {
      const wheels: WheelSpec[] = [
        { pos: [-0.92, 0.38, 1.32], radius: 0.38, width: 0.28, isFront: true },
        { pos: [0.92, 0.38, 1.32], radius: 0.38, width: 0.28, isFront: true },
        { pos: [-0.92, 0.38, -1.26], radius: 0.38, width: 0.28, isFront: false },
        { pos: [0.92, 0.38, -1.26], radius: 0.38, width: 0.28, isFront: false },
      ];
      return (
        <>
          <group ref={chassisRef}>
            {/* Elevated chassis & hood */}
            <mesh position={[0, 0.72, 0.05]} castShadow receiveShadow>
              <boxGeometry args={[1.9, 0.58, 4.45]} />
              <meshStandardMaterial
                color={finish.body}
                roughness={finish.roughness}
                metalness={finish.metalness}
              />
            </mesh>
            {/* Crew cab */}
            <mesh position={[0, 1.28, 0.32]} castShadow>
              <boxGeometry args={[1.7, 0.62, 1.65]} />
              <meshStandardMaterial
                color="#0F172A"
                roughness={0.14}
                metalness={0.88}
                transparent={hasDriver}
                opacity={hasDriver ? 0.78 : 1}
              />
            </mesh>
            {/* Cab roof */}
            <mesh position={[0, 1.61, 0.32]}>
              <boxGeometry args={[1.64, 0.08, 1.5]} />
              <meshStandardMaterial
                color={finish.body}
                roughness={finish.roughness}
                metalness={finish.metalness}
              />
            </mesh>
            {/* Cargo bed inner dark liner */}
            <mesh position={[0, 1.02, -1.32]}>
              <boxGeometry args={[1.6, 0.08, 1.55]} />
              <meshStandardMaterial color="#11141B" roughness={0.9} metalness={0.1} />
            </mesh>
            {/* Roll bar behind cab */}
            <mesh position={[0, 1.35, -0.58]}>
              <boxGeometry args={[1.68, 0.52, 0.12]} />
              <meshStandardMaterial color="#272E3B" roughness={0.35} metalness={0.8} />
            </mesh>
            {/* Headlights & taillights */}
            <mesh position={[-0.66, 0.78, 2.29]}>
              <boxGeometry args={[0.38, 0.16, 0.06]} />
              <meshStandardMaterial
                color="#FEF3C7"
                emissive="#F59E0B"
                emissiveIntensity={headIntensity}
              />
            </mesh>
            <mesh position={[0.66, 0.78, 2.29]}>
              <boxGeometry args={[0.38, 0.16, 0.06]} />
              <meshStandardMaterial
                color="#FEF3C7"
                emissive="#F59E0B"
                emissiveIntensity={headIntensity}
              />
            </mesh>
            <mesh position={[0, 0.78, -2.18]}>
              <boxGeometry args={[1.62, 0.12, 0.06]} />
              <meshStandardMaterial
                color="#FCA5A5"
                emissive={tailColor}
                emissiveIntensity={tailIntensity}
              />
            </mesh>
            {reversing && (
              <mesh position={[0, 0.65, -2.19]}>
                <boxGeometry args={[0.38, 0.09, 0.06]} />
                <meshStandardMaterial color="#FFFFFF" emissive="#E2E8F0" emissiveIntensity={2.5} />
              </mesh>
            )}
            {plate && (
              <>
                <LicensePlateBadge plate={plate} position={[0, 0.56, 2.3]} rotationY={0} />
                <LicensePlateBadge plate={plate} position={[0, 0.58, -2.2]} rotationY={Math.PI} />
              </>
            )}
            {hasDriver && <DriverSilhouette position={[-0.36, 1.12, 0.34]} />}
          </group>
          {wheels.map((w, idx) => (
            <WheelAssembly
              key={idx}
              spec={w}
              index={idx}
              frontIndex={w.isFront ? idx : -1}
              wheelSpinRefs={wheelSpinRefs}
              frontSteerRefs={frontSteerRefs}
            />
          ))}
        </>
      );
    }

    // Sculpted silhouettes for popular, sedan, suv, esportivo, luxo
    const isCompact = category === 'popular';
    const isSuv = category === 'suv';
    const isSport = category === 'esportivo';
    const isLuxo = category === 'luxo';

    const bodyLen = isCompact ? 3.65 : isLuxo ? 4.55 : isSport ? 4.25 : 4.25;
    const bodyW = isSport ? 1.92 : isSuv ? 1.88 : 1.78;
    const bodyH = isSport ? 0.46 : isSuv ? 0.64 : 0.54;
    const bodyY = isSport ? 0.52 : isSuv ? 0.7 : 0.6;
    const cabinLen = isCompact ? 2.15 : isSuv ? 2.65 : isSport ? 1.75 : 2.18;
    const cabinH = isSport ? 0.42 : isSuv ? 0.62 : 0.5;
    const cabinZ = isCompact ? -0.22 : isSuv ? -0.28 : isSport ? -0.22 : -0.15;
    const wheelR = isSuv ? 0.37 : isSport ? 0.33 : 0.32;
    const wheelZ = bodyLen * 0.31;

    const wheels: WheelSpec[] = [
      { pos: [-(bodyW / 2 - 0.04), wheelR, wheelZ], radius: wheelR, width: 0.24, isFront: true },
      { pos: [bodyW / 2 - 0.04, wheelR, wheelZ], radius: wheelR, width: 0.24, isFront: true },
      { pos: [-(bodyW / 2 - 0.04), wheelR, -wheelZ], radius: wheelR, width: 0.24, isFront: false },
      { pos: [bodyW / 2 - 0.04, wheelR, -wheelZ], radius: wheelR, width: 0.24, isFront: false },
    ];

    return (
      <>
        <group ref={chassisRef}>
          {/* Main lower chassis */}
          <mesh position={[0, bodyY, 0]} castShadow receiveShadow>
            <boxGeometry args={[bodyW, bodyH, bodyLen]} />
            <meshStandardMaterial
              color={finish.body}
              roughness={finish.roughness}
              metalness={finish.metalness}
            />
          </mesh>
          {/* Greenhouse / tinted glass cabin */}
          <mesh position={[0, bodyY + bodyH / 2 + cabinH / 2 - 0.02, cabinZ]} castShadow>
            <boxGeometry args={[bodyW * 0.85, cabinH, cabinLen]} />
            <meshStandardMaterial
              color="#0F172A"
              roughness={0.12}
              metalness={0.9}
              transparent={hasDriver}
              opacity={hasDriver ? 0.78 : 1}
            />
          </mesh>
          {/* Painted roof panel */}
          <mesh position={[0, bodyY + bodyH / 2 + cabinH + 0.01, cabinZ]}>
            <boxGeometry args={[bodyW * 0.8, 0.06, cabinLen * 0.88]} />
            <meshStandardMaterial
              color={finish.body}
              roughness={finish.roughness}
              metalness={finish.metalness}
            />
          </mesh>
          {/* Sport GT rear wing */}
          {isSport && (
            <group position={[0, bodyY + bodyH / 2 + 0.22, -bodyLen / 2 + 0.22]}>
              <mesh castShadow>
                <boxGeometry args={[bodyW * 0.92, 0.06, 0.28]} />
                <meshStandardMaterial color="#111622" roughness={0.25} metalness={0.85} />
              </mesh>
              <mesh position={[-0.55, -0.12, 0]}>
                <boxGeometry args={[0.08, 0.22, 0.16]} />
                <meshStandardMaterial color="#111622" roughness={0.3} metalness={0.85} />
              </mesh>
              <mesh position={[0.55, -0.12, 0]}>
                <boxGeometry args={[0.08, 0.22, 0.16]} />
                <meshStandardMaterial color="#111622" roughness={0.3} metalness={0.85} />
              </mesh>
            </group>
          )}
          {/* Luxury side trim bar */}
          {isLuxo && (
            <mesh position={[0, bodyY - 0.12, 0]}>
              <boxGeometry args={[bodyW + 0.03, 0.06, bodyLen * 0.72]} />
              <meshStandardMaterial color={finish.accent} roughness={0.2} metalness={0.95} />
            </mesh>
          )}
          {/* Front headlights */}
          <mesh position={[-(bodyW * 0.34), bodyY + 0.04, bodyLen / 2 + 0.01]}>
            <boxGeometry args={[0.36, 0.12, 0.05]} />
            <meshStandardMaterial
              color="#FEF3C7"
              emissive="#F59E0B"
              emissiveIntensity={headIntensity}
            />
          </mesh>
          <mesh position={[bodyW * 0.34, bodyY + 0.04, bodyLen / 2 + 0.01]}>
            <boxGeometry args={[0.36, 0.12, 0.05]} />
            <meshStandardMaterial
              color="#FEF3C7"
              emissive="#F59E0B"
              emissiveIntensity={headIntensity}
            />
          </mesh>
          {/* Rear LED taillight bar (brightens when braking) */}
          <mesh position={[0, bodyY + 0.06, -(bodyLen / 2 + 0.01)]}>
            <boxGeometry args={[bodyW * 0.82, 0.1, 0.05]} />
            <meshStandardMaterial
              color="#FCA5A5"
              emissive={tailColor}
              emissiveIntensity={tailIntensity}
            />
          </mesh>
          {/* Reversing lamp */}
          {reversing && (
            <mesh position={[0, bodyY - 0.06, -(bodyLen / 2 + 0.015)]}>
              <boxGeometry args={[0.36, 0.08, 0.05]} />
              <meshStandardMaterial color="#FFFFFF" emissive="#E2E8F0" emissiveIntensity={2.5} />
            </mesh>
          )}
          {/* Subtle turbo exhaust glow when Shift boost is active */}
          {boost && (
            <mesh position={[0, bodyY - 0.17, -(bodyLen / 2 + 0.06)]}>
              <boxGeometry args={[0.48, 0.08, 0.14]} />
              <meshStandardMaterial color="#FDE68A" emissive="#F59E0B" emissiveIntensity={3.2} />
            </mesh>
          )}
          {plate && (
            <>
              <LicensePlateBadge
                plate={plate}
                position={[0, bodyY - 0.12, bodyLen / 2 + 0.02]}
                rotationY={0}
              />
              <LicensePlateBadge
                plate={plate}
                position={[0, bodyY - 0.1, -(bodyLen / 2 + 0.02)]}
                rotationY={Math.PI}
              />
            </>
          )}
          {hasDriver && (
            <DriverSilhouette
              position={[-0.34, bodyY + bodyH / 2 + 0.06, cabinZ + 0.15]}
            />
          )}
        </group>
        {wheels.map((w, idx) => (
          <WheelAssembly
            key={idx}
            spec={w}
            index={idx}
            frontIndex={w.isFront ? idx : -1}
            wheelSpinRefs={wheelSpinRefs}
            frontSteerRefs={frontSteerRefs}
          />
        ))}
      </>
    );
  };

  return (
    <group>
      {/* Grounded contact shadow directly underneath chassis */}
      {shadowTexture && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.032, 0]} renderOrder={2}>
          <planeGeometry args={shadowScale} />
          <meshBasicMaterial
            map={shadowTexture}
            transparent
            depthWrite={false}
            opacity={0.78}
          />
        </mesh>
      )}

      {/* Subtle ownership perimeter highlight when parked and owned by self */}
      {labelInfo?.isOwnedBySelf && !labelInfo.isDrivenBySelf && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.038, 0]} renderOrder={3}>
          <ringGeometry args={[1.65, 1.82, 32]} />
          <meshBasicMaterial color="#F59E0B" transparent opacity={0.45} depthWrite={false} />
        </mesh>
      )}

      {renderVehicleParts()}

      {/* Clean floating multiplayer identification header */}
      {labelInfo && (
        <Billboard position={[0, labelHeight, 0]}>
          <Text
            position={[0, 0.16, 0]}
            fontSize={0.21}
            color={labelInfo.isOwnedBySelf ? '#FDE68A' : '#F8FAFC'}
            outlineWidth={0.025}
            outlineColor="#090B10"
            anchorX="center"
            anchorY="middle"
          >
            {`${labelInfo.model} · ${labelInfo.plate}`}
          </Text>
          <Text
            position={[0, -0.08, 0]}
            fontSize={0.135}
            color={labelInfo.driverName ? '#34D399' : '#CBD5E1'}
            outlineWidth={0.018}
            outlineColor="#090B10"
            anchorX="center"
            anchorY="middle"
          >
            {labelInfo.driverName
              ? `Dirigindo: ${labelInfo.driverName}`
              : labelInfo.ownerAlias
                ? `Proprietário: @${labelInfo.ownerAlias} · Estacionado`
                : 'Estacionado'}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
