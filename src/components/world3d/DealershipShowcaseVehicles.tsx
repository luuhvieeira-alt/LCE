import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import { formatBRL } from '../../config/economyCatalog';
import type { DealershipStockItem, VehicleCategory } from '../../types/vehicle';
import { VehicleMesh3D } from './VehicleMesh3D';

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

/**
 * Displays ONLY real available dealership showroom stock on the dealership's 3D forecourt pads.
 * Never renders generic placeholder vehicles pretending to be player-owned cars.
 */
export function DealershipShowcaseVehicles({
  availableStock,
  onSelectStock,
}: DealershipShowcaseVehiclesProps) {
  const featuredStock = useMemo(() => {
    const valid = availableStock.filter((s) => s.status === 'available');
    const picked: DealershipStockItem[] = [];
    const seenModels = new Set<string>();

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
                  <VehicleMesh3D
                    category={stock.category}
                    showContactShadow={false}
                  />
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
