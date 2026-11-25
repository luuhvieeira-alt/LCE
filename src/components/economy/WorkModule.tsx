import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Clock,
  Award,
  CheckCircle2,
  AlertCircle,
  Play,
  XCircle,
  TrendingUp,
  History,
  CheckSquare,
  Square,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import {
  JOB_TASKS_BY_ID,
  PROFESSIONAL_TIERS,
  computeExpectedSalary,
  formatBRL,
  getJobXpFromRecord,
  resolveProfessionalTier,
} from '../../config/economyCatalog';
import {
  cancelWorkShift,
  completeWorkShift,
  startWorkShift,
  timestampToEpochMs,
} from '../../services/economyService';
import type { LegalJobId } from '../../types/economy';

function formatDateTime(val: unknown): string {
  const ms = timestampToEpochMs(val);
  if (!ms) return 'Agora';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

export function WorkModule() {
  const {
    firebaseUser,
    character,
    jobsCatalog,
    jobExperience,
    activeWorkSession,
    salaryPayments,
  } = useGame();

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [checkedTasks, setCheckedTasks] = useState<Record<number, boolean>>({});
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Live 1-second clock tick for shift countdown and cooldown timers
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Reset shift checklist whenever active shift changes
  useEffect(() => {
    setCheckedTasks({});
  }, [activeWorkSession?.id]);

  // Compute daily payout counts & cooldown remaining per job
  const jobUsageStats = useMemo(() => {
    const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
    const stats: Record<string, { payouts24h: number; lastPaidMs: number }> = {};

    for (const p of salaryPayments) {
      const paidMs = timestampToEpochMs(p.paidAt);
      if (!stats[p.jobId]) {
        stats[p.jobId] = { payouts24h: 0, lastPaidMs: 0 };
      }
      if (paidMs > stats[p.jobId].lastPaidMs) {
        stats[p.jobId].lastPaidMs = paidMs;
      }
      if (paidMs >= oneDayAgo) {
        stats[p.jobId].payouts24h += 1;
      }
    }
    return stats;
  }, [salaryPayments, nowMs]);

  const activeSessionTiming = useMemo(() => {
    if (!activeWorkSession) return null;
    const startedAtMs = timestampToEpochMs(activeWorkSession.startedAt);
    const totalMs = activeWorkSession.durationSeconds * 1000 + 1500;
    if (!startedAtMs) {
      return {
        remainingSec: Math.ceil(totalMs / 1000),
        progressPct: 0,
        ready: false,
      };
    }
    const elapsedMs = Math.max(0, nowMs - startedAtMs);
    const remainingSec = Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000));
    const progressPct = Math.min(100, Math.round((elapsedMs / Math.max(1, totalMs)) * 100));
    return { remainingSec, progressPct, ready: remainingSec === 0 };
  }, [activeWorkSession, nowMs]);

  const totalXp = jobExperience?.totalXp ?? 0;
  const globalTier = resolveProfessionalTier(totalXp);

  const handleStartJob = async (jobId: LegalJobId) => {
    if (!firebaseUser) return;
    setFeedback(null);
    setBusyJobId(jobId);
    try {
      const res = await startWorkShift(firebaseUser, jobId);
      setFeedback({
        type: 'ok',
        text: `Expediente de ${res.session.jobName} iniciado (${res.session.durationSeconds}s). Pagamento previsto: ${formatBRL(res.session.expectedSalary)}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Não foi possível iniciar o expediente.',
      });
    } finally {
      setBusyJobId(null);
    }
  };

  const handleCompleteShift = async () => {
    if (!firebaseUser || !activeWorkSession) return;
    setFeedback(null);
    setCompleting(true);
    try {
      const res = await completeWorkShift(firebaseUser, activeWorkSession.id);
      setFeedback({
        type: 'ok',
        text: `Salário legal de ${formatBRL(res.paidAmount)} creditado na sua conta bancária (+${res.xpAwarded} XP · Patente: ${res.tierLabel}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao concluir expediente.',
      });
    } finally {
      setCompleting(false);
    }
  };

  const handleCancelShift = async () => {
    if (!firebaseUser || !activeWorkSession) return;
    setFeedback(null);
    setCompleting(true);
    try {
      await cancelWorkShift(firebaseUser, activeWorkSession.id);
      setFeedback({
        type: 'ok',
        text: 'Expediente encerrado antecipadamente sem pagamento.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao cancelar expediente.',
      });
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Career Header Summary */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border border-white/10 bg-[#121722] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Experiência Profissional Total</span>
            <Award className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-slate-100">
            {totalXp} XP
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Patente geral: <span className="font-semibold text-amber-400">{globalTier.name}</span>
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Salários Recebidos</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-emerald-400">
            {formatBRL(salaryPayments.reduce((sum, p) => sum + p.amount, 0))}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {salaryPayments.length} expediente(s) pago(s) como dinheiro limpo
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Status Operacional</span>
            <Briefcase className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 text-lg font-semibold text-slate-100">
            {activeWorkSession ? activeWorkSession.jobName : 'Disponível para Expediente'}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Nível civil {character?.level ?? 1} · Reputação {character?.reputation ?? 0}
          </p>
        </div>
      </section>

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

      {/* 2. Active Shift Control Card */}
      {activeWorkSession && activeSessionTiming && (
        <section className="space-y-4 border border-amber-500/45 bg-[#131824] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-wider text-amber-400">
                EXPEDIENTE EM ANDAMENTO · CONTROLADO PELO SERVIDOR
              </p>
              <h3 className="mt-1 font-display text-2xl font-bold text-slate-50">
                {activeWorkSession.jobName}
              </h3>
              <p className="text-xs text-slate-400">
                Salário garantido ao concluir:{' '}
                <span className="font-mono font-semibold text-emerald-400">
                  {formatBRL(activeWorkSession.expectedSalary)}
                </span>{' '}
                (Dinheiro Limpo em Conta) · Recompensa:{' '}
                <span className="font-mono text-amber-300">+{activeWorkSession.xpReward} XP</span>
              </p>
            </div>

            <div className="text-right">
              <p className="text-[11px] text-slate-400">Tempo Restante</p>
              <p className="font-mono text-2xl font-semibold tabular-nums text-amber-400">
                {activeSessionTiming.remainingSec}s
              </p>
            </div>
          </div>

          <div className="h-2 w-full bg-[#0A0D14]">
            <div
              className="h-full bg-amber-500 transition-all duration-500"
              style={{ width: `${activeSessionTiming.progressPct}%` }}
            />
          </div>

          {/* Interactive Shift Activity Checklist */}
          <div className="space-y-2 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold text-slate-300">
              Atividades Operacionais do Turno
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(JOB_TASKS_BY_ID[activeWorkSession.jobId] ?? []).map((task, idx) => {
                const done = Boolean(checkedTasks[idx]);
                return (
                  <button
                    key={task}
                    type="button"
                    onClick={() =>
                      setCheckedTasks((prev) => ({ ...prev, [idx]: !prev[idx] }))
                    }
                    className={`flex items-start gap-2 border p-2.5 text-left text-xs transition-colors ${
                      done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-white/10 bg-[#0A0D14] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {done ? (
                      <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    )}
                    <span>{task}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              disabled={!activeSessionTiming.ready || completing}
              onClick={() => void handleCompleteShift()}
              className="inline-flex min-h-[42px] items-center gap-2 bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {completing
                  ? 'Validando pagamento...'
                  : activeSessionTiming.ready
                  ? 'Concluir Expediente e Receber Salário'
                  : `Aguarde ${activeSessionTiming.remainingSec}s para Concluir`}
              </span>
            </button>

            <button
              type="button"
              disabled={completing}
              onClick={() => void handleCancelShift()}
              className="inline-flex min-h-[42px] items-center gap-2 border border-red-500/35 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              <span>Cancelar Turno</span>
            </button>
          </div>
        </section>
      )}

      {/* 3. Four Legal Professions Catalog */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">
            Profissões Legais — Agência Metropolitana LCE
          </h3>
          <p className="text-xs text-slate-400">
            Salários são calculados no servidor com base na sua patente profissional e depositados
            como dinheiro limpo na conta bancária.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {jobsCatalog.map((job) => {
            const profXp = getJobXpFromRecord(jobExperience, job.id);
            const tier = resolveProfessionalTier(profXp);
            const expectedPay = computeExpectedSalary(job.baseSalary, profXp);
            const stats = jobUsageStats[job.id] ?? { payouts24h: 0, lastPaidMs: 0 };

            const cooldownRemSec =
              stats.lastPaidMs > 0
                ? Math.max(0, job.cooldownSeconds - Math.floor((nowMs - stats.lastPaidMs) / 1000))
                : 0;
            const dailyCapReached = stats.payouts24h >= job.maxDailyPayouts;
            const levelLocked = (character?.level ?? 1) < job.minLevel;
            const xpLocked = totalXp < job.requiredExperience;

            let blockReason: string | null = null;
            if (!job.available) blockReason = 'Indisponível pela administração';
            else if (activeWorkSession) blockReason = 'Conclua o expediente atual primeiro';
            else if (levelLocked) blockReason = `Requer Nível ${job.minLevel}`;
            else if (xpLocked) blockReason = `Requer ${job.requiredExperience} XP totais`;
            else if (dailyCapReached) blockReason = `Limite diário (${job.maxDailyPayouts}/24h) atingido`;
            else if (cooldownRemSec > 0) blockReason = `Intervalo ativo: aguarde ${cooldownRemSec}s`;

            return (
              <div
                key={job.id}
                className="flex flex-col justify-between border border-white/10 bg-[#121722] p-5"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-display text-2xl font-bold text-slate-50">{job.name}</h4>
                      <p className="text-[11px] font-medium text-amber-400">
                        Patente: {tier.name} ({Math.round((tier.multiplier - 1) * 100)}% bônus ·{' '}
                        {profXp} XP)
                      </p>
                    </div>
                    <span
                      className={`border px-2 py-0.5 text-[11px] font-medium ${
                        job.available
                          ? 'border-emerald-500/35 text-emerald-300'
                          : 'border-red-500/35 text-red-300'
                      }`}
                    >
                      {job.available ? 'Ativa' : 'Pausada'}
                    </span>
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{job.description}</p>

                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-xs">
                    <div>
                      <p className="text-[11px] text-slate-400">Salário do Turno</p>
                      <p className="font-mono font-semibold tabular-nums text-emerald-400">
                        {formatBRL(expectedPay)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">Duração / Cooldown</p>
                      <p className="font-mono tabular-nums text-slate-200">
                        {job.durationSeconds}s / {job.cooldownSeconds}s
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">Requisitos</p>
                      <p className="font-mono tabular-nums text-slate-200">
                        Nv. {job.minLevel} · {job.requiredExperience} XP
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">Limite Diário / XP</p>
                      <p className="font-mono tabular-nums text-slate-200">
                        {stats.payouts24h}/{job.maxDailyPayouts} · +{job.xpReward} XP
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-2">
                  <button
                    type="button"
                    disabled={Boolean(blockReason) || busyJobId === job.id}
                    onClick={() => void handleStartJob(job.id)}
                    className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:bg-[#1A2130] disabled:text-slate-400"
                  >
                    {busyJobId === job.id ? (
                      <>
                        <Clock className="h-4 w-4 animate-spin" />
                        <span>Iniciando...</span>
                      </>
                    ) : blockReason ? (
                      <span>{blockReason}</span>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        <span>Iniciar Expediente</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. Professional Progression (5 Tiers) */}
      <section className="border border-white/10 bg-[#121722] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Progressão Profissional (5 Níveis)
            </h3>
            <p className="text-xs text-slate-400">
              Evolua de Iniciante até Mestre em cada profissão para desbloquear multiplicadores de
              salário.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
            {PROFESSIONAL_TIERS.map((t) => (
              <span key={t.name} className="border border-white/10 bg-[#0A0D14] px-2 py-0.5 font-mono">
                {t.name}: {t.minXp}+ XP ({Math.round(t.multiplier * 100)}%)
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {jobsCatalog.map((job) => {
            const xp = getJobXpFromRecord(jobExperience, job.id);
            const tier = resolveProfessionalTier(xp);
            const pct = tier.progressPercent;
            return (
              <div key={job.id} className="border border-white/10 bg-[#0A0D14] p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-100">{job.name}</span>
                  <span className="font-mono text-amber-400">{tier.name}</span>
                </div>
                <div className="mt-2 h-1.5 w-full bg-[#192030]">
                  <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-slate-400">
                  <span>{xp} XP acumulados</span>
                  <span>
                    {tier.nextMinXp !== null ? `Próximo nível: ${tier.nextMinXp} XP` : 'Patente Máxima'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5. Salary Payout History */}
      <section className="border border-white/10 bg-[#121722] p-5">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-amber-500" />
          <h3 className="text-base font-semibold text-slate-100">
            Histórico de Salários Pagos (/salary_payments)
          </h3>
        </div>

        {salaryPayments.length === 0 ? (
          <p className="py-4 text-xs text-slate-400">
            Nenhum salário recebido ainda. Inicie um expediente acima para receber seu primeiro
            pagamento legal.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="py-2 pr-4 font-medium">Data</th>
                  <th className="py-2 pr-4 font-medium">Profissão</th>
                  <th className="py-2 pr-4 font-medium">Patente / XP</th>
                  <th className="py-2 pr-4 text-right font-medium">Salário Limpo</th>
                  <th className="py-2 text-right font-medium">Comprovante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {salaryPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 pr-4 font-mono text-[11px] tabular-nums text-slate-300">
                      {formatDateTime(p.paidAt)}
                    </td>
                    <td className="py-2.5 pr-4 font-medium text-slate-100">{p.jobName}</td>
                    <td className="py-2.5 pr-4 text-slate-300">
                      {p.tierLabel} <span className="font-mono text-amber-400">+{p.xpAwarded} XP</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono font-semibold tabular-nums text-emerald-400">
                      + {formatBRL(p.amount)}
                    </td>
                    <td className="py-2.5 text-right font-mono text-[10px] text-slate-500">
                      {p.txId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
