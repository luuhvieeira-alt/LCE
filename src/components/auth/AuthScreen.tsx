import React, { useState } from 'react';
import { Lock, Mail, LogIn, UserPlus, CheckCircle2, LogOut, RefreshCw } from 'lucide-react';
import { useGame } from '../../context/GameContext';
import {
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  resendVerificationEmail,
} from '../../services/authService';

const BACKDROP_IMAGE_URL = '/src/assets/images/lce_district_backdrop_1795618858485.jpg';

export function AuthScreen() {
  const { firebaseUser, characterLoading, signOutUser } = useGame();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao autenticar com Google.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!email.trim() || !password) {
      setErrorMsg('Informe e-mail e senha para continuar.');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setErrorMsg('A senha deve ter no mínimo 6 caracteres.');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('As senhas informadas não coincidem.');
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password);
        setInfoMsg(
          'Cadastro realizado. Enviamos um link de verificação para o seu e-mail antes de criar o personagem.'
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!firebaseUser) return;
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await resendVerificationEmail(firebaseUser);
      setInfoMsg('E-mail de verificação reenviado. Confirme sua caixa de entrada e atualize.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Não foi possível reenviar o e-mail.');
    } finally {
      setBusy(false);
    }
  };

  const handleRefreshVerification = async () => {
    if (!firebaseUser) return;
    setBusy(true);
    try {
      await firebaseUser.reload();
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  // Loading character profile after successful verified login
  if (firebaseUser && firebaseUser.emailVerified && characterLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#090B10] p-6">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <p className="font-display text-2xl font-bold tracking-wider text-slate-100">
            CARREGANDO IDENTIDADE
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Sincronizando registro do cidadão no Cloud Firestore...
          </p>
        </div>
      </div>
    );
  }

  // Email verification gate for unverified email/password signups
  if (firebaseUser && !firebaseUser.emailVerified) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#090B10] p-6">
        <div className="w-full max-w-md border border-white/10 bg-[#11151E] p-7">
          <div className="mb-4 flex items-center gap-3 text-amber-500">
            <CheckCircle2 className="h-5 w-5" />
            <h2 className="font-display text-2xl font-bold tracking-wide text-slate-100">
              Verificação de E-mail Obrigatória
            </h2>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">
            Por segurança das regras do Firestore, contas criadas com e-mail precisam confirmar o
            endereço <span className="font-medium text-slate-100">{firebaseUser.email}</span> antes
            de registrar um personagem.
          </p>

          {infoMsg && (
            <p className="mt-4 border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              {infoMsg}
            </p>
          )}
          {errorMsg && (
            <p className="mt-4 border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
              {errorMsg}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={handleRefreshVerification}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              <RefreshCw className="h-4 w-4" />
              Já verifiquei meu e-mail
            </button>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={busy}
              className="min-h-[44px] border border-white/15 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/5"
            >
              Reenviar link de verificação
            </button>
            <button
              type="button"
              onClick={() => void signOutUser()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sair e entrar com outra conta
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full w-full grid-cols-1 overflow-y-auto bg-[#090B10] lg:grid-cols-12">
      {/* Left Architectural Visual Panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 lg:col-span-7 lg:flex">
        {!imgFailed ? (
          <img
            src={BACKDROP_IMAGE_URL}
            alt="Distrito Financeiro de LCE ao anoitecer"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 h-full w-full object-cover opacity-75"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#0F1420] via-[#090B10] to-[#171B26]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#090B10] via-[#090B10]/45 to-[#090B10]/70" />

        <div className="relative z-10 p-12">
          <span className="font-display text-3xl font-bold tracking-[0.18em] text-amber-500">
            LCE
          </span>
        </div>

        <div className="relative z-10 max-w-xl p-12">
          <h2 className="font-display text-4xl font-bold leading-tight text-slate-50">
            Acesso ao Distrito Central
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Sua conta Firebase Authentication vincula seu personagem ao universo persistente. Dados
            privados permanecem isolados e os saldos iniciais são protegidos por regras no servidor.
          </p>
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:col-span-5 lg:px-14">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8">
            <p className="font-display text-2xl font-bold tracking-[0.18em] text-amber-500 lg:hidden">
              LCE
            </p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-slate-50">
              {mode === 'login' ? 'Acessar Conta' : 'Criar Nova Conta'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              Autenticação integrada ao Firebase Authentication.
            </p>
          </div>

          {/* Primary Google Sign-In (Active out-of-the-box) */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={busy}
            className="flex min-h-[46px] w-full items-center justify-center gap-3 bg-amber-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            <span>{busy ? 'Autenticando...' : 'Entrar com Google (Recomendado)'}</span>
          </button>

          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs text-slate-500">ou use e-mail e senha</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          {/* Interactive Mode Switcher */}
          <div className="mb-5 grid grid-cols-2 gap-1 bg-[#11151E] p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
              }}
              className={`min-h-[40px] text-xs font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-[#1D2434] text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg(null);
              }}
              className={`min-h-[40px] text-xs font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-[#1D2434] text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cadastrar
            </button>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-xs font-medium text-slate-300">
                E-mail
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  className="min-h-[44px] w-full border border-white/10 bg-[#11151E] py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="auth-pass" className="mb-1.5 block text-xs font-medium text-slate-300">
                Senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  id="auth-pass"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="min-h-[44px] w-full border border-white/10 bg-[#11151E] py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label
                  htmlFor="auth-confirm"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  Confirmar Senha
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="auth-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    className="min-h-[44px] w-full border border-white/10 bg-[#11151E] py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
                {errorMsg}
              </div>
            )}

            {infoMsg && (
              <div className="border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-200">
                {infoMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 border border-white/15 bg-[#161C29] px-4 py-2.5 text-sm font-semibold text-slate-100 transition-colors hover:bg-[#1E2638] disabled:opacity-60"
            >
              {mode === 'login' ? (
                <>
                  <LogIn className="h-4 w-4" />
                  <span>Entrar com E-mail</span>
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  <span>Criar Conta com E-mail</span>
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-slate-500">
            O provedor Google já está ativo neste projeto. Caso deseje utilizar E-mail/Senha em
            produção, ative o método em Firebase Console &gt; Authentication &gt; Sign-in method.
          </p>
        </div>
      </div>
    </div>
  );
}
