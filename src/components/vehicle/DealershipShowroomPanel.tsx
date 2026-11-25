import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Car,
  CheckCircle2,
  DollarSign,
  Eye,
  Fuel,
  Gauge,
  Percent,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL } from '../../config/economyCatalog';
import {
  VEHICLE_CATEGORIES,
  VEHICLE_CATEGORY_LABELS,
  computeDiscountedPrice,
  getConditionLabel,
} from '../../config/vehicleCatalog';
import {
  buyVehicleFromDealership,
  fetchDealershipShowroom,
  payDealershipCommission,
  restockDealershipVehicle,
  updateDealershipStockUnit,
} from '../../services/vehicleService';
import type {
  DealershipShowroomPayload,
  DealershipStockItem,
  VehicleCategory,
} from '../../types/vehicle';
import { VehicleCardImage } from './VehicleCardImage';

interface DealershipShowroomPanelProps {
  businessId: string;
  onRefreshParent?: () => void;
}

export function DealershipShowroomPanel({
  businessId,
  onRefreshParent,
}: DealershipShowroomPanelProps) {
  const { firebaseUser, vehicleCatalog, bankAccount } = useGame();
  const [data, setData] = useState<DealershipShowroomPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'all' | VehicleCategory>('all');
  const [ownerSection, setOwnerSection] = useState<'showroom' | 'comprar_estoque' | 'comissoes'>(
    'showroom'
  );
  const [inspectingItem, setInspectingItem] = useState<DealershipStockItem | null>(null);
  const [confirmingBuyItem, setConfirmingBuyItem] = useState<DealershipStockItem | null>(null);

  // Restock form state (owner only)
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [stockSalePrice, setStockSalePrice] = useState<string>('');
  const [stockPromo, setStockPromo] = useState<string>('0');
  const [stockComm, setStockComm] = useState<string>('0');
  const [stockSellerUid, setStockSellerUid] = useState<string>('none');

  // Inline edit state for existing stock unit
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState<string>('');
  const [editPromo, setEditPromo] = useState<string>('0');
  const [editComm, setEditComm] = useState<string>('0');
  const [editSellerUid, setEditSellerUid] = useState<string>('none');

  const loadShowroom = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const payload = await fetchDealershipShowroom(firebaseUser, businessId);
      setData(payload);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao carregar showroom da concessionária.',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, businessId]);

  useEffect(() => {
    void loadShowroom();
  }, [loadShowroom]);

  const activeModels = useMemo(
    () => vehicleCatalog.filter((m) => m.active),
    [vehicleCatalog]
  );

  useEffect(() => {
    if (!selectedModelId && activeModels.length > 0) {
      const first = activeModels[0];
      setSelectedModelId(first.id);
      setStockSalePrice(String(first.marketValue));
    }
  }, [activeModels, selectedModelId]);

  const selectedModel = useMemo(
    () => activeModels.find((m) => m.id === selectedModelId) ?? null,
    [activeModels, selectedModelId]
  );

  const filteredAvailableStock = useMemo(() => {
    const items = data?.availableStock ?? [];
    if (categoryFilter === 'all') return items;
    return items.filter((item) => item.category === categoryFilter);
  }, [data?.availableStock, categoryFilter]);

  const runAction = async (fn: () => Promise<string>) => {
    setFeedback(null);
    setBusy(true);
    try {
      const msg = await fn();
      setFeedback({ type: 'ok', text: msg });
      await loadShowroom();
      onRefreshParent?.();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro na operação da concessionária.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openStockEditor = (item: DealershipStockItem) => {
    setEditingStockId(item.id);
    setEditPrice(String(item.salePrice));
    setEditPromo(String(item.promoDiscountPercent));
    setEditComm(String(item.commissionPercent));
    setEditSellerUid(item.assignedSellerUid || 'none');
  };

  if (loading && !data) {
    return (
      <div className="border border-white/10 bg-[#121722] p-8 text-center text-xs text-slate-400">
        Carregando showroom de veículos...
      </div>
    );
  }

  if (!data || !firebaseUser) {
    return (
      <div className="border border-white/10 bg-[#121722] p-6 text-xs text-red-300">
        {feedback?.text ?? 'Showroom indisponível.'}
      </div>
    );
  }

  const { business, isOwner, finances, stats, activeEmployees, commissions, soldStock } = data;
  const buyerBalance = bankAccount?.balance ?? 0;

  return (
    <div className="space-y-6">
      {/* Top Showroom Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Veículos no Showroom</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-50">
            {stats.availableCount}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">
            {isOwner ? 'Caixa da Concessionária' : 'Seu Saldo Bancário'}
          </p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-400">
            {formatBRL(isOwner ? finances?.cashBalance ?? 0 : buyerBalance)}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">
            {isOwner ? 'Veículos Vendidos' : 'Proprietário'}
          </p>
          <p className="mt-1 truncate font-mono text-base font-semibold tabular-nums text-emerald-400">
            {isOwner ? `${stats.soldCount} un.` : business.ownerName}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">
            {isOwner ? 'Faturamento em Veículos' : 'Status da Loja'}
          </p>
          <p className="mt-1 font-mono text-base font-semibold tabular-nums text-slate-100">
            {isOwner
              ? formatBRL(stats.totalVehicleRevenue)
              : business.status === 'active'
              ? 'Funcionando'
              : 'Restrito'}
          </p>
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

      {/* Owner Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOwnerSection('showroom')}
            className={`inline-flex min-h-[36px] items-center gap-1.5 px-3 text-xs font-semibold ${
              ownerSection === 'showroom'
                ? 'bg-amber-500 text-slate-950'
                : 'border border-white/10 bg-[#0A0D14] text-slate-300 hover:bg-white/5'
            }`}
          >
            <Car className="h-3.5 w-3.5" />
            <span>Showroom ({stats.availableCount})</span>
          </button>

          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => setOwnerSection('comprar_estoque')}
                className={`inline-flex min-h-[36px] items-center gap-1.5 px-3 text-xs font-semibold ${
                  ownerSection === 'comprar_estoque'
                    ? 'bg-amber-500 text-slate-950'
                    : 'border border-white/10 bg-[#0A0D14] text-slate-300 hover:bg-white/5'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Comprar Estoque</span>
              </button>

              <button
                type="button"
                onClick={() => setOwnerSection('comissoes')}
                className={`inline-flex min-h-[36px] items-center gap-1.5 px-3 text-xs font-semibold ${
                  ownerSection === 'comissoes'
                    ? 'bg-amber-500 text-slate-950'
                    : 'border border-white/10 bg-[#0A0D14] text-slate-300 hover:bg-white/5'
                }`}
              >
                <Percent className="h-3.5 w-3.5" />
                <span>Vendas & Comissões ({commissions.length})</span>
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => void loadShowroom()}
          disabled={loading}
          className="inline-flex min-h-[36px] items-center gap-1.5 border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-300 hover:bg-white/5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar</span>
        </button>
      </div>

      {/* SECTION 1: SHOWROOM CATALOG */}
      {ownerSection === 'showroom' && (
        <div className="space-y-4">
          {/* Category Filter Strip */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`min-h-[32px] shrink-0 px-3 text-[11px] font-semibold uppercase tracking-wider ${
                categoryFilter === 'all'
                  ? 'border border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border border-white/10 bg-[#0A0D14] text-slate-400 hover:text-slate-100'
              }`}
            >
              Todos ({data.availableStock.length})
            </button>
            {VEHICLE_CATEGORIES.map((cat) => {
              const count = data.availableStock.filter((i) => i.category === cat).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`min-h-[32px] shrink-0 px-3 text-[11px] font-semibold uppercase tracking-wider ${
                    categoryFilter === cat
                      ? 'border border-amber-500/50 bg-amber-500/15 text-amber-300'
                      : 'border border-white/10 bg-[#0A0D14] text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {VEHICLE_CATEGORY_LABELS[cat]} ({count})
                </button>
              );
            })}
          </div>

          {filteredAvailableStock.length === 0 ? (
            <div className="border border-white/10 bg-[#121722] p-8 text-center">
              <Car className="mx-auto h-8 w-8 text-slate-500" />
              <p className="mt-2 text-sm font-semibold text-slate-200">
                Nenhum veículo disponível no showroom neste momento.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {isOwner
                  ? 'Clique em "Comprar Estoque" para adquirir veículos do catálogo oficial usando o caixa da concessionária.'
                  : 'Aguarde o proprietário reabastecer o pátio ou visite outra concessionária.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredAvailableStock.map((item) => {
                const isEditing = editingStockId === item.id;
                const canAfford = buyerBalance >= item.finalPrice;
                const hasPromo = item.promoDiscountPercent > 0;

                return (
                  <article
                    key={item.id}
                    className="group flex flex-col border border-white/10 bg-[#121722]"
                  >
                    <VehicleCardImage
                      category={item.imageKey}
                      alt={`${item.manufacturer} ${item.model}`}
                      promoPercent={item.promoDiscountPercent}
                    />

                    <div className="flex flex-1 flex-col justify-between p-4">
                      <div className="space-y-3">
                        {/* Title & Price */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                              {item.manufacturer} · {item.year}
                            </p>
                            <h4 className="truncate font-display text-xl font-bold tracking-wide text-slate-50">
                              {item.model}
                            </h4>
                          </div>
                          <div className="shrink-0 text-right">
                            {hasPromo && (
                              <p className="font-mono text-[11px] text-slate-500 line-through tabular-nums">
                                {formatBRL(item.salePrice)}
                              </p>
                            )}
                            <p className="font-mono text-lg font-bold tabular-nums text-amber-400">
                              {formatBRL(item.finalPrice)}
                            </p>
                          </div>
                        </div>

                        {/* Technical Specs Grid */}
                        <div className="grid grid-cols-4 gap-2 border-y border-white/10 py-2.5 text-[11px]">
                          <div>
                            <span className="flex items-center gap-1 text-slate-500">
                              <Gauge className="h-3 w-3" /> Vel.
                            </span>
                            <span className="font-mono font-medium text-slate-200">
                              {item.topSpeed} km/h
                            </span>
                          </div>
                          <div>
                            <span className="flex items-center gap-1 text-slate-500">
                              <Zap className="h-3 w-3" /> Acel.
                            </span>
                            <span className="font-mono font-medium text-slate-200">
                              {item.acceleration.toFixed(1)}/10
                            </span>
                          </div>
                          <div>
                            <span className="flex items-center gap-1 text-slate-500">
                              <Users className="h-3 w-3" /> Lug.
                            </span>
                            <span className="font-mono font-medium text-slate-200">
                              {item.capacity}
                            </span>
                          </div>
                          <div>
                            <span className="flex items-center gap-1 text-slate-500">
                              <Fuel className="h-3 w-3" /> Cons.
                            </span>
                            <span className="font-mono font-medium text-slate-200">
                              {item.fuelConsumption} L
                            </span>
                          </div>
                        </div>

                        {/* Metadata line */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                          <span>
                            Condição:{' '}
                            <strong className="text-emerald-400">
                              {item.condition}% ({getConditionLabel(item.condition)})
                            </strong>
                          </span>
                          <span>
                            Concessionária: <strong className="text-slate-200">{item.businessName}</strong>
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>Proprietário: {item.ownerName}</span>
                          {item.assignedSellerUid !== 'none' && (
                            <span>
                              Vendedor: <span className="text-slate-300">{item.assignedSellerName}</span> (
                              {item.commissionPercent}%)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Inline Owner Editor */}
                      {isOwner && isEditing && (
                        <div className="mt-4 space-y-2.5 border-t border-white/10 pt-3 text-xs">
                          <div className="grid grid-cols-3 gap-2">
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">Preço (R$)</span>
                              <input
                                type="number"
                                value={editPrice}
                                onChange={(e) => setEditPrice(e.target.value)}
                                className="w-full border border-white/15 bg-[#0A0D14] px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">Promo (%)</span>
                              <input
                                type="number"
                                min={0}
                                max={35}
                                value={editPromo}
                                onChange={(e) => setEditPromo(e.target.value)}
                                className="w-full border border-white/15 bg-[#0A0D14] px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[10px] text-slate-400">Comissão (%)</span>
                              <input
                                type="number"
                                min={0}
                                max={35}
                                value={editComm}
                                onChange={(e) => setEditComm(e.target.value)}
                                className="w-full border border-white/15 bg-[#0A0D14] px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                              />
                            </label>
                          </div>
                          {activeEmployees.length > 0 && (
                            <label className="block space-y-1">
                              <span className="text-[10px] text-slate-400">Vendedor Responsável</span>
                              <select
                                value={editSellerUid}
                                onChange={(e) => setEditSellerUid(e.target.value)}
                                className="w-full border border-white/15 bg-[#0A0D14] px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-500"
                              >
                                <option value="none">Showroom Direto (sem comissão)</option>
                                {activeEmployees.map((emp) => (
                                  <option key={emp.id} value={emp.employeeUid}>
                                    {emp.employeeName} — {emp.roleTitle}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(async () => {
                                  await updateDealershipStockUnit(
                                    firebaseUser,
                                    businessId,
                                    item.id,
                                    {
                                      salePrice: Number(editPrice),
                                      promoDiscountPercent: Number(editPromo),
                                      commissionPercent: Number(editComm),
                                      assignedSellerUid: editSellerUid,
                                    }
                                  );
                                  setEditingStockId(null);
                                  return `Preço e condições de ${item.manufacturer} ${item.model} atualizados.`;
                                })
                              }
                              className="min-h-[34px] flex-1 bg-amber-500 px-3 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                            >
                              Salvar Alterações
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingStockId(null)}
                              className="min-h-[34px] border border-white/15 px-3 text-xs text-slate-300"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {/* CTA Footer */}
                      <div className="mt-4 pt-3 border-t border-white/10">
                        {isOwner ? (
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] text-slate-400">
                              Custo: {formatBRL(item.purchaseCost)}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openStockEditor(item)}
                                className="min-h-[34px] border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-200 hover:bg-white/5"
                              >
                                Preço / Promo
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void runAction(async () => {
                                    await updateDealershipStockUnit(
                                      firebaseUser,
                                      businessId,
                                      item.id,
                                      { status: 'removed' }
                                    );
                                    return `${item.manufacturer} ${item.model} retirado da vitrine.`;
                                  })
                                }
                                title="Retirar do showroom"
                                className="inline-flex min-h-[34px] items-center justify-center border border-red-500/35 bg-red-500/10 px-2.5 text-red-300 hover:bg-red-500/20"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setInspectingItem(item)}
                              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/5"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Detalhes</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy || business.status === 'suspended'}
                              onClick={() => setConfirmingBuyItem(item)}
                              className={`inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 px-4 text-xs font-bold tracking-wider uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                                canAfford
                                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                                  : 'border border-red-500/35 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                              }`}
                            >
                              <ShoppingCart className="h-4 w-4" />
                              <span>
                                {canAfford
                                  ? `INICIAR COMPRA · ${formatBRL(item.finalPrice)}`
                                  : `Saldo Insuficiente (${formatBRL(item.finalPrice)})`}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: OWNER RESTOCK FROM OFFICIAL CATALOG */}
      {isOwner && ownerSection === 'comprar_estoque' && (
        <div className="space-y-5 border border-white/10 bg-[#121722] p-5">
          <div>
            <h4 className="text-sm font-semibold text-slate-100">
              Aquisição de Veículos da Montadora (Pago via Caixa da Concessionária)
            </h4>
            <p className="mt-0.5 text-xs text-slate-400">
              Saldo atual do caixa empresarial:{' '}
              <span className="font-mono font-semibold text-amber-400">
                {formatBRL(finances?.cashBalance ?? 0)}
              </span>
              . Selecione um modelo homologado e defina o preço de venda no showroom.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="block space-y-1 text-xs">
                <span className="text-slate-300">Modelo do Catálogo Oficial ({activeModels.length})</span>
                <select
                  value={selectedModelId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedModelId(nextId);
                    const found = activeModels.find((m) => m.id === nextId);
                    if (found) {
                      setStockSalePrice(String(found.marketValue));
                    }
                  }}
                  className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2.5 text-xs text-slate-100 outline-none focus:border-amber-500"
                >
                  {activeModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      [{VEHICLE_CATEGORY_LABELS[m.category]}] {m.manufacturer} {m.model} ({m.year}) — Custo:{' '}
                      {formatBRL(m.basePrice)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedModel && (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <label className="space-y-1">
                    <span className="text-slate-400">
                      Preço de Venda (faixa: {formatBRL(selectedModel.basePrice * selectedModel.minPriceMultiplier)} –{' '}
                      {formatBRL(selectedModel.basePrice * selectedModel.maxPriceMultiplier)})
                    </span>
                    <input
                      type="number"
                      min={selectedModel.basePrice * selectedModel.minPriceMultiplier}
                      max={selectedModel.basePrice * selectedModel.maxPriceMultiplier}
                      step="5"
                      value={stockSalePrice}
                      onChange={(e) => setStockSalePrice(e.target.value)}
                      className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-slate-400">Desconto Promocional (0–35%)</span>
                    <input
                      type="number"
                      min={0}
                      max={35}
                      value={stockPromo}
                      onChange={(e) => setStockPromo(e.target.value)}
                      className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-slate-400">
                      Vendedor Atribuído (Opcional)
                    </span>
                    <select
                      value={stockSellerUid}
                      onChange={(e) => setStockSellerUid(e.target.value)}
                      className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                    >
                      <option value="none">Showroom Direto</option>
                      {activeEmployees.map((emp) => (
                        <option key={emp.id} value={emp.employeeUid}>
                          {emp.employeeName} ({emp.roleTitle})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-slate-400">
                      Comissão Vendedor (máx {selectedModel.maxCommissionPercent}%)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={selectedModel.maxCommissionPercent}
                      value={stockComm}
                      onChange={(e) => setStockComm(e.target.value)}
                      className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                    />
                  </label>
                </div>
              )}

              {selectedModel && (
                <button
                  type="button"
                  disabled={busy || (finances?.cashBalance ?? 0) < selectedModel.basePrice}
                  onClick={() =>
                    void runAction(async () => {
                      const res = await restockDealershipVehicle(firebaseUser, businessId, {
                        modelId: selectedModel.id,
                        salePrice: Number(stockSalePrice),
                        promoDiscountPercent: Number(stockPromo),
                        commissionPercent: Number(stockComm),
                        assignedSellerUid: stockSellerUid,
                      });
                      setOwnerSection('showroom');
                      return `${selectedModel.manufacturer} ${selectedModel.model} adicionado ao showroom por ${formatBRL(res.stock.finalPrice)}. Novo caixa: ${formatBRL(res.cashBalance)}.`;
                    })
                  }
                  className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-45"
                >
                  <Plus className="h-4 w-4" />
                  <span>
                    Adquirir para Estoque ({formatBRL(selectedModel.basePrice)})
                  </span>
                </button>
              )}
            </div>

            {selectedModel && (
              <div className="border border-white/10 bg-[#0A0D14]">
                <VehicleCardImage
                  category={selectedModel.imageKey}
                  alt={`${selectedModel.manufacturer} ${selectedModel.model}`}
                  promoPercent={Number(stockPromo) || 0}
                />
                <div className="space-y-2 p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-lg font-bold text-slate-100">
                      {selectedModel.manufacturer} {selectedModel.model}
                    </span>
                    <span className="font-mono text-sm font-semibold text-amber-400">
                      Vitrine:{' '}
                      {formatBRL(
                        computeDiscountedPrice(
                          Number(stockSalePrice) || selectedModel.marketValue,
                          Number(stockPromo) || 0
                        )
                      )}
                    </span>
                  </div>
                  <p className="text-slate-400">{selectedModel.description}</p>
                  <div className="flex flex-wrap gap-4 border-t border-white/10 pt-2 font-mono text-[11px] text-slate-300">
                    <span>Custo: {formatBRL(selectedModel.basePrice)}</span>
                    <span>Vel: {selectedModel.topSpeed} km/h</span>
                    <span>Acel: {selectedModel.acceleration}/10</span>
                    <span>Cap: {selectedModel.capacity}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: OWNER COMMISSIONS & SALES HISTORY */}
      {isOwner && ownerSection === 'comissoes' && (
        <div className="space-y-5">
          {/* Commissions Queue */}
          <div className="border border-white/10 bg-[#121722] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-slate-100">
                  Comissões de Vendedores ({commissions.length})
                </h4>
                <p className="text-xs text-slate-400">
                  Pagamentos debitam o caixa da concessionária e creditam diretamente a conta
                  bancária do funcionário.
                </p>
              </div>
              <span className="font-mono text-xs text-amber-400">
                Pendente: {formatBRL(stats.pendingCommissionsAmount)}
              </span>
            </div>

            {commissions.length === 0 ? (
              <p className="mt-4 text-xs text-slate-400">
                Nenhuma comissão registrada ainda. Atribua um vendedor contratado ao estocar ou
                editar um veículo.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-white/10 text-xs">
                {commissions.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="font-semibold text-slate-100">
                        {c.sellerName} · {c.vehicleLabel}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Venda: {formatBRL(c.salePrice)} · Comissão {c.commissionPercent}% · Status:{' '}
                        <strong
                          className={
                            c.status === 'paid' ? 'text-emerald-400' : 'text-amber-400'
                          }
                        >
                          {c.status === 'paid' ? 'Paga' : 'Pendente'}
                        </strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-semibold text-amber-400">
                        {formatBRL(c.commissionAmount)}
                      </span>
                      {c.status === 'pending' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runAction(async () => {
                              const res = await payDealershipCommission(
                                firebaseUser,
                                businessId,
                                c.id
                              );
                              return `Comissão de ${formatBRL(res.paidAmount)} paga para ${c.sellerName}.`;
                            })
                          }
                          className="inline-flex min-h-[34px] items-center gap-1.5 bg-emerald-500 px-3 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                        >
                          <DollarSign className="h-3.5 w-3.5" />
                          <span>Pagar Comissão</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sold Units Summary */}
          <div className="border border-white/10 bg-[#121722] p-5">
            <h4 className="text-sm font-semibold text-slate-100">
              Veículos Vendidos ({soldStock.length})
            </h4>
            {soldStock.length === 0 ? (
              <p className="mt-3 text-xs text-slate-400">Nenhuma venda registrada ainda.</p>
            ) : (
              <div className="mt-3 divide-y divide-white/10 text-xs">
                {soldStock.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-medium text-slate-100">
                        {s.manufacturer} {s.model} ({s.year})
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Custo {formatBRL(s.purchaseCost)} · Vendedor: {s.assignedSellerName}
                      </p>
                    </div>
                    <span className="font-mono font-semibold text-emerald-400">
                      + {formatBRL(s.finalPrice)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* VEHICLE DETAILS INSPECTION MODAL */}
      {inspectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-xl border border-white/15 bg-[#101520] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-amber-400">
                  Ficha Técnica · {VEHICLE_CATEGORY_LABELS[inspectingItem.category]}
                </p>
                <h4 className="font-display text-2xl font-bold text-slate-50">
                  {inspectingItem.manufacturer} {inspectingItem.model} ({inspectingItem.year})
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setInspectingItem(null)}
                className="flex h-9 w-9 items-center justify-center border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-100"
                aria-label="Fechar detalhes"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <VehicleCardImage
                category={inspectingItem.imageKey}
                alt={`${inspectingItem.manufacturer} ${inspectingItem.model}`}
                promoPercent={inspectingItem.promoDiscountPercent}
              />

              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <div className="border border-white/10 bg-[#0A0D14] p-3">
                  <p className="text-[10px] text-slate-500">Velocidade Máx.</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-100">
                    {inspectingItem.topSpeed} km/h
                  </p>
                </div>
                <div className="border border-white/10 bg-[#0A0D14] p-3">
                  <p className="text-[10px] text-slate-500">Aceleração</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-100">
                    {inspectingItem.acceleration.toFixed(1)} / 10
                  </p>
                </div>
                <div className="border border-white/10 bg-[#0A0D14] p-3">
                  <p className="text-[10px] text-slate-500">Capacidade</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-100">
                    {inspectingItem.capacity} lugares
                  </p>
                </div>
                <div className="border border-white/10 bg-[#0A0D14] p-3">
                  <p className="text-[10px] text-slate-500">Consumo</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-100">
                    {inspectingItem.fuelConsumption} L/100km
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 border border-white/10 bg-[#0A0D14] p-3.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Concessionária Responsável</span>
                  <span className="font-semibold text-slate-100">{inspectingItem.businessName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Condição do Veículo</span>
                  <span className="font-semibold text-emerald-400">
                    {inspectingItem.condition}% ({getConditionLabel(inspectingItem.condition)})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vendedor / Atendimento</span>
                  <span className="text-slate-200">{inspectingItem.assignedSellerName}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-2">
                  <span className="font-semibold text-slate-300">Valor Final de Aquisição</span>
                  <span className="font-mono text-base font-bold text-amber-400 tabular-nums">
                    {formatBRL(inspectingItem.finalPrice)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setInspectingItem(null)}
                  className="min-h-[40px] border border-white/15 bg-[#0A0D14] px-4 text-xs font-semibold text-slate-300 hover:bg-white/5"
                >
                  Fechar
                </button>
                {!isOwner && (
                  <button
                    type="button"
                    disabled={busy || business.status === 'suspended'}
                    onClick={() => {
                      const target = inspectingItem;
                      setInspectingItem(null);
                      setConfirmingBuyItem(target);
                    }}
                    className="inline-flex min-h-[40px] items-center gap-2 bg-amber-500 px-5 text-xs font-bold uppercase tracking-wider text-slate-950 hover:bg-amber-400 disabled:opacity-45"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    <span>Iniciar Compra</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TWO-STEP PURCHASE CONFIRMATION MODAL */}
      {confirmingBuyItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-md border border-amber-500/35 bg-[#101520] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-amber-400">
                  Confirmação de Aquisição Veicular
                </p>
                <h4 className="font-display text-xl font-bold text-slate-50">
                  {confirmingBuyItem.manufacturer} {confirmingBuyItem.model}
                </h4>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingBuyItem(null)}
                className="flex h-9 w-9 items-center justify-center border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-100"
                aria-label="Cancelar compra"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs">
              <div className="space-y-2 border border-white/10 bg-[#0A0D14] p-4">
                <div className="flex justify-between">
                  <span className="text-slate-400">Modelo</span>
                  <span className="font-semibold text-slate-100">
                    {confirmingBuyItem.model} ({confirmingBuyItem.year})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Categoria</span>
                  <span className="text-slate-200">
                    {VEHICLE_CATEGORY_LABELS[confirmingBuyItem.category]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Concessionária</span>
                  <span className="text-slate-200">{confirmingBuyItem.businessName}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-2">
                  <span className="text-slate-400">Saldo Bancário Atual</span>
                  <span className="font-mono font-semibold text-slate-200 tabular-nums">
                    {formatBRL(buyerBalance)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Valor a Debitar</span>
                  <span className="font-mono font-bold text-amber-400 tabular-nums">
                    - {formatBRL(confirmingBuyItem.finalPrice)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-2">
                  <span className="font-semibold text-slate-300">Saldo Após Aquisição</span>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      buyerBalance >= confirmingBuyItem.finalPrice
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {formatBRL(buyerBalance - confirmingBuyItem.finalPrice)}
                  </span>
                </div>
              </div>

              {buyerBalance < confirmingBuyItem.finalPrice && (
                <div className="flex items-start gap-2 border border-red-500/35 bg-red-500/10 p-3 text-red-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Saldo bancário insuficiente para concluir esta compra. Deposite dinheiro limpo
                    na aba Financeiro ou trabalhe para acumular saldo.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmingBuyItem(null)}
                  className="min-h-[40px] border border-white/15 bg-[#0A0D14] px-4 text-xs font-semibold text-slate-300 hover:bg-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    buyerBalance < confirmingBuyItem.finalPrice ||
                    business.status === 'suspended'
                  }
                  onClick={() => {
                    const target = confirmingBuyItem;
                    void runAction(async () => {
                      const res = await buyVehicleFromDealership(
                        firebaseUser,
                        businessId,
                        target.id
                      );
                      setConfirmingBuyItem(null);
                      return `Aquisição confirmada! ${target.manufacturer} ${target.model} (placa ${res.vehicle.plate}) enviado à sua Garagem por ${formatBRL(res.paidAmount)}.`;
                    });
                  }}
                  className="inline-flex min-h-[40px] items-center gap-2 bg-amber-500 px-5 text-xs font-bold uppercase tracking-wider text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{busy ? 'Processando...' : 'Confirmar Aquisição'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
