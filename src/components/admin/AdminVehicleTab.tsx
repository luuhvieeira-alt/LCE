import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Car,
  CheckCircle2,
  Plus,
  RefreshCw,
  Save,
  ShieldBan,
  Upload,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL } from '../../config/economyCatalog';
import {
  DEFAULT_VEHICLE_CATALOG,
  VEHICLE_CATEGORIES,
  VEHICLE_CATEGORY_LABELS,
  getVehicleTxLabel,
} from '../../config/vehicleCatalog';
import {
  createVehicleModelAdmin,
  fetchAdminVehicleOverview,
  seedInitialVehicleStockAdmin,
  seedVehicleCatalogAdmin,
  suspendVehicleListingAdmin,
  updateVehicleModelAdmin,
} from '../../services/vehicleService';
import type { AdminVehicleOverview, VehicleCategory } from '../../types/vehicle';

export function AdminVehicleTab() {
  const { firebaseUser } = useGame();
  const [overview, setOverview] = useState<AdminVehicleOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // New catalog model form
  const [newManufacturer, setNewManufacturer] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newYear, setNewYear] = useState('2026');
  const [newCategory, setNewCategory] = useState<VehicleCategory>('sedan');
  const [newBasePrice, setNewBasePrice] = useState('450');
  const [newMarketValue, setNewMarketValue] = useState('540');
  const [newTopSpeed, setNewTopSpeed] = useState('210');
  const [newAccel, setNewAccel] = useState('7.4');
  const [newCapacity, setNewCapacity] = useState('5');
  const [newFuel, setNewFuel] = useState('8.5');
  const [newMaxComm, setNewMaxComm] = useState('15');
  const [newDesc, setNewDesc] = useState('');

  // Quick price/commission edits keyed by modelId
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [commEdits, setCommEdits] = useState<Record<string, string>>({});

  const loadOverview = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const data = await fetchAdminVehicleOverview(firebaseUser);
      setOverview(data);
      const nextPrices: Record<string, string> = {};
      const nextComms: Record<string, string> = {};
      for (const m of data.catalog) {
        nextPrices[m.id] = String(m.basePrice);
        nextComms[m.id] = String(m.maxCommissionPercent);
      }
      setPriceEdits(nextPrices);
      setCommEdits(nextComms);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao carregar governança de veículos.',
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const runAction = async (fn: () => Promise<string>) => {
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

  if (!firebaseUser) return null;

  return (
    <div className="space-y-6">
      {/* Header & Seed */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#11151E] p-4">
        <div>
          <h3 className="text-base font-semibold text-slate-100">
            Governança do Mercado Automotivo & Concessionárias
          </h3>
          <p className="text-xs text-slate-400">
            Controle modelos oficiais, preços-base, tetos de comissão, frota de jogadores e
            suspensão de anúncios irregulares. Todas as ações são gravadas em /admin_logs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                const res = await seedVehicleCatalogAdmin(firebaseUser);
                return `Catálogo oficial sincronizado no Firestore (${res.seededCount} modelos).`;
              })
            }
            className="inline-flex min-h-[38px] items-center gap-1.5 bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Sincronizar Catálogo ({DEFAULT_VEHICLE_CATALOG.length})</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void runAction(async () => {
                const res = await seedInitialVehicleStockAdmin(firebaseUser);
                return `Estoque inicial abastecido em ${res.dealershipName}: ${res.createdUnits} nova(s) unidade(s) criada(s) · Total disponível: ${res.availableUnits}.`;
              })
            }
            className="inline-flex min-h-[38px] items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            <Car className="h-3.5 w-3.5" />
            <span>Abastecer Estoque Inicial</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadOverview()}
            className="inline-flex min-h-[38px] items-center gap-1.5 border border-white/15 bg-[#161C29] px-3 text-xs font-semibold text-slate-200 hover:bg-[#1E2638]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 border p-3.5 text-xs ${
            feedback.type === 'ok'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/35 bg-red-500/10 text-red-200'
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
      {overview && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="border border-white/10 bg-[#121722] p-3">
            <p className="text-[11px] text-slate-400">Modelos Catálogo</p>
            <p className="mt-1 font-mono text-xl font-semibold text-slate-100">
              {overview.catalog.length}
            </p>
          </div>
          <div className="border border-white/10 bg-[#121722] p-3">
            <p className="text-[11px] text-slate-400">Veículos em Garagens</p>
            <p className="mt-1 font-mono text-xl font-semibold text-amber-400">
              {overview.vehicles.length}
            </p>
          </div>
          <div className="border border-white/10 bg-[#121722] p-3">
            <p className="text-[11px] text-slate-400">Concessionárias</p>
            <p className="mt-1 font-mono text-xl font-semibold text-slate-100">
              {overview.dealerships.length}
            </p>
          </div>
          <div className="border border-white/10 bg-[#121722] p-3">
            <p className="text-[11px] text-slate-400">Anúncios P2P</p>
            <p className="mt-1 font-mono text-xl font-semibold text-slate-100">
              {overview.listings.filter((l) => l.status === 'active').length}
            </p>
          </div>
          <div className="border border-white/10 bg-[#121722] p-3">
            <p className="text-[11px] text-slate-400">Comissões</p>
            <p className="mt-1 font-mono text-xl font-semibold text-emerald-400">
              {overview.commissions.length}
            </p>
          </div>
        </div>
      )}

      {/* Add New Vehicle Model */}
      <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
          <Plus className="h-4 w-4" />
          <span>Adicionar Novo Modelo Fictício ao Catálogo Oficial</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <input
            type="text"
            value={newManufacturer}
            onChange={(e) => setNewManufacturer(e.target.value)}
            placeholder="Fabricante (ex: Solaris)"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 text-slate-100 outline-none focus:border-amber-500"
          />
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="Modelo (ex: Apex GT)"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 text-slate-100 outline-none focus:border-amber-500"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as VehicleCategory)}
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 text-slate-100 outline-none focus:border-amber-500"
          >
            {VEHICLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {VEHICLE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={newYear}
            onChange={(e) => setNewYear(e.target.value)}
            placeholder="Ano"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 font-mono text-slate-100 outline-none focus:border-amber-500"
          />
          <input
            type="number"
            value={newBasePrice}
            onChange={(e) => setNewBasePrice(e.target.value)}
            placeholder="Preço-base (R$)"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 font-mono text-slate-100 outline-none focus:border-amber-500"
          />
          <input
            type="number"
            value={newMarketValue}
            onChange={(e) => setNewMarketValue(e.target.value)}
            placeholder="Valor mercado (R$)"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 font-mono text-slate-100 outline-none focus:border-amber-500"
          />
          <input
            type="number"
            value={newTopSpeed}
            onChange={(e) => setNewTopSpeed(e.target.value)}
            placeholder="Vel. máx (km/h)"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 font-mono text-slate-100 outline-none focus:border-amber-500"
          />
          <input
            type="number"
            value={newMaxComm}
            onChange={(e) => setNewMaxComm(e.target.value)}
            placeholder="Comissão máx (%)"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 font-mono text-slate-100 outline-none focus:border-amber-500"
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Descrição técnica resumida"
            className="border border-white/15 bg-[#0A0D14] px-2.5 py-2 text-slate-100 outline-none focus:border-amber-500 col-span-2 sm:col-span-3"
          />
          <button
            type="button"
            disabled={busy || !newManufacturer.trim() || !newModel.trim()}
            onClick={() =>
              void runAction(async () => {
                await createVehicleModelAdmin(firebaseUser, {
                  manufacturer: newManufacturer.trim(),
                  model: newModel.trim(),
                  year: Number(newYear),
                  category: newCategory,
                  basePrice: Number(newBasePrice),
                  marketValue: Number(newMarketValue),
                  topSpeed: Number(newTopSpeed),
                  acceleration: Number(newAccel),
                  capacity: Number(newCapacity),
                  fuelConsumption: Number(newFuel),
                  minPriceMultiplier: 1.0,
                  maxPriceMultiplier: 2.4,
                  maxCommissionPercent: Number(newMaxComm),
                  description: newDesc.trim() || 'Modelo oficial homologado para o universo LCE.',
                });
                setNewManufacturer('');
                setNewModel('');
                setNewDesc('');
                return 'Novo modelo adicionado ao catálogo oficial e auditado em /admin_logs.';
              })
            }
            className="min-h-[38px] bg-amber-500 px-3 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-45"
          >
            Criar Modelo
          </button>
        </div>
      </section>

      {/* Catalog Price & Commission Editor */}
      {overview && (
        <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Car className="h-4 w-4 text-amber-500" />
            <span>Catálogo Oficial ({overview.catalog.length} modelos)</span>
          </div>
          <div className="divide-y divide-white/5 text-xs">
            {overview.catalog.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100">
                    {m.manufacturer} {m.model} ({m.year}) ·{' '}
                    <span className="text-amber-400">{VEHICLE_CATEGORY_LABELS[m.category]}</span>
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {m.id} · {m.topSpeed} km/h · Cap. {m.capacity} · Ativo: {m.active ? 'Sim' : 'Não'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1 text-[11px] text-slate-400">
                    <span>Base R$</span>
                    <input
                      type="number"
                      value={priceEdits[m.id] ?? String(m.basePrice)}
                      onChange={(e) =>
                        setPriceEdits((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                      className="w-24 border border-white/15 bg-[#0A0D14] px-2 py-1 font-mono text-xs text-slate-100"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-400">
                    <span>Com.%</span>
                    <input
                      type="number"
                      value={commEdits[m.id] ?? String(m.maxCommissionPercent)}
                      onChange={(e) =>
                        setCommEdits((prev) => ({ ...prev, [m.id]: e.target.value }))
                      }
                      className="w-16 border border-white/15 bg-[#0A0D14] px-2 py-1 font-mono text-xs text-slate-100"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        const nextBase = Number(priceEdits[m.id] ?? m.basePrice);
                        const nextComm = Number(commEdits[m.id] ?? m.maxCommissionPercent);
                        await updateVehicleModelAdmin(firebaseUser, m.id, {
                          basePrice: nextBase,
                          marketValue: Math.round(nextBase * 1.2),
                          maxCommissionPercent: nextComm,
                        });
                        return `${m.manufacturer} ${m.model} atualizado (base ${formatBRL(nextBase)}).`;
                      })
                    }
                    className="inline-flex min-h-[30px] items-center gap-1 border border-amber-500/40 bg-amber-500/15 px-2.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25"
                  >
                    <Save className="h-3 w-3" />
                    <span>Salvar</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Listings Fraud Moderation & All Owned Vehicles */}
      {overview && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Active Listings Moderation */}
          <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
            <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
              Moderação de Anúncios P2P ({overview.listings.length})
            </h4>
            {overview.listings.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum anúncio P2P registrado.</p>
            ) : (
              <div className="divide-y divide-white/5 text-xs">
                {overview.listings.slice(0, 15).map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-100">
                        {l.manufacturer} {l.model} ({l.plate}) — {formatBRL(l.askingPrice)}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Vendedor: {l.sellerName} · Status:{' '}
                        <strong className="uppercase">{l.status}</strong>
                      </p>
                    </div>
                    {l.status === 'active' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void runAction(async () => {
                            await suspendVehicleListingAdmin(
                              firebaseUser,
                              l.id,
                              'Anúncio suspenso pela moderação administrativa.'
                            );
                            return `Anúncio ${l.id} suspenso com sucesso.`;
                          })
                        }
                        className="inline-flex min-h-[30px] shrink-0 items-center gap-1 border border-red-500/40 bg-red-500/10 px-2.5 text-[11px] font-semibold text-red-200 hover:bg-red-500/20"
                      >
                        <ShieldBan className="h-3 w-3" />
                        <span>Suspender</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* All Registered Player Vehicles + Recent Vehicle Ledger */}
          <section className="space-y-3 border border-white/10 bg-[#11151E] p-5">
            <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
              Frota Registrada ({overview.vehicles.length}) & Transações ({overview.transactions.length})
            </h4>
            {overview.vehicles.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum veículo de jogador registrado ainda.</p>
            ) : (
              <div className="divide-y divide-white/5 text-xs">
                {overview.vehicles.slice(0, 12).map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-100">
                        {v.manufacturer} {v.model} [{v.plate}]
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Dono: {v.ownerName} (@{v.ownerAlias}) · Cond. {v.condition}% · {v.status}
                      </p>
                    </div>
                    <span className="font-mono text-amber-400">{formatBRL(v.marketValue)}</span>
                  </div>
                ))}
              </div>
            )}

            {overview.transactions.length > 0 && (
              <div className="border-t border-white/10 pt-3">
                <p className="mb-2 text-[11px] font-semibold text-slate-400 uppercase">
                  Últimas Operações Veiculares
                </p>
                <div className="divide-y divide-white/5 text-[11px]">
                  {overview.transactions.slice(0, 6).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between py-1.5">
                      <span className="truncate text-slate-300">
                        {getVehicleTxLabel(tx.type)}: {tx.vehicleLabel} ({tx.fromLabel} → {tx.toLabel})
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-amber-400">
                        {formatBRL(tx.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
