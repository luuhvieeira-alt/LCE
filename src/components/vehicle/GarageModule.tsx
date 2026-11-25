import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  Car,
  CheckCircle2,
  Fuel,
  Gauge,
  History,
  MessageSquare,
  RefreshCw,
  ShoppingCart,
  Tag,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL } from '../../config/economyCatalog';
import {
  VEHICLE_CATEGORIES,
  VEHICLE_CATEGORY_LABELS,
  estimateMaintenanceCost,
  getConditionLabel,
  getVehicleStatusLabel,
  getVehicleTxLabel,
} from '../../config/vehicleCatalog';
import { timestampToEpochMs } from '../../services/economyService';
import {
  buyUsedVehicleListing,
  cancelVehicleListing,
  completeAcceptedVehicleOffer,
  createVehicleListing,
  fetchGarageOverview,
  performVehicleMaintenance,
  recordVehicleTripWear,
  respondVehicleOffer,
  submitVehicleOffer,
} from '../../services/vehicleService';
import type {
  GarageOverviewPayload,
  PlayerVehicle,
  VehicleCategory,
  VehicleMaintenanceType,
} from '../../types/vehicle';
import { VehicleCardImage } from './VehicleCardImage';

type GarageTab = 'catalogo' | 'garagem' | 'mercado_p2p' | 'concessionarias';

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

export function GarageModule() {
  const {
    firebaseUser,
    economyConfig,
    bankAccount,
    businesses,
    vehicleCatalog,
    myVehicles,
    availableDealershipStock,
    activeVehicleListings,
    enterDealershipShowroom,
  } = useGame();

  const [tab, setTab] = useState<GarageTab>(() => (myVehicles.length > 0 ? 'garagem' : 'catalogo'));
  const [catalogCategory, setCatalogCategory] = useState<'all' | VehicleCategory>('all');
  const [overview, setOverview] = useState<GarageOverviewPayload | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Listing form
  const [listingPrice, setListingPrice] = useState('');
  const [listingDesc, setListingDesc] = useState(
    'Veículo revisado, documentação em dia e pronto para transferência imediata.'
  );

  // Market filter + offer form
  const [marketCategory, setMarketCategory] = useState<'all' | VehicleCategory>('all');
  const [offerListingId, setOfferListingId] = useState<string | null>(null);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerMessage, setOfferMessage] = useState(
    'Posso pagar à vista agora pelo Banco Central LCE.'
  );

  const loadGarage = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const data = await fetchGarageOverview(firebaseUser);
      setOverview(data);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao carregar garagem.',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void loadGarage();
  }, [loadGarage]);

  // Combine real-time Firestore subscription with server overview so garage updates instantaneously
  const vehicles: PlayerVehicle[] = useMemo(() => {
    if (myVehicles.length > 0) return myVehicles;
    return overview?.vehicles ?? [];
  }, [myVehicles, overview?.vehicles]);

  const selectedVehicle = useMemo(() => {
    if (!vehicles.length) return null;
    return vehicles.find((v) => v.id === selectedVehicleId) ?? vehicles[0];
  }, [vehicles, selectedVehicleId]);

  useEffect(() => {
    if (selectedVehicle && !listingPrice) {
      setListingPrice(String(Math.round(selectedVehicle.marketValue)));
    }
  }, [selectedVehicle, listingPrice]);

  const dealerships = useMemo(() => {
    return businesses
      .filter((b) => b.templateType === 'concessionaria')
      .map((b) => ({
        ...b,
        availableCount: availableDealershipStock.filter((s) => s.businessId === b.id).length,
      }));
  }, [businesses, availableDealershipStock]);

  const filteredListings = useMemo(() => {
    if (marketCategory === 'all') return activeVehicleListings;
    return activeVehicleListings.filter((l) => l.category === marketCategory);
  }, [activeVehicleListings, marketCategory]);

  const activeCatalogModels = useMemo(
    () => vehicleCatalog.filter((m) => m.active),
    [vehicleCatalog]
  );

  const catalogEntries = useMemo(() => {
    return activeCatalogModels
      .filter((m) => catalogCategory === 'all' || m.category === catalogCategory)
      .map((model) => {
        const stockUnits = availableDealershipStock
          .filter((s) => s.modelId === model.id && s.status === 'available')
          .sort((a, b) => a.finalPrice - b.finalPrice);

        const dealerMap = new Map<string, { id: string; name: string; count: number; minPrice: number }>();
        for (const s of stockUnits) {
          const prev = dealerMap.get(s.businessId);
          if (!prev) {
            dealerMap.set(s.businessId, {
              id: s.businessId,
              name: s.businessName,
              count: 1,
              minPrice: s.finalPrice,
            });
          } else {
            prev.count += 1;
            prev.minPrice = Math.min(prev.minPrice, s.finalPrice);
          }
        }
        const responsibleDealers = Array.from(dealerMap.values());
        const primaryDealer = responsibleDealers[0] ?? null;

        return {
          model,
          availableUnits: stockUnits.length,
          displayPrice: primaryDealer ? primaryDealer.minPrice : model.basePrice,
          responsibleDealers,
          primaryDealer,
        };
      });
  }, [activeCatalogModels, availableDealershipStock, catalogCategory]);

  const totalVehiclesValue = useMemo(
    () => vehicles.reduce((acc, v) => acc + v.marketValue, 0),
    [vehicles]
  );

  const runAction = async (fn: () => Promise<string>) => {
    setFeedback(null);
    setBusy(true);
    try {
      const msg = await fn();
      setFeedback({ type: 'ok', text: msg });
      await loadGarage();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao processar operação.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!firebaseUser) return null;

  const baseFuelPrice = economyConfig?.baseFuelPrice ?? 7.5;
  const bankBalance = bankAccount?.balance ?? 0;
  const incomingPending = (overview?.incomingOffers ?? []).filter((o) => o.status === 'pending');
  const outgoingActionable = (overview?.outgoingOffers ?? []).filter(
    (o) => o.status === 'pending' || o.status === 'accepted'
  );

  return (
    <div className="space-y-6">
      {/* Top KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Meus Veículos</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-50">
            {vehicles.length}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Patrimônio em Frota</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-amber-400">
            {formatBRL(totalVehiclesValue)}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Usados no Mercado P2P</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-100">
            {activeVehicleListings.length}
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-3.5">
          <p className="text-[11px] text-slate-400">Saldo Bancário</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-400">
            {formatBRL(bankBalance)}
          </p>
        </div>
      </div>

      {/* Navigation Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setTab('catalogo')}
            className={`inline-flex min-h-[38px] items-center gap-1.5 px-3.5 text-xs font-semibold ${
              tab === 'catalogo'
                ? 'bg-amber-500 text-slate-950'
                : 'border border-white/10 bg-[#121722] text-slate-300 hover:bg-white/5'
            }`}
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            <span>
              Catálogo ({activeCatalogModels.length} · {availableDealershipStock.length} em estoque)
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('garagem')}
            className={`inline-flex min-h-[38px] items-center gap-1.5 px-3.5 text-xs font-semibold ${
              tab === 'garagem'
                ? 'bg-amber-500 text-slate-950'
                : 'border border-white/10 bg-[#121722] text-slate-300 hover:bg-white/5'
            }`}
          >
            <Car className="h-3.5 w-3.5" />
            <span>Minha Garagem ({vehicles.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('mercado_p2p')}
            className={`inline-flex min-h-[38px] items-center gap-1.5 px-3.5 text-xs font-semibold ${
              tab === 'mercado_p2p'
                ? 'bg-amber-500 text-slate-950'
                : 'border border-white/10 bg-[#121722] text-slate-300 hover:bg-white/5'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            <span>
              Mercado de Usados P2P ({activeVehicleListings.length})
              {incomingPending.length + outgoingActionable.length > 0
                ? ` · ${incomingPending.length + outgoingActionable.length} prop.`
                : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab('concessionarias')}
            className={`inline-flex min-h-[38px] items-center gap-1.5 px-3.5 text-xs font-semibold ${
              tab === 'concessionarias'
                ? 'bg-amber-500 text-slate-950'
                : 'border border-white/10 bg-[#121722] text-slate-300 hover:bg-white/5'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Concessionárias ({dealerships.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => void loadGarage()}
          disabled={loading}
          className="inline-flex min-h-[38px] items-center gap-1.5 border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-300 hover:bg-white/5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar</span>
        </button>
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

      {/* ================================================================= */}
      {/* TAB 0: CATÁLOGO DE VEÍCULOS & DISPONIBILIDADE EM CONCESSIONÁRIAS  */}
      {/* ================================================================= */}
      {tab === 'catalogo' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#121722] p-4">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-100">
                Catálogo Oficial de Veículos LCE
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Consulte todos os modelos homologados, disponibilidade em tempo real e acesse a
                concessionária responsável para ver detalhes e concluir a aquisição.
              </p>
            </div>
            <div className="text-right text-xs">
              <p className="text-slate-400">Estoque ativo na cidade</p>
              <p className="font-mono text-base font-bold text-emerald-400 tabular-nums">
                {availableDealershipStock.length} unidade(s)
              </p>
            </div>
          </div>

          {/* Category Filter Strip */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCatalogCategory('all')}
              className={`min-h-[32px] shrink-0 px-3 text-[11px] font-semibold uppercase tracking-wider ${
                catalogCategory === 'all'
                  ? 'border border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border border-white/10 bg-[#0A0D14] text-slate-400 hover:text-slate-100'
              }`}
            >
              Todos ({activeCatalogModels.length})
            </button>
            {VEHICLE_CATEGORIES.map((cat) => {
              const count = activeCatalogModels.filter((m) => m.category === cat).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCatalogCategory(cat)}
                  className={`min-h-[32px] shrink-0 px-3 text-[11px] font-semibold uppercase tracking-wider ${
                    catalogCategory === cat
                      ? 'border border-amber-500/50 bg-amber-500/15 text-amber-300'
                      : 'border border-white/10 bg-[#0A0D14] text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {VEHICLE_CATEGORY_LABELS[cat]} ({count})
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {catalogEntries.map(({ model, availableUnits, displayPrice, responsibleDealers, primaryDealer }) => {
              const inStock = availableUnits > 0;
              return (
                <article
                  key={model.id}
                  className="flex flex-col border border-white/10 bg-[#121722]"
                >
                  <VehicleCardImage
                    category={model.imageKey}
                    alt={`${model.manufacturer} ${model.model}`}
                  />

                  <div className="flex flex-1 flex-col justify-between p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                            {model.manufacturer} · {VEHICLE_CATEGORY_LABELS[model.category]} · {model.year}
                          </p>
                          <h4 className="truncate font-display text-xl font-bold text-slate-50">
                            {model.model}
                          </h4>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] uppercase tracking-wider text-slate-500">
                            {inStock ? 'A partir de' : 'Preço-base'}
                          </p>
                          <p className="font-mono text-lg font-bold tabular-nums text-amber-400">
                            {formatBRL(displayPrice)}
                          </p>
                        </div>
                      </div>

                      <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">
                        {model.description}
                      </p>

                      {/* Availability & Responsible Dealership */}
                      <div className="space-y-1.5 border-y border-white/10 py-2.5 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-400">Disponibilidade</span>
                          <span
                            className={`font-semibold ${
                              inStock ? 'text-emerald-400' : 'text-slate-500'
                            }`}
                          >
                            {inStock
                              ? `${availableUnits} unidade(s) disponível(is)`
                              : 'Esgotado no momento'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="shrink-0 text-slate-400">Concessionária</span>
                          <span className="truncate font-medium text-slate-200">
                            {primaryDealer
                              ? responsibleDealers.length > 1
                                ? `${primaryDealer.name} (+${responsibleDealers.length - 1})`
                                : primaryDealer.name
                              : 'Aguardando reposição'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-500">Vel.</span>
                          <p className="font-mono font-medium text-slate-200">{model.topSpeed}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">Acel.</span>
                          <p className="font-mono font-medium text-slate-200">
                            {model.acceleration.toFixed(1)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Lug.</span>
                          <p className="font-mono font-medium text-slate-200">{model.capacity}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">Cons.</span>
                          <p className="font-mono font-medium text-slate-200">
                            {model.fuelConsumption}L
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-white/10 pt-3">
                      {primaryDealer ? (
                        <button
                          type="button"
                          onClick={() => enterDealershipShowroom(primaryDealer.id)}
                          className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 bg-amber-500 px-3 text-xs font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-amber-400"
                        >
                          <span>Abrir Concessionária</span>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTab('concessionarias')}
                          className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-300 hover:bg-white/5"
                        >
                          <span>Ver Concessionárias</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 1: MINHA GARAGEM                                              */}
      {/* ================================================================= */}
      {tab === 'garagem' && (
        <div className="space-y-6">
          {vehicles.length === 0 ? (
            <div className="border border-white/10 bg-[#121722] p-8 text-center">
              <Car className="mx-auto h-10 w-10 text-slate-500" />
              <h3 className="mt-3 font-display text-2xl font-bold text-slate-100">
                Sua garagem está vazia
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                Explore o catálogo oficial LCE, visite uma concessionária com estoque disponível ou
                negocie no mercado P2P de usados para adquirir seu primeiro veículo.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setTab('catalogo')}
                  className="min-h-[40px] bg-amber-500 px-5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  Ver Catálogo ({availableDealershipStock.length} em estoque)
                </button>
                <button
                  type="button"
                  onClick={() => setTab('concessionarias')}
                  className="min-h-[40px] border border-white/15 bg-[#0A0D14] px-5 text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  Concessionárias
                </button>
                <button
                  type="button"
                  onClick={() => setTab('mercado_p2p')}
                  className="min-h-[40px] border border-white/15 bg-[#0A0D14] px-5 text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  Mercado de Usados
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Owned Vehicles Cards Grid */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {vehicles.map((v) => {
                  const isSelected = selectedVehicle?.id === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelectedVehicleId(v.id);
                        setListingPrice(String(Math.round(v.marketValue)));
                      }}
                      className={`group text-left border transition-colors ${
                        isSelected
                          ? 'border-amber-500 bg-[#161D2C]'
                          : 'border-white/10 bg-[#121722] hover:border-white/25'
                      }`}
                    >
                      <VehicleCardImage
                        category={v.imageKey}
                        alt={`${v.manufacturer} ${v.model}`}
                        plate={v.plate}
                      />
                      <div className="p-3.5 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-slate-400">
                              {v.manufacturer} · {v.year}
                            </p>
                            <p className="truncate font-display text-lg font-bold text-slate-50">
                              {v.model}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-amber-400">
                            {formatBRL(v.marketValue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span>{getVehicleStatusLabel(v.status)}</span>
                          <span className="font-mono tabular-nums">
                            {v.condition}% · {v.mileageKm.toLocaleString('pt-BR')} km
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected Vehicle Full Inspection, Maintenance & P2P Sale Panel */}
              {selectedVehicle && (
                <div className="grid grid-cols-1 gap-5 border border-white/10 bg-[#121722] p-5 lg:grid-cols-12">
                  {/* Left: Full Technical Dossier */}
                  <div className="space-y-4 lg:col-span-7">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-3">
                      <div>
                        <p className="text-xs font-medium text-amber-400">
                          {selectedVehicle.manufacturer} · {VEHICLE_CATEGORY_LABELS[selectedVehicle.category]} ·{' '}
                          {selectedVehicle.year}
                        </p>
                        <h3 className="font-display text-2xl font-bold text-slate-50">
                          {selectedVehicle.model}
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Placa: <span className="font-mono text-slate-200">{selectedVehicle.plate}</span> · Origem:{' '}
                          {selectedVehicle.originBusinessName} · Adquirido em{' '}
                          {formatDateTime(selectedVehicle.acquiredAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-slate-400">Valor de Mercado</p>
                        <p className="font-mono text-xl font-bold tabular-nums text-amber-400">
                          {formatBRL(selectedVehicle.marketValue)}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Pago: {formatBRL(selectedVehicle.purchasePrice)}
                        </p>
                      </div>
                    </div>

                    {/* Condition & Fuel Gauges */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="border border-white/10 bg-[#0A0D14] p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">Conservação</span>
                          <span className="font-mono font-semibold text-emerald-400">
                            {selectedVehicle.condition}% ({getConditionLabel(selectedVehicle.condition)})
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full bg-white/10">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${selectedVehicle.condition}%` }}
                          />
                        </div>
                      </div>

                      <div className="border border-white/10 bg-[#0A0D14] p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">Combustível</span>
                          <span className="font-mono font-semibold text-amber-400">
                            {selectedVehicle.fuelLevel}%
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full bg-white/10">
                          <div
                            className="h-full bg-amber-500"
                            style={{ width: `${selectedVehicle.fuelLevel}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Specs + Mileage + Future Parking Location */}
                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div className="border border-white/10 bg-[#0A0D14] p-3">
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Gauge className="h-3.5 w-3.5" /> Velocidade
                        </span>
                        <p className="mt-1 font-mono font-semibold text-slate-100">
                          {selectedVehicle.topSpeed} km/h
                        </p>
                      </div>
                      <div className="border border-white/10 bg-[#0A0D14] p-3">
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Zap className="h-3.5 w-3.5" /> Aceleração
                        </span>
                        <p className="mt-1 font-mono font-semibold text-slate-100">
                          {selectedVehicle.acceleration.toFixed(1)} / 10
                        </p>
                      </div>
                      <div className="border border-white/10 bg-[#0A0D14] p-3">
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Users className="h-3.5 w-3.5" /> Capacidade
                        </span>
                        <p className="mt-1 font-mono font-semibold text-slate-100">
                          {selectedVehicle.capacity} lugares
                        </p>
                      </div>
                      <div className="border border-white/10 bg-[#0A0D14] p-3">
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Fuel className="h-3.5 w-3.5" /> Odômetro
                        </span>
                        <p className="mt-1 font-mono font-semibold text-slate-100">
                          {selectedVehicle.mileageKm.toLocaleString('pt-BR')} km
                        </p>
                      </div>
                    </div>

                    {/* Maintenance, Fuel & Usage Actions */}
                    <div className="space-y-2.5 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                          <Wrench className="h-4 w-4 text-amber-500" />
                          <span>Manutenção, Abastecimento & Uso</span>
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Local: {selectedVehicle.parkedZone}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(['fuel', 'repair', 'revision'] as VehicleMaintenanceType[]).map((svc) => {
                          const quote = estimateMaintenanceCost(
                            svc,
                            baseFuelPrice,
                            selectedVehicle.condition,
                            selectedVehicle.fuelLevel,
                            selectedVehicle.marketValue
                          );
                          const label =
                            svc === 'fuel'
                              ? 'Abastecer'
                              : svc === 'repair'
                              ? 'Reparar'
                              : 'Revisão';
                          return (
                            <button
                              key={svc}
                              type="button"
                              disabled={busy || bankBalance < quote.cost}
                              onClick={() =>
                                void runAction(async () => {
                                  const res = await performVehicleMaintenance(
                                    firebaseUser,
                                    selectedVehicle.id,
                                    svc
                                  );
                                  return `${label} concluído por ${formatBRL(res.cost)}. Condição ${res.condition}%, combustível ${res.fuelLevel}%.`;
                                })
                              }
                              className="flex min-h-[44px] flex-col items-center justify-center border border-white/15 bg-[#0A0D14] px-2 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-500/50 hover:bg-white/5 disabled:opacity-45"
                            >
                              <span>{label}</span>
                              <span className="font-mono text-[10px] text-amber-400">
                                {formatBRL(quote.cost)}
                              </span>
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          disabled={busy || selectedVehicle.status === 'listed'}
                          onClick={() =>
                            void runAction(async () => {
                              const res = await recordVehicleTripWear(
                                firebaseUser,
                                selectedVehicle.id,
                                45
                              );
                              return `Trajeto urbano registrado (+45 km). Odômetro: ${res.mileageKm} km · Combustível: ${res.fuelLevel}% · Conservação: ${res.condition}%.`;
                            })
                          }
                          className="flex min-h-[44px] flex-col items-center justify-center border border-white/10 bg-[#0A0D14] px-2 py-1.5 text-xs font-semibold text-slate-300 hover:border-white/25 disabled:opacity-45"
                        >
                          <span>Rodar (+45km)</span>
                          <span className="text-[10px] text-slate-500">Desgaste real</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right: List Vehicle for P2P Used Market */}
                  <div className="space-y-4 border-t border-white/10 pt-4 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                      <Tag className="h-4 w-4" />
                      <span>Venda Particular no Mercado de Usados (P2P)</span>
                    </div>

                    {selectedVehicle.status === 'listed' ? (
                      <div className="space-y-3 border border-amber-500/35 bg-amber-500/10 p-4 text-xs">
                        <p className="font-semibold text-amber-200">
                          Este veículo está anunciado no mercado público de usados.
                        </p>
                        <p className="text-slate-300">
                          Qualquer cidadão pode comprá-lo diretamente ou enviar proposta de
                          negociação. A transferência é atômica com propriedade única garantida.
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runAction(async () => {
                              await cancelVehicleListing(
                                firebaseUser,
                                selectedVehicle.activeListingId
                              );
                              return 'Anúncio cancelado. Veículo devolvido ao status Na Garagem.';
                            })
                          }
                          className="min-h-[38px] w-full border border-red-500/40 bg-red-500/15 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/25"
                        >
                          Cancelar Anúncio
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3 text-xs">
                        <p className="text-slate-400">
                          Defina o valor pedido e publique seu veículo para negociação direta com
                          outros jogadores da cidade.
                        </p>
                        <label className="block space-y-1">
                          <span className="text-slate-300">Preço Pedido (R$)</span>
                          <input
                            type="number"
                            min={15}
                            step="5"
                            value={listingPrice}
                            onChange={(e) => setListingPrice(e.target.value)}
                            className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-slate-300">Descrição do Anúncio</span>
                          <textarea
                            rows={2}
                            value={listingDesc}
                            onChange={(e) => setListingDesc(e.target.value)}
                            className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={busy || Number(listingPrice) < 15}
                          onClick={() =>
                            void runAction(async () => {
                              const price = Number(listingPrice);
                              await createVehicleListing(firebaseUser, selectedVehicle.id, {
                                askingPrice: price,
                                description: listingDesc,
                              });
                              return `${selectedVehicle.manufacturer} ${selectedVehicle.model} anunciado no Mercado P2P por ${formatBRL(price)}.`;
                            })
                          }
                          className="min-h-[40px] w-full bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-45"
                        >
                          Anunciar Veículo à Venda
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Vehicle Buy/Sell & Maintenance History */}
              <div className="border border-white/10 bg-[#121722] p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <History className="h-4 w-4 text-amber-500" />
                  <span>
                    Histórico Veicular ({overview?.transactions.length ?? 0} registros)
                  </span>
                </div>
                {!overview || overview.transactions.length === 0 ? (
                  <p className="mt-3 text-xs text-slate-400">
                    Nenhuma movimentação veicular registrada ainda.
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-white/5 text-xs">
                    {overview.transactions.slice(0, 15).map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-100">{tx.description}</p>
                          <p className="text-[11px] text-slate-400">
                            {getVehicleTxLabel(tx.type)} · {tx.fromLabel} → {tx.toLabel} ·{' '}
                            {formatDateTime(tx.createdAt)}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono font-semibold tabular-nums text-amber-400">
                          {formatBRL(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: MERCADO DE USADOS P2P & PROPOSTAS                          */}
      {/* ================================================================= */}
      {tab === 'mercado_p2p' && (
        <div className="space-y-6">
          {/* Active Negotiations (Incoming + Outgoing Offers) */}
          {((overview?.incomingOffers.length ?? 0) > 0 ||
            (overview?.outgoingOffers.length ?? 0) > 0) && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Incoming Offers (as Seller) */}
              <div className="border border-white/10 bg-[#121722] p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                  <MessageSquare className="h-4 w-4" />
                  <span>Propostas Recebidas ({overview?.incomingOffers.length ?? 0})</span>
                </div>
                {(overview?.incomingOffers ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhuma proposta recebida.</p>
                ) : (
                  <div className="space-y-2.5 text-xs">
                    {(overview?.incomingOffers ?? []).map((off) => (
                      <div
                        key={off.id}
                        className="space-y-2 border border-white/10 bg-[#0A0D14] p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-100">{off.vehicleLabel}</span>
                          <span className="font-mono font-semibold text-amber-400">
                            {formatBRL(off.offerPrice)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Comprador: {off.buyerName} (@{off.buyerAlias}) · Pedido:{' '}
                          {formatBRL(off.askingPrice)} · Status:{' '}
                          <strong className="uppercase text-slate-200">{off.status}</strong>
                        </p>
                        <p className="text-[11px] text-slate-300">“{off.message}”</p>
                        {off.status === 'pending' && (
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(async () => {
                                  await respondVehicleOffer(firebaseUser, off.id, 'accept');
                                  return `Proposta de ${formatBRL(off.offerPrice)} aceita! Aguardando liquidação pelo comprador.`;
                                })
                              }
                              className="min-h-[32px] flex-1 bg-emerald-500 px-3 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                            >
                              Aceitar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(async () => {
                                  await respondVehicleOffer(firebaseUser, off.id, 'reject');
                                  return 'Proposta recusada.';
                                })
                              }
                              className="min-h-[32px] flex-1 border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                            >
                              Recusar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Outgoing Offers (as Buyer) */}
              <div className="border border-white/10 bg-[#121722] p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <MessageSquare className="h-4 w-4 text-amber-500" />
                  <span>Minhas Propostas Enviadas ({overview?.outgoingOffers.length ?? 0})</span>
                </div>
                {(overview?.outgoingOffers ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">Você ainda não enviou propostas.</p>
                ) : (
                  <div className="space-y-2.5 text-xs">
                    {(overview?.outgoingOffers ?? []).map((off) => (
                      <div
                        key={off.id}
                        className="space-y-2 border border-white/10 bg-[#0A0D14] p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-100">{off.vehicleLabel}</span>
                          <span className="font-mono font-semibold text-amber-400">
                            {formatBRL(off.offerPrice)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Vendedor: {off.sellerName} · Status:{' '}
                          <strong className="uppercase text-emerald-400">{off.status}</strong>
                        </p>
                        <div className="flex gap-2 pt-1">
                          {off.status === 'accepted' && (
                            <button
                              type="button"
                              disabled={busy || bankBalance < off.offerPrice}
                              onClick={() =>
                                void runAction(async () => {
                                  const res = await completeAcceptedVehicleOffer(
                                    firebaseUser,
                                    off.id
                                  );
                                  return `Compra negociada concluída por ${formatBRL(res.paidAmount)}! Veículo transferido para sua Garagem.`;
                                })
                              }
                              className="min-h-[34px] flex-1 bg-amber-500 px-3 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-45"
                            >
                              Concluir Compra ({formatBRL(off.offerPrice)})
                            </button>
                          )}
                          {(off.status === 'pending' || off.status === 'accepted') && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(async () => {
                                  await respondVehicleOffer(firebaseUser, off.id, 'withdraw');
                                  return 'Proposta cancelada.';
                                })
                              }
                              className="min-h-[34px] border border-white/15 px-3 text-xs text-slate-300"
                            >
                              Retirar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Category Filter Strip */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setMarketCategory('all')}
              className={`min-h-[32px] shrink-0 px-3 text-[11px] font-semibold uppercase tracking-wider ${
                marketCategory === 'all'
                  ? 'border border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border border-white/10 bg-[#0A0D14] text-slate-400'
              }`}
            >
              Todos ({activeVehicleListings.length})
            </button>
            {VEHICLE_CATEGORIES.map((cat) => {
              const count = activeVehicleListings.filter((l) => l.category === cat).length;
              if (count === 0) return null;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setMarketCategory(cat)}
                  className={`min-h-[32px] shrink-0 px-3 text-[11px] font-semibold uppercase tracking-wider ${
                    marketCategory === cat
                      ? 'border border-amber-500/50 bg-amber-500/15 text-amber-300'
                      : 'border border-white/10 bg-[#0A0D14] text-slate-400'
                  }`}
                >
                  {VEHICLE_CATEGORY_LABELS[cat]} ({count})
                </button>
              );
            })}
          </div>

          {/* Active Used Vehicle Listings Grid */}
          {filteredListings.length === 0 ? (
            <div className="border border-white/10 bg-[#121722] p-8 text-center text-xs text-slate-400">
              Nenhum veículo usado anunciado no momento.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {filteredListings.map((lst) => {
                const isMine = lst.sellerUid === firebaseUser.uid;
                const isOffering = offerListingId === lst.id;
                const canAfford = bankBalance >= lst.askingPrice;

                return (
                  <article
                    key={lst.id}
                    className="group flex flex-col border border-white/10 bg-[#121722]"
                  >
                    <VehicleCardImage
                      category={lst.imageKey}
                      alt={`${lst.manufacturer} ${lst.model}`}
                      plate={lst.plate}
                    />
                    <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-wider text-slate-400">
                              {lst.manufacturer} · {lst.year}
                            </p>
                            <h4 className="font-display text-xl font-bold text-slate-50">
                              {lst.model}
                            </h4>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-lg font-bold tabular-nums text-amber-400">
                              {formatBRL(lst.askingPrice)}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              Ref. {formatBRL(lst.marketValue)}
                            </p>
                          </div>
                        </div>

                        <p className="text-xs text-slate-300">{lst.description}</p>

                        <div className="flex flex-wrap gap-3 border-y border-white/10 py-2 text-[11px] text-slate-400">
                          <span>Vendedor: <strong className="text-slate-200">{lst.sellerName}</strong></span>
                          <span>Condição: <strong className="text-emerald-400">{lst.condition}%</strong></span>
                          <span>Km: <strong className="font-mono text-slate-200">{lst.mileageKm}</strong></span>
                        </div>
                      </div>

                      {isOffering && !isMine && (
                        <div className="space-y-2 border-t border-white/10 pt-3 text-xs">
                          <input
                            type="number"
                            min={15}
                            value={offerAmount}
                            onChange={(e) => setOfferAmount(e.target.value)}
                            placeholder="Valor da proposta (R$)"
                            className="w-full border border-white/15 bg-[#0A0D14] px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                          />
                          <input
                            type="text"
                            value={offerMessage}
                            onChange={(e) => setOfferMessage(e.target.value)}
                            placeholder="Mensagem ao vendedor"
                            className="w-full border border-white/15 bg-[#0A0D14] px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-500"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy || Number(offerAmount) < 15}
                              onClick={() =>
                                void runAction(async () => {
                                  await submitVehicleOffer(firebaseUser, lst.id, {
                                    offerPrice: Number(offerAmount),
                                    message: offerMessage,
                                  });
                                  setOfferListingId(null);
                                  return `Proposta de ${formatBRL(Number(offerAmount))} enviada para ${lst.sellerName}.`;
                                })
                              }
                              className="min-h-[34px] flex-1 bg-amber-500 px-3 text-xs font-bold text-slate-950"
                            >
                              Enviar Proposta
                            </button>
                            <button
                              type="button"
                              onClick={() => setOfferListingId(null)}
                              className="min-h-[34px] border border-white/15 px-3 text-xs text-slate-300"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-white/10">
                        {isMine ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                await cancelVehicleListing(firebaseUser, lst.id);
                                return 'Anúncio cancelado.';
                              })
                            }
                            className="min-h-[38px] w-full border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                          >
                            Cancelar Meu Anúncio
                          </button>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              disabled={busy || !canAfford}
                              onClick={() =>
                                void runAction(async () => {
                                  const res = await buyUsedVehicleListing(firebaseUser, lst.id);
                                  return `Veículo comprado via P2P por ${formatBRL(res.paidAmount)}! Transferido para sua Garagem.`;
                                })
                              }
                              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 bg-amber-500 px-3 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-45"
                            >
                              <ShoppingCart className="h-3.5 w-3.5" />
                              <span>Comprar</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setOfferListingId(lst.id);
                                setOfferAmount(String(Math.max(15, Math.round(lst.askingPrice * 0.9))));
                              }}
                              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-200 hover:bg-white/5"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              <span>Proposta</span>
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

      {/* ================================================================= */}
      {/* TAB 3: CONCESSIONÁRIAS DA CIDADE & MINHAS COMISSÕES               */}
      {/* ================================================================= */}
      {tab === 'concessionarias' && (
        <div className="space-y-6">
          {dealerships.length === 0 ? (
            <div className="border border-white/10 bg-[#121722] p-8 text-center text-xs text-slate-400">
              Nenhuma concessionária aberta por jogadores ainda. Vá na aba{' '}
              <strong className="text-slate-200">Empresas</strong> para adquirir a{' '}
              <strong className="text-amber-400">Apex Motors Concessionária</strong>.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {dealerships.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-col justify-between border border-white/10 bg-[#121722] p-5 space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-amber-400">
                        {d.locationLabel}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          d.status === 'active' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {d.status === 'active' ? 'Funcionando' : 'Restrita'}
                      </span>
                    </div>
                    <h4 className="mt-1 font-display text-2xl font-bold text-slate-50">
                      {d.name}
                    </h4>
                    <p className="mt-1 text-xs text-slate-400">
                      Proprietário: <strong className="text-slate-200">{d.ownerName}</strong> (@
                      {d.ownerAlias})
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-white/10 pt-3">
                    <div className="text-xs">
                      <span className="text-slate-400">Veículos disponíveis: </span>
                      <span className="font-mono font-semibold text-amber-400">
                        {d.availableCount}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => enterDealershipShowroom(d.id)}
                      className="inline-flex min-h-[38px] items-center gap-1.5 bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400"
                    >
                      <span>VISITAR CONCESSIONÁRIA</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Salesperson Commissions Earned by Current Player */}
          {(overview?.myCommissions.length ?? 0) > 0 && (
            <div className="border border-white/10 bg-[#121722] p-5">
              <h4 className="text-sm font-semibold text-slate-100">
                Minhas Comissões como Vendedor ({overview?.myCommissions.length ?? 0})
              </h4>
              <div className="mt-3 divide-y divide-white/10 text-xs">
                {(overview?.myCommissions ?? []).map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-medium text-slate-100">
                        {c.vehicleLabel} · {c.businessName}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Venda {formatBRL(c.salePrice)} · {c.commissionPercent}% ·{' '}
                        <span className={c.status === 'paid' ? 'text-emerald-400' : 'text-amber-400'}>
                          {c.status === 'paid' ? 'Paga no Banco' : 'Aguardando pagamento do proprietário'}
                        </span>
                      </p>
                    </div>
                    <span className="font-mono font-semibold text-amber-400">
                      {formatBRL(c.commissionAmount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
