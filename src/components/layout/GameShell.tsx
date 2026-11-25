import { useState } from 'react';
import {
  LayoutDashboard,
  User,
  Globe,
  Briefcase,
  Building2,
  Landmark,
  TrendingUp,
  Car,
  Handshake,
  Settings,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { MAIN_GAME_MODULES, type GameModuleId } from '../../config/gameModules';
import { formatBRL } from '../../config/economyCatalog';
import { CityCanvas } from '../world3d/CityCanvas';
import { ModuleDrawer } from './ModuleDrawer';
import { BusinessProximityPrompt } from '../business/BusinessProximityPrompt';

const MODULE_ICONS: Record<Exclude<GameModuleId, 'admin'>, React.ComponentType<{ className?: string }>> = {
  painel: LayoutDashboard,
  personagem: User,
  mundo: Globe,
  trabalho: Briefcase,
  empresas: Building2,
  financeiro: Landmark,
  investimentos: TrendingUp,
  garagem: Car,
  negociacoes: Handshake,
  configuracoes: Settings,
};

export function GameShell() {
  const {
    character,
    wallet,
    bankAccount,
    adminStatus,
    activeModule,
    setActiveModule,
    onlineCount,
    mpConnection,
  } = useGame();

  const [dockCollapsed, setDockCollapsed] = useState(false);

  if (!character) return null;

  const liveCleanCash = wallet?.cleanCash ?? character.cashBalance;
  const liveBankBalance = bankAccount?.balance ?? character.bankBalance;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#090B10] text-slate-100">
      {/* Persistent 100% Full-Viewport 3D Urban World */}
      <div className="absolute inset-0 z-0">
        <CityCanvas />
      </div>

      {/* Top Compact HUD Bar (Clean 3-zone structure, solid dark surface, zero backdrop-blur over WebGL) */}
      <header className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-white/10 bg-[#090B10]/94 px-4 md:px-6">
        {/* Zone 1: Brand & Active Character */}
        <div className="flex min-w-0 items-baseline gap-3">
          <button
            type="button"
            onClick={() => setActiveModule('mundo')}
            className="font-display text-2xl font-bold tracking-[0.18em] text-amber-500 whitespace-nowrap shrink-0"
          >
            LCE
          </button>
          <span className="hidden truncate text-xs text-slate-300 sm:inline">
            {character.characterName}
          </span>
          <span className="hidden text-xs text-slate-500 md:inline">· Distrito Central</span>
        </div>

        {/* Zone 2: Read-Only Balances & Shared Universe Count (Unboxed clean tabular typography) */}
        <div className="flex items-center gap-4 text-xs md:gap-6">
          <button
            type="button"
            onClick={() => setActiveModule('financeiro')}
            className="flex items-baseline gap-1.5 whitespace-nowrap hover:opacity-90"
            title="Abrir Financeiro"
          >
            <span className="hidden text-slate-400 sm:inline">Limpo</span>
            <span className="font-mono font-medium tabular-nums text-slate-100">
              {formatBRL(liveCleanCash)}
            </span>
          </button>
          <span aria-hidden="true" className="text-slate-700">
            /
          </span>
          <button
            type="button"
            onClick={() => setActiveModule('financeiro')}
            className="flex items-baseline gap-1.5 whitespace-nowrap hover:opacity-90"
            title="Abrir Banco Central LCE"
          >
            <span className="hidden text-slate-400 sm:inline">Banco</span>
            <span className="font-mono font-medium tabular-nums text-amber-400">
              {formatBRL(liveBankBalance)}
            </span>
          </button>
          <span aria-hidden="true" className="hidden text-slate-700 lg:inline">
            ·
          </span>
          <span className="hidden whitespace-nowrap font-mono text-slate-300 tabular-nums lg:inline">
            {mpConnection === 'connected' ? `${onlineCount} online` : 'Sincronizando...'}
          </span>
        </div>

        {/* Zone 3: Admin Portal (Rendered ONLY after real backend + Firestore RBAC verification) */}
        <div className="flex shrink-0 items-center gap-2">
          {adminStatus.isAdmin && (
            <button
              type="button"
              onClick={() => setActiveModule(activeModule === 'admin' ? 'mundo' : 'admin')}
              className={`inline-flex min-h-[36px] items-center gap-1.5 border px-3 text-xs font-semibold whitespace-nowrap transition-colors ${
                activeModule === 'admin'
                  ? 'border-amber-400 bg-amber-500 text-slate-950'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Admin</span>
            </button>
          )}
        </div>
      </header>

      {/* Active Module Drawer (hidden when exploring 3D world) */}
      <ModuleDrawer />

      {/* 3D City Business Proximity Prompt (rendered over 3D world when near an establishment) */}
      <BusinessProximityPrompt />

      {/* Unified Collapsible Bottom Navigation Dock containing all 10 LCE modules */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center">
        {/* Collapse / Expand toggle when exploring 3D */}
        {activeModule === 'mundo' && (
          <button
            type="button"
            onClick={() => setDockCollapsed((prev) => !prev)}
            className="pointer-events-auto mb-1 inline-flex items-center gap-1.5 border border-b-0 border-white/10 bg-[#090B10]/94 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-slate-100"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                <span>Mostrar Menus</span>
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                <span>Ocultar Menus</span>
              </>
            )}
          </button>
        )}

        <nav
          aria-label="Navegação principal do jogo"
          className={`pointer-events-auto w-full border-t border-white/10 bg-[#090B10]/96 transition-transform duration-200 ${
            dockCollapsed && activeModule === 'mundo' ? 'translate-y-full' : 'translate-y-0'
          }`}
        >
          <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-1 overflow-x-auto px-2 sm:justify-center sm:px-4">
            {MAIN_GAME_MODULES.map((mod) => {
              const Icon = MODULE_ICONS[mod.id as Exclude<GameModuleId, 'admin'>];
              const isActive = activeModule === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => setActiveModule(mod.id)}
                  className={`flex min-h-[46px] shrink-0 flex-col items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors sm:min-w-[82px] ${
                    isActive
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{mod.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
