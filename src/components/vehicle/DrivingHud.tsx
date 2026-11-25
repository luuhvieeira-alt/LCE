import { useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Car,
  Fuel,
  LogOut,
  MapPin,
  Octagon,
  Warehouse,
  Wrench,
  Zap,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL } from '../../config/economyCatalog';
import {
  VEHICLE_CATEGORY_LABELS,
  estimateMaintenanceCost,
  getConditionLabel,
} from '../../config/vehicleCatalog';
import { performVehicleMaintenance } from '../../services/vehicleService';
import type { SharedVehicleState } from '../../types/multiplayer';
import type {
  LocalDrivingTelemetry,
  MobileDrivingInputState,
} from '../world3d/WorldVehicles';

interface DrivingHudProps {
  vehicle: SharedVehicleState;
  telemetry: LocalDrivingTelemetry | null;
  showTouchPad: boolean;
  mobileDrivingRef: React.RefObject<MobileDrivingInputState>;
  onExit: () => void;
  onStore: () => void;
  onServiceFeedback: (type: 'ok' | 'err', text: string) => void;
}

export function DrivingHud({
  vehicle,
  telemetry,
  showTouchPad,
  mobileDrivingRef,
  onExit,
  onStore,
  onServiceFeedback,
}: DrivingHudProps) {
  const { firebaseUser, economyConfig, bankAccount } = useGame();
  const [serviceBusy, setServiceBusy] = useState(false);

  const speedKmh = telemetry?.speedKmh ?? 0;
  const gear = telemetry?.gear ?? 'N';
  const fuelLevel = Math.round(telemetry?.fuelLevel ?? vehicle.fuelLevel);
  const condition = Math.round(telemetry?.condition ?? vehicle.condition);
  const nearbyZone = telemetry?.nearbyZone ?? null;
  const baseFuelPrice = economyConfig?.baseFuelPrice ?? 7.5;
  const bankBalance = bankAccount?.balance ?? 0;

  const fuelQuote = estimateMaintenanceCost('fuel', baseFuelPrice, condition, fuelLevel, 20000);
  const repairQuote = estimateMaintenanceCost('repair', baseFuelPrice, condition, fuelLevel, 20000);

  const runQuickService = async (serviceType: 'fuel' | 'repair') => {
    if (!firebaseUser || serviceBusy) return;
    setServiceBusy(true);
    try {
      const res = await performVehicleMaintenance(firebaseUser, vehicle.vehicleId, serviceType);
      const label = serviceType === 'fuel' ? 'Abastecimento' : 'Reparo mecânico';
      onServiceFeedback(
        'ok',
        `${label} concluído por ${formatBRL(res.cost)}. Combustível: ${Math.round(res.fuelLevel)}% · Conservação: ${res.condition}%.`
      );
    } catch (err) {
      onServiceFeedback(
        'err',
        err instanceof Error ? err.message : 'Não foi possível concluir o serviço.'
      );
    } finally {
      setServiceBusy(false);
    }
  };

  const setTouchInput = (patch: Partial<MobileDrivingInputState>) => {
    if (!mobileDrivingRef.current) return;
    Object.assign(mobileDrivingRef.current, patch);
  };

  const outOfFuel = fuelLevel <= 1;

  return (
    <>
      {/* Contextual World Service Zone Action Strip (Top-Center-Bottom above dock) */}
      {nearbyZone && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 z-20 -translate-x-1/2 border border-amber-500/40 bg-[#0B0F18]/95 px-4 py-2.5 shadow-xl">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-amber-400" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                  {nearbyZone.name}
                </p>
                <p className="text-[11px] text-slate-300">{nearbyZone.subtitle}</p>
              </div>
            </div>

            {nearbyZone.type === 'fuel_station' && (
              <button
                type="button"
                disabled={serviceBusy || fuelLevel >= 98 || bankBalance < fuelQuote.cost}
                onClick={() => void runQuickService('fuel')}
                className="inline-flex min-h-[36px] items-center gap-1.5 bg-emerald-500 px-3 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-45"
              >
                <Fuel className="h-3.5 w-3.5" />
                <span>
                  {fuelLevel >= 98
                    ? 'Tanque Cheio'
                    : `Abastecer (${formatBRL(fuelQuote.cost)})`}
                </span>
              </button>
            )}

            {nearbyZone.type === 'workshop' && (
              <button
                type="button"
                disabled={serviceBusy || condition >= 98 || bankBalance < repairQuote.cost}
                onClick={() => void runQuickService('repair')}
                className="inline-flex min-h-[36px] items-center gap-1.5 bg-sky-500 px-3 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-45"
              >
                <Wrench className="h-3.5 w-3.5" />
                <span>
                  {condition >= 98
                    ? 'Veículo Íntegro'
                    : `Reparar (${formatBRL(repairQuote.cost)})`}
                </span>
              </button>
            )}

            {nearbyZone.type === 'garage' && (
              <button
                type="button"
                onClick={onStore}
                className="inline-flex min-h-[36px] items-center gap-1.5 bg-amber-500 px-3 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                <Warehouse className="h-3.5 w-3.5" />
                <span>Guardar na Garagem (G)</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Discrete Bottom-Right Driving Telemetry Panel */}
      <div
        className={`pointer-events-auto absolute right-4 z-20 w-[268px] border border-white/15 bg-[#0B0F18]/92 p-3.5 shadow-2xl ${
          showTouchPad ? 'bottom-52' : 'bottom-20'
        }`}
      >
        {/* Header: Model + Plate + Category */}
        <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="truncate font-display text-sm font-bold text-slate-100">
                {vehicle.model}
              </p>
            </div>
            <p className="text-[10px] text-slate-400">
              {VEHICLE_CATEGORY_LABELS[vehicle.category]} · @{vehicle.ownerAlias}
            </p>
          </div>
          <span className="shrink-0 border border-white/15 bg-[#121826] px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-slate-200">
            {vehicle.plate}
          </span>
        </div>

        {/* Speedometer & Active Gear */}
        <div className="mt-2.5 flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-3xl font-bold leading-none tabular-nums text-slate-50">
              {speedKmh}
            </span>
            <span className="text-[11px] font-semibold uppercase text-slate-400">km/h</span>
          </div>
          <div className="flex items-center gap-1.5">
            {telemetry?.handbrake && (
              <span className="border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-300">
                FREIO
              </span>
            )}
            <span
              className={`border px-2 py-0.5 font-mono text-xs font-bold ${
                gear === 'BOOST'
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-300'
                  : gear === 'R'
                    ? 'border-sky-400/50 bg-sky-500/15 text-sky-300'
                    : 'border-white/15 bg-[#131926] text-slate-200'
              }`}
            >
              {gear}
            </span>
          </div>
        </div>

        {/* Fuel & Condition Bars */}
        <div className="mt-3 grid grid-cols-2 gap-2.5 text-[10px]">
          <div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Combustível</span>
              <span
                className={`font-mono font-semibold ${
                  outOfFuel ? 'text-red-400' : fuelLevel < 20 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {fuelLevel}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full bg-white/10">
              <div
                className={`h-full ${
                  outOfFuel ? 'bg-red-500' : fuelLevel < 20 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, fuelLevel))}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Estado</span>
              <span className="font-mono font-semibold text-slate-200">{condition}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full bg-white/10">
              <div
                className={`h-full ${
                  condition < 40 ? 'bg-red-500' : condition < 70 ? 'bg-amber-500' : 'bg-sky-400'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, condition))}%` }}
              />
            </div>
          </div>
        </div>

        {outOfFuel ? (
          <p className="mt-2 border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-200">
            Combustível esgotado — modo reserva. Dirija até o Posto LCE ou guarde na garagem.
          </p>
        ) : (
          <p className="mt-2 text-[10px] text-slate-500">
            Conservação: {getConditionLabel(condition)} · Distância sessão:{' '}
            {(vehicle.sessionDistanceM / 1000).toFixed(2)} km
          </p>
        )}

        {/* Quick Exit & Store Actions */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex min-h-[34px] items-center justify-center gap-1.5 border border-white/15 bg-[#121826] px-2 text-[11px] font-semibold text-slate-100 hover:bg-white/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sair (F)</span>
          </button>
          <button
            type="button"
            onClick={onStore}
            className="inline-flex min-h-[34px] items-center justify-center gap-1.5 bg-amber-500 px-2 text-[11px] font-bold text-slate-950 hover:bg-amber-400"
          >
            <Warehouse className="h-3.5 w-3.5" />
            <span>Guardar (G)</span>
          </button>
        </div>
      </div>

      {/* Mobile / Touch Driving Controls */}
      {showTouchPad && (
        <>
          {/* Left Side: Steering Controls */}
          <div className="pointer-events-auto absolute bottom-24 left-4 z-20 flex items-center gap-2">
            <button
              type="button"
              aria-label="Virar à esquerda"
              onPointerDown={() => setTouchInput({ steer: 1 })}
              onPointerUp={() => setTouchInput({ steer: 0 })}
              onPointerCancel={() => setTouchInput({ steer: 0 })}
              onPointerLeave={() => setTouchInput({ steer: 0 })}
              className="flex h-14 w-14 touch-none items-center justify-center border border-white/20 bg-[#0B0F18]/90 text-slate-100 active:bg-amber-500 active:text-slate-950"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              aria-label="Virar à direita"
              onPointerDown={() => setTouchInput({ steer: -1 })}
              onPointerUp={() => setTouchInput({ steer: 0 })}
              onPointerCancel={() => setTouchInput({ steer: 0 })}
              onPointerLeave={() => setTouchInput({ steer: 0 })}
              className="flex h-14 w-14 touch-none items-center justify-center border border-white/20 bg-[#0B0F18]/90 text-slate-100 active:bg-amber-500 active:text-slate-950"
            >
              <ArrowRight className="h-6 w-6" />
            </button>
          </div>

          {/* Right Side: Throttle, Brake/Reverse, Handbrake, Boost */}
          <div className="pointer-events-auto absolute bottom-24 right-4 z-20 flex items-end gap-2">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-label="Turbo"
                onPointerDown={() => setTouchInput({ boost: true })}
                onPointerUp={() => setTouchInput({ boost: false })}
                onPointerCancel={() => setTouchInput({ boost: false })}
                onPointerLeave={() => setTouchInput({ boost: false })}
                className="flex h-11 w-12 touch-none items-center justify-center border border-amber-500/40 bg-[#0B0F18]/90 text-amber-300 active:bg-amber-500 active:text-slate-950"
              >
                <Zap className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Freio de mão"
                onPointerDown={() => setTouchInput({ handbrake: true })}
                onPointerUp={() => setTouchInput({ handbrake: false })}
                onPointerCancel={() => setTouchInput({ handbrake: false })}
                onPointerLeave={() => setTouchInput({ handbrake: false })}
                className="flex h-11 w-12 touch-none items-center justify-center border border-red-500/40 bg-[#0B0F18]/90 text-red-300 active:bg-red-500 active:text-slate-950"
              >
                <Octagon className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              aria-label="Frear ou Ré"
              onPointerDown={() => setTouchInput({ brake: 1 })}
              onPointerUp={() => setTouchInput({ brake: 0 })}
              onPointerCancel={() => setTouchInput({ brake: 0 })}
              onPointerLeave={() => setTouchInput({ brake: 0 })}
              className="flex h-14 w-14 touch-none items-center justify-center border border-white/20 bg-[#0B0F18]/90 text-slate-100 active:bg-red-500 active:text-slate-950"
            >
              <ArrowDown className="h-6 w-6" />
            </button>
            <button
              type="button"
              aria-label="Acelerar"
              onPointerDown={() => setTouchInput({ throttle: 1 })}
              onPointerUp={() => setTouchInput({ throttle: 0 })}
              onPointerCancel={() => setTouchInput({ throttle: 0 })}
              onPointerLeave={() => setTouchInput({ throttle: 0 })}
              className="flex h-16 w-16 touch-none items-center justify-center border border-emerald-500/50 bg-emerald-500/20 text-emerald-300 active:bg-emerald-500 active:text-slate-950"
            >
              <ArrowUp className="h-7 w-7" />
            </button>
          </div>
        </>
      )}
    </>
  );
}
