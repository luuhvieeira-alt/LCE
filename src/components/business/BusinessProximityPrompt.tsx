import { useMemo } from 'react';
import { Building2, Users, ArrowUpRight, MapPin, Car } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { getBusinessStatusLabel } from '../../config/businessCatalog';

const PROXIMITY_RADIUS = 10.5;

export function BusinessProximityPrompt() {
  const {
    activeModule,
    playerCoords,
    businessLocations,
    businesses,
    availableDealershipStock,
    enterBusinessById,
    enterDealershipShowroom,
  } = useGame();

  const nearest = useMemo(() => {
    if (activeModule !== 'mundo') return null;

    let bestLoc: (typeof businessLocations)[number] | null = null;
    let bestDist = Infinity;

    for (const loc of businessLocations) {
      const dist = Math.hypot(playerCoords.x - loc.posX, playerCoords.z - loc.posZ);
      if (dist <= PROXIMITY_RADIUS && dist < bestDist) {
        bestDist = dist;
        bestLoc = loc;
      }
    }

    if (!bestLoc) return null;
    const owned = businesses.find(
      (b) => b.locationId === bestLoc!.id || b.id === `biz_${bestLoc!.id}`
    );

    return {
      location: bestLoc,
      business: owned ?? null,
      distance: Math.round(bestDist * 10) / 10,
    };
  }, [activeModule, playerCoords.x, playerCoords.z, businessLocations, businesses]);

  if (!nearest) return null;

  const { location, business, distance } = nearest;
  const isDealership = location.templateType === 'concessionaria';
  const availableVehiclesCount =
    isDealership && business
      ? availableDealershipStock.filter(
          (item) => item.businessId === business.id && item.status === 'available'
        ).length
      : 0;

  return (
    <div className="pointer-events-auto absolute bottom-20 left-4 z-20 w-[min(350px,calc(100vw-2rem))] border border-amber-500/40 bg-[#090B10]/95 p-4 text-slate-100 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{location.locationLabel}</span>
            <span className="font-mono text-slate-400">· {distance}m</span>
          </div>
          <h3 className="mt-1 truncate font-display text-xl font-bold tracking-wide text-slate-50">
            {business ? business.name : location.name}
          </h3>
          <p className="text-xs text-slate-400">
            {isDealership ? 'Concessionária de Veículos' : location.category}
          </p>
        </div>
        {isDealership ? (
          <Car className="h-5 w-5 shrink-0 text-amber-500" />
        ) : (
          <Building2 className="h-5 w-5 shrink-0 text-amber-500" />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 border-y border-white/10 py-2.5 text-xs">
        <div>
          <span className="block text-[11px] text-slate-500">Proprietário</span>
          <span className="truncate font-medium text-slate-200">
            {business ? business.ownerName : 'Disponível na Cidade'}
          </span>
        </div>
        <div>
          <span className="block text-[11px] text-slate-500">Status</span>
          <span
            className={`font-medium ${
              !business
                ? 'text-emerald-400'
                : business.status === 'active'
                ? 'text-emerald-400'
                : business.status === 'inactive_funds'
                ? 'text-amber-400'
                : 'text-red-400'
            }`}
          >
            {business ? getBusinessStatusLabel(business.status) : 'Aberto para Aquisição'}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {isDealership && business ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <Car className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-mono tabular-nums">
              Veículos disponíveis: <strong className="text-slate-100">{availableVehiclesCount}</strong>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <Users className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-mono tabular-nums">
              {business
                ? `${business.employeeCount}/${business.maxEmployees} func.`
                : `Até ${location.maxEmployees} func.`}
            </span>
          </div>
        )}

        {isDealership && business ? (
          <button
            type="button"
            onClick={() => enterDealershipShowroom(business.id)}
            className="inline-flex min-h-[38px] items-center gap-1.5 bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap"
          >
            <span>VISITAR CONCESSIONÁRIA</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => enterBusinessById(business ? business.id : location.id)}
            className="inline-flex min-h-[38px] items-center gap-1.5 bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap"
          >
            <span>{business ? 'Entrar na Empresa' : 'Abrir / Inspecionar'}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
