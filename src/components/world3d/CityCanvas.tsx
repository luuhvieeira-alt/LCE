import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Compass, RotateCcw, RotateCw, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import type { CityEstablishment } from '../../config/gameModules';
import { detectSoftwareWebGL } from './proceduralTextures';
import { UrbanEnvironment } from './UrbanEnvironment';
import { PlayerController, type MobileInputState } from './PlayerController';
import { RemotePlayers } from './RemotePlayers';
import { DealershipShowcaseVehicles } from './DealershipShowcaseVehicles';

export function CityCanvas() {
  const {
    character,
    remotePlayers,
    mpConnection,
    activeModule,
    setActiveModule,
    availableDealershipStock,
    enterDealershipShowroom,
    reportLocalPosition,
    graphicsPreset,
    cameraPreset,
  } = useGame();

  const isSoftwareGl = useMemo(() => detectSoftwareWebGL(), []);
  const [contextLost, setContextLost] = useState(false);
  const [nearbyEstablishment, setNearbyEstablishment] = useState<CityEstablishment | null>(null);
  const [showTouchPad, setShowTouchPad] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)').matches : false
  );

  const mobileInputRef = useRef<MobileInputState>({
    moveX: 0,
    moveY: 0,
    turnYaw: 0,
    sprint: false,
  });

  const joystickOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [knobOffset, setKnobOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const controlsEnabled = activeModule === 'mundo';

  // Open nearby establishment module with keyboard F
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!controlsEnabled || !nearbyEstablishment) return;
      if (e.code === 'KeyF') {
        setActiveModule(nearbyEstablishment.moduleLink);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controlsEnabled, nearbyEstablishment, setActiveModule]);

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
          <PlayerController
            key={character.uid}
            character={character}
            cameraPreset={cameraPreset}
            controlsEnabled={controlsEnabled}
            isOnline={mpConnection === 'connected'}
            mobileInputRef={mobileInputRef}
            onReportPosition={reportLocalPosition}
            onNearEstablishment={setNearbyEstablishment}
          />
          <RemotePlayers players={remotePlayers} />
        </Canvas>
      )}

      {/* Nearby Establishment Interaction Prompt (Clean, non-obtrusive, no backdrop-filter over WebGL) */}
      {controlsEnabled && nearbyEstablishment && (
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
          <span>WASD / Setas: Mover</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span>Shift: Correr</span>
          <span aria-hidden="true" className="text-slate-600">·</span>
          <span>Arrastar / Q-E: Câmera</span>
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

      {/* Mobile / Touch Virtual Joystick & Camera Turn Controls */}
      {controlsEnabled && showTouchPad && (
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
