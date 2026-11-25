import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Save,
  RefreshCw,
  Users,
  FileText,
  Lock,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Building2,
  Landmark,
  Sliders,
  Car,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { DEFAULT_JOBS_CATALOG, formatBRL } from '../../config/economyCatalog';
import { timestampToEpochMs } from '../../services/economyService';
import {
  bootstrapOwnerAdminRecord,
  DEFAULT_ECONOMY_DRAFT,
  executeAdminBalanceAdjustment,
  fetchAdminEconomyOverview,
  fetchAdminServerSession,
  listAdminAuditLogs,
  listCitizensForAdmin,
  saveEconomyConfig,
  seedJobsCatalogAdmin,
  updateCitizenOperationalStatus,
  updateJobConfigAdmin,
} from '../../services/adminService';
import type {
  AdminAuditLog,
  AdminEconomyOverview,
  AdminServerSession,
  EconomyConfigDraft,
} from '../../types/admin';
import type { CharacterProfile } from '../../types/character';
import type { CurrencyCategory, JobDefinition, LegalJobId } from '../../types/economy';
import { AdminBusinessTab } from './AdminBusinessTab';
import { AdminVehicleTab } from './AdminVehicleTab';

type AdminTab = 'economia' | 'profissoes' | 'empresas' | 'veiculos' | 'saldos' | 'auditoria';

function formatLogDate(val: unknown): string {
  const ms = timestampToEpochMs(val);
  if (!ms) return 'Recente';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function AdminPanel() {
  const {
    firebaseUser,
    adminStatus,
    economyConfig,
    refreshEconomyConfig,
    refreshAdminStatus,
  } = useGame();

  const [tab, setTab] = useState<AdminTab>('economia');
  const [serverSession, setServerSession] = useState<AdminServerSession | null>(null);
  const [draft, setDraft] = useState<EconomyConfigDraft>(DEFAULT_ECONOMY_DRAFT);
  const [overview, setOverview] = useState<AdminEconomyOverview | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [citizens, setCitizens] = useState<CharacterProfile[]>([]);
  const [jobDrafts, setJobDrafts] = useState<Record<LegalJobId, JobDefinition>>(() => {
    const map = {} as Record<LegalJobId, JobDefinition>;
    for (const j of DEFAULT_JOBS_CATALOG) map[j.id] = { ...j };
    return map;
  });

  // Audited balance adjustment form state
  const [adjTargetUid, setAdjTargetUid] = useState('');
  const [adjAccount, setAdjAccount] = useState<CurrencyCategory>('bank');
  const [adjDelta, setAdjDelta] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (economyConfig) {
      setDraft({
        cityName: economyConfig.cityName,
        taxRatePercent: economyConfig.taxRatePercent,
        baseSalaryHourly: economyConfig.baseSalaryHourly,
        baseFuelPrice: economyConfig.baseFuelPrice,
        basePropertyPrice: economyConfig.basePropertyPrice,
        initialCleanCash: economyConfig.initialCleanCash ?? 500,
        initialBankBalance: economyConfig.initialBankBalance ?? 1000,
        defaultMaxDailyPayouts: economyConfig.defaultMaxDailyPayouts ?? 12,
        marketOpen: economyConfig.marketOpen,
      });
    }
  }, [economyConfig]);

  const loadAdminData = useCallback(async () => {
    if (!firebaseUser || !adminStatus.isAdmin) return;
    setLoading(true);
    try {
      const [session, ecoOverview] = await Promise.all([
        fetchAdminServerSession(firebaseUser),
        fetchAdminEconomyOverview(firebaseUser).catch(() => null),
      ]);
      setServerSession(session);
      setOverview(ecoOverview);

      if (ecoOverview) {
        setAuditLogs(ecoOverview.adminLogs);
        setCitizens(ecoOverview.users);

        const nextDrafts = {} as Record<LegalJobId, JobDefinition>;
        for (const def of DEFAULT_JOBS_CATALOG) {
          const remote = ecoOverview.jobs.find((j) => j.id === def.id);
          nextDrafts[def.id] = remote ? { ...def, ...remote } : { ...def };
        }
        setJobDrafts(nextDrafts);
      } else {
        const logs = await listAdminAuditLogs(firebaseUser.uid, adminStatus.isBootstrappedOwner);
        setAuditLogs(logs);
        if (adminStatus.isBootstrappedOwner) {
          const usersList = await listCitizensForAdmin();
          setCitizens(usersList);
        }
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao carregar dados administrativos.',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, adminStatus.isAdmin, adminStatus.isBootstrappedOwner]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const walletByUid = useMemo(() => {
    const map = new Map<string, AdminEconomyOverview['wallets'][number]>();
    for (const w of overview?.wallets ?? []) map.set(w.uid, w);
    return map;
  }, [overview?.wallets]);

  const bankByUid = useMemo(() => {
    const map = new Map<string, AdminEconomyOverview['bankAccounts'][number]>();
    for (const b of overview?.bankAccounts ?? []) map.set(b.uid, b);
    return map;
  }, [overview?.bankAccounts]);

  // Hard guard: never render admin controls without real verified authorization
  if (!firebaseUser || !adminStatus.isAdmin) {
    return (
      <div className="border border-red-500/30 bg-red-500/10 p-6">
        <div className="flex items-center gap-3 text-red-300">
          <Lock className="h-5 w-5" />
          <h3 className="font-display text-2xl font-bold">Acesso Restrito</h3>
        </div>
        <p className="mt-2 text-sm text-red-200/90">
          Esta área exige autorização verificada no servidor e registro ativo na coleção protegida
          de administradores.
        </p>
      </div>
    );
  }

  const handleSaveEconomy = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    setSaving(true);
    try {
      await saveEconomyConfig(firebaseUser.uid, draft);
      await refreshEconomyConfig();
      await loadAdminData();
      setFeedback({
        type: 'ok',
        text: 'Parâmetros globais e saldos iniciais salvos e registrados em /admin_logs.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Permissão negada ao salvar economia.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSeedJobs = async () => {
    setFeedback(null);
    setSaving(true);
    try {
      const res = await seedJobsCatalogAdmin(firebaseUser);
      await loadAdminData();
      setFeedback({
        type: 'ok',
        text: `Catálogo de ${res.seededCount} profissões sincronizado em /jobs com sucesso.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao sincronizar profissões.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveJob = async (jobId: LegalJobId) => {
    setFeedback(null);
    setSaving(true);
    try {
      await updateJobConfigAdmin(firebaseUser, jobId, jobDrafts[jobId]);
      await loadAdminData();
      setFeedback({
        type: 'ok',
        text: `Configuração de ${jobDrafts[jobId].name} atualizada no Firestore e auditada.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao atualizar profissão.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const delta = Number(adjDelta.replace(',', '.'));
    if (!adjTargetUid || !Number.isFinite(delta) || delta === 0 || adjReason.trim().length < 5) {
      setFeedback({
        type: 'err',
        text: 'Selecione um cidadão, informe um valor diferente de zero e justificativa (mín. 5 caracteres).',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await executeAdminBalanceAdjustment(firebaseUser, {
        targetUid: adjTargetUid,
        targetAccount: adjAccount,
        delta,
        reason: adjReason.trim(),
      });
      setAdjDelta('');
      setAdjReason('');
      await loadAdminData();
      setFeedback({
        type: 'ok',
        text: `Ajuste auditado aplicado (novo saldo: ${formatBRL(res.newBalance)}). Transação: ${res.txId} · Log: ${res.logId}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao executar ajuste financeiro.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleBootstrapRecord = async () => {
    setFeedback(null);
    setSaving(true);
    try {
      await bootstrapOwnerAdminRecord(firebaseUser.uid, 'Administrador Principal LCE');
      await refreshAdminStatus();
      await loadAdminData();
      setFeedback({
        type: 'ok',
        text: 'Documento oficial gravado em /admins/{uid} com sucesso.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao gravar registro administrativo.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCitizenStatus = async (citizen: CharacterProfile) => {
    setFeedback(null);
    const nextStatus = citizen.status === 'active' ? 'suspended' : 'active';
    try {
      await updateCitizenOperationalStatus(firebaseUser.uid, citizen.uid, nextStatus);
      await loadAdminData();
      setFeedback({
        type: 'ok',
        text: `Status de ${citizen.characterName} atualizado para ${nextStatus}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao alterar status do cidadão.',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Verification Summary */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-amber-500">
            <ShieldCheck className="h-4 w-4" />
            <span>GOVERNANÇA ECONÔMICA & AUDITORIA</span>
          </div>
          <h2 className="mt-1 font-display text-3xl font-bold text-slate-50">
            Console Administrativo LCE
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Papel: {adminStatus.role ?? 'verificado'} · JWT servidor:{' '}
            {serverSession?.authorized ? 'Confirmado' : 'Pendente'} · Online:{' '}
            <span className="font-mono tabular-nums text-slate-200">
              {serverSession?.shardStats.onlinePlayers ?? 0}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {adminStatus.isBootstrappedOwner && (
            <button
              type="button"
              onClick={handleBootstrapRecord}
              disabled={saving}
              className="min-h-[40px] border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/20"
            >
              Sincronizar /admins
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadAdminData()}
            disabled={loading}
            className="inline-flex min-h-[40px] items-center gap-2 border border-white/15 bg-[#161C29] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-[#1E2638]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Admin Sub-Navigation */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {(
          [
            { id: 'economia', label: 'Economia & Inicial', Icon: Sliders },
            { id: 'profissoes', label: 'Profissões (4)', Icon: Briefcase },
            { id: 'empresas', label: 'Empresas (10)', Icon: Building2 },
            { id: 'veiculos', label: 'Veículos', Icon: Car },
            { id: 'saldos', label: 'Saldos & Extrato', Icon: Landmark },
            { id: 'auditoria', label: 'Cidadãos & Logs', Icon: FileText },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setFeedback(null);
            }}
            className={`inline-flex min-h-[42px] items-center justify-center gap-2 border px-3 text-xs font-semibold transition-colors ${
              tab === id
                ? 'border-amber-500 bg-amber-500 text-slate-950'
                : 'border-white/10 bg-[#121722] text-slate-300 hover:bg-[#1A2130]'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {feedback && (
        <div
          className={`flex items-start gap-2.5 border p-3.5 text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/35 bg-red-500/10 text-red-200'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* TAB 1: GLOBAL ECONOMY & INITIAL PLAYER MONEY */}
      {tab === 'economia' && (
        <form onSubmit={handleSaveEconomy} className="space-y-4 border border-white/10 bg-[#11151E] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Economia Mista & Dinheiro Inicial (/economyConfig/global)
              </h3>
              <p className="text-xs text-slate-400">
                Define o capital inicial de novos cidadãos e os índices de referência da cidade.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-200">
              <input
                type="checkbox"
                checked={draft.marketOpen}
                onChange={(e) => setDraft((prev) => ({ ...prev, marketOpen: e.target.checked }))}
                className="h-4 w-4 accent-amber-500"
              />
              <span>Mercado Aberto</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <label htmlFor="eco-city" className="mb-1 block text-xs text-slate-400">
                Nome Oficial da Cidade
              </label>
              <input
                id="eco-city"
                type="text"
                maxLength={64}
                value={draft.cityName}
                onChange={(e) => setDraft((prev) => ({ ...prev, cityName: e.target.value }))}
                className="min-h-[42px] w-full border border-white/10 bg-[#0A0D14] px-3 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="eco-init-cash" className="mb-1 block text-xs text-amber-300">
                Dinheiro Limpo Inicial (R$)
              </label>
              <input
                id="eco-init-cash"
                type="number"
                min={0}
                max={1000000}
                value={draft.initialCleanCash}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, initialCleanCash: Number(e.target.value) }))
                }
                className="min-h-[42px] w-full border border-amber-500/35 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="eco-init-bank" className="mb-1 block text-xs text-amber-300">
                Saldo Bancário Inicial (R$)
              </label>
              <input
                id="eco-init-bank"
                type="number"
                min={0}
                max={1000000}
                value={draft.initialBankBalance}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, initialBankBalance: Number(e.target.value) }))
                }
                className="min-h-[42px] w-full border border-amber-500/35 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="eco-daily-cap" className="mb-1 block text-xs text-amber-300">
                Limite Diário Padrão de Salários
              </label>
              <input
                id="eco-daily-cap"
                type="number"
                min={1}
                max={100}
                value={draft.defaultMaxDailyPayouts}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, defaultMaxDailyPayouts: Number(e.target.value) }))
                }
                className="min-h-[42px] w-full border border-amber-500/35 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="eco-tax" className="mb-1 block text-xs text-slate-400">
                Taxa Tributária Base (%)
              </label>
              <input
                id="eco-tax"
                type="number"
                step="0.5"
                min={0}
                max={50}
                value={draft.taxRatePercent}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, taxRatePercent: Number(e.target.value) }))
                }
                className="min-h-[42px] w-full border border-white/10 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="eco-salary" className="mb-1 block text-xs text-slate-400">
                Salário-Base Referência (R$/h)
              </label>
              <input
                id="eco-salary"
                type="number"
                min={10}
                max={10000}
                value={draft.baseSalaryHourly}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, baseSalaryHourly: Number(e.target.value) }))
                }
                className="min-h-[42px] w-full border border-white/10 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="eco-fuel" className="mb-1 block text-xs text-slate-400">
                Combustível Base (R$/L)
              </label>
              <input
                id="eco-fuel"
                type="number"
                step="0.1"
                min={1}
                max={500}
                value={draft.baseFuelPrice}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, baseFuelPrice: Number(e.target.value) }))
                }
                className="min-h-[42px] w-full border border-white/10 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="eco-prop" className="mb-1 block text-xs text-slate-400">
                Imóvel Base (R$)
              </label>
              <input
                id="eco-prop"
                type="number"
                step="500"
                min={1000}
                max={10000000}
                value={draft.basePropertyPrice}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, basePropertyPrice: Number(e.target.value) }))
                }
                className="min-h-[42px] w-full border border-white/10 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[42px] items-center gap-2 bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              <span>{saving ? 'Salvando...' : 'Salvar Configuração Econômica'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: LEGAL JOBS CONFIGURATION */}
      {tab === 'profissoes' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#11151E] p-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Gestão de Salários, Tempos e Requisitos (/jobs)
              </h3>
              <p className="text-xs text-slate-400">
                Alterações entram em vigor imediatamente para todos os novos expedientes no servidor.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSeedJobs()}
              disabled={saving}
              className="min-h-[38px] border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              Inicializar / Restaurar 4 Profissões no Firestore
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {DEFAULT_JOBS_CATALOG.map((def) => {
              const job = jobDrafts[def.id];
              const updateField = <K extends keyof JobDefinition>(key: K, val: JobDefinition[K]) =>
                setJobDrafts((prev) => ({
                  ...prev,
                  [def.id]: { ...prev[def.id], [key]: val },
                }));

              return (
                <div key={def.id} className="space-y-3 border border-white/10 bg-[#11151E] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-display text-xl font-bold text-slate-50">{job.name}</h4>
                      <p className="font-mono text-[11px] text-slate-500">ID: /jobs/{job.id}</p>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                      <input
                        type="checkbox"
                        checked={job.available}
                        onChange={(e) => updateField('available', e.target.checked)}
                        className="h-4 w-4 accent-amber-500"
                      />
                      <span>Disponível para jogadores</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">Salário Base (R$)</label>
                      <input
                        type="number"
                        min={10}
                        max={50000}
                        value={job.baseSalary}
                        onChange={(e) => updateField('baseSalary', Number(e.target.value))}
                        className="min-h-[38px] w-full border border-white/10 bg-[#0A0D14] px-2.5 font-mono text-xs text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">Duração (seg)</label>
                      <input
                        type="number"
                        min={10}
                        max={3600}
                        value={job.durationSeconds}
                        onChange={(e) => updateField('durationSeconds', Number(e.target.value))}
                        className="min-h-[38px] w-full border border-white/10 bg-[#0A0D14] px-2.5 font-mono text-xs text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">Cooldown (seg)</label>
                      <input
                        type="number"
                        min={5}
                        max={86400}
                        value={job.cooldownSeconds}
                        onChange={(e) => updateField('cooldownSeconds', Number(e.target.value))}
                        className="min-h-[38px] w-full border border-white/10 bg-[#0A0D14] px-2.5 font-mono text-xs text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">Limite / 24h</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={job.maxDailyPayouts}
                        onChange={(e) => updateField('maxDailyPayouts', Number(e.target.value))}
                        className="min-h-[38px] w-full border border-white/10 bg-[#0A0D14] px-2.5 font-mono text-xs text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">XP Requerida</label>
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        value={job.requiredExperience}
                        onChange={(e) => updateField('requiredExperience', Number(e.target.value))}
                        className="min-h-[38px] w-full border border-white/10 bg-[#0A0D14] px-2.5 font-mono text-xs text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">XP por Turno</label>
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        value={job.xpReward}
                        onChange={(e) => updateField('xpReward', Number(e.target.value))}
                        className="min-h-[38px] w-full border border-white/10 bg-[#0A0D14] px-2.5 font-mono text-xs text-slate-100"
                      />
                    </div>
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSaveJob(def.id)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>Salvar {job.name}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: BALANCES, GLOBAL LEDGER & AUDITED ADJUSTMENT */}
      {tab === 'saldos' && (
        <div className="space-y-6">
          {/* Audited Balance Adjustment Form */}
          <form onSubmit={handleAdjustBalance} className="space-y-4 border border-amber-500/30 bg-[#11151E] p-5">
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                Ajuste Financeiro Auditado (Gera Transação + Registro em /admin_logs)
              </h3>
              <p className="text-xs text-slate-400">
                Permite crédito (+) ou débito (-) controlado em Dinheiro Limpo, Dinheiro Sujo ou
                Conta Bancária. Saldos negativos são bloqueados pelo servidor.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="adj-citizen" className="mb-1 block text-xs text-slate-400">
                  Cidadão Alvo
                </label>
                <select
                  id="adj-citizen"
                  value={adjTargetUid}
                  onChange={(e) => setAdjTargetUid(e.target.value)}
                  className="min-h-[40px] w-full border border-white/15 bg-[#0A0D14] px-2.5 text-xs text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {citizens.map((c) => (
                    <option key={c.uid} value={c.uid}>
                      {c.characterName} (@{c.alias})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="adj-account" className="mb-1 block text-xs text-slate-400">
                  Categoria / Conta
                </label>
                <select
                  id="adj-account"
                  value={adjAccount}
                  onChange={(e) => setAdjAccount(e.target.value as CurrencyCategory)}
                  className="min-h-[40px] w-full border border-white/15 bg-[#0A0D14] px-2.5 text-xs text-slate-100"
                >
                  <option value="bank">Conta Bancária Legal</option>
                  <option value="clean_cash">Dinheiro Limpo (Espécie)</option>
                  <option value="dirty_cash">Dinheiro Sujo (Separado)</option>
                </select>
              </div>

              <div>
                <label htmlFor="adj-delta" className="mb-1 block text-xs text-slate-400">
                  Variação (Ex.: 500 ou -100)
                </label>
                <input
                  id="adj-delta"
                  type="number"
                  step="0.01"
                  value={adjDelta}
                  onChange={(e) => setAdjDelta(e.target.value)}
                  placeholder="+500 ou -100"
                  className="min-h-[40px] w-full border border-white/15 bg-[#0A0D14] px-2.5 font-mono text-xs text-slate-100"
                />
              </div>

              <div>
                <label htmlFor="adj-reason" className="mb-1 block text-xs text-slate-400">
                  Justificativa Obrigatória
                </label>
                <input
                  id="adj-reason"
                  type="text"
                  maxLength={140}
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Ex.: Correção de evento oficial"
                  className="min-h-[40px] w-full border border-white/15 bg-[#0A0D14] px-2.5 text-xs text-slate-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[40px] items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>{saving ? 'Executando...' : 'Aplicar Ajuste Auditado'}</span>
            </button>
          </form>

          {/* All Citizens Live Wallets & Bank Balances */}
          <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
            <h3 className="text-base font-semibold text-slate-100">
              Carteiras & Contas Bancárias dos Jogadores
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400">
                    <th className="py-2 pr-4 font-medium">Cidadão</th>
                    <th className="py-2 pr-4 font-medium">Conta LCE</th>
                    <th className="py-2 pr-4 text-right font-medium">Limpo (Espécie)</th>
                    <th className="py-2 pr-4 text-right font-medium">Banco Legal</th>
                    <th className="py-2 text-right font-medium">Dinheiro Sujo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {citizens.map((c) => {
                    const w = walletByUid.get(c.uid);
                    const b = bankByUid.get(c.uid);
                    return (
                      <tr key={c.uid}>
                        <td className="py-2.5 pr-4">
                          <p className="font-medium text-slate-100">{c.characterName}</p>
                          <p className="font-mono text-[11px] text-slate-500">@{c.alias}</p>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-[11px] text-slate-300">
                          {b?.accountNumber ?? 'Não inicializada'}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-emerald-300">
                          {formatBRL(w?.cleanCash ?? c.cashBalance)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-amber-400">
                          {formatBRL(b?.balance ?? c.bankBalance)}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-red-300">
                          {formatBRL(w?.dirtyCash ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Global Immutable Transactions Ledger */}
          <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
            <h3 className="text-base font-semibold text-slate-100">
              Extrato Global de Transações (/transactions · {overview?.transactions.length ?? 0})
            </h3>
            {(overview?.transactions.length ?? 0) === 0 ? (
              <p className="text-xs text-slate-400">Nenhuma transação registrada ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400">
                      <th className="py-2 pr-4 font-medium">Data / ID</th>
                      <th className="py-2 pr-4 font-medium">Tipo</th>
                      <th className="py-2 pr-4 font-medium">Origem → Destino</th>
                      <th className="py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {(overview?.transactions ?? []).map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-2.5 pr-4 align-top">
                          <p className="font-mono text-[11px] text-slate-300">
                            {formatLogDate(tx.createdAt)}
                          </p>
                          <p className="font-mono text-[10px] text-slate-500">{tx.id}</p>
                        </td>
                        <td className="py-2.5 pr-4 align-top font-mono text-[11px] text-amber-300">
                          {tx.type}
                        </td>
                        <td className="py-2.5 pr-4 align-top">
                          <p className="text-slate-200">
                            {tx.fromLabel} → {tx.toLabel}
                          </p>
                          <p className="text-[11px] text-slate-400">{tx.description}</p>
                        </td>
                        <td className="py-2.5 text-right align-top font-mono font-semibold tabular-nums text-slate-100">
                          {formatBRL(tx.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 4: CITIZENS MODERATION & IMMUTABLE ADMIN LOGS */}
      {tab === 'auditoria' && (
        <div className="space-y-6">
          {adminStatus.isBootstrappedOwner && (
            <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-amber-500" />
                <h3 className="text-base font-semibold text-slate-100">
                  Moderação de Cidadãos ({citizens.length})
                </h3>
              </div>
              {citizens.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum personagem registrado até o momento.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400">
                        <th className="py-2 pr-4 font-medium">Personagem</th>
                        <th className="py-2 pr-4 font-medium">Origem</th>
                        <th className="py-2 pr-4 font-medium">Status</th>
                        <th className="py-2 text-right font-medium">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {citizens.map((c) => (
                        <tr key={c.uid}>
                          <td className="py-2.5 pr-4">
                            <p className="font-medium text-slate-100">{c.characterName}</p>
                            <p className="font-mono text-[11px] text-slate-500">@{c.alias}</p>
                          </td>
                          <td className="py-2.5 pr-4 capitalize text-slate-300">{c.origin}</td>
                          <td className="py-2.5 pr-4">
                            <span
                              className={
                                c.status === 'active' ? 'text-emerald-400' : 'text-red-400'
                              }
                            >
                              {c.status === 'active' ? 'Ativo' : 'Suspenso'}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => void handleToggleCitizenStatus(c)}
                              className="border border-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/5"
                            >
                              {c.status === 'active' ? 'Suspender' : 'Reativar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-500" />
              <h3 className="text-base font-semibold text-slate-100">
                Trilha de Auditoria Imutável (/admin_logs · {auditLogs.length})
              </h3>
            </div>
            {auditLogs.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nenhuma ação registrada em /admin_logs ainda.
              </p>
            ) : (
              <div className="divide-y divide-white/5">
                {auditLogs.map((log) => (
                  <div key={log.id} className="py-2.5 text-xs">
                    <p className="text-slate-200">{log.summary}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {formatLogDate(log.createdAt)} · {log.action} · ator:{' '}
                      {log.actorUid.slice(0, 12)}...
                      {log.targetUid ? ` · alvo: ${log.targetUid.slice(0, 12)}...` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {/* TAB 5: EMPRESAS (Módulo 3) */}
      {tab === 'empresas' && <AdminBusinessTab />}

      {/* TAB 6: VEÍCULOS (Módulo 4) */}
      {tab === 'veiculos' && <AdminVehicleTab />}
    </div>
  );
}

