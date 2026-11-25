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
import { GARAGE_EXIT_BAYS } from '../../config/vehiclePhysics';

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

const PUBLIC_PARKING_BAYS: Array<{ pos: [number, number, number]; rotY: number; label: string }> = [
  { pos: [-19.5, 0.032, -8.6], rotY: Math.PI / 2, label: 'ESTACIONAMENTO · BANCO' },
  { pos: [19.5, 0.032, -8.6], rotY: -Math.PI / 2, label: 'ESTACIONAMENTO · AGÊNCIA' },
  { pos: [19.5, 0.032, 8.6], rotY: -Math.PI / 2, label: 'ESTACIONAMENTO · GALERIA' },
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

function WorldVehicleZones3D() {
  return (
    <group name="world-vehicle-zones">
      {/* 1. Physical Garage Exit Bays (Baias 01–04 illuminated floor markings) */}
      {GARAGE_EXIT_BAYS.slice(0, 4).map((bay, idx) => (
        <group key={bay.id} position={[bay.x, 0.032, bay.z]} rotation={[0, bay.rotY, 0]}>
          {/* Bay asphalt pad */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[2.9, 5.4]} />
            <meshStandardMaterial color="#121722" roughness={0.72} metalness={0.18} />
          </mesh>
          {/* Left & Right Amber Guide Strips */}
          <mesh position={[-1.4, 0.01, 0]}>
            <boxGeometry args={[0.08, 0.02, 5.2]} />
            <meshStandardMaterial
              color="#F59E0B"
              emissive="#D97706"
              emissiveIntensity={1.1}
              roughness={0.35}
            />
          </mesh>
          <mesh position={[1.4, 0.01, 0]}>
            <boxGeometry args={[0.08, 0.02, 5.2]} />
            <meshStandardMaterial
              color="#F59E0B"
              emissive="#D97706"
              emissiveIntensity={1.1}
              roughness={0.35}
            />
          </mesh>
          {/* Front wheel stop bar */}
          <mesh position={[0, 0.01, 2.55]}>
            <boxGeometry args={[2.8, 0.02, 0.1]} />
            <meshStandardMaterial
              color="#F59E0B"
              emissive="#D97706"
              emissiveIntensity={1.3}
              roughness={0.35}
            />
          </mesh>
          <Text
            position={[0, 0.03, -1.9]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.42}
            color="#F59E0B"
            anchorX="center"
            anchorY="middle"
          >
            {`GARAGEM 0${idx + 1}`}
          </Text>
        </group>
      ))}

      {/* 2. Posto de Combustível LCE (x = 29.5, z = -10.5; pumps solid island at x = 32.8, z = -12.5) */}
      <group position={[29.5, 0, -10.5]}>
        {/* Concrete forecourt apron */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
          <planeGeometry args={[9.2, 8.6]} />
          <meshStandardMaterial color="#181E2B" roughness={0.78} metalness={0.12} />
        </mesh>
        {/* Marked Refuel Lane */}
        <mesh position={[-0.6, 0.04, 0]}>
          <boxGeometry args={[3.4, 0.02, 6.2]} />
          <meshStandardMaterial color="#121824" roughness={0.75} />
        </mesh>
        <mesh position={[-2.3, 0.05, 0]}>
          <boxGeometry args={[0.1, 0.02, 6.2]} />
          <meshStandardMaterial color="#10B981" emissive="#059669" emissiveIntensity={1.2} />
        </mesh>
        <mesh position={[1.1, 0.05, 0]}>
          <boxGeometry args={[0.1, 0.02, 6.2]} />
          <meshStandardMaterial color="#10B981" emissive="#059669" emissiveIntensity={1.2} />
        </mesh>
        {/* Solid Fuel Pump Island & Dispensers (aligned with SERVICE_STRUCTURE_BOXES at x=32.8, z=-12.5) */}
        <group position={[3.3, 0, -2.0]}>
          <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.6, 0.32, 5.8]} />
            <meshStandardMaterial color="#272E3D" roughness={0.8} metalness={0.15} />
          </mesh>
          {[-1.5, 1.5].map((pz, idx) => (
            <group key={idx} position={[0, 0.32, pz]}>
              <mesh position={[0, 0.78, 0]} castShadow>
                <boxGeometry args={[0.82, 1.56, 0.65]} />
                <meshStandardMaterial color="#1F2937" roughness={0.35} metalness={0.6} />
              </mesh>
              <mesh position={[-0.42, 1.15, 0]}>
                <boxGeometry args={[0.04, 0.36, 0.42]} />
                <meshStandardMaterial color="#10B981" emissive="#10B981" emissiveIntensity={1.6} />
              </mesh>
            </group>
          ))}
          {/* Overhead Fuel Station Canopy supported by two slim columns */}
          <mesh position={[-1.4, 2.5, -2.2]} castShadow>
            <boxGeometry args={[0.32, 4.4, 0.32]} />
            <meshStandardMaterial color="#1A202C" roughness={0.4} metalness={0.75} />
          </mesh>
          <mesh position={[-1.4, 2.5, 2.2]} castShadow>
            <boxGeometry args={[0.32, 4.4, 0.32]} />
            <meshStandardMaterial color="#1A202C" roughness={0.4} metalness={0.75} />
          </mesh>
          <mesh position={[-2.2, 4.65, 0]} castShadow>
            <boxGeometry args={[7.4, 0.48, 7.6]} />
            <meshStandardMaterial color="#111622" roughness={0.4} metalness={0.65} />
          </mesh>
          <mesh position={[-5.92, 4.65, 0]}>
            <boxGeometry args={[0.08, 0.24, 7.4]} />
            <meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={1.9} />
          </mesh>
          <Text
            position={[-6.02, 4.65, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            fontSize={0.42}
            color="#F8FAFC"
            anchorX="center"
            anchorY="middle"
          >
            POSTO LCE · COMBUSTÍVEL
          </Text>
        </group>
      </group>

      {/* 3. Oficina Mecânica LCE (x = 29.5, z = 10.5; service wall at x = 32.8, z = 12.5) */}
      <group position={[29.5, 0, 10.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} receiveShadow>
          <planeGeometry args={[9.2, 8.6]} />
          <meshStandardMaterial color="#181E2B" roughness={0.78} metalness={0.12} />
        </mesh>
        {/* Marked Mechanical Repair Pad */}
        <mesh position={[-0.6, 0.04, 0]}>
          <boxGeometry args={[3.5, 0.02, 6.2]} />
          <meshStandardMaterial color="#121824" roughness={0.75} />
        </mesh>
        <mesh position={[-2.35, 0.05, 0]}>
          <boxGeometry args={[0.1, 0.02, 6.2]} />
          <meshStandardMaterial color="#38BDF8" emissive="#0284C7" emissiveIntensity={1.2} />
        </mesh>
        <mesh position={[1.15, 0.05, 0]}>
          <boxGeometry args={[0.1, 0.02, 6.2]} />
          <meshStandardMaterial color="#38BDF8" emissive="#0284C7" emissiveIntensity={1.2} />
        </mesh>
        {/* Solid Workshop Back Wall & Service Canopy (aligned with SERVICE_STRUCTURE_BOXES at x=32.8, z=12.5) */}
        <group position={[3.3, 0, 2.0]}>
          <mesh position={[0, 2.2, 0]} castShadow receiveShadow>
            <boxGeometry args={[2.6, 4.4, 6.0]} />
            <meshStandardMaterial color="#1A2232" roughness={0.62} metalness={0.35} />
          </mesh>
          {/* Overhead Workshop Canopy */}
          <mesh position={[-2.2, 4.55, 0]} castShadow>
            <boxGeometry args={[7.4, 0.48, 7.6]} />
            <meshStandardMaterial color="#111622" roughness={0.42} metalness={0.62} />
          </mesh>
          <mesh position={[-5.92, 4.55, 0]}>
            <boxGeometry args={[0.08, 0.24, 7.4]} />
            <meshStandardMaterial color="#38BDF8" emissive="#0284C7" emissiveIntensity={1.9} />
          </mesh>
          <Text
            position={[-6.02, 4.55, 0]}
            rotation={[0, -Math.PI / 2, 0]}
            fontSize={0.42}
            color="#F8FAFC"
            anchorX="center"
            anchorY="middle"
          >
            OFICINA MECÂNICA LCE
          </Text>
        </group>
      </group>

      {/* 4. Vagas de Estacionamento Públicas (curb-side stalls beside major establishments) */}
      {PUBLIC_PARKING_BAYS.map((spot, idx) => (
        <group key={idx} position={spot.pos} rotation={[0, spot.rotY, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[2.8, 5.6]} />
            <meshStandardMaterial color="#131926" roughness={0.78} metalness={0.14} />
          </mesh>
          <mesh position={[-1.36, 0.01, 0]}>
            <boxGeometry args={[0.07, 0.02, 5.4]} />
            <meshStandardMaterial color="#94A3B8" roughness={0.5} />
          </mesh>
          <mesh position={[1.36, 0.01, 0]}>
            <boxGeometry args={[0.07, 0.02, 5.4]} />
            <meshStandardMaterial color="#94A3B8" roughness={0.5} />
          </mesh>
          <Text
            position={[0, 0.03, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={0.28}
            color="#94A3B8"
            anchorX="center"
            anchorY="middle"
          >
            P
          </Text>
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

      {/* Integrated World Vehicle Zones (Garage Exit Bays, Fuel Station, Workshop, Public Parking) */}
      <WorldVehicleZones3D />
    </group>
  );
}
