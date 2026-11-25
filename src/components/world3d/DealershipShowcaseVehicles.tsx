import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import { formatBRL } from '../../config/economyCatalog';
import type { DealershipStockItem, VehicleCategory } from '../../types/vehicle';

interface DealershipShowcaseVehiclesProps {
  availableStock: DealershipStockItem[];
  onSelectStock: (stock: DealershipStockItem) => void;
}

interface ShowcasePadSpec {
  position: [number, number, number];
  rotY: number;
}

// 4 outdoor showroom display pads around the SW dealership plaza (y = 0.14 sidewalk top)
const SHOWCASE_PADS: ShowcasePadSpec[] = [
  { position: [-23.6, 0.14, 9.6], rotY: Math.PI * 0.86 },
  { position: [-19.2, 0.14, 9.6], rotY: Math.PI * 0.94 },
  { position: [-10.6, 0.14, 9.6], rotY: Math.PI * 1.12 },
  { position: [-9.6, 0.14, 21.0], rotY: Math.PI * 0.56 },
];

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

function WheelAssembly({
  position,
  radius = 0.33,
  width = 0.24,
}: {
  position: [number, number, number];
  radius?: number;
  width?: number;
}) {
  return (
    <group position={position} rotation={[0, 0, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius, width, 14]} />
        <meshStandardMaterial color="#101216" roughness={0.86} metalness={0.08} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[radius * 0.58, radius * 0.58, width + 0.02, 10]} />
        <meshStandardMaterial color="#CBD5E1" roughness={0.22} metalness={0.92} />
      </mesh>
    </group>
  );
}

function CompositeShowcaseVehicle({ category }: { category: VehicleCategory }) {
  const finish = CATEGORY_FINISH[category] ?? CATEGORY_FINISH.sedan;

  if (category === 'caminhao') {
    const wheels: [number, number, number][] = [
      [-0.95, 0.38, 1.45],
      [0.95, 0.38, 1.45],
      [-0.95, 0.38, -0.75],
      [0.95, 0.38, -0.75],
      [-0.95, 0.38, -1.65],
      [0.95, 0.38, -1.65],
    ];
    return (
      <group>
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
          <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.6} />
        </mesh>
        <mesh position={[0.68, 0.86, 2.13]}>
          <boxGeometry args={[0.36, 0.16, 0.06]} />
          <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.6} />
        </mesh>
        {wheels.map((pos, idx) => (
          <WheelAssembly key={idx} position={pos} radius={0.38} width={0.28} />
        ))}
      </group>
    );
  }

  if (category === 'picape') {
    const wheels: [number, number, number][] = [
      [-0.92, 0.38, 1.32],
      [0.92, 0.38, 1.32],
      [-0.92, 0.38, -1.26],
      [0.92, 0.38, -1.26],
    ];
    return (
      <group>
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
          <meshStandardMaterial color="#0F172A" roughness={0.14} metalness={0.88} />
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
          <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.6} />
        </mesh>
        <mesh position={[0.66, 0.78, 2.29]}>
          <boxGeometry args={[0.38, 0.16, 0.06]} />
          <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.6} />
        </mesh>
        <mesh position={[0, 0.78, -2.18]}>
          <boxGeometry args={[1.62, 0.12, 0.06]} />
          <meshStandardMaterial color="#FCA5A5" emissive="#DC2626" emissiveIntensity={1.4} />
        </mesh>
        {wheels.map((pos, idx) => (
          <WheelAssembly key={idx} position={pos} radius={0.38} width={0.28} />
        ))}
      </group>
    );
  }

  // Unified sculpted silhouettes for popular, sedan, suv, esportivo, luxo
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

  const wheels: [number, number, number][] = [
    [-(bodyW / 2 - 0.04), wheelR, wheelZ],
    [bodyW / 2 - 0.04, wheelR, wheelZ],
    [-(bodyW / 2 - 0.04), wheelR, -wheelZ],
    [bodyW / 2 - 0.04, wheelR, -wheelZ],
  ];

  return (
    <group>
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
        <meshStandardMaterial color="#0F172A" roughness={0.12} metalness={0.9} />
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
        <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.8} />
      </mesh>
      <mesh position={[bodyW * 0.34, bodyY + 0.04, bodyLen / 2 + 0.01]}>
        <boxGeometry args={[0.36, 0.12, 0.05]} />
        <meshStandardMaterial color="#FEF3C7" emissive="#F59E0B" emissiveIntensity={1.8} />
      </mesh>
      {/* Rear LED taillight bar */}
      <mesh position={[0, bodyY + 0.06, -(bodyLen / 2 + 0.01)]}>
        <boxGeometry args={[bodyW * 0.82, 0.1, 0.05]} />
        <meshStandardMaterial color="#FCA5A5" emissive="#DC2626" emissiveIntensity={1.5} />
      </mesh>
      {wheels.map((pos, idx) => (
        <WheelAssembly key={idx} position={pos} radius={wheelR} />
      ))}
    </group>
  );
}

/**
 * Displays ONLY real available dealership showroom stock on the dealership's 3D forecourt pads.
 * Never renders generic placeholder vehicles pretending to be player-owned cars.
 */
export function DealershipShowcaseVehicles({
  availableStock,
  onSelectStock,
}: DealershipShowcaseVehiclesProps) {
  // Pick up to 4 real available stock units, favoring distinct models/categories for showroom variety
  const featuredStock = useMemo(() => {
    const valid = availableStock.filter((s) => s.status === 'available');
    const picked: DealershipStockItem[] = [];
    const seenModels = new Set<string>();

    // Prefer iconic showcase order: esportivo, luxo, suv, sedan, picape, popular, caminhao
    const priorityOrder: VehicleCategory[] = [
      'esportivo',
      'luxo',
      'suv',
      'sedan',
      'picape',
      'popular',
      'caminhao',
      'moto',
    ];
    const sorted = [...valid].sort((a, b) => {
      const ia = priorityOrder.indexOf(a.category);
      const ib = priorityOrder.indexOf(b.category);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    for (const item of sorted) {
      if (picked.length >= SHOWCASE_PADS.length) break;
      if (seenModels.has(item.modelId)) continue;
      seenModels.add(item.modelId);
      picked.push(item);
    }
    return picked;
  }, [availableStock]);

  return (
    <group name="dealership-3d-showcase">
      {SHOWCASE_PADS.map((pad, idx) => {
        const stock = featuredStock[idx];
        return (
          <group
            key={idx}
            position={pad.position}
            rotation={[0, pad.rotY, 0]}
            onClick={(e) => {
              if (!stock) return;
              e.stopPropagation();
              onSelectStock(stock);
            }}
          >
            {/* Illuminated Showroom Display Plinth (y = 0 to 0.12) */}
            <mesh position={[0, 0.06, 0]} receiveShadow>
              <boxGeometry args={[2.55, 0.12, 5.1]} />
              <meshStandardMaterial color="#141A26" roughness={0.62} metalness={0.4} />
            </mesh>
            {/* Subtle Amber Showroom Perimeter Strip */}
            <mesh position={[0, 0.125, 0]}>
              <boxGeometry args={[2.6, 0.025, 5.14]} />
              <meshStandardMaterial
                color="#D97706"
                emissive="#D97706"
                emissiveIntensity={stock ? 0.9 : 0.2}
                roughness={0.3}
              />
            </mesh>

            {/* Render vehicle ONLY if real dealership stock exists */}
            {stock && (
              <>
                <group position={[0, 0.13, 0]} scale={0.78}>
                  <CompositeShowcaseVehicle category={stock.category} />
                </group>

                {/* Floating Showroom Tag */}
                <group position={[0, 2.25, 0]} rotation={[0, Math.PI, 0]}>
                  <mesh>
                    <boxGeometry args={[2.5, 0.62, 0.06]} />
                    <meshStandardMaterial color="#0A0E16" roughness={0.45} metalness={0.5} />
                  </mesh>
                  <Text
                    position={[0, 0.12, 0.05]}
                    fontSize={0.22}
                    maxWidth={2.35}
                    color="#F8FAFC"
                    anchorX="center"
                    anchorY="middle"
                  >
                    {stock.model}
                  </Text>
                  <Text
                    position={[0, -0.14, 0.05]}
                    fontSize={0.17}
                    color="#F59E0B"
                    anchorX="center"
                    anchorY="middle"
                  >
                    {`SHOWROOM · ${formatBRL(stock.finalPrice)}`}
                  </Text>
                </group>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}
