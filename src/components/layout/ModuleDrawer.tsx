import { useEffect, useState } from 'react';
import {
  X,
  Shield,
  Users,
  MapPin,
  Save,
  LogOut,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import {
  ACCENT_PALETTE,
  CHARACTER_STYLES,
  CITY_ESTABLISHMENTS,
  COAT_PALETTE,
  MAIN_GAME_MODULES,
  SKIN_PALETTE,
} from '../../config/gameModules';
import { formatBRL } from '../../config/economyCatalog';
import { DEFAULT_ECONOMY_DRAFT } from '../../services/adminService';
import { AdminPanel } from '../admin/AdminPanel';
import { FinanceModule } from '../economy/FinanceModule';
import { WorkModule } from '../economy/WorkModule';
import { BusinessModule } from '../business/BusinessModule';
import { GarageModule } from '../vehicle/GarageModule';
import type { CharacterStyle } from '../../types/character';

export function ModuleDrawer() {
  const {
    activeModule,
    setActiveModule,
    character,
    firebaseUser,
    economyConfig,
    wallet,
    bankAccount,
    jobExperience,
    remotePlayers,
    onlineCount,
    mpConnection,
    playerCoords,
    saveAppearance,
    graphicsPreset,
    setGraphicsPreset,
    cameraPreset,
    setCameraPreset,
    signOutUser,
  } = useGame();

  const [coatColor, setCoatColor] = useState(character?.coatColor ?? COAT_PALETTE[0].hex);
  const [accentColor, setAccentColor] = useState(character?.accentColor ?? ACCENT_PALETTE[0].hex);
  const [skinTone, setSkinTone] = useState(character?.skinTone ?? SKIN_PALETTE[1].hex);
  const [style, setStyle] = useState<CharacterStyle>(character?.style ?? 'executivo');
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceMsg, setAppearanceMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!character) return;
    setCoatColor(character.coatColor);
    setAccentColor(character.accentColor);
    setSkinTone(character.skinTone);
    setStyle(character.style);
  }, [
    character?.uid,
    character?.coatColor,
    character?.accentColor,
    character?.skinTone,
    character?.style,
  ]);

  if (activeModule === 'mundo' || !character) return null;

  const moduleMeta = MAIN_GAME_MODULES.find((m) => m.id === activeModule);
  const eco = economyConfig ?? DEFAULT_ECONOMY_DRAFT;
  const remoteList = Object.values(remotePlayers);

  const handleSaveAppearance = async () => {
    setAppearanceMsg(null);
    setSavingAppearance(true);
    try {
      await saveAppearance({ coatColor, accentColor, skinTone, style });
      setAppearanceMsg('Visual atualizado no Firestore e sincronizado no personagem 3D.');
    } catch (err) {
      setAppearanceMsg(err instanceof Error ? err.message : 'Falha ao salvar aparência.');
    } finally {
      setSavingAppearance(false);
    }
  };

  const liveCleanCash = wallet?.cleanCash ?? character.cashBalance;
  const liveBankBalance = bankAccount?.balance ?? character.bankBalance;
  const liveJobXp = jobExperience?.totalXp ?? character.experience ?? 0;

  return (
    <div className="pointer-events-auto absolute inset-x-0 top-14 bottom-16 z-30 flex justify-end overflow-hidden bg-[#090B10]/70">
      <div className="flex h-full w-full max-w-4xl flex-col border-l border-white/10 bg-[#0D111A] text-slate-100 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs font-medium text-amber-500">
              {activeModule === 'admin'
                ? 'Administração'
                : moduleMeta?.roadmapModule ?? 'Módulo LCE'}
            </p>
            <h2 className="font-display text-3xl font-bold tracking-wide text-slate-50">
              {activeModule === 'admin' ? 'Painel Administrativo' : moduleMeta?.label}
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setActiveModule('mundo')}
            className="inline-flex min-h-[42px] items-center gap-2 border border-white/15 bg-[#151B27] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#1E2638]"
          >
            <X className="h-4 w-4" />
            <span>Voltar ao Mundo 3D</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 1. PAINEL */}
          {activeModule === 'painel' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="border border-white/10 bg-[#121722] p-4">
                  <p className="text-xs text-slate-400">Dinheiro Limpo (Mãos)</p>
                  <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-slate-100">
                    {formatBRL(liveCleanCash)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">Carteira autoritativa</p>
                </div>
                <div className="border border-white/10 bg-[#121722] p-4">
                  <p className="text-xs text-slate-400">Conta Bancária Legal</p>
                  <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-amber-400">
                    {formatBRL(liveBankBalance)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    {bankAccount?.accountNumber ?? 'Banco Central LCE'}
                  </p>
                </div>
                <div className="border border-white/10 bg-[#121722] p-4">
                  <p className="text-xs text-slate-400">Cidadãos Online</p>
                  <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-slate-100">
                    {onlineCount}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    WebSocket: {mpConnection}
                  </p>
                </div>
                <div className="border border-white/10 bg-[#121722] p-4">
                  <p className="text-xs text-slate-400">Posição no Distrito</p>
                  <p className="mt-1 font-mono text-xl font-medium tabular-nums text-slate-100">
                    X {playerCoords.x} · Z {playerCoords.z}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">Distrito Central</p>
                </div>
              </div>

              {/* Shared Economy Base Indices */}
              <section className="border border-white/10 bg-[#121722] p-5">
                <h3 className="text-sm font-semibold text-slate-100">
                  Parâmetros Atuais da Economia Mista — {eco.cityName}
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Tabela global administrável que servirá de referência aos mercados entre jogadores
                  nos próximos módulos.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-400">Imposto Urbano</p>
                    <p className="font-mono text-base tabular-nums text-slate-100">
                      {eco.taxRatePercent}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Salário-Base / h</p>
                    <p className="font-mono text-base tabular-nums text-slate-100">
                      R$ {eco.baseSalaryHourly.toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Combustível Base</p>
                    <p className="font-mono text-base tabular-nums text-slate-100">
                      R$ {eco.baseFuelPrice.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Imóvel Referência</p>
                    <p className="font-mono text-base tabular-nums text-slate-100">
                      R$ {eco.basePropertyPrice.toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              </section>

              {/* Online Players in Shared Universe */}
              <section className="border border-white/10 bg-[#121722] p-5">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    Presença Compartilhada no Distrito Central
                  </h3>
                </div>
                <div className="mt-3 divide-y divide-white/5 text-xs">
                  <div className="flex items-center justify-between py-2.5">
                    <div>
                      <span className="font-semibold text-slate-100">
                        {character.characterName}
                      </span>
                      <span className="ml-2 font-mono text-amber-400">@{character.alias}</span>
                      <span className="ml-2 text-slate-500">(Você)</span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-400">
                      X {playerCoords.x} / Z {playerCoords.z}
                    </span>
                  </div>
                  {remoteList.map((p) => (
                    <div key={p.uid} className="flex items-center justify-between py-2.5">
                      <div>
                        <span className="font-medium text-slate-200">{p.characterName}</span>
                        <span className="ml-2 font-mono text-slate-400">@{p.alias}</span>
                      </div>
                      <span className="font-mono tabular-nums text-slate-400">
                        X {Math.round(p.x)} / Z {Math.round(p.z)}
                      </span>
                    </div>
                  ))}
                  {remoteList.length === 0 && (
                    <p className="py-3 text-slate-400">
                      Nenhum outro jogador conectado neste momento. Abra outra sessão autenticada
                      para ver a sincronização em tempo real no mesmo mapa 3D.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* 2. PERSONAGEM */}
          {activeModule === 'personagem' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 border border-white/10 bg-[#121722] p-5 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-400">Identidade Civil</p>
                  <p className="mt-1 text-base font-semibold text-slate-100">
                    {character.characterName}
                  </p>
                  <p className="font-mono text-xs text-amber-400">@{character.alias}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Origem & Distrito</p>
                  <p className="mt-1 text-sm font-medium capitalize text-slate-100">
                    {character.origin}
                  </p>
                  <p className="text-xs text-slate-400">Distrito Central</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Progressão (Protegida)</p>
                  <p className="mt-1 font-mono text-sm tabular-nums text-slate-100">
                    Nível {character.level} · {liveJobXp} XP Prof. · Rep. {character.reputation}
                  </p>
                  <p className="text-xs text-slate-500">
                    Status: {character.status} · Posição salva: X {playerCoords.x} / Z{' '}
                    {playerCoords.z}
                  </p>
                </div>
              </div>

              {/* Editable Appearance (Only cosmetic fields allowed by Firestore rules) */}
              <div className="space-y-5 border border-white/10 bg-[#121722] p-5">
                <div>
                  <h3 className="text-base font-semibold text-slate-100">
                    Personalização Visual do Personagem 3D
                  </h3>
                  <p className="text-xs text-slate-400">
                    Alterações estéticas são persistidas no Firestore e refletidas imediatamente no
                    avatar 3D.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs text-slate-300">Estilo do Traje</p>
                  <div className="grid grid-cols-3 gap-2">
                    {CHARACTER_STYLES.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setStyle(opt.id)}
                        className={`min-h-[40px] border text-xs font-semibold ${
                          style === opt.id
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-[#0A0D14] text-slate-300 hover:border-white/25'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="mb-2 text-xs text-slate-300">Casaco</p>
                    <div className="flex flex-wrap gap-2">
                      {COAT_PALETTE.map((c) => (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => setCoatColor(c.hex)}
                          style={{ backgroundColor: c.hex }}
                          aria-label={c.name}
                          className={`h-8 w-8 border ${
                            coatColor === c.hex ? 'border-amber-400 ring-2 ring-amber-500/40' : 'border-white/20'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs text-slate-300">Detalhe</p>
                    <div className="flex flex-wrap gap-2">
                      {ACCENT_PALETTE.map((c) => (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => setAccentColor(c.hex)}
                          style={{ backgroundColor: c.hex }}
                          aria-label={c.name}
                          className={`h-8 w-8 border ${
                            accentColor === c.hex ? 'border-amber-400 ring-2 ring-amber-500/40' : 'border-white/20'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs text-slate-300">Tom de Pele</p>
                    <div className="flex flex-wrap gap-2">
                      {SKIN_PALETTE.map((c) => (
                        <button
                          key={c.hex}
                          type="button"
                          onClick={() => setSkinTone(c.hex)}
                          style={{ backgroundColor: c.hex }}
                          aria-label={c.name}
                          className={`h-8 w-8 border ${
                            skinTone === c.hex ? 'border-amber-400 ring-2 ring-amber-500/40' : 'border-white/20'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {appearanceMsg && (
                  <p className="flex items-center gap-2 text-xs text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{appearanceMsg}</span>
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void handleSaveAppearance()}
                  disabled={savingAppearance}
                  className="inline-flex min-h-[42px] items-center gap-2 bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  <span>{savingAppearance ? 'Salvando...' : 'Salvar Aparência'}</span>
                </button>
              </div>
            </div>
          )}

          {/* 3A. FINANCEIRO (Módulo Econômico Ativo) */}
          {activeModule === 'financeiro' && <FinanceModule />}

          {/* 3B. TRABALHO (Sistema de Profissões Legais Ativo) */}
          {activeModule === 'trabalho' && <WorkModule />}

          {/* 3C. EMPRESAS (Módulo 3 — Sistema de Empresas e Negócios Ativo) */}
          {activeModule === 'empresas' && <BusinessModule />}

          {/* 3D. GARAGEM & VEÍCULOS (Módulo 4 — Concessionárias, Garagem e Mercado Usados) */}
          {activeModule === 'garagem' && <GarageModule />}

          {/* 3E. MÓDULOS PREPARADOS PARA EXPANSÃO FUTURA (Investimentos, Negociações) */}
          {['investimentos', 'negociacoes'].includes(activeModule) && (
            <div className="space-y-6">
              <div className="border border-white/10 bg-[#121722] p-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-500">
                  <Lock className="h-4 w-4" />
                  <span>ESTRUTURA MODULAR PREPARADA · PRÓXIMA EXPANSÃO</span>
                </div>
                <h3 className="mt-2 font-display text-2xl font-bold text-slate-100">
                  {moduleMeta?.label} — {moduleMeta?.roadmapModule}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  {moduleMeta?.description} Este módulo será conectado diretamente à sua carteira
                  individual, conta bancária e patrimônio já ativos na aba Financeiro.
                </p>

                {activeModule === 'negociacoes' && (
                  <div className="mt-5 border-t border-white/10 pt-4 text-xs text-slate-400">
                    Estado do mercado compartilhado:{' '}
                    <span className="font-semibold text-slate-100">
                      {eco.marketOpen ? 'Aberto para estruturação' : 'Fechado pela Administração'}
                    </span>{' '}
                    · Combustível referência: R$ {eco.baseFuelPrice.toFixed(2)} · Imóvel base: R${' '}
                    {eco.basePropertyPrice.toLocaleString('pt-BR')}.
                  </div>
                )}
              </div>

              {/* Establishments in 3D City */}
              <div className="border border-white/10 bg-[#121722] p-5">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <MapPin className="h-4 w-4 text-amber-500" />
                  <span>Estabelecimentos no Distrito Central 3D</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {CITY_ESTABLISHMENTS.map((est) => (
                    <div
                      key={est.id}
                      className="flex items-start justify-between border border-white/10 bg-[#0A0D14] p-3.5"
                    >
                      <div>
                        <p className="text-xs font-semibold text-slate-100">{est.name}</p>
                        <p className="text-[11px] text-slate-400">{est.description}</p>
                      </div>
                      <span className="ml-2 shrink-0 font-mono text-[11px] text-slate-500">
                        ({est.position[0]}, {est.position[2]})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4. CONFIGURAÇÕES */}
          {activeModule === 'configuracoes' && (
            <div className="space-y-6">
              <section className="space-y-4 border border-white/10 bg-[#121722] p-5">
                <h3 className="text-base font-semibold text-slate-100">
                  Desempenho Gráfico 3D e Câmera
                </h3>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs text-slate-400">Qualidade Gráfica WebGL</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setGraphicsPreset('equilibrada')}
                        className={`min-h-[42px] border text-xs font-semibold ${
                          graphicsPreset === 'equilibrada'
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-[#0A0D14] text-slate-300'
                        }`}
                      >
                        Equilibrada
                      </button>
                      <button
                        type="button"
                        onClick={() => setGraphicsPreset('alta')}
                        className={`min-h-[42px] border text-xs font-semibold ${
                          graphicsPreset === 'alta'
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-[#0A0D14] text-slate-300'
                        }`}
                      >
                        Alta (Sombras)
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs text-slate-400">Modo de Câmera em 3ª Pessoa</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCameraPreset('terceira-pessoa')}
                        className={`min-h-[42px] border text-xs font-semibold ${
                          cameraPreset === 'terceira-pessoa'
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-[#0A0D14] text-slate-300'
                        }`}
                      >
                        Próxima
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraPreset('orbital')}
                        className={`min-h-[42px] border text-xs font-semibold ${
                          cameraPreset === 'orbital'
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-white/10 bg-[#0A0D14] text-slate-300'
                        }`}
                      >
                        Panorâmica
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="flex flex-wrap items-center justify-between gap-4 border border-white/10 bg-[#121722] p-5">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Shield className="h-4 w-4 text-amber-500" />
                    <span>Sessão Firebase Authentication</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Conta conectada: {firebaseUser?.email ?? 'Sessão ativa'} · UID:{' '}
                    <span className="font-mono">{firebaseUser?.uid.slice(0, 12)}...</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="inline-flex min-h-[42px] items-center gap-2 border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Encerrar Sessão</span>
                </button>
              </section>
            </div>
          )}

          {/* 5. ADMINISTRAÇÃO */}
          {activeModule === 'admin' && <AdminPanel />}
        </div>
      </div>
    </div>
  );
}
