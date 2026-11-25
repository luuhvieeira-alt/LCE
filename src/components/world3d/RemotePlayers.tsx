import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RemotePlayerState } from '../../types/multiplayer';
import { CharacterAvatar3D } from './CharacterAvatar3D';

function RemoteCitizenMesh({ player }: { player: RemotePlayerState }) {
  const groupRef = useRef<THREE.Group>(null);
  const smoothPos = useRef({ x: player.x, z: player.z, rotY: player.rotY });
  const [activelyMoving, setActivelyMoving] = useState(player.isMoving);
  const activeFlagRef = useRef(player.isMoving);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    smoothPos.current.x = THREE.MathUtils.damp(smoothPos.current.x, player.x, 11, dt);
    smoothPos.current.z = THREE.MathUtils.damp(smoothPos.current.z, player.z, 11, dt);

    let diff = player.rotY - smoothPos.current.rotY;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    smoothPos.current.rotY += diff * (1 - Math.exp(-11 * dt));

    if (groupRef.current) {
      groupRef.current.position.set(smoothPos.current.x, 0, smoothPos.current.z);
      groupRef.current.rotation.y = smoothPos.current.rotY;
    }

    // Settle animation to idle if no fresh movement packet arrived within 500ms
    const stillMoving = player.isMoving && Date.now() - player.updatedAt < 500;
    if (stillMoving !== activeFlagRef.current) {
      activeFlagRef.current = stillMoving;
      setActivelyMoving(stillMoving);
    }
  });

  return (
    <group ref={groupRef} position={[player.x, 0, player.z]} rotation={[0, player.rotY, 0]}>
      <CharacterAvatar3D
        coatColor={player.coatColor}
        accentColor={player.accentColor}
        skinTone={player.skinTone}
        style={player.style}
        characterName={player.characterName}
        alias={player.alias}
        isMoving={activelyMoving}
        showLabel
        isOnline
      />
    </group>
  );
}

export function RemotePlayers({ players }: { players: Record<string, RemotePlayerState> }) {
  const list = Object.values(players);
  if (list.length === 0) return null;

  return (
    <group>
      {list.map((player) => (
        <RemoteCitizenMesh key={player.uid} player={player} />
      ))}
    </group>
  );
}
