import React, { useState } from 'react';
import { UserCheck, LogOut, Shield } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import {
  ACCENT_PALETTE,
  CHARACTER_ORIGINS,
  CHARACTER_STYLES,
  COAT_PALETTE,
  SKIN_PALETTE,
} from '../../config/gameModules';
import {
  createCharacterProfile,
  INITIAL_CITIZEN_BANK,
  INITIAL_CITIZEN_CASH,
  validateCharacterInput,
} from '../../services/characterService';
import type { CharacterOrigin, CharacterStyle } from '../../types/character';

export function CharacterCreator() {
  const { firebaseUser, signOutUser } = useGame();

  const defaultName = firebaseUser?.displayName
    ? firebaseUser.displayName.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '').slice(0, 28)
    : '';
  const defaultAlias = defaultName
    ? defaultName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 18)
    : '';

  const [characterName, setCharacterName] = useState(defaultName);
  const [alias, setAlias] = useState(defaultAlias);
  const [origin, setOrigin] = useState<CharacterOrigin>('comerciante');
  const [style, setStyle] = useState<CharacterStyle>('executivo');
  const [coatColor, setCoatColor] = useState(COAT_PALETTE[0].hex);
  const [accentColor, setAccentColor] = useState(ACCENT_PALETTE[0].hex);
  const [skinTone, setSkinTone] = useState(SKIN_PALETTE[1].hex);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;

    const payload = {
      characterName,
      alias,
      origin,
      coatColor,
      accentColor,
      skinTone,
      style,
    };

    const validationError = validateCharacterInput(payload);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg(null);
    setSubmitting(true);
    try {
      await createCharacterProfile(firebaseUser.uid, payload);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao registrar personagem.');
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-[#090B10] text-slate-100">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4 md:px-12">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl font-bold tracking-[0.18em] text-amber-500">
            LCE
          </span>
          <span className="text-xs text-slate-400">Registro Civil · Distrito Central</span>
        </div>

        <button
          type="button"
          onClick={() => void signOutUser()}
          className="inline-flex min-h-[40px] items-center gap-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-100"
        >
          <LogOut className="h-4 w-4" />
          <span>Encerrar Sessão</span>
        </button>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-12 lg:px-12">
        {/* Left: Character Visual Preview & Server-Locked Starting Grant */}
        <section className="flex flex-col justify-between border border-white/10 bg-[#11151E] p-6 lg:col-span-5">
          <div>
            <p className="text-xs font-semibold tracking-wider text-amber-500">
              PRÉ-VISUALIZAÇÃO DO CIDADÃO
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold text-slate-50">
              {characterName.trim() || 'Novo Cidadão'}
            </h1>
            <p className="font-mono text-xs text-slate-400">
              @{alias.trim() || 'codinome'} · Distrito Central
            </p>

            {/* Clean Architectural Character Silhouette SVG reflecting live chosen colors */}
            <div className="my-8 flex items-center justify-center border border-white/5 bg-[#0A0D14] py-10">
              <svg
                width="160"
                height="240"
                viewBox="0 0 160 240"
                fill="none"
                aria-label="Pré-visualização do visual do personagem"
              >
                {/* Ground shadow */}
                <ellipse cx="80" cy="224" rx="44" ry="8" fill="#000000" fillOpacity="0.55" />
                {/* Legs */}
                <rect x="57" y="148" width="18" height="72" rx="4" fill="#141821" />
                <rect x="85" y="148" width="18" height="72" rx="4" fill="#141821" />
                {/* Shoes */}
                <rect x="54" y="212" width="22" height="10" rx="3" fill="#0B0D12" />
                <rect x="84" y="212" width="22" height="10" rx="3" fill="#0B0D12" />
                {/* Coat / Torso */}
                <path
                  d="M44 78 C44 68 54 64 80 64 C106 64 116 68 116 78 L112 154 L48 154 Z"
                  fill={coatColor}
                />
                {/* Style-specific chest/lapel accent */}
                {style === 'executivo' && (
                  <>
                    <polygon points="80,68 68,112 80,104 92,112" fill={accentColor} />
                    <rect x="77" y="72" width="6" height="44" fill={accentColor} />
                  </>
                )}
                {style === 'urbano' && (
                  <rect x="50" y="92" width="60" height="10" fill={accentColor} />
                )}
                {style === 'tatico' && (
                  <>
                    <rect x="54" y="78" width="52" height="46" rx="4" fill={accentColor} fillOpacity="0.85" />
                    <rect x="58" y="88" width="18" height="12" rx="2" fill="#0D111A" />
                    <rect x="84" y="88" width="18" height="12" rx="2" fill="#0D111A" />
                  </>
                )}
                {/* Arms */}
                <rect x="30" y="76" width="16" height="68" rx="6" fill={coatColor} />
                <rect x="114" y="76" width="16" height="68" rx="6" fill={coatColor} />
                {/* Hands */}
                <circle cx="38" cy="148" r="7" fill={skinTone} />
                <circle cx="122" cy="148" r="7" fill={skinTone} />
                {/* Neck & Head */}
                <rect x="72" y="52" width="16" height="14" rx="4" fill={skinTone} />
                <circle cx="80" cy="36" r="20" fill={skinTone} />
                {/* Hair silhouette */}
                <path
                  d="M60 34 C60 18 70 14 80 14 C90 14 100 18 100 34 C94 26 66 26 60 34 Z"
                  fill="#12151C"
                />
              </svg>
            </div>
          </div>

          {/* Transparent initial economic allocation */}
          <div className="border-t border-white/10 pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Shield className="h-4 w-4 text-amber-500" />
              <span>Patrimônio Inicial Controlado pelo Servidor</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400">Dinheiro em Mãos</p>
                <p className="font-mono text-lg font-medium tabular-nums text-slate-100">
                  R$ {INITIAL_CITIZEN_CASH.toLocaleString('pt-BR')}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Conta Bancária</p>
                <p className="font-mono text-lg font-medium tabular-nums text-slate-100">
                  R$ {INITIAL_CITIZEN_BANK.toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Valores iniciais validados pelas regras do Firestore; não podem ser alterados pelo
              navegador.
            </p>
          </div>
        </section>

        {/* Right: Character Form */}
        <form onSubmit={handleSubmit} className="space-y-6 lg:col-span-7">
          <div>
            <h2 className="font-display text-3xl font-bold text-slate-50">
              Criar Perfil e Personagem
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Defina sua identidade civil e aparência inicial antes de ingressar no Distrito Central
              em 3D.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="char-name"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Nome do Personagem
              </label>
              <input
                id="char-name"
                type="text"
                maxLength={32}
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                placeholder="Ex: Henrique Valente"
                className="min-h-[44px] w-full border border-white/10 bg-[#11151E] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="char-alias"
                className="mb-1.5 block text-xs font-medium text-slate-300"
              >
                Codinome no Mundo 3D
              </label>
              <input
                id="char-alias"
                type="text"
                maxLength={24}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="Ex: HValente"
                className="min-h-[44px] w-full border border-white/10 bg-[#11151E] px-3.5 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Origin selection */}
          <div>
            <p className="mb-2.5 text-xs font-medium text-slate-300">Origem Urbana</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CHARACTER_ORIGINS.map((item) => {
                const active = origin === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOrigin(item.id)}
                    className={`border p-4 text-left transition-colors ${
                      active
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-white/10 bg-[#11151E] hover:border-white/25'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-100">{item.name}</p>
                    <p className="text-xs text-amber-400/90">{item.subtitle}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      {item.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Style & Colors */}
          <div className="space-y-4 border-t border-white/10 pt-5">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-300">Estilo do Traje</p>
              <div className="grid grid-cols-3 gap-2">
                {CHARACTER_STYLES.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStyle(opt.id)}
                    className={`min-h-[42px] border text-xs font-semibold transition-colors ${
                      style === opt.id
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-white/10 bg-[#11151E] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-medium text-slate-300">Cor do Casaco</p>
                <div className="flex flex-wrap gap-2">
                  {COAT_PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      aria-label={`Cor do casaco ${c.name}`}
                      onClick={() => setCoatColor(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      className={`h-8 w-8 border transition-transform ${
                        coatColor === c.hex
                          ? 'scale-110 border-amber-400 ring-2 ring-amber-500/50'
                          : 'border-white/20'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-300">Detalhe</p>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      aria-label={`Cor de detalhe ${c.name}`}
                      onClick={() => setAccentColor(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      className={`h-8 w-8 border transition-transform ${
                        accentColor === c.hex
                          ? 'scale-110 border-amber-400 ring-2 ring-amber-500/50'
                          : 'border-white/20'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-slate-300">Tom de Pele</p>
                <div className="flex flex-wrap gap-2">
                  {SKIN_PALETTE.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.name}
                      aria-label={`Tom de pele ${c.name}`}
                      onClick={() => setSkinTone(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      className={`h-8 w-8 border transition-transform ${
                        skinTone === c.hex
                          ? 'scale-110 border-amber-400 ring-2 ring-amber-500/50'
                          : 'border-white/20'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60 sm:w-auto"
            >
              <UserCheck className="h-4 w-4" />
              <span>{submitting ? 'Registrando no Universo...' : 'Criar Personagem e Entrar'}</span>
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
