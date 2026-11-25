import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { createContactShadowTexture } from './proceduralTextures';

interface CharacterAvatar3DProps {
  coatColor: string;
  accentColor: string;
  skinTone: string;
  style: string;
  characterName?: string;
  alias?: string;
  isMoving: boolean;
  isSprinting?: boolean;
  showLabel?: boolean;
  isLocalPlayer?: boolean;
  isOnline?: boolean;
}

export function CharacterAvatar3D({
  coatColor,
  accentColor,
  skinTone,
  style,
  characterName,
  alias,
  isMoving,
  isSprinting = false,
  showLabel = false,
  isLocalPlayer = false,
  isOnline = false,
}: CharacterAvatar3DProps) {
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const bodyBounceRef = useRef<THREE.Group>(null);
  const phaseRef = useRef(0);

  const shadowTexture = useMemo(() => createContactShadowTexture(), []);

  useEffect(() => {
    return () => {
      shadowTexture.dispose();
    };
  }, [shadowTexture]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const speed = isSprinting ? 12.5 : 8.2;
    const amplitude = isSprinting ? 0.65 : 0.45;

    if (isMoving) {
      phaseRef.current += dt * speed;
    }

    const targetSwing = isMoving ? Math.sin(phaseRef.current) * amplitude : 0;
    const targetBounce = isMoving ? Math.abs(Math.cos(phaseRef.current)) * 0.045 : 0;

    if (leftLegRef.current) {
      leftLegRef.current.rotation.x = THREE.MathUtils.damp(
        leftLegRef.current.rotation.x,
        targetSwing,
        12,
        dt
      );
    }
    if (rightLegRef.current) {
      rightLegRef.current.rotation.x = THREE.MathUtils.damp(
        rightLegRef.current.rotation.x,
        -targetSwing,
        12,
        dt
      );
    }
    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = THREE.MathUtils.damp(
        leftArmRef.current.rotation.x,
        -targetSwing * 0.85,
        12,
        dt
      );
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = THREE.MathUtils.damp(
        rightArmRef.current.rotation.x,
        targetSwing * 0.85,
        12,
        dt
      );
    }
    if (bodyBounceRef.current) {
      bodyBounceRef.current.position.y = THREE.MathUtils.damp(
        bodyBounceRef.current.position.y,
        targetBounce,
        14,
        dt
      );
    }
  });

  // Grounded bottom-center pivot at y = 0
  return (
    <group>
      {/* Soft contact shadow plane directly beneath boots */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} renderOrder={2}>
        <planeGeometry args={[1.15, 1.15]} />
        <meshBasicMaterial
          map={shadowTexture}
          transparent
          depthWrite={false}
          opacity={0.75}
        />
      </mesh>

      {/* Subtle architectural locator ring for the local player */}
      {isLocalPlayer && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.032, 0]} renderOrder={3}>
          <ringGeometry args={[0.56, 0.66, 32]} />
          <meshBasicMaterial
            color="#F59E0B"
            transparent
            opacity={0.62}
            depthWrite={false}
          />
        </mesh>
      )}

      <group ref={bodyBounceRef}>
        {/* Left Leg (pivoted at hip y = 0.82) */}
        <group ref={leftLegRef} position={[-0.14, 0.82, 0]}>
          <mesh position={[0, -0.36, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.19, 0.7, 0.21]} />
            <meshStandardMaterial color="#141821" roughness={0.85} metalness={0.05} />
          </mesh>
          <mesh position={[0, -0.76, 0.04]} castShadow>
            <boxGeometry args={[0.2, 0.12, 0.3]} />
            <meshStandardMaterial color="#0A0C10" roughness={0.35} metalness={0.25} />
          </mesh>
        </group>

        {/* Right Leg (pivoted at hip y = 0.82) */}
        <group ref={rightLegRef} position={[0.14, 0.82, 0]}>
          <mesh position={[0, -0.36, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.19, 0.7, 0.21]} />
            <meshStandardMaterial color="#141821" roughness={0.85} metalness={0.05} />
          </mesh>
          <mesh position={[0, -0.76, 0.04]} castShadow>
            <boxGeometry args={[0.2, 0.12, 0.3]} />
            <meshStandardMaterial color="#0A0C10" roughness={0.35} metalness={0.25} />
          </mesh>
        </group>

        {/* Pelvis / Belt */}
        <mesh position={[0, 0.87, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 0.12, 0.28]} />
          <meshStandardMaterial color="#10131A" roughness={0.45} metalness={0.35} />
        </mesh>

        {/* Primary Torso / Coat */}
        <mesh position={[0, 1.24, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.54, 0.64, 0.3]} />
          <meshStandardMaterial color={coatColor} roughness={0.78} metalness={0.08} />
        </mesh>

        {/* Style-specific secondary & accent detail */}
        {style === 'executivo' && (
          <mesh position={[0, 1.27, 0.155]} castShadow>
            <boxGeometry args={[0.11, 0.44, 0.03]} />
            <meshStandardMaterial color={accentColor} roughness={0.35} metalness={0.35} />
          </mesh>
        )}
        {style === 'urbano' && (
          <mesh position={[0, 1.28, 0]} castShadow>
            <boxGeometry args={[0.56, 0.1, 0.32]} />
            <meshStandardMaterial color={accentColor} roughness={0.5} metalness={0.18} />
          </mesh>
        )}
        {style === 'tatico' && (
          <mesh position={[0, 1.26, 0]} castShadow>
            <boxGeometry args={[0.58, 0.42, 0.35]} />
            <meshStandardMaterial color={accentColor} roughness={0.42} metalness={0.4} />
          </mesh>
        )}

        {/* Collar trim */}
        <mesh position={[0, 1.57, 0]} castShadow>
          <boxGeometry args={[0.32, 0.08, 0.24]} />
          <meshStandardMaterial color={coatColor} roughness={0.72} metalness={0.1} />
        </mesh>

        {/* Left Arm */}
        <group ref={leftArmRef} position={[-0.36, 1.48, 0]}>
          <mesh position={[0, -0.25, 0]} castShadow>
            <boxGeometry args={[0.16, 0.54, 0.18]} />
            <meshStandardMaterial color={coatColor} roughness={0.78} metalness={0.08} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <boxGeometry args={[0.13, 0.12, 0.14]} />
            <meshStandardMaterial color={skinTone} roughness={0.62} metalness={0.02} />
          </mesh>
        </group>

        {/* Right Arm */}
        <group ref={rightArmRef} position={[0.36, 1.48, 0]}>
          <mesh position={[0, -0.25, 0]} castShadow>
            <boxGeometry args={[0.16, 0.54, 0.18]} />
            <meshStandardMaterial color={coatColor} roughness={0.78} metalness={0.08} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <boxGeometry args={[0.13, 0.12, 0.14]} />
            <meshStandardMaterial color={skinTone} roughness={0.62} metalness={0.02} />
          </mesh>
        </group>

        {/* Neck */}
        <mesh position={[0, 1.63, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.09, 0.12, 10]} />
          <meshStandardMaterial color={skinTone} roughness={0.62} metalness={0.02} />
        </mesh>

        {/* Head */}
        <mesh position={[0, 1.81, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.32, 0.3]} />
          <meshStandardMaterial color={skinTone} roughness={0.6} metalness={0.02} />
        </mesh>

        {/* Hair Crown */}
        <mesh position={[0, 1.94, -0.02]} castShadow>
          <boxGeometry args={[0.32, 0.12, 0.33]} />
          <meshStandardMaterial color="#11141C" roughness={0.82} metalness={0.05} />
        </mesh>

        {/* Subtle Dark Glasses / Visor Accent */}
        <mesh position={[0, 1.83, 0.155]}>
          <boxGeometry args={[0.24, 0.06, 0.025]} />
          <meshStandardMaterial color="#0A0D14" roughness={0.18} metalness={0.85} />
        </mesh>
      </group>

      {/* Overhead Character Identification & Discreet Static Online Indicator */}
      {showLabel && (characterName || alias) && (
        <Billboard position={[0, 2.48, 0]}>
          <Text
            position={[0, 0.11, 0]}
            fontSize={0.21}
            color={isLocalPlayer ? '#FDE68A' : '#F8FAFC'}
            outlineWidth={0.024}
            outlineColor="#090B10"
            anchorX="center"
            anchorY="middle"
          >
            {characterName || `@${alias}`}
          </Text>
          <Text
            position={[0, -0.1, 0]}
            fontSize={0.13}
            color={isOnline ? '#34D399' : '#94A3B8'}
            outlineWidth={0.018}
            outlineColor="#090B10"
            anchorX="center"
            anchorY="middle"
          >
            {isLocalPlayer
              ? isOnline
                ? `Você · Online`
                : `Você · Reconectando`
              : isOnline
                ? `@${alias ?? 'cidadao'} · Online`
                : `@${alias ?? 'cidadao'}`}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
