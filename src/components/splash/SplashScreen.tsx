import { useState } from 'react';
import { ArrowRight, ShieldCheck, Globe2, Building2 } from 'lucide-react';
import { useGame } from '../../context/GameContext';

const SPLASH_IMAGE_URL = '/src/assets/images/lce_splash_skyline_1795618861454.jpg';

export function SplashScreen() {
  const { enterFromSplash, authReady, firebaseUser } = useGame();
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-[#090B10] text-slate-100">
      {/* Full-bleed urban twilight backdrop with measured contrast scrim */}
      <div className="absolute inset-0 z-0">
        {!imgFailed ? (
          <img
            src={SPLASH_IMAGE_URL}
            alt="Panorama urbano noturno de LIFE CRIMINAL EXPERIENCE"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover object-center opacity-70"
          />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_70%_25%,rgba(217,119,6,0.18),transparent_55%),linear-gradient(160deg,#090B10_0%,#111827_60%,#090B10_100%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#090B10] via-[#090B10]/82 to-[#090B10]/35" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#090B10] via-transparent to-[#090B10]/65" />
      </div>

      {/* Top minimal bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-14">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-2xl font-bold tracking-[0.18em] text-amber-500">
            LCE
          </span>
          <span className="text-xs font-medium tracking-wider text-slate-400">
            LIFE CRIMINAL EXPERIENCE
          </span>
        </div>

        <div className="hidden items-center gap-3 text-xs text-slate-400 sm:flex">
          <span>Universo Compartilhado</span>
          <span aria-hidden="true">·</span>
          <span>Simulação Urbana 3D</span>
          <span aria-hidden="true">·</span>
          <span>Módulo 1</span>
        </div>
      </header>

      {/* Main Focal Anchor */}
      <main className="relative z-10 flex flex-1 items-center px-6 md:px-14">
        <div className="max-w-2xl">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-amber-500">
            CIDADE PERSISTENTE EM TEMPO REAL
          </p>
          <h1
            className="font-display text-5xl font-bold leading-[0.95] tracking-tight text-slate-50 sm:text-6xl md:text-7xl"
            style={{ textWrap: 'balance' }}
          >
            LIFE CRIMINAL EXPERIENCE
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300">
            Um único universo urbano compartilhado no navegador. Construa sua identidade, explore o
            Distrito Central em 3D e participe de uma economia mista regida por regras autoritativas.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={enterFromSplash}
              disabled={!authReady}
              className="inline-flex min-h-[46px] items-center gap-3 bg-amber-500 px-7 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-60"
            >
              <span>
                {!authReady
                  ? 'Conectando...'
                  : firebaseUser
                    ? 'Continuar Sessão'
                    : 'Entrar na Cidade'}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>

            <span className="text-xs text-slate-400">
              Desktop e Mobile · WebGL 3D · Firebase Auth & Firestore
            </span>
          </div>
        </div>
      </main>

      {/* Clean architectural footer strip (no telemetry fluff) */}
      <footer className="relative z-10 border-t border-white/10 bg-[#090B10]/85 px-6 py-5 md:px-14">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-8">
          <div className="flex items-start gap-3">
            <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-slate-100">Universo Único</p>
              <p className="text-xs text-slate-400">
                Presença sincronizada em tempo real no mesmo distrito urbano.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-slate-100">Economia Mista</p>
              <p className="text-xs text-slate-400">
                Preços-base administráveis e arquitetura preparada para livre negociação.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-semibold text-slate-100">Integridade Autoritativa</p>
              <p className="text-xs text-slate-400">
                Saldos imutáveis no cliente e controle administrativo verificado no servidor.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
