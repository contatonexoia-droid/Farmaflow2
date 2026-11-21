import React, { useMemo, useState } from 'react';
import { TrendingUp, Sparkles } from 'lucide-react';
import { Order } from '../types';
import { normalizeOrderOrigin, OrderOrigin } from '../lib/orderOrigin';

interface SalesOriginRoiCardProps {
  orders: Order[];
  isDarkMode?: boolean;
}

type RoiPeriod = 'today' | '7d' | '30d' | 'month';

const PERIOD_OPTIONS: { id: RoiPeriod; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'month', label: 'Este mês' },
];

const AUTOMATIC_ORIGINS: Set<OrderOrigin> = new Set([
  'google',
  'google_shopping',
  'story',
  'push',
  'recompra',
]);

interface ChannelRow {
  id: string;
  label: string;
  sublabel: string;
  barColor: string;
  revenue: number;
  count: number;
  sharePct: number;
}

const getBrazilDateKey = (date: Date): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().split('T')[0];
  }
};

const formatCurrencyBRL = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const SalesOriginRoiCard: React.FC<SalesOriginRoiCardProps> = ({
  orders,
  isDarkMode = false,
}) => {
  const [period, setPeriod] = useState<RoiPeriod>('30d');

  const roiSummary = useMemo(() => {
    const now = new Date();
    const todayKey = getBrazilDateKey(now);
    const monthPrefix = todayKey.slice(0, 7); // YYYY-MM

    const d7 = new Date(now);
    d7.setDate(d7.getDate() - 6);
    const key7d = getBrazilDateKey(d7);

    const d30 = new Date(now);
    d30.setDate(d30.getDate() - 29);
    const key30d = getBrazilDateKey(d30);

    const validOrders = (orders || []).filter((order) => {
      if (!order || !order.date) return false;
      const status = String(order.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'cancelado') return false;

      const parsed = new Date(order.date);
      if (Number.isNaN(parsed.getTime())) return false;
      const orderKey = getBrazilDateKey(parsed);

      if (period === 'today') return orderKey === todayKey;
      if (period === '7d') return orderKey >= key7d && orderKey <= todayKey;
      if (period === '30d') return orderKey >= key30d && orderKey <= todayKey;
      return orderKey.startsWith(monthPrefix);
    });

    const buckets: Record<
      'google_shopping' | 'stories_ig' | 'push' | 'recompra' | 'share_wa' | 'direct_other',
      { revenue: number; count: number }
    > = {
      google_shopping: { revenue: 0, count: 0 },
      stories_ig: { revenue: 0, count: 0 },
      push: { revenue: 0, count: 0 },
      recompra: { revenue: 0, count: 0 },
      share_wa: { revenue: 0, count: 0 },
      direct_other: { revenue: 0, count: 0 },
    };

    let totalRevenue = 0;
    let totalOrders = 0;
    let autoRevenue = 0;
    let autoOrders = 0;

    for (const order of validOrders) {
      const value = Number(order.total) || 0;
      const rawOrigin =
        order.origin ||
        (order.customer as any)?.orderOrigin ||
        (order.customer as any)?.origin;
      const origin = normalizeOrderOrigin(rawOrigin) || 'direto';

      totalRevenue += value;
      totalOrders += 1;

      if (AUTOMATIC_ORIGINS.has(origin)) {
        autoRevenue += value;
        autoOrders += 1;
      }

      if (origin === 'google' || origin === 'google_shopping') {
        buckets.google_shopping.revenue += value;
        buckets.google_shopping.count += 1;
      } else if (origin === 'story' || origin === 'instagram') {
        buckets.stories_ig.revenue += value;
        buckets.stories_ig.count += 1;
      } else if (origin === 'push') {
        buckets.push.revenue += value;
        buckets.push.count += 1;
      } else if (origin === 'recompra') {
        buckets.recompra.revenue += value;
        buckets.recompra.count += 1;
      } else if (origin === 'compartilhamento' || origin === 'whatsapp') {
        buckets.share_wa.revenue += value;
        buckets.share_wa.count += 1;
      } else {
        buckets.direct_other.revenue += value;
        buckets.direct_other.count += 1;
      }
    }

    const calcPct = (val: number, count: number): number => {
      if (totalRevenue > 0) return Math.round((val / totalRevenue) * 100);
      if (totalOrders > 0) return Math.round((count / totalOrders) * 100);
      return 0;
    };

    const channels: ChannelRow[] = [
      {
        id: 'google_shopping',
        label: 'Google & Shopping',
        sublabel: 'Busca orgânica e Google Shopping',
        barColor: 'bg-blue-600',
        revenue: buckets.google_shopping.revenue,
        count: buckets.google_shopping.count,
        sharePct: calcPct(buckets.google_shopping.revenue, buckets.google_shopping.count),
      },
      {
        id: 'stories_ig',
        label: 'Stories & Instagram',
        sublabel: 'Gerador de Stories e Instagram',
        barColor: 'bg-rose-500',
        revenue: buckets.stories_ig.revenue,
        count: buckets.stories_ig.count,
        sharePct: calcPct(buckets.stories_ig.revenue, buckets.stories_ig.count),
      },
      {
        id: 'push',
        label: 'Notificações Push',
        sublabel: 'Disparos diretos no celular',
        barColor: 'bg-violet-600',
        revenue: buckets.push.revenue,
        count: buckets.push.count,
        sharePct: calcPct(buckets.push.revenue, buckets.push.count),
      },
      {
        id: 'recompra',
        label: 'Radar de Recompra',
        sublabel: 'Lembretes de reposição e pedido 1-toque',
        barColor: 'bg-teal-600',
        revenue: buckets.recompra.revenue,
        count: buckets.recompra.count,
        sharePct: calcPct(buckets.recompra.revenue, buckets.recompra.count),
      },
      {
        id: 'share_wa',
        label: 'Compartilhamento & WhatsApp',
        sublabel: 'Links compartilhados e WhatsApp',
        barColor: 'bg-emerald-600',
        revenue: buckets.share_wa.revenue,
        count: buckets.share_wa.count,
        sharePct: calcPct(buckets.share_wa.revenue, buckets.share_wa.count),
      },
      {
        id: 'direct_other',
        label: 'Acesso Direto / Outros',
        sublabel: 'Link salvo, QR Code e outros',
        barColor: 'bg-slate-400',
        revenue: buckets.direct_other.revenue,
        count: buckets.direct_other.count,
        sharePct: calcPct(buckets.direct_other.revenue, buckets.direct_other.count),
      },
    ];

    const autoPct = calcPct(autoRevenue, autoOrders);

    return {
      totalRevenue,
      totalOrders,
      autoRevenue,
      autoOrders,
      autoPct,
      channels,
    };
  }, [orders, period]);

  return (
    <section
      className={`rounded-2xl border p-6 transition-colors ${
        isDarkMode
          ? 'bg-gray-800 border-gray-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}
    >
      {/* Cabeçalho + Seletor de Período */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-gray-100 dark:border-gray-700">
        <div>
          <h3
            className={`text-base sm:text-lg font-black tracking-tight flex items-center gap-2 ${
              isDarkMode ? 'text-white' : 'text-gray-900'
            }`}
          >
            <TrendingUp size={18} className="text-emerald-600 shrink-0" />
            Origem das Vendas (ROI FarmaFlow)
          </h3>
          <p
            className={`text-xs mt-0.5 ${
              isDarkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            Acompanhe quanto cada canal digital gera em pedidos válidos (exceto cancelados)
          </p>
        </div>

        <div
          className={`inline-flex p-1 rounded-xl border shrink-0 self-start sm:self-auto ${
            isDarkMode
              ? 'bg-gray-900 border-gray-700'
              : 'bg-gray-100 border-gray-200/70'
          }`}
        >
          {PERIOD_OPTIONS.map((opt) => {
            const active = period === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  active
                    ? isDarkMode
                      ? 'bg-gray-700 text-white shadow-xs'
                      : 'bg-white text-gray-900 shadow-xs'
                    : isDarkMode
                      ? 'text-gray-400 hover:text-gray-200'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Resumo no Topo: Total do Período + Destaque Canais Automáticos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-5 border-b border-gray-100 dark:border-gray-700">
        <div
          className={`rounded-xl p-4 border ${
            isDarkMode
              ? 'bg-gray-900/50 border-gray-700'
              : 'bg-gray-50/80 border-gray-200/80'
          }`}
        >
          <p
            className={`text-xs font-semibold ${
              isDarkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            Faturamento Total no Período
          </p>
          <div className="flex items-baseline justify-between gap-3 mt-1.5">
            <p className="text-2xl font-black tracking-tight tabular-nums">
              {formatCurrencyBRL(roiSummary.totalRevenue)}
            </p>
            <span
              className={`text-xs font-bold tabular-nums ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              {roiSummary.totalOrders}{' '}
              {roiSummary.totalOrders === 1 ? 'pedido' : 'pedidos'}
            </span>
          </div>
        </div>

        <div
          className={`rounded-xl p-4 border ${
            isDarkMode
              ? 'bg-emerald-950/40 border-emerald-800/70'
              : 'bg-emerald-50/70 border-emerald-200/80'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p
              className={`text-xs font-bold flex items-center gap-1.5 ${
                isDarkMode ? 'text-emerald-300' : 'text-emerald-800'
              }`}
            >
              <Sparkles size={13} className="shrink-0" />
              Vendas de Canais Automáticos FarmaFlow
            </p>
            <span
              className={`text-xs font-black tabular-nums ${
                isDarkMode ? 'text-emerald-300' : 'text-emerald-700'
              }`}
            >
              {roiSummary.autoPct}% do total
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 mt-1.5">
            <p
              className={`text-2xl font-black tracking-tight tabular-nums ${
                isDarkMode ? 'text-emerald-300' : 'text-emerald-700'
              }`}
            >
              {formatCurrencyBRL(roiSummary.autoRevenue)}
            </p>
            <span
              className={`text-xs font-semibold tabular-nums ${
                isDarkMode ? 'text-emerald-300/80' : 'text-emerald-700/80'
              }`}
            >
              {roiSummary.autoOrders}{' '}
              {roiSummary.autoOrders === 1 ? 'pedido' : 'pedidos'} · Google, Shopping, Stories, Push e Recompra
            </span>
          </div>
        </div>
      </div>

      {/* Quebra por Canal */}
      <div className="pt-5 space-y-4">
        {roiSummary.totalOrders === 0 ? (
          <div className="py-6 text-center">
            <p
              className={`text-sm font-bold ${
                isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              Nenhum pedido registrado neste período
            </p>
            <p
              className={`text-xs mt-1 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              Assim que novos pedidos entrarem, a origem (Google, Shopping, Stories, Push, Recompra ou Direto) aparecerá aqui automaticamente.
            </p>
          </div>
        ) : (
          roiSummary.channels.map((ch) => (
            <div key={ch.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className={`text-sm font-bold ${
                      isDarkMode ? 'text-gray-100' : 'text-gray-900'
                    }`}
                  >
                    {ch.label}
                  </span>
                  <span
                    className={`hidden sm:inline text-xs ml-2 ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}
                  >
                    · {ch.sublabel}
                  </span>
                </div>

                <div className="flex items-baseline gap-3 shrink-0 tabular-nums text-right">
                  <span
                    className={`text-xs font-semibold ${
                      isDarkMode ? 'text-gray-400' : 'text-gray-500'
                    }`}
                  >
                    {ch.count} {ch.count === 1 ? 'pedido' : 'pedidos'} ({ch.sharePct}%)
                  </span>
                  <span
                    className={`text-sm font-black min-w-[92px] ${
                      isDarkMode ? 'text-white' : 'text-gray-900'
                    }`}
                  >
                    {formatCurrencyBRL(ch.revenue)}
                  </span>
                </div>
              </div>

              <div
                className={`w-full h-2 rounded-full overflow-hidden ${
                  isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                }`}
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ${ch.barColor}`}
                  style={{
                    width: `${ch.count > 0 ? Math.max(ch.sharePct, 2) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
