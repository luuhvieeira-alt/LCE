import { formatBRL } from '../../config/economyCatalog';
import type { BusinessFinance, BusinessTransaction } from '../../types/business';

interface BusinessFinanceChartProps {
  finances: BusinessFinance;
  transactions: BusinessTransaction[];
}

export function BusinessFinanceChart({ finances, transactions }: BusinessFinanceChartProps) {
  const metrics = [
    {
      label: 'Caixa Atual',
      value: finances.cashBalance,
      barColor: '#F59E0B',
      textColor: 'text-amber-400',
    },
    {
      label: 'Receita Total',
      value: finances.totalRevenue,
      barColor: '#10B981',
      textColor: 'text-emerald-400',
    },
    {
      label: 'Despesas Totais',
      value: finances.totalExpenses,
      barColor: '#EF4444',
      textColor: 'text-red-400',
    },
    {
      label: 'Folha Salarial',
      value: finances.totalPayrollPaid,
      barColor: '#38BDF8',
      textColor: 'text-sky-400',
    },
    {
      label: finances.netProfit >= 0 ? 'Lucro Líquido' : 'Prejuízo Líquido',
      value: Math.abs(finances.netProfit),
      signedValue: finances.netProfit,
      barColor: finances.netProfit >= 0 ? '#22C55E' : '#F87171',
      textColor: finances.netProfit >= 0 ? 'text-emerald-300' : 'text-red-300',
    },
  ];

  const maxMetric = Math.max(100, ...metrics.map((m) => Math.abs(m.value)));

  // Recent 10 transactions in chronological order for cashflow bar chart
  const recentFlow = [...transactions].slice(0, 10).reverse();
  const maxFlow = Math.max(50, ...recentFlow.map((t) => t.amount));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Summary Financial Bars */}
      <div className="border border-white/10 bg-[#0A0D14] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
            Demonstrativo Financeiro
          </h4>
          <span className="font-mono text-[11px] text-slate-500">Consolidado</span>
        </div>
        <div className="space-y-3">
          {metrics.map((item) => {
            const pct = Math.max(3, Math.min(100, (Math.abs(item.value) / maxMetric) * 100));
            const displayVal = item.signedValue !== undefined ? item.signedValue : item.value;
            return (
              <div key={item.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{item.label}</span>
                  <span className={`font-mono font-medium tabular-nums ${item.textColor}`}>
                    {displayVal < 0 ? `- ${formatBRL(Math.abs(displayVal))}` : formatBRL(displayVal)}
                  </span>
                </div>
                <div className="h-2 w-full bg-white/5">
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: item.barColor }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SVG Cash Flow Bar Chart */}
      <div className="border border-white/10 bg-[#0A0D14] p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h4 className="text-xs font-semibold tracking-wider text-slate-200 uppercase">
            Fluxo de Caixa Recente
          </h4>
          <span className="font-mono text-[11px] text-slate-500">
            Últimas {recentFlow.length} mov.
          </span>
        </div>

        {recentFlow.length === 0 ? (
          <div className="flex h-36 items-center justify-center text-xs text-slate-500">
            Sem movimentações registradas ainda.
          </div>
        ) : (
          <div>
            <svg
              viewBox="0 0 320 120"
              className="h-36 w-full"
              role="img"
              aria-label="Gráfico de fluxo de caixa da empresa"
            >
              {/* Subtle horizontal gridlines */}
              <line x1="0" y1="20" x2="320" y2="20" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <line x1="0" y1="60" x2="320" y2="60" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <line x1="0" y1="100" x2="320" y2="100" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />

              {recentFlow.map((tx, idx) => {
                const slotW = 320 / Math.max(recentFlow.length, 1);
                const barW = Math.max(10, Math.min(26, slotW * 0.62));
                const barH = Math.max(8, (tx.amount / maxFlow) * 84);
                const x = idx * slotW + (slotW - barW) / 2;
                const y = 100 - barH;
                const fill = tx.direction === 'in' ? '#10B981' : '#EF4444';

                return (
                  <g key={tx.id}>
                    <rect x={x} y={y} width={barW} height={barH} fill={fill} opacity="0.9" />
                    <text
                      x={x + barW / 2}
                      y={114}
                      textAnchor="middle"
                      fill="#94A3B8"
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      {tx.direction === 'in' ? '+' : '-'}
                      {Math.round(tx.amount)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 bg-emerald-500" />
                Entradas (Receitas / Aportes)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 bg-red-500" />
                Saídas (Folha / Estoque / Despesas)
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
