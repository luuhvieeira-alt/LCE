import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CITY_ESTABLISHMENTS,
  PERIMETER_BUILDINGS,
  type CityEstablishment,
} from '../../config/gameModules';
import {
  createAsphaltTexture,
  createFacadeTexture,
  createSidewalkTexture,
} from './proceduralTextures';

interface UrbanEnvironmentProps {
  isSoftwareGl: boolean;
  highQuality: boolean;
  onSelectEstablishment?: (est: CityEstablishment) => void;
}

const STREETLAMP_POSITIONS: [number, number, number][] = [
  [-7.5, 0, -24],
  [7.5, 0, -24],
  [-7.5, 0, -10],
  [7.5, 0, -10],
  [-7.5, 0, 10],
  [7.5, 0, 10],
  [-7.5, 0, 24],
  [7.5, 0, 24],
  [-24, 0, -7.5],
  [-24, 0, 7.5],
  [24, 0, -7.5],
  [24, 0, 7.5],
];

const TREE_POSITIONS: [number, number, number][] = [
  [-9.5, 0, -15],
  [9.5, 0, -15],
  [-9.5, 0, 15],
  [9.5, 0, 15],
  [-15, 0, -9.5],
  [15, 0, -9.5],
  [-15, 0, 9.5],
  [15, 0, 9.5],
];

const PARKED_VEHICLES: {
  pos: [number, number, number];
  rotY: number;
  bodyColor: string;
}[] = [
  { pos: [-4.6, 0, -14], rotY: 0, bodyColor: '#1F2633' },
  { pos: [4.6, 0, 14], rotY: Math.PI, bodyColor: '#2B1F23' },
  { pos: [-16, 0, 4.6], rotY: Math.PI / 2, bodyColor: '#242B35' },
  { pos: [15, 0, -4.6], rotY: -Math.PI / 2, bodyColor: '#1A242D' },
];

function CompositeStreetLamp({ position }: { position: [number, number, number] }) {
  const armDir = position[0] < 0 ? 1 : -1;
  return (
    <group position={position}>
      {/* Concrete plinth base */}
      <mesh position={[0, 0.2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.3, 0.4, 8]} />
        <meshStandardMaterial color="#2A303D" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* Tapered steel pole */}
      <mesh position={[0, 3.1, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.12, 5.8, 8]} />
        <meshStandardMaterial color="#1A202B" roughness={0.35} metalness={0.82} />
      </mesh>
      {/* Cantilever arm */}
      <mesh position={[armDir * 0.65, 5.95, 0]} rotation={[0, 0, armDir * -0.15]}>
        <boxGeometry args={[1.45, 0.1, 0.12]} />
        <meshStandardMaterial color="#1A202B" roughness={0.35} metalness={0.82} />
      </mesh>
      {/* Luminaire housing */}
      <mesh position={[armDir * 1.25, 5.82, 0]}>
        <boxGeometry args={[0.52, 0.14, 0.28]} />
        <meshStandardMaterial color="#12161F" roughness={0.3} metalness={0.85} />
      </mesh>
      {/* Warm sodium-amber emissive LED strip */}
      <mesh position={[armDir * 1.25, 5.74, 0]}>
        <boxGeometry args={[0.42, 0.05, 0.2]} />
        <meshStandardMaterial
          color="#FDE68A"
          emissive="#F59E0B"
          emissiveIntensity={2.8}
          roughness={0.2}
        />
      </mesh>
      {/* Subtle light pool projection on street */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[armDir * 1.15, 0.04, 0]}>
        <circleGeometry args={[3.4, 18]} />
        <meshBasicMaterial color="#D97706" transparent opacity={0.09} depthWrite={false} />
      </mesh>
    </group>
  );
}

function UrbanTree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Concrete planter curb */}
      <mesh position={[0, 0.24, 0]} receiveShadow castShadow>
        <boxGeometry args={[1.65, 0.48, 1.65]} />
        <meshStandardMaterial color="#272D39" roughness={0.88} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.49, 0]}>
        <boxGeometry args={[1.35, 0.04, 1.35]} />
        <meshStandardMaterial color="#1A1713" roughness={0.95} />
      </mesh>
      {/* Tapered Trunk */}
      <mesh position={[0, 1.55, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.2, 2.2, 7]} />
        <meshStandardMaterial color="#3B2D23" roughness={0.92} />
      </mesh>
      {/* Layered Foliage Crown */}
      <mesh position={[0, 3.05, 0]} castShadow>
        <dodecahedronGeometry args={[1.15, 0]} />
        <meshStandardMaterial color="#1E352B" roughness={0.88} metalness={0.02} />
      </mesh>
      <mesh position={[0.45, 3.55, 0.25]} castShadow>
        <dodecahedronGeometry args={[0.78, 0]} />
        <meshStandardMaterial color="#254235" roughness={0.86} metalness={0.02} />
      </mesh>
    </group>
  );
}

function ParkedSedan({
  pos,
  rotY,
  bodyColor,
}: {
  pos: [number, number, number];
  rotY: number;
  bodyColor: string;
}) {
  const wheels: [number, number, number][] = [
    [-0.86, 0.34, 1.25],
    [0.86, 0.34, 1.25],
    [-0.86, 0.34, -1.25],
    [0.86, 0.34, -1.25],
  ];

  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      {/* Main Lower Chassis */}
      <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.82, 0.56, 4.35]} />
        <meshStandardMaterial color={bodyColor} roughness={0.28} metalness={0.78} />
      </mesh>
      {/* Cabin & Pillars */}
      <mesh position={[0, 1.12, -0.15]} castShadow>
        <boxGeometry args={[1.56, 0.52, 2.15]} />
        <meshStandardMaterial color="#111620" roughness={0.14} metalness={0.88} />
      </mesh>
      {/* Roof cap */}
      <mesh position={[0, 1.39, -0.15]}>
        <boxGeometry args={[1.48, 0.06, 1.9]} />
        <meshStandardMaterial color={bodyColor} roughness={0.32} metalness={0.75} />
      </mesh>
      {/* Front Headlights */}
      <mesh position={[-0.62, 0.66, 2.18]}>
        <boxGeometry args={[0.38, 0.14, 0.06]} />
        <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[0.62, 0.66, 2.18]}>
        <boxGeometry args={[0.38, 0.14, 0.06]} />
        <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.6} />
      </mesh>
      {/* Rear Taillights */}
      <mesh position={[0, 0.68, -2.18]}>
        <boxGeometry args={[1.54, 0.1, 0.06]} />
        <meshStandardMaterial color="#FCA5A5" emissive="#DC2626" emissiveIntensity={1.4} />
      </mesh>
      {/* 4 Wheels with metallic rims */}
      {wheels.map((wPos, idx) => (
        <group key={idx} position={wPos} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.34, 0.34, 0.24, 14]} />
            <meshStandardMaterial color="#101216" roughness={0.85} metalness={0.1} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.2, 0.2, 0.26, 10]} />
            <meshStandardMaterial color="#94A3B8" roughness={0.25} metalness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function EstablishmentBuilding({
  est,
  facadeTex,
  onSelect,
}: {
  est: CityEstablishment;
  facadeTex: THREE.CanvasTexture;
  onSelect?: (est: CityEstablishment) => void;
}) {
  const [w, h, d] = est.size;
  const lobbyH = 3.2;
  const upperH = Math.max(4, h - lobbyH);
  // Face the signboard toward the central intersection
  const signZ = est.position[2] < 0 ? d / 2 + 0.18 : -d / 2 - 0.18;
  const signRotY = est.position[2] < 0 ? 0 : Math.PI;

  return (
    <group
      position={est.position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(est);
      }}
    >
      {/* Concrete Plinth */}
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <boxGeometry args={[w + 1.2, 0.4, d + 1.2]} />
        <meshStandardMaterial color="#232936" roughness={0.85} metalness={0.1} />
      </mesh>

      {/* Ground Floor Lobby with Recessed Illuminated Storefront */}
      <mesh position={[0, lobbyH / 2 + 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[w - 0.4, lobbyH, d - 0.4]} />
        <meshStandardMaterial color="#131926" roughness={0.22} metalness={0.78} />
      </mesh>
      {/* Illuminated lobby glass accent band */}
      <mesh position={[0, 1.8, signZ * 0.96]}>
        <boxGeometry args={[w * 0.72, 2.2, 0.12]} />
        <meshStandardMaterial
          color="#1E293B"
          emissive={est.accentHex}
          emissiveIntensity={0.45}
          roughness={0.15}
          metalness={0.85}
        />
      </mesh>

      {/* Main Architectural Tower */}
      <mesh position={[0, lobbyH + 0.4 + upperH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, upperH, d]} />
        <meshStandardMaterial
          map={facadeTex}
          roughness={0.48}
          metalness={0.45}
        />
      </mesh>

      {/* Architectural Parapet Crown */}
      <mesh position={[0, h + 0.65, 0]} castShadow>
        <boxGeometry args={[w + 0.45, 0.55, d + 0.45]} />
        <meshStandardMaterial color="#141923" roughness={0.55} metalness={0.5} />
      </mesh>

      {/* Rooftop Mechanical Penthouse */}
      <mesh position={[w * 0.15, h + 1.65, -d * 0.12]} castShadow>
        <boxGeometry args={[w * 0.42, 1.5, d * 0.38]} />
        <meshStandardMaterial color="#1D2432" roughness={0.72} metalness={0.35} />
      </mesh>

      {/* Glowing Accent Architectural Trim Band */}
      <mesh position={[0, lobbyH + 0.55, signZ]}>
        <boxGeometry args={[w * 0.88, 0.16, 0.14]} />
        <meshStandardMaterial
          color={est.accentHex}
          emissive={est.accentHex}
          emissiveIntensity={1.9}
          roughness={0.25}
        />
      </mesh>

      {/* Establishment Signboard facing central avenue */}
      <group position={[0, lobbyH + 1.25, signZ + (est.position[2] < 0 ? 0.08 : -0.08)]} rotation={[0, signRotY, 0]}>
        <mesh>
          <boxGeometry args={[w * 0.76, 1.05, 0.12]} />
          <meshStandardMaterial color="#0C1018" roughness={0.4} metalness={0.6} />
        </mesh>
        <Text
          position={[0, 0.12, 0.09]}
          fontSize={0.48}
          maxWidth={w * 0.7}
          color="#F8FAFC"
          anchorX="center"
          anchorY="middle"
        >
          {est.name}
        </Text>
        <Text
          position={[0, -0.26, 0.09]}
          fontSize={0.24}
          color={est.accentHex}
          anchorX="center"
          anchorY="middle"
        >
          {est.category.toUpperCase()}
        </Text>
      </group>
    </group>
  );
}

export function UrbanEnvironment({
  isSoftwareGl,
  highQuality,
  onSelectEstablishment,
}: UrbanEnvironmentProps) {
  const { gl, scene } = useThree();
  const maxAnisotropy = gl.capabilities.getMaxAnisotropy();

  // Studio environment reflections (RoomEnvironment + PMREMGenerator) for PBR metals & glass
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    return () => {
      scene.environment = null;
      envTarget.dispose();
    };
  }, [gl, scene]);

  // Procedural Textures with proper cleanup
  const textures = useMemo(() => {
    const asphalt = createAsphaltTexture(maxAnisotropy);
    const sidewalk = createSidewalkTexture(maxAnisotropy);
    const estFacades = CITY_ESTABLISHMENTS.map((est, i) =>
      createFacadeTexture('#181F2C', est.accentHex, 17 + i * 31, maxAnisotropy)
    );
    const perimeterFacade = createFacadeTexture('#141925', '#D97706', 97, maxAnisotropy);
    return { asphalt, sidewalk, estFacades, perimeterFacade };
  }, [maxAnisotropy]);

  useEffect(() => {
    return () => {
      textures.asphalt.dispose();
      textures.sidewalk.dispose();
      textures.perimeterFacade.dispose();
      textures.estFacades.forEach((t) => t.dispose());
    };
  }, [textures]);

  const enableShadows = !isSoftwareGl && highQuality;

  return (
    <group>
      {/* Horizon-matched midnight twilight backdrop & fog */}
      <color attach="background" args={['#0B101B']} />
      <fogExp2 attach="fog" args={['#0B101B', 0.0125]} />

      {/* Warm/Cool Urban Twilight Lighting Rig (<= 3 lights, zero blown-out ambient) */}
      <hemisphereLight args={['#5B7CAE', '#191612', 0.85]} />
      <directionalLight
        position={[32, 46, 24]}
        intensity={1.55}
        color="#FFE2B8"
        castShadow={enableShadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-44}
        shadow-camera-right={44}
        shadow-camera-top={44}
        shadow-camera-bottom={-44}
        shadow-camera-near={5}
        shadow-camera-far={120}
        shadow-bias={-0.0005}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[-28, 22, -26]} intensity={0.45} color="#7DA6E8" />

      {/* Extended Outer Metropolitan Terrain (fades into horizon fog — never boxed in void) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[280, 280]} />
        <meshStandardMaterial color="#0E121B" roughness={0.95} metalness={0.05} />
      </mesh>

      {/* Playable District Ground Concrete Base (y = 0) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[96, 96]} />
        <meshStandardMaterial map={textures.sidewalk} roughness={0.85} metalness={0.08} />
      </mesh>

      {/* North-South Avenue (offset y = 0.02 to prevent Z-fighting) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[12.5, 96]} />
        <meshStandardMaterial
          map={textures.asphalt}
          roughness={0.58}
          metalness={0.18}
        />
      </mesh>

      {/* East-West Avenue (offset y = 0.022) */}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.022, 0]} receiveShadow>
        <planeGeometry args={[12.5, 96]} />
        <meshStandardMaterial
          map={textures.asphalt}
          roughness={0.58}
          metalness={0.18}
        />
      </mesh>

      {/* Central Intersection Asphalt Hub (y = 0.026) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]} receiveShadow>
        <planeGeometry args={[13.2, 13.2]} />
        <meshStandardMaterial color="#171B22" roughness={0.55} metalness={0.2} />
      </mesh>

      {/* Central Roundabout Architectural Marker */}
      <group position={[0, 0.03, 0]}>
        <mesh receiveShadow>
          <cylinderGeometry args={[2.1, 2.35, 0.24, 24]} />
          <meshStandardMaterial color="#232936" roughness={0.75} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.14, 0]}>
          <cylinderGeometry args={[1.65, 1.65, 0.06, 24]} />
          <meshStandardMaterial
            color="#D97706"
            emissive="#B45309"
            emissiveIntensity={0.7}
            roughness={0.35}
            metalness={0.6}
          />
        </mesh>
      </group>

      {/* 4 Raised Quadrant Sidewalk Plazas */}
      {[
        [-21, -21],
        [21, -21],
        [-21, 21],
        [21, 21],
      ].map(([qx, qz], idx) => (
        <mesh key={idx} position={[qx, 0.07, qz]} receiveShadow>
          <boxGeometry args={[28, 0.14, 28]} />
          <meshStandardMaterial map={textures.sidewalk} roughness={0.86} metalness={0.08} />
        </mesh>
      ))}

      {/* 4 Interactive District Establishments */}
      {CITY_ESTABLISHMENTS.map((est, idx) => (
        <EstablishmentBuilding
          key={est.id}
          est={est}
          facadeTex={textures.estFacades[idx]}
          onSelect={onSelectEstablishment}
        />
      ))}

      {/* Architectural Perimeter Skyline Towers */}
      {PERIMETER_BUILDINGS.map((b) => (
        <group key={b.id} position={b.position}>
          <mesh position={[0, b.size[1] / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={b.size} />
            <meshStandardMaterial
              map={textures.perimeterFacade}
              color={b.tone}
              roughness={0.55}
              metalness={0.42}
            />
          </mesh>
          <mesh position={[0, b.size[1] + b.roofHeight / 2, 0]}>
            <boxGeometry args={[b.size[0] * 0.5, b.roofHeight, b.size[2] * 0.5]} />
            <meshStandardMaterial color="#10151F" roughness={0.65} metalness={0.4} />
          </mesh>
        </group>
      ))}

      {/* Urban Streetlamps */}
      {STREETLAMP_POSITIONS.map((pos, idx) => (
        <CompositeStreetLamp key={idx} position={pos} />
      ))}

      {/* Urban Trees in Planters */}
      {TREE_POSITIONS.map((pos, idx) => (
        <UrbanTree key={idx} position={pos} />
      ))}

      {/* Parked Composite Sedans */}
      {PARKED_VEHICLES.map((v, idx) => (
        <ParkedSedan key={idx} pos={v.pos} rotY={v.rotY} bodyColor={v.bodyColor} />
      ))}
    </group>
  );
}
