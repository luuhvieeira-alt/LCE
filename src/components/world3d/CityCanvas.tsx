import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import {
  AlertTriangle,
  ArrowUpRight,
  Car,
  CheckCircle2,
  Compass,
  KeyRound,
  RotateCcw,
  RotateCw,
  Warehouse,
  X,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import type { CityEstablishment } from '../../config/gameModules';
import type { SharedVehicleState } from '../../types/multiplayer';
import { detectSoftwareWebGL } from './proceduralTextures';
import { UrbanEnvironment } from './UrbanEnvironment';
import { PlayerController, type MobileInputState } from './PlayerController';
import { RemotePlayers } from './RemotePlayers';
import { DealershipShowcaseVehicles } from './DealershipShowcaseVehicles';
import {
  WorldVehicles,
  type LocalDrivingTelemetry,
  type MobileDrivingInputState,
} from './WorldVehicles';
import { DrivingHud } from '../vehicle/DrivingHud';

export function CityCanvas() {
  const {
    character,
    remotePlayers,
    worldVehicles,
    drivingVehicleId,
    mySpawnedVehicle,
    activeDrivenVehicle,
    pendingPlayerTeleport,
    vehicleCorrection,
    vehicleNotice,
    clearVehicleNotice,
    enterVehicle,
    exitVehicle,
    storeVehicle,
    reportLocalVehicleMotion,
    mpConnection,
    activeModule,
    setActiveModule,
    availableDealershipStock,
    enterDealershipShowroom,
    playerCoords,
    reportLocalPosition,
    graphicsPreset,
    cameraPreset,
  } = useGame();

  const isSoftwareGl = useMemo(() => detectSoftwareWebGL(), []);
  const [contextLost, setContextLost] = useState(false);
  const [nearbyEstablishment, setNearbyEstablishment] = useState<CityEstablishment | null>(null);
  const [drivingTelemetry, setDrivingTelemetry] = useState<LocalDrivingTelemetry | null>(null);
  const [localBanner, setLocalBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [storeBusy, setStoreBusy] = useState(false);
  const [showTouchPad, setShowTouchPad] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false
  );

  const mobileInputRef = useRef<MobileInputState>({
    moveX: 0,
    moveY: 0,
    turnYaw: 0,
    sprint: false,
  });

  const mobileDrivingRef = useRef<MobileDrivingInputState>({
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
  });

  const joystickOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const controlsEnabled = activeModule === 'mundo';
  const isDriving = Boolean(drivingVehicleId && activeDrivenVehicle);

  // Auto-dismiss transient notices after 5.5s
  useEffect(() => {
    if (!vehicleNotice) return;
    const t = window.setTimeout(() => clearVehicleNotice(), 5500);
    return () => window.clearTimeout(t);
  }, [vehicleNotice, clearVehicleNotice]);

  useEffect(() => {
    if (!localBanner) return;
    const t = window.setTimeout(() => setLocalBanner(null), 5000);
    return () => window.clearTimeout(t);
  }, [localBanner]);

  // Reset mobile driving inputs whenever exiting driving mode
  useEffect(() => {
    if (!isDriving) {
      mobileDrivingRef.current.throttle = 0;
      mobileDrivingRef.current.brake = 0;
      mobileDrivingRef.current.steer = 0;
      mobileDrivingRef.current.handbrake = false;
      mobileDrivingRef.current.boost = false;
      setDrivingTelemetry(null);
    }
  }, [isDriving]);

  // Nearest active street vehicle to on-foot player (within 5.5m)
  const nearbyVehicle = useMemo<SharedVehicleState | null>(() => {
    if (isDriving || !character) return null;
    let closest: SharedVehicleState | null = null;
    let bestDist = 5.5;
    for (const v of Object.values(worldVehicles)) {
      const dist = Math.hypot(playerCoords.x - v.x, playerCoords.z - v.z);
      if (dist < bestDist) {
        bestDist = dist;
        closest = v;
      }
    }
    return closest;
  }, [isDriving, character, worldVehicles, playerCoords.x, playerCoords.z]);

  const myVehicleDistanceM = useMemo(() => {
    if (!mySpawnedVehicle || isDriving) return null;
    return Math.round(
      Math.hypot(playerCoords.x - mySpawnedVehicle.x, playerCoords.z - mySpawnedVehicle.z)
    );
  }, [mySpawnedVehicle, isDriving, playerCoords.x, playerCoords.z]);

  const handleStoreVehicle = useCallback(
    async (vehicleId: string) => {
      if (storeBusy) return;
      setStoreBusy(true);
      try {
        await storeVehicle(vehicleId);
      } catch (err) {
        setLocalBanner({
          type: 'err',
          text: err instanceof Error ? err.message : 'Não foi possível guardar o veículo.',
        });
      } finally {
        setStoreBusy(false);
      }
    },
    [storeBusy, storeVehicle]
  );

  const handleSelectVehicle3D = useCallback(
    (v: SharedVehicleState) => {
      if (!controlsEnabled || !character || isDriving) return;
      if (v.ownerUid === character.uid && !v.driverUid) {
        const dist = Math.hypot(playerCoords.x - v.x, playerCoords.z - v.z);
        if (dist <= 7.5) {
          enterVehicle(v.vehicleId);
        } else {
          setLocalBanner({
            type: 'ok',
            text: `Aproxime-se de ${v.model} [${v.plate}] (${Math.round(dist)}m) para entrar.`,
          });
        }
      }
    },
    [controlsEnabled, character, isDriving, playerCoords.x, playerCoords.z, enterVehicle]
  );

  // Unified F / G keyboard interactions (Vehicle Enter/Exit, Store in Garage, Establishment Open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!controlsEnabled || !character) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'KeyF') {
        if (isDriving && drivingVehicleId) {
          exitVehicle(drivingVehicleId);
          return;
        }
        if (nearbyVehicle && nearbyVehicle.ownerUid === character.uid && !nearbyVehicle.driverUid) {
          enterVehicle(nearbyVehicle.vehicleId);
          return;
        }
        if (nearbyEstablishment) {
          setActiveModule(nearbyEstablishment.moduleLink);
        }
      }

      if (e.code === 'KeyG') {
        if (isDriving && drivingVehicleId) {
          void handleStoreVehicle(drivingVehicleId);
          return;
        }
        if (nearbyVehicle && nearbyVehicle.ownerUid === character.uid && !nearbyVehicle.driverUid) {
          void handleStoreVehicle(nearbyVehicle.vehicleId);
          return;
        }
        if (mySpawnedVehicle && !mySpawnedVehicle.driverUid) {
          void handleStoreVehicle(mySpawnedVehicle.vehicleId);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    controlsEnabled,
    character,
    isDriving,
    drivingVehicleId,
    nearbyVehicle,
    nearbyEstablishment,
    mySpawnedVehicle,
    exitVehicle,
    enterVehicle,
    handleStoreVehicle,
    setActiveModule,
  ]);

  const handleJoystickStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    joystickOriginRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    handleJoystickMove(e);
  };

  const handleJoystickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const origin = joystickOriginRef.current;
    if (!origin) return;
    const maxRadius = 38;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(maxRadius, dist);
    const angle = Math.atan2(dy, dx);
    const ox = Math.cos(angle) * clampedDist;
    const oy = Math.sin(angle) * clampedDist;

    setKnobOffset({ x: ox, y: oy });
    mobileInputRef.current.moveX = ox / maxRadius;
    mobileInputRef.current.moveY = -oy / maxRadius;
    mobileInputRef.current.sprint = clampedDist > maxRadius * 0.85;
  };

  const handleJoystickEnd = () => {
    joystickOriginRef.current = null;
    setKnobOffset({ x: 0, y: 0 });
    mobileInputRef.current.moveX = 0;
    mobileInputRef.current.moveY = 0;
    mobileInputRef.current.sprint = false;
  };

  if (!character) return null;

  const activeBanner = localBanner ?? vehicleNotice;
  const nearOwnedParked =
    nearbyVehicle && nearbyVehicle.ownerUid === character.uid && !nearbyVehicle.driverUid;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0B101B]">
      {/* Dedicated WebGL 3D Viewport Container */}
      {contextLost ? (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#0B101B] p-6 text-center">
          <AlertTriangle className="mb-3 h-8 w-8 text-amber-500" />
          <p className="font-display text-2xl font-bold text-slate-100">
            Contexto WebGL Interrompido
          </p>
          <p className="mt-1 max-w-sm text-xs text-slate-400">
            O navegador suspendeu a aceleração 3D temporariamente. Recarregue para retomar a cena do
            Distrito Central.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950"
          >
            Restaurar Cena 3D
          </button>
        </div>
      ) : (
        <Canvas
          shadows={!isSoftwareGl && graphicsPreset === 'alta'}
          dpr={isSoftwareGl ? 1 : graphicsPreset === 'alta' ? [1, 2] : [1, 1.5]}
          camera={{ fov: 52, near: 0.1, far: 240, position: [0, 4.5, 14] }}
          gl={{
            antialias: !isSoftwareGl,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.12,
          }}
          onCreated={({ gl }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            const canvas = gl.domElement;
            const handleLost = (ev: Event) => {
              ev.preventDefault();
              setContextLost(true);
            };
            const handleRestored = () => setContextLost(false);
            canvas.addEventListener('webglcontextlost', handleLost, false);
            canvas.addEventListener('webglcontextrestored', handleRestored, false);
          }}
        >
          <UrbanEnvironment
            isSoftwareGl={isSoftwareGl}
            highQuality={graphicsPreset === 'alta'}
            onSelectEstablishment={(est) => setActiveModule(est.moduleLink)}
          />
          <DealershipShowcaseVehicles
            availableStock={availableDealershipStock}
            onSelectStock={(stock) => enterDealershipShowroom(stock.businessId)}
          />
          <WorldVehicles
            vehicles={worldVehicles}
            selfUid={character.uid}
            drivingVehicleId={drivingVehicleId}
            controlsEnabled={controlsEnabled}
            cameraPreset={cameraPreset}
            vehicleCorrection={vehicleCorrection}
            mobileDrivingRef={mobileDrivingRef}
            onReportVehicleMotion={reportLocalVehicleMotion}
            onLocalTelemetry={setDrivingTelemetry}
            onSelectVehicle={handleSelectVehicle3D}
          />
          <PlayerController
            key={character.uid}
            character={character}
            cameraPreset={cameraPreset}
            controlsEnabled={controlsEnabled}
            isDriving={isDriving}
            pendingTeleport={pendingPlayerTeleport}
            isOnline={mpConnection === 'connected'}
            mobileInputRef={mobileInputRef}
            onReportPosition={reportLocalPosition}
            onNearEstablishment={setNearbyEstablishment}
          />
          <RemotePlayers players={remotePlayers} />
        </Canvas>
      )}

      {/* Transient Vehicle Action / Error Notification Banner */}
      {controlsEnabled && activeBanner && (
        <div
          className={`pointer-events-auto absolute top-20 left-1/2 z-30 flex max-w-md -translate-x-1/2 items-center gap-2.5 border px-3.5 py-2 text-xs shadow-xl ${
            activeBanner.type === 'ok'
              ? 'border-emerald-500/40 bg-[#0B1218]/95 text-emerald-200'
              : 'border-red-500/40 bg-[#180C10]/95 text-red-200'
          }`}
        >
          {activeBanner.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          )}
          <span className="leading-snug">{activeBanner.text}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => {
              setLocalBanner(null);
              clearVehicleNotice();
            }}
            className="ml-1 text-slate-400 hover:text-slate-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Active Driving HUD & Touch Driving Controls */}
      {controlsEnabled && isDriving && activeDrivenVehicle && (
        <DrivingHud
          vehicle={activeDrivenVehicle}
          telemetry={drivingTelemetry}
          showTouchPad={showTouchPad}
          mobileDrivingRef={mobileDrivingRef}
          onExit={() => exitVehicle(activeDrivenVehicle.vehicleId)}
          onStore={() => void handleStoreVehicle(activeDrivenVehicle.vehicleId)}
          onServiceFeedback={(type, text) => setLocalBanner({ type, text })}
        />
      )}

      {/* On-Foot Nearby Vehicle Prompt (Takes precedence over establishment prompt when right next to a car) */}
      {controlsEnabled && !isDriving && nearbyVehicle && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 z-20 -translate-x-1/2 border border-amber-500/45 bg-[#0D111A]/95 px-4 py-2.5 shadow-xl">
          <div className="flex flex-wrap items-center gap-3.5">
            <div className="flex items-center gap-2.5">
              <Car className="h-4 w-4 text-amber-400" />
              <div>
                <p className="text-xs font-semibold text-amber-400">
                  {nearbyVehicle.plate} ·{' '}
                  {nearOwnedParked
                    ? 'Seu Veículo'
                    : nearbyVehicle.driverName
                      ? `Dirigido por ${nearbyVehicle.driverName}`
                      : `Proprietário: @${nearbyVehicle.ownerAlias}`}
                </p>
                <p className="text-sm font-semibold text-slate-100">{nearbyVehicle.model}</p>
              </div>
            </div>

            {nearOwnedParked && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => enterVehicle(nearbyVehicle.vehicleId)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 bg-amber-500 px-3 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>Entrar (F)</span>
                </button>
                <button
                  type="button"
                  disabled={storeBusy}
                  onClick={() => void handleStoreVehicle(nearbyVehicle.vehicleId)}
                  className="inline-flex min-h-[36px] items-center gap-1.5 border border-white/15 bg-[#121826] px-3 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-45"
                >
                  <Warehouse className="h-3.5 w-3.5" />
                  <span>Guardar (G)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compact Locator Chip when Player Has an Active Parked Vehicle Further Away */}
      {controlsEnabled && !isDriving && mySpawnedVehicle && !nearOwnedParked && (
        <div className="pointer-events-auto absolute right-4 bottom-20 z-10 flex items-center gap-3 border border-amber-500/30 bg-[#0B0F18]/92 px-3 py-2 text-xs shadow-lg">
          <Car className="h-4 w-4 text-amber-400" />
          <div>
            <p className="font-semibold text-slate-100">
              {mySpawnedVehicle.model}{' '}
              <span className="font-mono text-[11px] text-amber-400">
                [{mySpawnedVehicle.plate}]
              </span>
            </p>
            <p className="text-[11px] text-slate-400">
              Estacionado na cidade · {myVehicleDistanceM ?? 0}m de distância
            </p>
          </div>
          <button
            type="button"
            disabled={storeBusy}
            onClick={() => void handleStoreVehicle(mySpawnedVehicle.vehicleId)}
            className="border border-white/15 bg-[#121826] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-45"
          >
            Guardar (G)
          </button>
        </div>
      )}

      {/* Nearby Establishment Interaction Prompt (Only when on-foot and not beside a vehicle) */}
      {controlsEnabled && !isDriving && !nearbyVehicle && nearbyEstablishment && (
        <div className="pointer-events-auto absolute bottom-24 left-1/2 z-20 -translate-x-1/2 border border-amber-500/40 bg-[#0D111A]/95 px-4 py-2.5 shadow-xl">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs font-semibold text-amber-400">
                {nearbyEstablishment.category}
              </p>
              <p className="text-sm font-semibold text-slate-100">{nearbyEstablishment.name}</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveModule(nearbyEstablishment.moduleLink)}
              className="inline-flex min-h-[38px] items-center gap-1.5 bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              <span>
                {nearbyEstablishment.moduleLink === 'financeiro'
                  ? 'Acessar Banco (F)'
                  : nearbyEstablishment.moduleLink === 'trabalho'
                    ? 'Acessar Trabalho (F)'
                    : 'Abrir (F)'}
              </span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Subtle Controls Help & Touch Toggle (Bottom Left on Desktop) */}
      {controlsEnabled && (
        <div className="pointer-events-auto absolute bottom-20 left-4 z-10 hidden items-center gap-3 border border-white/10 bg-[#0C1018]/90 px-3.5 py-2 text-xs text-slate-300 md:flex">
          <Compass className="h-3.5 w-3.5 text-amber-500" />
          {isDriving ? (
            <>
              <span>W/S: Acelerar / Ré</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>A/D: Direção</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Espaço: Freio de Mão</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Shift: Turbo</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>F: Sair · G: Guardar</span>
            </>
          ) : (
            <>
              <span>WASD / Setas: Mover</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Shift: Correr</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Arrastar / Q-E: Câmera</span>
            </>
          )}
          <span aria-hidden="true" className="text-slate-600">·</span>
          <button
            type="button"
            onClick={() => setShowTouchPad((prev) => !prev)}
            className="font-medium text-amber-400 hover:text-amber-300"
          >
            {showTouchPad ? 'Ocultar Controles Táteis' : 'Modo Tátil'}
          </button>
        </div>
      )}

      {/* Mobile / Touch Virtual Joystick & Camera Turn Controls (On-Foot Mode Only) */}
      {controlsEnabled && !isDriving && showTouchPad && (
        <>
          <div
            onPointerDown={handleJoystickStart}
            onPointerMove={handleJoystickMove}
            onPointerUp={handleJoystickEnd}
            onPointerCancel={handleJoystickEnd}
            className="pointer-events-auto absolute bottom-24 left-5 z-20 flex h-28 w-28 touch-none items-center justify-center rounded-full border border-white/15 bg-[#0C1018]/80"
            aria-label="Joystick de movimento do personagem"
          >
            <div
              style={{
                transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)`,
              }}
              className="h-11 w-11 rounded-full border border-amber-400/60 bg-amber-500/80"
            />
          </div>

          <div className="pointer-events-auto absolute bottom-28 right-5 z-20 flex items-center gap-2">
            <button
              type="button"
              aria-label="Girar câmera à esquerda"
              onPointerDown={() => {
                mobileInputRef.current.turnYaw = -1;
              }}
              onPointerUp={() => {
                mobileInputRef.current.turnYaw = 0;
              }}
              onPointerLeave={() => {
                mobileInputRef.current.turnYaw = 0;
              }}
              className="flex h-12 w-12 items-center justify-center border border-white/15 bg-[#0C1018]/90 text-slate-200 active:bg-amber-500 active:text-slate-950"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Girar câmera à direita"
              onPointerDown={() => {
                mobileInputRef.current.turnYaw = 1;
              }}
              onPointerUp={() => {
                mobileInputRef.current.turnYaw = 0;
              }}
              onPointerLeave={() => {
                mobileInputRef.current.turnYaw = 0;
              }}
              className="flex h-12 w-12 items-center justify-center border border-white/15 bg-[#0C1018]/90 text-slate-200 active:bg-amber-500 active:text-slate-950"
            >
              <RotateCw className="h-5 w-5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
