import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Send,
  Wallet as WalletIcon,
  Landmark,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
  Search,
} from 'lucide-react';
import { useGame } from '../../context/GameContext';
import { formatBRL, LCE_BANK_NAME } from '../../config/economyCatalog';
import {
  createOperationId,
  depositCleanCash,
  timestampToEpochMs,
  transferBankFunds,
  withdrawBankCash,
} from '../../services/economyService';
import type { FinancialTransaction, TransactionType } from '../../types/economy';

type BankActionTab = 'depositar' | 'sacar' | 'transferir';
type HistoryFilter = 'all' | TransactionType | 'dirty_cash';

interface PendingTransferConfirmation {
  recipientUid: string;
  recipientName: string;
  recipientAlias: string;
  recipientAccount: string;
  amount: number;
  description: string;
  operationId: string;
}

const TX_TYPE_LABELS: Record<TransactionType, string> = {
  deposit: 'Depósito',
  withdraw: 'Saque',
  transfer: 'Transferência',
  salary: 'Salário Legal',
  admin_adjustment: 'Ajuste Admin',
  business_purchase: 'Compra de Empresa',
  business_sale: 'Venda P2P Empresa',
  business_payroll: 'Folha Empresarial',
  business_capital: 'Caixa Empresarial',
  vehicle_purchase: 'Compra de Veículo',
  vehicle_p2p_sale: 'Veículo Usado (P2P)',
  vehicle_maintenance: 'Manutenção Veicular',
  vehicle_commission: 'Comissão Veicular',
};

function formatDateTime(val: unknown): string {
  const ms = timestampToEpochMs(val);
  if (!ms) return 'Agora';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ms));
}

export function FinanceModule() {
  const {
    firebaseUser,
    character,
    wallet,
    bankAccount,
    transactions,
    bankDirectory,
    myVehicles,
    economyReady,
    economyError,
  } = useGame();

  const [activeTab, setActiveTab] = useState<BankActionTab>('depositar');
  const [amountInput, setAmountInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [recipientUid, setRecipientUid] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransferConfirmation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [guardCheckResult, setGuardCheckResult] = useState<string | null>(null);

  const cleanCash = wallet?.cleanCash ?? character?.cashBalance ?? 0;
  const dirtyCash = wallet?.dirtyCash ?? 0;
  const bankBalance = bankAccount?.balance ?? character?.bankBalance ?? 0;
  const companiesValue = wallet?.companiesValue ?? 0;
  const realEstateValue = wallet?.realEstateValue ?? 0;
  const vehiclesValue =
    myVehicles.length > 0
      ? Math.round(myVehicles.reduce((sum, v) => sum + v.marketValue, 0) * 100) / 100
      : wallet?.vehiclesValue ?? 0;
  const investmentsValue = wallet?.investmentsValue ?? 0;
  const otherAssetsValue = wallet?.otherAssetsValue ?? 0;

  const totalPatrimony =
    cleanCash +
    bankBalance +
    companiesValue +
    realEstateValue +
    vehiclesValue +
    investmentsValue +
    otherAssetsValue;

  const availableRecipients = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    return bankDirectory.filter((entry) => {
      if (entry.uid === firebaseUser?.uid) return false;
      if (!q) return true;
      return (
        entry.characterName.toLowerCase().includes(q) ||
        entry.alias.toLowerCase().includes(q) ||
        entry.accountNumber.toLowerCase().includes(q)
      );
    });
  }, [bankDirectory, firebaseUser?.uid, recipientSearch]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (historyFilter === 'all') return true;
      if (historyFilter === 'dirty_cash') return tx.currencyCategory === 'dirty_cash';
      return tx.type === historyFilter;
    });
  }, [transactions, historyFilter]);

  const parseAmount = (): number | null => {
    const normalized = amountInput.replace(',', '.').trim();
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed * 100) / 100;
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setFeedback(null);

    const amount = parseAmount();
    if (!amount) {
      setFeedback({ type: 'err', text: 'Informe um valor positivo válido para depósito.' });
      return;
    }
    if (amount > cleanCash) {
      setFeedback({
        type: 'err',
        text: 'Saldo de dinheiro limpo insuficiente na carteira física.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const opId = createOperationId('dep');
      const res = await depositCleanCash(
        firebaseUser,
        amount,
        descriptionInput.trim() || undefined,
        opId
      );
      setAmountInput('');
      setDescriptionInput('');
      setFeedback({
        type: 'ok',
        text: `Depósito de ${formatBRL(amount)} concluído. Comprovante: ${res.txId}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao processar depósito.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setFeedback(null);

    const amount = parseAmount();
    if (!amount) {
      setFeedback({ type: 'err', text: 'Informe um valor positivo válido para saque.' });
      return;
    }
    if (amount > bankBalance) {
      setFeedback({ type: 'err', text: 'Saldo bancário insuficiente para este saque.' });
      return;
    }

    setSubmitting(true);
    try {
      const opId = createOperationId('wdr');
      const res = await withdrawBankCash(
        firebaseUser,
        amount,
        descriptionInput.trim() || undefined,
        opId
      );
      setAmountInput('');
      setDescriptionInput('');
      setFeedback({
        type: 'ok',
        text: `Saque de ${formatBRL(amount)} concluído. Comprovante: ${res.txId}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao processar saque.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrepareTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const amount = parseAmount();
    if (!amount) {
      setFeedback({ type: 'err', text: 'Informe um valor positivo válido para transferência.' });
      return;
    }
    if (amount > bankBalance) {
      setFeedback({ type: 'err', text: 'Saldo bancário insuficiente para esta transferência.' });
      return;
    }

    const recipient = bankDirectory.find((entry) => entry.uid === recipientUid);
    if (!recipient) {
      setFeedback({ type: 'err', text: 'Selecione um destinatário válido no diretório bancário.' });
      return;
    }

    setPendingTransfer({
      recipientUid: recipient.uid,
      recipientName: recipient.characterName,
      recipientAlias: recipient.alias,
      recipientAccount: recipient.accountNumber,
      amount,
      description: descriptionInput.trim() || 'Transferência bancária entre cidadãos',
      operationId: createOperationId('trf'),
    });
  };

  const handleConfirmTransfer = async () => {
    if (!firebaseUser || !pendingTransfer) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await transferBankFunds(
        firebaseUser,
        pendingTransfer.recipientUid,
        pendingTransfer.amount,
        pendingTransfer.description,
        pendingTransfer.operationId
      );
      setPendingTransfer(null);
      setAmountInput('');
      setDescriptionInput('');
      setFeedback({
        type: 'ok',
        text: `Transferência de ${formatBRL(pendingTransfer.amount)} enviada para ${res.recipientLabel}. Comprovante: ${res.txId}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falha ao confirmar transferência.',
      });
      setPendingTransfer(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestServerGuard = async () => {
    if (!firebaseUser) return;
    setGuardCheckResult('Testando bloqueio de alteração arbitrária no servidor...');
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/economy/mutate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ attemptedBalance: 999999 }),
      });
      const data = (await res.json()) as { error?: string; policy?: string };
      setGuardCheckResult(`HTTP ${res.status}: ${data.error ?? ''} ${data.policy ?? ''}`.trim());
    } catch {
      setGuardCheckResult('Não foi possível contatar o servidor de validação.');
    }
  };

  const isOutgoing = (tx: FinancialTransaction): boolean => {
    if (!firebaseUser) return false;
    if (tx.type === 'transfer') return tx.fromUid === firebaseUser.uid;
    if (tx.type === 'withdraw') return false;
    if (tx.type === 'admin_adjustment') return tx.fromUid === firebaseUser.uid;
    return false;
  };

  return (
    <div className="space-y-6">
      {economyError && (
        <div className="flex items-start gap-2.5 border border-red-500/35 bg-red-500/10 p-3.5 text-xs text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{economyError}</span>
        </div>
      )}

      {/* 1. Primary Individual Balances */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-white/10 bg-[#121722] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Dinheiro Limpo (Espécie)</span>
            <WalletIcon className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-slate-100">
            {formatBRL(cleanCash)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Carteira física legal · aceito em depósitos
          </p>
        </div>

        <div className="border border-amber-500/25 bg-[#121722] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Conta Bancária Legal</span>
            <Landmark className="h-4 w-4 text-amber-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-amber-400">
            {formatBRL(bankBalance)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-400">
            {bankAccount?.accountNumber ?? (economyReady ? 'Inicializando...' : 'Sincronizando...')}
          </p>
        </div>

        <div className="border border-red-500/25 bg-[#161117] p-4">
          <div className="flex items-center justify-between text-xs text-red-300/90">
            <span>Dinheiro Sujo (Separado)</span>
            <AlertTriangle className="h-4 w-4 text-red-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-red-300">
            {formatBRL(dirtyCash)}
          </p>
          <p className="mt-1 text-[11px] text-red-300/70">
            Origem clandestina · bloqueado em bancos legais
          </p>
        </div>

        <div className="border border-white/10 bg-[#121722] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Patrimônio Total Legal</span>
            <ShieldCheck className="h-4 w-4 text-sky-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-slate-50">
            {formatBRL(totalPatrimony)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Soma de liquidez legal + bens declarados
          </p>
        </div>
      </section>

      {/* 2. Patrimony Breakdown (All 7 Required Categories) */}
      <section className="border border-white/10 bg-[#121722] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Composição do Patrimônio</h3>
            <p className="text-xs text-slate-400">
              Inventário patrimonial consolidado (dinheiro sujo permanece fora da contabilidade legal).
            </p>
          </div>
          <span className="font-mono text-xs text-slate-400">{LCE_BANK_NAME}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { label: 'Espécie Limpo', value: cleanCash },
            { label: 'Saldo Bancário', value: bankBalance },
            { label: 'Empresas', value: companiesValue },
            { label: 'Imóveis', value: realEstateValue },
            { label: 'Veículos', value: vehiclesValue },
            { label: 'Investimentos', value: investmentsValue },
            { label: 'Outros Bens', value: otherAssetsValue },
          ].map((item) => (
            <div key={item.label} className="border border-white/10 bg-[#0A0D14] p-3">
              <p className="text-[11px] text-slate-400">{item.label}</p>
              <p className="mt-1 font-mono text-xs font-medium tabular-nums text-slate-100">
                {formatBRL(item.value)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Banco Central LCE — Operations Console */}
      <section className="border border-white/10 bg-[#121722] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-xs font-semibold tracking-wider text-amber-500">
              SISTEMA BANCÁRIO OFICIAL
            </p>
            <h3 className="font-display text-2xl font-bold text-slate-50">{LCE_BANK_NAME}</h3>
            <p className="text-xs text-slate-400">
              Titular: {character?.characterName} (@{character?.alias}) · Conta:{' '}
              <span className="font-mono text-slate-200">
                {bankAccount?.accountNumber ?? '---'}
              </span>{' '}
              · Status:{' '}
              <span className={bankAccount?.status === 'frozen' ? 'text-red-400' : 'text-emerald-400'}>
                {bankAccount?.status === 'frozen' ? 'Congelada' : 'Ativa'}
              </span>
            </p>
          </div>

          <div className="grid grid-cols-3 border border-white/10 bg-[#0A0D14]">
            {(
              [
                { id: 'depositar', label: 'Depositar', Icon: ArrowDownLeft },
                { id: 'sacar', label: 'Sacar', Icon: ArrowUpRight },
                { id: 'transferir', label: 'Transferir', Icon: Send },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  setPendingTransfer(null);
                  setFeedback(null);
                }}
                className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 px-3.5 text-xs font-semibold transition-colors ${
                  activeTab === id
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {feedback && (
          <div
            className={`mt-4 flex items-start gap-2.5 border p-3.5 text-xs ${
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

        {/* DEPOSIT FORM */}
        {activeTab === 'depositar' && (
          <form onSubmit={handleDeposit} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="dep-amount" className="mb-1 block text-xs text-slate-300">
                  Valor do Depósito (Dinheiro Limpo em Espécie)
                </label>
                <input
                  id="dep-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={cleanCash}
                  placeholder="0,00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                />
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Disponível em espécie limpo: {formatBRL(cleanCash)}</span>
                  <button
                    type="button"
                    onClick={() => setAmountInput(String(cleanCash))}
                    className="font-semibold text-amber-400 hover:text-amber-300"
                  >
                    Usar total
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="dep-desc" className="mb-1 block text-xs text-slate-300">
                  Descrição (opcional)
                </label>
                <input
                  id="dep-desc"
                  type="text"
                  maxLength={120}
                  placeholder="Ex.: Reserva de caixa pessoal"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] px-3 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Dinheiro sujo ({formatBRL(dirtyCash)}) não pode ser depositado em contas legais.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || cleanCash <= 0 || bankAccount?.status === 'frozen'}
              className="inline-flex min-h-[42px] items-center gap-2 bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              <ArrowDownLeft className="h-4 w-4" />
              <span>{submitting ? 'Processando no servidor...' : 'Confirmar Depósito Legal'}</span>
            </button>
          </form>
        )}

        {/* WITHDRAW FORM */}
        {activeTab === 'sacar' && (
          <form onSubmit={handleWithdraw} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wdr-amount" className="mb-1 block text-xs text-slate-300">
                  Valor do Saque (Conta Bancária → Carteira Limpa)
                </label>
                <input
                  id="wdr-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={bankBalance}
                  placeholder="0,00"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                />
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Saldo bancário disponível: {formatBRL(bankBalance)}</span>
                  <button
                    type="button"
                    onClick={() => setAmountInput(String(bankBalance))}
                    className="font-semibold text-amber-400 hover:text-amber-300"
                  >
                    Sacar total
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="wdr-desc" className="mb-1 block text-xs text-slate-300">
                  Descrição (opcional)
                </label>
                <input
                  id="wdr-desc"
                  type="text"
                  maxLength={120}
                  placeholder="Ex.: Retirada para despesas do dia"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] px-3 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || bankBalance <= 0 || bankAccount?.status === 'frozen'}
              className="inline-flex min-h-[42px] items-center gap-2 bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              <ArrowUpRight className="h-4 w-4" />
              <span>{submitting ? 'Processando no servidor...' : 'Confirmar Saque em Espécie'}</span>
            </button>
          </form>
        )}

        {/* TRANSFER FORM + MANDATORY CONFIRMATION STEP */}
        {activeTab === 'transferir' && (
          <div className="mt-5 space-y-4">
            {!pendingTransfer ? (
              <form onSubmit={handlePrepareTransfer} className="space-y-4">
                <div>
                  <label htmlFor="trf-search" className="mb-1 block text-xs text-slate-300">
                    Buscar Cidadão Destinatário (Nome, @codinome ou Conta LCE)
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      id="trf-search"
                      type="text"
                      placeholder="Filtrar cidadãos com conta ativa..."
                      value={recipientSearch}
                      onChange={(e) => setRecipientSearch(e.target.value)}
                      className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] pl-9 pr-3 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="trf-recipient" className="mb-1 block text-xs text-slate-300">
                      Destinatário ({availableRecipients.length} disponíveis)
                    </label>
                    <select
                      id="trf-recipient"
                      value={recipientUid}
                      onChange={(e) => setRecipientUid(e.target.value)}
                      className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] px-3 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                    >
                      <option value="">Selecione um cidadão...</option>
                      {availableRecipients.map((entry) => (
                        <option key={entry.uid} value={entry.uid}>
                          {entry.characterName} (@{entry.alias}) · {entry.accountNumber}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="trf-amount" className="mb-1 block text-xs text-slate-300">
                      Valor a Transferir (R$)
                    </label>
                    <input
                      id="trf-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={bankBalance}
                      placeholder="0,00"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] px-3 font-mono text-sm tabular-nums text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="trf-desc" className="mb-1 block text-xs text-slate-300">
                    Motivo / Referência da Transferência
                  </label>
                  <input
                    id="trf-desc"
                    type="text"
                    maxLength={120}
                    placeholder="Ex.: Pagamento por serviço prestado"
                    value={descriptionInput}
                    onChange={(e) => setDescriptionInput(e.target.value)}
                    className="min-h-[42px] w-full border border-white/15 bg-[#0A0D14] px-3 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !recipientUid || bankBalance <= 0 || bankAccount?.status === 'frozen'}
                  className="inline-flex min-h-[42px] items-center gap-2 bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>Revisar e Confirmar Transferência</span>
                </button>
              </form>
            ) : (
              <div className="space-y-4 border border-amber-500/40 bg-[#0A0D14] p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span>CONFIRMAÇÃO OBRIGATÓRIA DE TRANSFERÊNCIA BANCÁRIA</span>
                </div>
                <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <p className="text-slate-400">Remetente</p>
                    <p className="font-semibold text-slate-100">
                      {character?.characterName} (@{character?.alias})
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      Conta {bankAccount?.accountNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Destinatário</p>
                    <p className="font-semibold text-slate-100">
                      {pendingTransfer.recipientName} (@{pendingTransfer.recipientAlias})
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      Conta {pendingTransfer.recipientAccount}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Valor da Operação</p>
                    <p className="font-mono text-lg font-semibold tabular-nums text-amber-400">
                      {formatBRL(pendingTransfer.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-400">Identificador Único (Antiduplicação)</p>
                    <p className="font-mono text-[11px] text-slate-300">
                      {pendingTransfer.operationId}
                    </p>
                    <p className="mt-1 text-slate-400">{pendingTransfer.description}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleConfirmTransfer()}
                    className="inline-flex min-h-[42px] items-center gap-2 bg-amber-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{submitting ? 'Enviando...' : 'Confirmar e Executar Transferência'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setPendingTransfer(null)}
                    className="min-h-[42px] border border-white/15 bg-[#151B27] px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-[#1E2638]"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4. Immutable Statement & Transaction History */}
      <section className="border border-white/10 bg-[#121722] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              Extrato Financeiro & Histórico Imutável
            </h3>
            <p className="text-xs text-slate-400">
              Todos os lançamentos são registrados no servidor e não podem ser alterados ou excluídos.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'deposit', label: 'Depósitos' },
                { id: 'withdraw', label: 'Saques' },
                { id: 'transfer', label: 'Transferências' },
                { id: 'salary', label: 'Salários' },
                { id: 'dirty_cash', label: 'Dinheiro Sujo' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setHistoryFilter(f.id)}
                className={`border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  historyFilter === f.id
                    ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                    : 'border-white/10 bg-[#0A0D14] text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            Nenhuma movimentação registrada neste filtro ainda. Realize um depósito, saque,
            transferência ou conclua um expediente de trabalho.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="py-2.5 pr-4 font-medium">Data / ID</th>
                  <th className="py-2.5 pr-4 font-medium">Tipo</th>
                  <th className="py-2.5 pr-4 font-medium">Origem → Destino</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Valor</th>
                  <th className="py-2.5 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredTransactions.map((tx) => {
                  const outgoing = isOutgoing(tx);
                  const isDirty = tx.currencyCategory === 'dirty_cash';
                  return (
                    <tr key={tx.id}>
                      <td className="py-3 pr-4 align-top">
                        <p className="font-mono text-[11px] tabular-nums text-slate-300">
                          {formatDateTime(tx.createdAt)}
                        </p>
                        <p className="font-mono text-[10px] text-slate-500">{tx.id}</p>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <p className="font-medium text-slate-100">
                          {TX_TYPE_LABELS[tx.type] ?? tx.type}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {isDirty
                            ? 'Dinheiro Sujo'
                            : tx.currencyCategory === 'clean_cash'
                            ? 'Dinheiro Limpo'
                            : 'Conta Bancária'}
                        </p>
                      </td>
                      <td className="py-3 pr-4 align-top">
                        <p className="text-slate-200">
                          {tx.fromLabel} → {tx.toLabel}
                        </p>
                        <p className="text-[11px] text-slate-400">{tx.description}</p>
                      </td>
                      <td
                        className={`py-3 pr-4 text-right align-top font-mono font-semibold tabular-nums ${
                          isDirty
                            ? 'text-red-300'
                            : outgoing
                            ? 'text-rose-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {outgoing ? '-' : '+'} {formatBRL(tx.amount)}
                      </td>
                      <td className="py-3 text-right align-top">
                        <span className="font-mono text-[11px] text-emerald-400">Concluída</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 5. Anti-Tamper Server Policy Verification */}
      <section className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#121722] p-4">
        <div className="flex items-start gap-2.5">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-xs font-semibold text-slate-200">
              Proteção Financeira Autoritativa no Servidor
            </p>
            <p className="text-[11px] text-slate-400">
              Saldos nunca são editáveis pelo cliente. Todas as transações exigem validação no
              backend + regras atômicas do Firestore.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleTestServerGuard()}
          className="min-h-[36px] border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
        >
          Validar Bloqueio no Servidor
        </button>
        {guardCheckResult && (
          <p className="w-full border-t border-white/10 pt-2.5 font-mono text-[11px] text-slate-300">
            {guardCheckResult}
          </p>
        )}
      </section>
    </div>
  );
}
