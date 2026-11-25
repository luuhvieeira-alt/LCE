import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  RefreshCw,
  DollarSign,
  Users,
  Briefcase,
  Package,
  Star,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  UserPlus,
  ShoppingBag,
  Tag,
  ShieldAlert,
  LogOut,
  Plus,
  Car,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL } from '../../config/economyCatalog';
import {
  getBusinessStatusLabel,
  getBusinessTxLabel,
  getReputationTier,
} from '../../config/businessCatalog';
import { timestampToEpochMs } from '../../services/economyService';
import {
  applyToBusinessVacancy,
  buyBusinessFromOwner,
  createBusinessProduct,
  createBusinessVacancy,
  decideBusinessApplication,
  fetchBusinessDashboard,
  payBusinessOperatingExpenses,
  payEmployeeSalary,
  restockBusinessInventory,
  sellBusinessInventory,
  submitBusinessReview,
  transferBusinessCapital,
  updateBusinessListing,
  updateBusinessProduct,
  updateBusinessVacancy,
  updateEmployeeContract,
} from '../../services/businessService';
import type { BusinessDashboardPayload } from '../../types/business';
import { DEALERSHIP_ROLE_PRESETS } from '../../config/vehicleCatalog';
import { DealershipShowroomPanel } from '../vehicle/DealershipShowroomPanel';
import { BusinessFinanceChart } from './BusinessFinanceChart';

type DetailTab = 'geral' | 'showroom' | 'vagas' | 'equipe' | 'estoque' | 'reputacao';

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

interface BusinessDetailPanelProps {
  businessId: string;
  onBack: () => void;
}

export function BusinessDetailPanel({ businessId, onBack }: BusinessDetailPanelProps) {
  const { firebaseUser, preferredBusinessTab, setPreferredBusinessTab } = useGame();
  const [tab, setTab] = useState<DetailTab>('geral');
  const [data, setData] = useState<BusinessDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Capital form
  const [capitalAmount, setCapitalAmount] = useState('150');
  // P2P listing form
  const [salePriceInput, setSalePriceInput] = useState('900');

  // Vacancy form
  const [vacRole, setVacRole] = useState('');
  const [vacSalary, setVacSalary] = useState('140');
  const [vacSchedule, setVacSchedule] = useState('Turno Integral (8h)');
  const [vacReqs, setVacReqs] = useState('Pontualidade e atendimento de qualidade.');
  const [vacSlots, setVacSlots] = useState('2');
  const [vacDesc, setVacDesc] = useState('Atuação nas operações diárias da unidade.');

  // Apply form
  const [applyCoverNote, setApplyCoverNote] = useState(
    'Tenho disponibilidade imediata para atuar no Distrito Central.'
  );

  // Employee inline edit
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editSalary, setEditSalary] = useState('');

  // New Product form
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCat, setProdCat] = useState('Comercial');
  const [prodCost, setProdCost] = useState('25');
  const [prodPrice, setProdPrice] = useState('45');

  // Stock action quantities per product
  const [stockQtyByProd, setStockQtyByProd] = useState<Record<string, string>>({});
  const [priceEditByProd, setPriceEditByProd] = useState<Record<string, string>>({});

  // Citizen review form
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  const loadDashboard = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const payload = await fetchBusinessDashboard(firebaseUser, businessId);
      setData(payload);
      if (payload.business.salePrice > 0) {
        setSalePriceInput(String(payload.business.salePrice));
      } else {
        setSalePriceInput(String(Math.round(payload.business.marketValue * 1.1)));
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao carregar painel da empresa.',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, businessId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!data) return;
    if (data.business.templateType === 'concessionaria' && preferredBusinessTab === 'showroom') {
      setTab('showroom');
      setPreferredBusinessTab(null);
    } else if (data.business.templateType !== 'concessionaria' && tab === 'showroom') {
      setTab('geral');
    }
  }, [data, preferredBusinessTab, setPreferredBusinessTab, tab]);

  const runAction = async (fn: () => Promise<string>) => {
    setFeedback(null);
    setBusy(true);
    try {
      const msg = await fn();
      setFeedback({ type: 'ok', text: msg });
      await loadDashboard();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao processar operação.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="border border-white/10 bg-[#121722] p-8 text-center text-xs text-slate-400">
        Carregando dados corporativos...
      </div>
    );
  }

  if (!data || !firebaseUser) {
    return (
      <div className="space-y-4 border border-white/10 bg-[#121722] p-6">
        <p className="text-sm text-red-300">
          {feedback?.text ?? 'Empresa não encontrada no Distrito Central.'}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[38px] items-center gap-2 border border-white/15 bg-[#0A0D14] px-3.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Voltar</span>
        </button>
      </div>
    );
  }

  const {
    business,
    isOwner,
    isEmployee,
    finances,
    vacancies,
    employees,
    applications,
    products,
    inventory,
    transactions,
    payroll,
    reviews,
  } = data;

  const inventoryMap = new Map(inventory.map((i) => [i.id, i]));
  const totalStockUnits = inventory.reduce((sum, i) => sum + i.quantity, 0);
  const openVacancyList = vacancies.filter((v) => v.status === 'open');
  const activeEmployees = employees.filter((e) => e.status === 'active');

  return (
    <div className="space-y-6">
      {/* Top Action & Identity Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border border-white/10 bg-[#121722] p-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1 text-slate-400 hover:text-amber-400"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Empresas</span>
            </button>
            <span className="text-slate-600">/</span>
            <span className="text-amber-400">{business.category}</span>
            <span className="text-slate-600">·</span>
            <span
              className={`font-semibold ${
                business.status === 'active'
                  ? 'text-emerald-400'
                  : business.status === 'inactive_funds'
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}
            >
              {getBusinessStatusLabel(business.status)}
            </span>
          </div>
          <h3 className="font-display text-2xl font-bold tracking-wide text-slate-50">
            {business.name}
          </h3>
          <p className="text-xs text-slate-400">
            Proprietário:{' '}
            <span className="font-semibold text-slate-200">{business.ownerName}</span> (
            <span className="font-mono text-amber-400">@{business.ownerAlias}</span>) ·{' '}
            {business.locationLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isOwner && business.forSale && business.status !== 'suspended' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction(async () => {
                  const res = await buyBusinessFromOwner(firebaseUser, business.id);
                  return `Empresa adquirida via mercado P2P por ${formatBRL(res.salePrice)}! Você agora é o proprietário.`;
                })
              }
              className="inline-flex min-h-[38px] items-center gap-1.5 bg-emerald-500 px-4 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              <Tag className="h-3.5 w-3.5" />
              <span>Comprar Empresa ({formatBRL(business.salePrice)})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadDashboard()}
            disabled={loading}
            className="inline-flex min-h-[38px] items-center gap-1.5 border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-300 hover:bg-white/5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center gap-2.5 border p-3.5 text-xs ${
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

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Valor de Mercado</p>
          <p className="mt-1 font-mono text-lg font-medium tabular-nums text-slate-100">
            {formatBRL(business.marketValue)}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Caixa da Empresa</p>
          <p className="mt-1 font-mono text-lg font-medium tabular-nums text-amber-400">
            {finances ? formatBRL(finances.cashBalance) : 'Privado'}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Funcionários</p>
          <p className="mt-1 font-mono text-lg font-medium tabular-nums text-slate-100">
            {business.employeeCount} / {business.maxEmployees}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Estoque Total</p>
          <p className="mt-1 font-mono text-lg font-medium tabular-nums text-slate-100">
            {totalStockUnits} un.
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Reputação</p>
          <p className="mt-1 font-mono text-lg font-medium tabular-nums text-emerald-400">
            {business.reputation}/100
          </p>
          <p className="text-[10px] text-slate-500">{getReputationTier(business.reputation)}</p>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-white/10 pb-2">
        {(
          [
            { id: 'geral' as const, label: 'Visão Geral & Finanças', icon: TrendingUp },
            ...(business.templateType === 'concessionaria'
              ? [{ id: 'showroom' as const, label: 'Showroom Veículos', icon: Car }]
              : []),
            { id: 'vagas' as const, label: `Vagas (${openVacancyList.length})`, icon: Briefcase },
            { id: 'equipe' as const, label: `Equipe & Folha (${business.employeeCount})`, icon: Users },
            { id: 'estoque' as const, label: `Estoque & Vendas (${products.length})`, icon: Package },
            { id: 'reputacao' as const, label: `Reputação (${reviews.length})`, icon: Star },
          ]
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 px-3.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                active
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1B: SHOWROOM DE VEÍCULOS (Concessionária) */}
      {tab === 'showroom' && business.templateType === 'concessionaria' && (
        <DealershipShowroomPanel
          businessId={business.id}
          onRefreshParent={() => void loadDashboard()}
        />
      )}

      {/* TAB 1: VISÃO GERAL & FINANÇAS */}
      {tab === 'geral' && (
        <div className="space-y-6">
          {finances ? (
            <>
              <BusinessFinanceChart finances={finances} transactions={transactions} />

              {/* Owner Controls: Capital, Operating Expenses, P2P Sale */}
              {isOwner && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {/* Capital Inject / Withdraw */}
                  <div className="space-y-3 border border-white/10 bg-[#121722] p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <DollarSign className="h-4 w-4 text-amber-500" />
                      <span>Movimentação de Caixa</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Transfira valores entre sua conta bancária pessoal e o caixa da empresa.
                    </p>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      value={capitalAmount}
                      onChange={(e) => setCapitalAmount(e.target.value)}
                      className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                      placeholder="Valor em R$"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            const val = Number(capitalAmount);
                            if (!Number.isFinite(val) || val <= 0) throw new Error('Valor inválido.');
                            const res = await transferBusinessCapital(
                              firebaseUser,
                              business.id,
                              'inject',
                              val
                            );
                            return `Aporte de ${formatBRL(res.amount)} concluído. Novo caixa: ${formatBRL(res.cashBalance)}.`;
                          })
                        }
                        className="min-h-[38px] bg-amber-500 px-3 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                      >
                        Aportar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            const val = Number(capitalAmount);
                            if (!Number.isFinite(val) || val <= 0) throw new Error('Valor inválido.');
                            const res = await transferBusinessCapital(
                              firebaseUser,
                              business.id,
                              'withdraw',
                              val
                            );
                            return `Retirada de ${formatBRL(res.amount)} creditada em sua conta bancária.`;
                          })
                        }
                        className="min-h-[38px] border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
                      >
                        Retirar
                      </button>
                    </div>
                  </div>

                  {/* Operating Expenses */}
                  <div className="space-y-3 border border-white/10 bg-[#121722] p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <ShieldAlert className="h-4 w-4 text-amber-500" />
                      <span>Despesas Operacionais</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Ciclo completo: aluguel, energia, água, manutenção e impostos municipais.
                    </p>
                    <div className="flex items-baseline justify-between border-y border-white/10 py-2 text-xs">
                      <span className="text-slate-400">Custo do ciclo</span>
                      <span className="font-mono font-semibold tabular-nums text-red-400">
                        {formatBRL(business.operatingExpense)}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy || business.status === 'suspended'}
                      onClick={() =>
                        void runAction(async () => {
                          const res = await payBusinessOperatingExpenses(firebaseUser, business.id);
                          if (!res.paid) {
                            return (
                              res.message ??
                              'Caixa insuficiente. Empresa marcada como temporariamente inoperante.'
                            );
                          }
                          return `Despesas operacionais de ${formatBRL(res.amount ?? business.operatingExpense)} quitadas! Reputação atualizada.`;
                        })
                      }
                      className="min-h-[38px] w-full border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      Quitar Ciclo Operacional
                    </button>
                  </div>

                  {/* P2P Business Listing */}
                  <div className="space-y-3 border border-white/10 bg-[#121722] p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <Tag className="h-4 w-4 text-amber-500" />
                      <span>Negociação P2P da Empresa</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {business.forSale
                        ? `Anunciada no mercado por ${formatBRL(business.salePrice)}.`
                        : 'Anuncie sua empresa para outros jogadores comprarem com transferência atômica.'}
                    </p>
                    <input
                      type="number"
                      min={50}
                      step="10"
                      value={salePriceInput}
                      onChange={(e) => setSalePriceInput(e.target.value)}
                      className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                      placeholder="Preço de venda (R$)"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            const p = Number(salePriceInput);
                            if (!Number.isFinite(p) || p < 50) throw new Error('Preço mínimo R$ 50.');
                            await updateBusinessListing(firebaseUser, business.id, true, p);
                            return `Empresa listada para venda por ${formatBRL(p)}.`;
                          })
                        }
                        className="min-h-[38px] bg-emerald-500/20 border border-emerald-500/40 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        Anunciar
                      </button>
                      <button
                        type="button"
                        disabled={busy || !business.forSale}
                        onClick={() =>
                          void runAction(async () => {
                            await updateBusinessListing(firebaseUser, business.id, false, 0);
                            return 'Anúncio de venda removido.';
                          })
                        }
                        className="min-h-[38px] border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-300 hover:bg-white/5 disabled:opacity-40"
                      >
                        Retirar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Business Financial Ledger */}
              <div className="border border-white/10 bg-[#121722] p-5">
                <h4 className="mb-3 text-xs font-semibold tracking-wider text-slate-200 uppercase">
                  Extrato Financeiro da Empresa ({transactions.length})
                </h4>
                {transactions.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhuma movimentação registrada.</p>
                ) : (
                  <div className="divide-y divide-white/5 text-xs">
                    {transactions.slice(0, 20).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-100">{tx.description}</p>
                          <p className="text-[11px] text-slate-400">
                            {getBusinessTxLabel(tx.type)} · {tx.counterpartyLabel} ·{' '}
                            {formatDateTime(tx.createdAt)}
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
              </div>
            </>
          ) : (
            <div className="space-y-4 border border-white/10 bg-[#121722] p-5">
              <h4 className="text-sm font-semibold text-slate-100">Perfil Público do Estabelecimento</h4>
              <p className="text-xs leading-relaxed text-slate-300">{business.description}</p>
              <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs sm:grid-cols-3">
                <div>
                  <span className="text-slate-400">Proprietário</span>
                  <p className="font-semibold text-slate-100">{business.ownerName}</p>
                </div>
                <div>
                  <span className="text-slate-400">Localização 3D</span>
                  <p className="font-mono text-slate-200">
                    X {business.posX} · Z {business.posZ}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">Vínculo Atual</span>
                  <p className="font-semibold text-amber-400">
                    {isEmployee ? 'Você é Funcionário' : 'Visitante / Cliente'}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Por segurança corporativa, o saldo de caixa e o extrato contábil da empresa são
                acessíveis apenas ao proprietário e à administração da cidade.
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: VAGAS & CANDIDATOS */}
      {tab === 'vagas' && (
        <div className="space-y-6">
          {isOwner && (
            <div className="space-y-4 border border-white/10 bg-[#121722] p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <UserPlus className="h-4 w-4" />
                <span>Abrir Nova Vaga de Emprego</span>
              </div>
              {business.templateType === 'concessionaria' && (
                <div className="space-y-1.5 border border-white/10 bg-[#0A0D14] p-3">
                  <p className="text-[11px] text-slate-400">
                    Cargos pré-configurados de Concessionária (clique para preencher):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DEALERSHIP_ROLE_PRESETS.map((preset) => (
                      <button
                        key={preset.roleTitle}
                        type="button"
                        onClick={() => {
                          setVacRole(preset.roleTitle);
                          setVacSalary(String(preset.suggestedSalary));
                          setVacSchedule(preset.schedule);
                          setVacDesc(preset.description);
                        }}
                        className="border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                      >
                        {preset.roleTitle} ({formatBRL(preset.suggestedSalary)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  value={vacRole}
                  onChange={(e) => setVacRole(e.target.value)}
                  placeholder="Cargo (ex: Gerente, Vendedor)"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="number"
                  min={10}
                  value={vacSalary}
                  onChange={(e) => setVacSalary(e.target.value)}
                  placeholder="Salário (R$)"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={vacSlots}
                  onChange={(e) => setVacSlots(e.target.value)}
                  placeholder="Qtd. de vagas"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  value={vacSchedule}
                  onChange={(e) => setVacSchedule(e.target.value)}
                  placeholder="Carga horária"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  value={vacReqs}
                  onChange={(e) => setVacReqs(e.target.value)}
                  placeholder="Requisitos"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500 sm:col-span-2"
                />
                <input
                  type="text"
                  value={vacDesc}
                  onChange={(e) => setVacDesc(e.target.value)}
                  placeholder="Descrição da função"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500 sm:col-span-2"
                />
                <button
                  type="button"
                  disabled={busy || !vacRole.trim()}
                  onClick={() =>
                    void runAction(async () => {
                      await createBusinessVacancy(firebaseUser, business.id, {
                        roleTitle: vacRole.trim(),
                        salary: Number(vacSalary),
                        schedule: vacSchedule.trim(),
                        requirements: vacReqs.trim(),
                        slots: Number(vacSlots),
                        description: vacDesc.trim(),
                      });
                      setVacRole('');
                      return `Vaga para ${vacRole.trim()} publicada no mural de empregos da cidade.`;
                    })
                  }
                  className="min-h-[38px] bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  Publicar Vaga
                </button>
              </div>
            </div>
          )}

          {/* Published Vacancies */}
          <div className="space-y-3 border border-white/10 bg-[#121722] p-5">
            <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
              Vagas Publicadas ({vacancies.length})
            </h4>
            {!isOwner && (
              <div className="mb-2">
                <label className="mb-1 block text-[11px] text-slate-400">
                  Mensagem de apresentação para candidatura
                </label>
                <input
                  type="text"
                  value={applyCoverNote}
                  onChange={(e) => setApplyCoverNote(e.target.value)}
                  className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
              </div>
            )}
            {vacancies.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhuma vaga publicada nesta empresa.</p>
            ) : (
              <div className="space-y-3">
                {vacancies.map((vac) => (
                  <div
                    key={vac.id}
                    className="flex flex-wrap items-center justify-between gap-4 border border-white/10 bg-[#0A0D14] p-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-100">{vac.roleTitle}</p>
                        <span
                          className={`font-mono text-[11px] ${
                            vac.status === 'open' ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          {vac.status === 'open' ? 'Aberta' : 'Encerrada'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">{vac.description}</p>
                      <p className="text-[11px] text-slate-500">
                        {vac.schedule} · Requisitos: {vac.requirements} · Preenchidas:{' '}
                        <span className="font-mono">
                          {vac.filledSlots}/{vac.slots}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold tabular-nums text-amber-400">
                        {formatBRL(vac.salary)}
                      </span>
                      {isOwner ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runAction(async () => {
                              const next = vac.status === 'open' ? 'closed' : 'open';
                              await updateBusinessVacancy(firebaseUser, business.id, vac.id, {
                                status: next,
                              });
                              return next === 'closed' ? 'Vaga encerrada.' : 'Vaga reaberta.';
                            })
                          }
                          className="min-h-[36px] border border-white/15 bg-[#121722] px-3 text-xs font-semibold text-slate-200 hover:bg-white/10"
                        >
                          {vac.status === 'open' ? 'Encerrar' : 'Reabrir'}
                        </button>
                      ) : (
                        vac.status === 'open' &&
                        !isEmployee && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                await applyToBusinessVacancy(
                                  firebaseUser,
                                  business.id,
                                  vac.id,
                                  applyCoverNote
                                );
                                return `Candidatura enviada para ${vac.roleTitle}!`;
                              })
                            }
                            className="min-h-[36px] bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                          >
                            Candidatar-se
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Applications & Offers */}
          <div className="space-y-3 border border-white/10 bg-[#121722] p-5">
            <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
              {isOwner ? `Candidatos & Propostas (${applications.length})` : `Minhas Candidaturas (${applications.length})`}
            </h4>
            {applications.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhuma candidatura registrada.</p>
            ) : (
              <div className="space-y-2.5">
                {applications.map((app) => (
                  <div
                    key={app.id}
                    className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#0A0D14] p-3.5 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-semibold text-slate-100">
                        {app.applicantName}{' '}
                        <span className="font-mono text-amber-400">@{app.applicantAlias}</span> ·{' '}
                        {app.roleTitle}
                      </p>
                      <p className="text-slate-400">{app.coverNote}</p>
                      <p className="text-[11px] text-slate-500">
                        Salário proposto: {formatBRL(app.offeredSalary)} · Status:{' '}
                        <span className="font-semibold text-slate-200 uppercase">{app.status}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isOwner && (app.status === 'pending' || app.status === 'offer_sent') && (
                        <>
                          {app.status === 'pending' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(async () => {
                                  await decideBusinessApplication(
                                    firebaseUser,
                                    business.id,
                                    app.id,
                                    'send_offer'
                                  );
                                  return `Proposta formal enviada para ${app.applicantName}.`;
                                })
                              }
                              className="min-h-[34px] border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                            >
                              Enviar Proposta
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                await decideBusinessApplication(
                                  firebaseUser,
                                  business.id,
                                  app.id,
                                  'hire'
                                );
                                return `${app.applicantName} contratado com sucesso!`;
                              })
                            }
                            className="min-h-[34px] bg-emerald-500 px-3 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                          >
                            Contratar
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                await decideBusinessApplication(
                                  firebaseUser,
                                  business.id,
                                  app.id,
                                  'reject'
                                );
                                return `Candidatura de ${app.applicantName} recusada.`;
                              })
                            }
                            className="min-h-[34px] border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                          >
                            Recusar
                          </button>
                        </>
                      )}

                      {!isOwner && app.applicantUid === firebaseUser.uid && app.status === 'offer_sent' && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                await decideBusinessApplication(
                                  firebaseUser,
                                  business.id,
                                  app.id,
                                  'accept_offer'
                                );
                                return `Proposta aceita! Você agora trabalha em ${business.name}.`;
                              })
                            }
                            className="min-h-[34px] bg-emerald-500 px-3 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                          >
                            Aceitar Proposta
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                await decideBusinessApplication(
                                  firebaseUser,
                                  business.id,
                                  app.id,
                                  'decline_offer'
                                );
                                return 'Proposta recusada.';
                              })
                            }
                            className="min-h-[34px] border border-white/15 px-3 text-xs font-semibold text-slate-300"
                          >
                            Recusar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: EQUIPE & FOLHA SALARIAL */}
      {tab === 'equipe' && (
        <div className="space-y-6">
          <div className="space-y-3 border border-white/10 bg-[#121722] p-5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
                {isOwner
                  ? `Quadro de Funcionários (${activeEmployees.length} ativos)`
                  : 'Meu Contrato nesta Empresa'}
              </h4>
              {finances && (
                <span className="font-mono text-xs text-amber-400 tabular-nums">
                  Caixa disponível: {formatBRL(finances.cashBalance)}
                </span>
              )}
            </div>

            {employees.length === 0 ? (
              <p className="text-xs text-slate-400">
                {isOwner
                  ? 'Nenhum funcionário contratado ainda. Abra uma vaga na aba Vagas & Candidatos.'
                  : 'Você não possui contrato ativo nesta empresa.'}
              </p>
            ) : (
              <div className="space-y-3">
                {employees.map((emp) => {
                  const isEditing = editingContractId === emp.id;
                  return (
                    <div
                      key={emp.id}
                      className="space-y-3 border border-white/10 bg-[#0A0D14] p-4 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">
                            {emp.employeeName}{' '}
                            <span className="font-mono text-xs text-amber-400">
                              @{emp.employeeAlias}
                            </span>
                          </p>
                          <p className="text-slate-400">
                            Cargo: <span className="text-slate-200">{emp.roleTitle}</span> ·{' '}
                            {emp.schedule} · Status:{' '}
                            <span
                              className={
                                emp.status === 'active'
                                  ? 'font-semibold text-emerald-400'
                                  : 'text-slate-500'
                              }
                            >
                              {emp.status === 'active'
                                ? 'Ativo'
                                : emp.status === 'resigned'
                                ? 'Pediu Demissão'
                                : 'Demitido'}
                            </span>
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Pagamentos: {emp.paymentsCount} · Total pago:{' '}
                            <span className="font-mono text-slate-300">
                              {formatBRL(emp.totalPaid)}
                            </span>
                            {emp.lastPaidAt ? ` · Último: ${formatDateTime(emp.lastPaidAt)}` : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mr-1 font-mono text-sm font-semibold tabular-nums text-amber-400">
                            {formatBRL(emp.salary)}
                          </span>

                          {isOwner && emp.status === 'active' && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void runAction(async () => {
                                    const res = await payEmployeeSalary(
                                      firebaseUser,
                                      business.id,
                                      emp.id
                                    );
                                    return `Salário de ${formatBRL(res.amount)} pago a ${res.employeeName} via caixa da empresa. Novo caixa: ${formatBRL(res.businessCashBalance)}.`;
                                  })
                                }
                                className="min-h-[36px] bg-emerald-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                              >
                                Pagar Salário
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingContractId(isEditing ? null : emp.id);
                                  setEditRole(emp.roleTitle);
                                  setEditSalary(String(emp.salary));
                                }}
                                className="min-h-[36px] border border-white/15 bg-[#121722] px-3 text-xs font-semibold text-slate-200 hover:bg-white/10"
                              >
                                Promover / Editar
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void runAction(async () => {
                                    await updateEmployeeContract(firebaseUser, business.id, emp.id, {
                                      action: 'terminate',
                                    });
                                    return `${emp.employeeName} desligado da empresa.`;
                                  })
                                }
                                className="min-h-[36px] border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                              >
                                Demitir
                              </button>
                            </>
                          )}

                          {!isOwner &&
                            emp.employeeUid === firebaseUser.uid &&
                            emp.status === 'active' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void runAction(async () => {
                                    await updateEmployeeContract(firebaseUser, business.id, emp.id, {
                                      action: 'resign',
                                    });
                                    return 'Você pediu demissão e encerrou seu contrato.';
                                  })
                                }
                                className="inline-flex min-h-[36px] items-center gap-1.5 border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                              >
                                <LogOut className="h-3.5 w-3.5" />
                                <span>Pedir Demissão</span>
                              </button>
                            )}
                        </div>
                      </div>

                      {isOwner && isEditing && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                          <input
                            type="text"
                            value={editRole}
                            onChange={(e) => setEditRole(e.target.value)}
                            placeholder="Novo cargo"
                            className="border border-white/15 bg-[#121722] px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-500"
                          />
                          <input
                            type="number"
                            min={10}
                            value={editSalary}
                            onChange={(e) => setEditSalary(e.target.value)}
                            placeholder="Novo salário"
                            className="w-32 border border-white/15 bg-[#121722] px-3 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                await updateEmployeeContract(firebaseUser, business.id, emp.id, {
                                  action: 'update',
                                  roleTitle: editRole.trim(),
                                  salary: Number(editSalary),
                                });
                                setEditingContractId(null);
                                return `Contrato de ${emp.employeeName} atualizado.`;
                              })
                            }
                            className="min-h-[34px] bg-amber-500 px-3 text-xs font-semibold text-slate-950"
                          >
                            Salvar Alteração
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payroll History */}
          <div className="border border-white/10 bg-[#121722] p-5">
            <h4 className="mb-3 text-xs font-semibold tracking-wider text-slate-200 uppercase">
              Histórico de Pagamentos Salariais ({payroll.length})
            </h4>
            {payroll.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum pagamento de folha registrado ainda.</p>
            ) : (
              <div className="divide-y divide-white/5 text-xs">
                {payroll.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-medium text-slate-100">
                        {p.employeeName} · <span className="text-slate-400">{p.roleTitle}</span>
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">
                        {p.id} · {formatDateTime(p.paidAt)}
                      </p>
                    </div>
                    <span className="font-mono font-semibold tabular-nums text-emerald-400">
                      {formatBRL(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: ESTOQUE & COMERCIALIZAÇÃO */}
      {tab === 'estoque' && (
        <div className="space-y-6">
          {isOwner && (
            <div className="space-y-3 border border-white/10 bg-[#121722] p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <Plus className="h-4 w-4" />
                <span>Cadastrar Novo Produto / Serviço</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <input
                  type="text"
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="Nome do produto"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500 sm:col-span-2"
                />
                <input
                  type="text"
                  value={prodSku}
                  onChange={(e) => setProdSku(e.target.value)}
                  placeholder="SKU (ex: PRD-03)"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="number"
                  min={1}
                  value={prodCost}
                  onChange={(e) => setProdCost(e.target.value)}
                  placeholder="Custo unit."
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="number"
                  min={1}
                  value={prodPrice}
                  onChange={(e) => setProdPrice(e.target.value)}
                  placeholder="Preço venda"
                  className="border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <input
                  type="text"
                  value={prodCat}
                  onChange={(e) => setProdCat(e.target.value)}
                  placeholder="Categoria"
                  className="w-52 border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  disabled={busy || !prodName.trim()}
                  onClick={() =>
                    void runAction(async () => {
                      await createBusinessProduct(firebaseUser, business.id, {
                        name: prodName.trim(),
                        sku: prodSku.trim() || `SKU-${Math.floor(100 + Math.random() * 899)}`,
                        category: prodCat.trim() || 'Comercial',
                        unitCost: Number(prodCost),
                        salePrice: Number(prodPrice),
                      });
                      setProdName('');
                      setProdSku('');
                      return `Produto ${prodName.trim()} cadastrado no estoque da empresa.`;
                    })
                  }
                  className="min-h-[38px] bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  Cadastrar Produto
                </button>
              </div>
            </div>
          )}

          {/* Product & Inventory Table */}
          <div className="space-y-3 border border-white/10 bg-[#121722] p-5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
                Catálogo, Margem e Estoque ({products.length})
              </h4>
              {finances && (
                <span className="font-mono text-xs text-amber-400 tabular-nums">
                  Caixa: {formatBRL(finances.cashBalance)}
                </span>
              )}
            </div>

            {products.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum produto cadastrado.</p>
            ) : (
              <div className="space-y-3">
                {products.map((prod) => {
                  const inv = inventoryMap.get(prod.id);
                  const qty = inv?.quantity ?? 0;
                  const qtyVal = stockQtyByProd[prod.id] ?? '2';
                  const priceVal = priceEditByProd[prod.id] ?? String(prod.salePrice);

                  return (
                    <div
                      key={prod.id}
                      className="space-y-3 border border-white/10 bg-[#0A0D14] p-4 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-100">
                            {prod.name}{' '}
                            <span className="font-mono text-[11px] text-slate-500">
                              [{prod.sku}]
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {prod.category} · Custo: {formatBRL(prod.unitCost)} · Margem:{' '}
                            <span className="font-mono text-emerald-400">
                              +{prod.marginPercent.toFixed(0)}%
                            </span>{' '}
                            · Faixa permitida: {formatBRL(prod.minAllowedPrice)}–
                            {formatBRL(prod.maxAllowedPrice)}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="font-mono text-base font-semibold tabular-nums text-amber-400">
                            {formatBRL(prod.salePrice)}
                          </p>
                          <p className="font-mono text-[11px] text-slate-300 tabular-nums">
                            Estoque: {qty} un.
                          </p>
                        </div>
                      </div>

                      {isOwner && (
                        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
                          <input
                            type="number"
                            min={1}
                            max={200}
                            value={qtyVal}
                            onChange={(e) =>
                              setStockQtyByProd((prev) => ({ ...prev, [prod.id]: e.target.value }))
                            }
                            className="w-20 border border-white/15 bg-[#121722] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                            aria-label="Quantidade"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                const q = Math.floor(Number(qtyVal));
                                const res = await restockBusinessInventory(
                                  firebaseUser,
                                  business.id,
                                  prod.id,
                                  q
                                );
                                return `Reposição de ${q}x ${prod.name} concluída (-${formatBRL(res.totalCost)}). Estoque: ${res.newQuantity}.`;
                              })
                            }
                            className="min-h-[34px] border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                          >
                            Comprar Estoque
                          </button>
                          <button
                            type="button"
                            disabled={busy || qty <= 0}
                            onClick={() =>
                              void runAction(async () => {
                                const q = Math.floor(Number(qtyVal));
                                const res = await sellBusinessInventory(
                                  firebaseUser,
                                  business.id,
                                  prod.id,
                                  q
                                );
                                return `Venda de ${q}x ${prod.name} registrada (+${formatBRL(res.revenue)} em caixa)!`;
                              })
                            }
                            className="inline-flex min-h-[34px] items-center gap-1.5 bg-emerald-500 px-3 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                            <span>Vender</span>
                          </button>

                          <div className="ml-auto flex items-center gap-1.5">
                            <input
                              type="number"
                              step="0.5"
                              value={priceVal}
                              onChange={(e) =>
                                setPriceEditByProd((prev) => ({
                                  ...prev,
                                  [prod.id]: e.target.value,
                                }))
                              }
                              className="w-24 border border-white/15 bg-[#121722] px-2.5 py-1.5 font-mono text-xs text-slate-100"
                              aria-label="Preço de venda"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(async () => {
                                  await updateBusinessProduct(firebaseUser, business.id, prod.id, {
                                    salePrice: Number(priceVal),
                                  });
                                  return `Preço de ${prod.name} atualizado para ${formatBRL(Number(priceVal))}.`;
                                })
                              }
                              className="min-h-[34px] border border-white/15 bg-[#121722] px-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
                            >
                              Ajustar Preço
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: REPUTAÇÃO & AVALIAÇÕES */}
      {tab === 'reputacao' && (
        <div className="space-y-6">
          <div className="border border-white/10 bg-[#121722] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs text-slate-400">Índice de Reputação Empresarial</p>
                <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-emerald-400">
                  {business.reputation}{' '}
                  <span className="text-sm font-normal text-slate-400">/ 100</span>
                </p>
                <p className="text-xs text-slate-300">
                  Classificação: {getReputationTier(business.reputation)} ·{' '}
                  {business.reputationCount} avaliação(ões) de clientes
                </p>
              </div>
              <div className="max-w-xs text-xs text-slate-400">
                A reputação evolui com contratações ativas, pontualidade na folha salarial, vendas
                regulares, despesas quitadas e avaliações de cidadãos.
              </div>
            </div>
          </div>

          {!isOwner && (
            <div className="space-y-3 border border-white/10 bg-[#121722] p-5">
              <h4 className="text-xs font-semibold tracking-wider text-amber-400 uppercase">
                Avaliar Estabelecimento
              </h4>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setReviewRating(star)}
                    className={`min-h-[36px] min-w-[36px] border font-mono text-xs font-semibold ${
                      reviewRating >= star
                        ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                        : 'border-white/15 bg-[#0A0D14] text-slate-500'
                    }`}
                  >
                    {star}★
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Compartilhe sua experiência com este estabelecimento..."
                  className="min-w-[220px] flex-1 border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  disabled={busy || reviewComment.trim().length < 3}
                  onClick={() =>
                    void runAction(async () => {
                      await submitBusinessReview(
                        firebaseUser,
                        business.id,
                        reviewRating,
                        reviewComment.trim()
                      );
                      setReviewComment('');
                      return 'Avaliação registrada! A reputação da empresa foi atualizada.';
                    })
                  }
                  className="min-h-[38px] bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  Enviar Avaliação
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3 border border-white/10 bg-[#121722] p-5">
            <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
              Avaliações Recentes ({reviews.length})
            </h4>
            {reviews.length === 0 ? (
              <p className="text-xs text-slate-400">Ainda não há avaliações de clientes.</p>
            ) : (
              <div className="divide-y divide-white/5 text-xs">
                {reviews.map((rev) => (
                  <div key={rev.id} className="py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-100">{rev.authorName}</span>
                      <span className="font-mono text-amber-400">{rev.rating}/5 ★</span>
                    </div>
                    <p className="mt-1 text-slate-300">{rev.comment}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
