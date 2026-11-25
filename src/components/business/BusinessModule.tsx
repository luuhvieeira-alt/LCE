import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Briefcase,
  Store,
  Search,
  MapPin,
  Users,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Tag,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL } from '../../config/economyCatalog';
import { getBusinessStatusLabel, getReputationTier } from '../../config/businessCatalog';
import {
  acquireBusiness,
  applyToBusinessVacancy,
  decideBusinessApplication,
} from '../../services/businessService';
import type { BusinessLocation } from '../../types/business';
import { BusinessDetailPanel } from './BusinessDetailPanel';

type HubTab = 'catalogo' | 'minhas' | 'vagas';

export function BusinessModule() {
  const {
    firebaseUser,
    bankAccount,
    businessLocations,
    businesses,
    openVacancies,
    myEmployeeContracts,
    myBusinessApplications,
    selectedBusinessId,
    setSelectedBusinessId,
  } = useGame();

  const [hubTab, setHubTab] = useState<HubTab>('catalogo');
  const [searchQuery, setSearchQuery] = useState('');
  const [acquiringLocation, setAcquiringLocation] = useState<BusinessLocation | null>(null);
  const [customBusinessName, setCustomBusinessName] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const ownedByMe = useMemo(
    () => businesses.filter((b) => b.ownerUid === firebaseUser?.uid),
    [businesses, firebaseUser?.uid]
  );

  const activeContracts = useMemo(
    () => myEmployeeContracts.filter((c) => c.status === 'active'),
    [myEmployeeContracts]
  );

  const businessByLocationId = useMemo(() => {
    const map = new Map<string, (typeof businesses)[number]>();
    for (const b of businesses) {
      map.set(b.locationId, b);
    }
    return map;
  }, [businesses]);

  // If user clicked "Entrar na Empresa" from 3D proximity prompt on an unowned locationId,
  // automatically open the acquisition panel for that location.
  useEffect(() => {
    if (!selectedBusinessId) return;
    const existingBiz = businesses.find((b) => b.id === selectedBusinessId);
    if (existingBiz) return;

    const loc = businessLocations.find((l) => l.id === selectedBusinessId);
    if (loc) {
      const bizForLoc = businessByLocationId.get(loc.id);
      if (bizForLoc) {
        setSelectedBusinessId(bizForLoc.id);
      } else {
        setAcquiringLocation(loc);
        setCustomBusinessName(loc.name);
        setSelectedBusinessId(null);
        setHubTab('catalogo');
      }
    }
  }, [selectedBusinessId, businesses, businessLocations, businessByLocationId, setSelectedBusinessId]);

  if (!firebaseUser) return null;

  // If a concrete businessId is selected, render its full individual dashboard
  const selectedBusinessExists = selectedBusinessId
    ? businesses.some((b) => b.id === selectedBusinessId)
    : false;

  if (selectedBusinessId && selectedBusinessExists) {
    return (
      <BusinessDetailPanel
        businessId={selectedBusinessId}
        onBack={() => setSelectedBusinessId(null)}
      />
    );
  }

  const bankBalance = bankAccount?.balance ?? 0;

  const filteredLocations = businessLocations.filter((loc) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const owned = businessByLocationId.get(loc.id);
    return (
      loc.name.toLowerCase().includes(q) ||
      loc.category.toLowerCase().includes(q) ||
      loc.locationLabel.toLowerCase().includes(q) ||
      (owned?.name.toLowerCase().includes(q) ?? false) ||
      (owned?.ownerName.toLowerCase().includes(q) ?? false)
    );
  });

  const handleConfirmAcquire = async () => {
    if (!acquiringLocation) return;
    setFeedback(null);
    setBusy(true);
    try {
      const res = await acquireBusiness(
        firebaseUser,
        acquiringLocation.id,
        customBusinessName.trim() || acquiringLocation.name
      );
      setAcquiringLocation(null);
      setCustomBusinessName('');
      setFeedback({
        type: 'ok',
        text: `${res.name} adquirida com sucesso por ${formatBRL(res.acquisitionPrice)}! Capital inicial em caixa: ${formatBRL(res.initialCapital)}.`,
      });
      setSelectedBusinessId(res.businessId);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erro ao adquirir estabelecimento.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border border-white/10 bg-[#121722] p-4">
          <p className="text-[11px] text-slate-400">Saldo Bancário</p>
          <p className="mt-1 font-mono text-xl font-medium tabular-nums text-amber-400">
            {formatBRL(bankBalance)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Para aquisições e aportes</p>
        </div>
        <div className="border border-white/10 bg-[#121722] p-4">
          <p className="text-[11px] text-slate-400">Minhas Empresas</p>
          <p className="mt-1 font-mono text-xl font-medium tabular-nums text-slate-100">
            {ownedByMe.length}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {businesses.length} ativas na cidade
          </p>
        </div>
        <div className="border border-white/10 bg-[#121722] p-4">
          <p className="text-[11px] text-slate-400">Meus Vínculos</p>
          <p className="mt-1 font-mono text-xl font-medium tabular-nums text-emerald-400">
            {activeContracts.length}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {myBusinessApplications.filter((a) => a.status === 'offer_sent').length} proposta(s)
          </p>
        </div>
        <div className="border border-white/10 bg-[#121722] p-4">
          <p className="text-[11px] text-slate-400">Vagas Abertas</p>
          <p className="mt-1 font-mono text-xl font-medium tabular-nums text-slate-100">
            {openVacancies.length}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">Mercado corporativo LCE</p>
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

      {/* Acquisition Confirmation Drawer/Panel */}
      {acquiringLocation && (
        <div className="space-y-4 border border-amber-500/40 bg-[#121722] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-amber-400">
                ABERTURA E AQUISIÇÃO DE EMPRESA LEGAL
              </p>
              <h3 className="mt-0.5 font-display text-2xl font-bold text-slate-50">
                {acquiringLocation.name}
              </h3>
              <p className="text-xs text-slate-400">
                {acquiringLocation.category} · {acquiringLocation.locationLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAcquiringLocation(null)}
              className="border border-white/15 bg-[#0A0D14] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            >
              Cancelar
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 border-y border-white/10 py-3 text-xs sm:grid-cols-4">
            <div>
              <span className="text-slate-400">Valor de Aquisição</span>
              <p className="font-mono text-sm font-semibold text-amber-400">
                {formatBRL(acquiringLocation.acquisitionPrice)}
              </p>
            </div>
            <div>
              <span className="text-slate-400">Capital Inicial em Caixa</span>
              <p className="font-mono text-sm font-semibold text-emerald-400">
                {formatBRL(acquiringLocation.initialCapital)}
              </p>
            </div>
            <div>
              <span className="text-slate-400">Despesa Operacional</span>
              <p className="font-mono text-sm text-slate-200">
                {formatBRL(acquiringLocation.operatingExpense)}/ciclo
              </p>
            </div>
            <div>
              <span className="text-slate-400">Capacidade Máxima</span>
              <p className="font-mono text-sm text-slate-200">
                {acquiringLocation.maxEmployees} funcionários
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs text-slate-300">
                Nome fantasia da sua empresa
              </label>
              <input
                type="text"
                value={customBusinessName}
                onChange={(e) => setCustomBusinessName(e.target.value)}
                maxLength={64}
                className="w-full border border-white/15 bg-[#0A0D14] px-3 py-2 text-xs text-slate-100 outline-none focus:border-amber-500"
              />
            </div>
            <button
              type="button"
              disabled={busy || bankBalance < acquiringLocation.acquisitionPrice}
              onClick={() => void handleConfirmAcquire()}
              className="min-h-[38px] bg-amber-500 px-5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
            >
              {busy
                ? 'Processando registro...'
                : bankBalance < acquiringLocation.acquisitionPrice
                ? 'Saldo Bancário Insuficiente'
                : `Confirmar Compra (${formatBRL(acquiringLocation.acquisitionPrice)})`}
            </button>
          </div>
        </div>
      )}

      {/* Primary Segmented Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-2">
        <div className="flex gap-1 overflow-x-auto">
          {(
            [
              { id: 'catalogo', label: `Mercado & Estabelecimentos (${businessLocations.length})`, icon: Store },
              { id: 'minhas', label: `Minhas Empresas (${ownedByMe.length})`, icon: Building2 },
              { id: 'vagas', label: `Vagas & Empregos (${openVacancies.length})`, icon: Briefcase },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = hubTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setHubTab(item.id)}
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

        {hubTab === 'catalogo' && (
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar empresa, setor ou dono..."
              className="w-full border border-white/15 bg-[#0A0D14] py-1.5 pr-3 pl-8 text-xs text-slate-100 outline-none focus:border-amber-500"
            />
          </div>
        )}
      </div>

      {/* TAB 1: MERCADO & CATÁLOGO DOS 10 TIPOS DE EMPRESAS */}
      {hubTab === 'catalogo' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredLocations.map((loc) => {
            const owned = businessByLocationId.get(loc.id);
            const isMine = owned?.ownerUid === firebaseUser.uid;
            return (
              <div
                key={loc.id}
                className="flex flex-col justify-between gap-4 border border-white/10 bg-[#121722] p-4"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-medium text-amber-400">{loc.category}</p>
                      <h4 className="text-base font-semibold text-slate-100">
                        {owned ? owned.name : loc.name}
                      </h4>
                    </div>
                    {owned ? (
                      <span
                        className={`shrink-0 font-mono text-[11px] font-semibold ${
                          owned.forSale
                            ? 'text-emerald-400'
                            : isMine
                            ? 'text-amber-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {owned.forSale
                          ? `À VENDA · ${formatBRL(owned.salePrice)}`
                          : isMine
                          ? 'SUA EMPRESA'
                          : 'EM OPERAÇÃO'}
                      </span>
                    ) : (
                      <span className="shrink-0 font-mono text-[11px] font-semibold text-emerald-400">
                        DISPONÍVEL
                      </span>
                    )}
                  </div>

                  <p className="text-xs leading-relaxed text-slate-400">{loc.description}</p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-slate-500" />
                      {loc.locationLabel} ({loc.posX}, {loc.posZ})
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Users className="h-3 w-3 text-slate-500" />
                      {owned
                        ? `${owned.employeeCount}/${owned.maxEmployees} func.`
                        : `Até ${loc.maxEmployees} func.`}
                    </span>
                  </div>
                </div>

                <div className="space-y-3 border-t border-white/10 pt-3">
                  {owned ? (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div>
                        <p className="text-[11px] text-slate-500">Proprietário</p>
                        <p className="font-medium text-slate-200">
                          {owned.ownerName}{' '}
                          <span className="font-mono text-slate-400">@{owned.ownerAlias}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedBusinessId(owned.id)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 border border-amber-500/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                      >
                        <span>{isMine ? 'Administrar' : 'Entrar / Ver'}</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex gap-4">
                        <div>
                          <span className="block text-[10px] text-slate-500">Aquisição</span>
                          <span className="font-mono font-semibold tabular-nums text-amber-400">
                            {formatBRL(loc.acquisitionPrice)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500">Caixa Inicial</span>
                          <span className="font-mono tabular-nums text-emerald-400">
                            {formatBRL(loc.initialCapital)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500">Despesa</span>
                          <span className="font-mono tabular-nums text-slate-300">
                            {formatBRL(loc.operatingExpense)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!loc.available}
                        onClick={() => {
                          setAcquiringLocation(loc);
                          setCustomBusinessName(loc.name);
                        }}
                        className="min-h-[36px] bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                      >
                        {loc.available ? 'Adquirir' : 'Indisponível'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: MINHAS EMPRESAS & MEUS CONTRATOS */}
      {hubTab === 'minhas' && (
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Empresas sob minha gestão ({ownedByMe.length})
            </h3>
            {ownedByMe.length === 0 ? (
              <div className="border border-white/10 bg-[#121722] p-6 text-xs text-slate-400">
                Você ainda não possui empresas. Escolha um dos 10 estabelecimentos disponíveis na aba{' '}
                <button
                  type="button"
                  onClick={() => setHubTab('catalogo')}
                  className="font-semibold text-amber-400 underline"
                >
                  Mercado & Estabelecimentos
                </button>
                .
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {ownedByMe.map((biz) => (
                  <div
                    key={biz.id}
                    className="space-y-3 border border-white/10 bg-[#121722] p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] text-amber-400">{biz.category}</p>
                        <h4 className="text-base font-semibold text-slate-100">{biz.name}</h4>
                        <p className="text-[11px] text-slate-400">{biz.locationLabel}</p>
                      </div>
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          biz.status === 'active'
                            ? 'text-emerald-400'
                            : biz.status === 'inactive_funds'
                            ? 'text-amber-400'
                            : 'text-red-400'
                        }`}
                      >
                        {getBusinessStatusLabel(biz.status)}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-y border-white/10 py-2.5 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500">Valor Mercado</span>
                        <p className="font-mono font-medium tabular-nums text-slate-100">
                          {formatBRL(biz.marketValue)}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500">Equipe</span>
                        <p className="font-mono tabular-nums text-slate-200">
                          {biz.employeeCount}/{biz.maxEmployees}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500">Reputação</span>
                        <p className="font-mono tabular-nums text-emerald-400">
                          {biz.reputation}/100
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        {biz.forSale ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <Tag className="h-3 w-3" /> À venda por {formatBRL(biz.salePrice)}
                          </span>
                        ) : (
                          getReputationTier(biz.reputation)
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedBusinessId(biz.id)}
                        className="inline-flex min-h-[36px] items-center gap-1.5 bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                      >
                        <span>Painel da Empresa</span>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wider text-slate-300 uppercase">
              Meus Empregos em Empresas de Jogadores ({myEmployeeContracts.length})
            </h3>
            {myEmployeeContracts.length === 0 ? (
              <p className="border border-white/10 bg-[#121722] p-4 text-xs text-slate-400">
                Você ainda não possui vínculos empregatícios em empresas privadas.
              </p>
            ) : (
              <div className="space-y-2.5">
                {myEmployeeContracts.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#121722] p-4 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-100">
                        {c.businessName} · <span className="text-amber-400">{c.roleTitle}</span>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Salário: <span className="font-mono">{formatBRL(c.salary)}</span> · Total
                        recebido: <span className="font-mono">{formatBRL(c.totalPaid)}</span> ·
                        Status: <span className="uppercase">{c.status}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedBusinessId(c.businessId)}
                      className="min-h-[34px] border border-white/15 bg-[#0A0D14] px-3 text-xs font-semibold text-slate-200 hover:bg-white/5"
                    >
                      Abrir Empresa
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: MURAL DE VAGAS & CANDIDATURAS */}
      {hubTab === 'vagas' && (
        <div className="space-y-6">
          {/* Pending offers for me */}
          {myBusinessApplications.length > 0 && (
            <section className="space-y-2.5 border border-white/10 bg-[#121722] p-5">
              <h3 className="text-xs font-semibold tracking-wider text-amber-400 uppercase">
                Minhas Candidaturas & Propostas ({myBusinessApplications.length})
              </h3>
              <div className="space-y-2">
                {myBusinessApplications.map((app) => (
                  <div
                    key={app.id}
                    className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#0A0D14] p-3.5 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-slate-100">
                        {app.businessName} — {app.roleTitle}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Salário: {formatBRL(app.offeredSalary)} · Status:{' '}
                        <span className="font-semibold text-amber-300 uppercase">{app.status}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {app.status === 'offer_sent' && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setFeedback(null);
                              try {
                                await decideBusinessApplication(
                                  firebaseUser,
                                  app.businessId,
                                  app.id,
                                  'accept_offer'
                                );
                                setFeedback({
                                  type: 'ok',
                                  text: `Proposta aceita! Você foi contratado por ${app.businessName}.`,
                                });
                              } catch (err) {
                                setFeedback({
                                  type: 'err',
                                  text: err instanceof Error ? err.message : 'Erro ao aceitar.',
                                });
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="min-h-[34px] bg-emerald-500 px-3 text-xs font-semibold text-slate-950"
                          >
                            Aceitar Proposta
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await decideBusinessApplication(
                                  firebaseUser,
                                  app.businessId,
                                  app.id,
                                  'decline_offer'
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="min-h-[34px] border border-white/15 px-3 text-xs text-slate-300"
                          >
                            Recusar
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedBusinessId(app.businessId)}
                        className="min-h-[34px] border border-white/15 bg-[#121722] px-3 text-xs text-slate-200"
                      >
                        Ver Empresa
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* All open vacancies across city */}
          <section className="space-y-3 border border-white/10 bg-[#121722] p-5">
            <h3 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
              Vagas Abertas no Distrito Central ({openVacancies.length})
            </h3>
            {openVacancies.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nenhuma empresa abriu vagas no momento. Proprietários podem publicar vagas dentro do
                painel de sua empresa.
              </p>
            ) : (
              <div className="space-y-3">
                {openVacancies.map((vac) => {
                  const isOwnVacancy = vac.ownerUid === firebaseUser.uid;
                  return (
                    <div
                      key={vac.id}
                      className="flex flex-wrap items-center justify-between gap-4 border border-white/10 bg-[#0A0D14] p-4 text-xs"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-[11px] font-medium text-amber-400">{vac.businessName}</p>
                        <p className="text-sm font-semibold text-slate-100">{vac.roleTitle}</p>
                        <p className="text-slate-400">{vac.description}</p>
                        <p className="text-[11px] text-slate-500">
                          {vac.schedule} · Requisitos: {vac.requirements} · Vagas:{' '}
                          <span className="font-mono">
                            {vac.filledSlots}/{vac.slots}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold tabular-nums text-amber-400">
                          {formatBRL(vac.salary)}
                        </span>
                        {isOwnVacancy ? (
                          <button
                            type="button"
                            onClick={() => setSelectedBusinessId(vac.businessId)}
                            className="min-h-[36px] border border-white/15 bg-[#121722] px-3 text-xs font-semibold text-slate-200"
                          >
                            Gerenciar
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setFeedback(null);
                              try {
                                await applyToBusinessVacancy(
                                  firebaseUser,
                                  vac.businessId,
                                  vac.id,
                                  'Candidatura rápida enviada pelo mural de empregos LCE.'
                                );
                                setFeedback({
                                  type: 'ok',
                                  text: `Candidatura enviada para ${vac.roleTitle} em ${vac.businessName}!`,
                                });
                              } catch (err) {
                                setFeedback({
                                  type: 'err',
                                  text:
                                    err instanceof Error
                                      ? err.message
                                      : 'Erro ao enviar candidatura.',
                                });
                              } finally {
                                setBusy(false);
                              }
                            }}
                            className="min-h-[36px] bg-amber-500 px-3.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                          >
                            Candidatar-se
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
