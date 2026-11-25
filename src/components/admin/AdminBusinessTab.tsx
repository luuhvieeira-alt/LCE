import { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  RefreshCw,
  Save,
  Plus,
  CheckCircle2,
  AlertCircle,
  Ban,
  Play,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL } from '../../config/economyCatalog';
import {
  BUSINESS_TEMPLATE_TYPES,
  getBusinessStatusLabel,
  getBusinessTxLabel,
} from '../../config/businessCatalog';
import {
  createBusinessLocationAdmin,
  fetchAdminBusinessOverview,
  seedBusinessLocationsAdmin,
  updateBusinessAdminStatus,
  updateBusinessLocationAdmin,
} from '../../services/businessService';
import type {
  AdminBusinessOverview,
  BusinessLocation,
  BusinessStatus,
  BusinessTemplateType,
} from '../../types/business';

export function AdminBusinessTab() {
  const { firebaseUser } = useGame();
  const [overview, setOverview] = useState<AdminBusinessOverview | null>(null);
  const [locationDrafts, setLocationDrafts] = useState<Record<string, BusinessLocation>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create custom establishment form
  const [newName, setNewName] = useState('');
  const [newTemplate, setNewTemplate] = useState<BusinessTemplateType>('supermercado');
  const [newCategory, setNewCategory] = useState('Comércio Local');
  const [newPrice, setNewPrice] = useState('720');
  const [newCapital, setNewCapital] = useState('250');
  const [newExpense, setNewExpense] = useState('90');
  const [newMaxEmp, setNewMaxEmp] = useState('8');
  const [newPosX, setNewPosX] = useState('6');
  const [newPosZ, setNewPosZ] = useState('-10');

  const loadOverview = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const data = await fetchAdminBusinessOverview(firebaseUser);
      setOverview(data);
      const map: Record<string, BusinessLocation> = {};
      for (const loc of data.locations) map[loc.id] = { ...loc };
      setLocationDrafts(map);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao carregar empresas para administração.',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  if (!firebaseUser) return null;

  const runAdminAction = async (fn: () => Promise<string>) => {
    setFeedback(null);
    setBusy(true);
    try {
      const msg = await fn();
      setFeedback({ type: 'ok', text: msg });
      await loadOverview();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro na ação administrativa.',
      });
    } finally {
      setBusy(false);
    }
  };

  const financeByBizId = new Map(
    (overview?.finances ?? []).map((f) => [f.businessId, f])
  );

  return (
    <div className="space-y-6">
      {/* Header & Seed */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#121722] p-4">
        <div className="flex items-center gap-2.5">
          <Building2 className="h-5 w-5 text-amber-500" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Governança do Sistema Empresarial
            </h3>
            <p className="text-[11px] text-slate-400">
              Toda criação, ajuste de preços, despesas ou suspensão gera registro imutável em{' '}
              <span className="font-mono">admin_logs</span>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void runAdminAction(async () => {
                const res = await seedBusinessLocationsAdmin(firebaseUser);
                return `Catálogo oficial sincronizado (${res.seededCount} estabelecimentos gravados no Firestore).`;
              })
            }
            className="min-h-[36px] border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
          >
            Sincronizar 10 Empresas no Banco
          </button>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex min-h-[36px] items-center gap-1.5 border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recarregar</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 border p-3 text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Active Player-Owned Businesses Inspection & Governance */}
      <section className="space-y-3 border border-white/10 bg-[#121722] p-5">
        <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
          Empresas Pertencentes a Jogadores ({overview?.businesses.length ?? 0})
        </h4>
        {(overview?.businesses.length ?? 0) === 0 ? (
          <p className="text-xs text-slate-400">Nenhuma empresa adquirida por jogadores ainda.</p>
        ) : (
          <div className="space-y-3">
            {overview!.businesses.map((biz) => {
              const fin = financeByBizId.get(biz.id);
              const nextToggleStatus: BusinessStatus =
                biz.status === 'suspended' ? 'active' : 'suspended';

              return (
                <div
                  key={biz.id}
                  className="flex flex-wrap items-center justify-between gap-4 border border-white/10 bg-[#0A0D14] p-4 text-xs"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-100">
                      {biz.name}{' '}
                      <span className="font-mono text-[11px] text-amber-400">[{biz.id}]</span>
                    </p>
                    <p className="text-slate-400">
                      Dono: <span className="text-slate-200">{biz.ownerName}</span> (@
                      {biz.ownerAlias}) · Status:{' '}
                      <span className="font-semibold text-slate-200">
                        {getBusinessStatusLabel(biz.status)}
                      </span>
                    </p>
                    <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                      Caixa: {fin ? formatBRL(fin.cashBalance) : '—'} · Receita:{' '}
                      {fin ? formatBRL(fin.totalRevenue) : '—'} · Despesas:{' '}
                      {fin ? formatBRL(fin.totalExpenses) : '—'} · Func.: {biz.employeeCount}/
                      {biz.maxEmployees}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAdminAction(async () => {
                        await updateBusinessAdminStatus(firebaseUser, biz.id, {
                          status: nextToggleStatus,
                          reason:
                            nextToggleStatus === 'suspended'
                              ? 'Suspensão administrativa preventiva'
                              : 'Reativação administrativa autorizada',
                        });
                        return `${biz.name} atualizada para status: ${getBusinessStatusLabel(nextToggleStatus)}.`;
                      })
                    }
                    className={`inline-flex min-h-[36px] items-center gap-1.5 border px-3 text-xs font-semibold ${
                      biz.status === 'suspended'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                        : 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                    }`}
                  >
                    {biz.status === 'suspended' ? (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        <span>Reativar</span>
                      </>
                    ) : (
                      <>
                        <Ban className="h-3.5 w-3.5" />
                        <span>Suspender</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Catalog Price & Operating Parameter Editor */}
      <section className="space-y-3 border border-white/10 bg-[#121722] p-5">
        <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
          Catálogo de Estabelecimentos (Valores de Aquisição, Despesas e Limites)
        </h4>
        <div className="space-y-2.5">
          {Object.values(locationDrafts).map((loc) => (
            <div
              key={loc.id}
              className="grid grid-cols-1 gap-2.5 border border-white/10 bg-[#0A0D14] p-3.5 text-xs lg:grid-cols-12 lg:items-center"
            >
              <div className="lg:col-span-4">
                <p className="font-semibold text-slate-100">{loc.name}</p>
                <p className="text-[11px] text-slate-400">
                  {loc.category} · ({loc.posX}, {loc.posZ})
                </p>
              </div>
              <label className="lg:col-span-2">
                <span className="block text-[10px] text-slate-500">Aquisição (R$)</span>
                <input
                  type="number"
                  value={loc.acquisitionPrice}
                  onChange={(e) =>
                    setLocationDrafts((prev) => ({
                      ...prev,
                      [loc.id]: { ...prev[loc.id], acquisitionPrice: Number(e.target.value) },
                    }))
                  }
                  className="mt-0.5 w-full border border-white/15 bg-[#121722] px-2 py-1 font-mono text-xs text-slate-100"
                />
              </label>
              <label className="lg:col-span-2">
                <span className="block text-[10px] text-slate-500">Despesa (R$)</span>
                <input
                  type="number"
                  value={loc.operatingExpense}
                  onChange={(e) =>
                    setLocationDrafts((prev) => ({
                      ...prev,
                      [loc.id]: { ...prev[loc.id], operatingExpense: Number(e.target.value) },
                    }))
                  }
                  className="mt-0.5 w-full border border-white/15 bg-[#121722] px-2 py-1 font-mono text-xs text-slate-100"
                />
              </label>
              <label className="lg:col-span-2">
                <span className="block text-[10px] text-slate-500">Máx. Func.</span>
                <input
                  type="number"
                  value={loc.maxEmployees}
                  onChange={(e) =>
                    setLocationDrafts((prev) => ({
                      ...prev,
                      [loc.id]: { ...prev[loc.id], maxEmployees: Number(e.target.value) },
                    }))
                  }
                  className="mt-0.5 w-full border border-white/15 bg-[#121722] px-2 py-1 font-mono text-xs text-slate-100"
                />
              </label>
              <div className="lg:col-span-2 lg:text-right">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void runAdminAction(async () => {
                      await updateBusinessLocationAdmin(firebaseUser, loc.id, {
                        acquisitionPrice: loc.acquisitionPrice,
                        operatingExpense: loc.operatingExpense,
                        maxEmployees: loc.maxEmployees,
                      });
                      return `Parâmetros de ${loc.name} atualizados e auditados.`;
                    })
                  }
                  className="inline-flex min-h-[34px] items-center gap-1 bg-amber-500 px-3 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Salvar</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Create Custom New Establishment */}
      <section className="space-y-3 border border-white/10 bg-[#121722] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase">
          <Plus className="h-4 w-4" />
          <span>Criar Novo Estabelecimento na Cidade</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do estabelecimento"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 sm:col-span-2"
          />
          <select
            value={newTemplate}
            onChange={(e) => setNewTemplate(e.target.value as BusinessTemplateType)}
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100"
          >
            {BUSINESS_TEMPLATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Categoria"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100"
          />
          <input
            type="number"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="Preço aquisição"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <input
            type="number"
            value={newCapital}
            onChange={(e) => setNewCapital(e.target.value)}
            placeholder="Capital inicial"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <input
            type="number"
            value={newExpense}
            onChange={(e) => setNewExpense(e.target.value)}
            placeholder="Despesa ciclo"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <input
            type="number"
            value={newMaxEmp}
            onChange={(e) => setNewMaxEmp(e.target.value)}
            placeholder="Máx. funcionários"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <input
            type="number"
            value={newPosX}
            onChange={(e) => setNewPosX(e.target.value)}
            placeholder="Coord X (-40..40)"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <input
            type="number"
            value={newPosZ}
            onChange={(e) => setNewPosZ(e.target.value)}
            placeholder="Coord Z (-40..40)"
            className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100"
          />
          <button
            type="button"
            disabled={busy || newName.trim().length < 3}
            onClick={() =>
              void runAdminAction(async () => {
                const res = await createBusinessLocationAdmin(firebaseUser, {
                  templateType: newTemplate,
                  name: newName.trim(),
                  category: newCategory.trim() || 'Comércio',
                  description: `Estabelecimento criado pela administração: ${newName.trim()}.`,
                  acquisitionPrice: Number(newPrice),
                  initialCapital: Number(newCapital),
                  operatingExpense: Number(newExpense),
                  maxEmployees: Number(newMaxEmp),
                  revenuePotential: Math.round(Number(newPrice) * 1.15),
                  minPriceMultiplier: 1.05,
                  maxPriceMultiplier: 2.5,
                  locationLabel: `Distrito Central (${newPosX}, ${newPosZ})`,
                  posX: Number(newPosX),
                  posZ: Number(newPosZ),
                });
                setNewName('');
                return `Estabelecimento ${res.name} criado com sucesso!`;
              })
            }
            className="min-h-[38px] bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 sm:col-span-2"
          >
            Criar Estabelecimento
          </button>
        </div>
      </section>

      {/* Recent Business Transactions Audit */}
      <section className="space-y-3 border border-white/10 bg-[#121722] p-5">
        <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
          Auditoria de Transações Empresariais ({overview?.transactions.length ?? 0})
        </h4>
        {(overview?.transactions.length ?? 0) === 0 ? (
          <p className="text-xs text-slate-400">Nenhuma transação empresarial registrada ainda.</p>
        ) : (
          <div className="divide-y divide-white/5 text-xs">
            {overview!.transactions.slice(0, 15).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-200">{tx.description}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {tx.businessId} · {getBusinessTxLabel(tx.type)} · {tx.counterpartyLabel}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono font-semibold tabular-nums ${
                    tx.direction === 'in' ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {tx.direction === 'in' ? '+' : '-'} {formatBRL(tx.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
