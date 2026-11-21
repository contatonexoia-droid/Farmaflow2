import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  RotateCcw,
  MessageCircle,
  Copy,
  Check,
  EyeOff,
  Search,
  RefreshCw,
  CheckCircle2,
  PackageX,
  SlidersHorizontal,
  Users,
  DollarSign,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Order, PharmacyConfig, Product, PromotionRule } from '../types';
import { getOrdersByTenant } from '../services/storage';
import {
  analyzeRepurchaseCandidates,
  buildRepurchaseWhatsAppHref,
  DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE,
  formatPhoneDisplay,
  formatRepurchaseWhatsAppMessage,
  loadRepurchaseContacts,
  loadRepurchaseTemplate,
  normalizePhoneBR,
  removeRepurchaseContact,
  RepurchaseCandidate,
  RepurchaseContactRecord,
  RepurchaseFilterKey,
  saveRepurchaseContact,
  saveRepurchaseTemplate,
} from '../lib/repurchaseRadar';

interface AdminRepurchaseRadarProps {
  orders: Order[];
  products: Product[];
  tenant: PharmacyConfig;
  promotions?: PromotionRule[];
}

type StatusTab = 'pending' | 'contacted' | 'ignored';

const CYCLE_FILTERS: { id: RepurchaseFilterKey; label: string }[] = [
  { id: 'all', label: 'Todos no ponto' },
  { id: 'uso_continuo', label: 'Uso Contínuo' },
  { id: 'bebe_fraldas', label: 'Bebê & Fraldas' },
  { id: 'geral', label: 'Geral 25-45 dias' },
];

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

const formatCurrencyBRL = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const getBrazilMonthKey = (date: Date): string => {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(date);
    return formatted.slice(0, 7);
  } catch {
    return date.toISOString().slice(0, 7);
  }
};

const copyTextSafely = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback abaixo
  }
  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  } catch {
    return false;
  }
  return false;
};

export const AdminRepurchaseRadar: React.FC<AdminRepurchaseRadarProps> = ({
  orders,
  products,
  tenant,
  promotions = [],
}) => {
  const [localOrders, setLocalOrders] = useState<Order[]>(orders || []);
  const [contacts, setContacts] = useState<RepurchaseContactRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<StatusTab>('pending');
  const [cycleFilter, setCycleFilter] = useState<RepurchaseFilterKey>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isTemplateOpen, setIsTemplateOpen] = useState<boolean>(false);
  const [templateDraft, setTemplateDraft] = useState<string>(() =>
    loadRepurchaseTemplate(tenant.id),
  );
  const [savedTemplate, setSavedTemplate] = useState<string>(() =>
    loadRepurchaseTemplate(tenant.id),
  );

  useEffect(() => {
    if (orders && orders.length > 0) {
      setLocalOrders((prev) => {
        const map = new Map<string, Order>();
        prev.forEach((o) => o?.id && map.set(o.id, o));
        orders.forEach((o) => o?.id && map.set(o.id, o));
        return Array.from(map.values());
      });
    }
  }, [orders]);

  useEffect(() => {
    const loaded = loadRepurchaseTemplate(tenant.id);
    setTemplateDraft(loaded);
    setSavedTemplate(loaded);
  }, [tenant.id]);

  const loadData = useCallback(
    async (showSpinner: boolean = false) => {
      if (!tenant?.id) return;
      if (showSpinner) setIsRefreshing(true);
      try {
        const [fetchedOrders, contactRes] = await Promise.all([
          getOrdersByTenant(tenant.id).catch(() => orders || []),
          loadRepurchaseContacts(tenant.id),
        ]);

        if (Array.isArray(fetchedOrders) && fetchedOrders.length > 0) {
          const map = new Map<string, Order>();
          (orders || []).forEach((o) => o?.id && map.set(o.id, o));
          fetchedOrders.forEach((o) => o?.id && map.set(o.id, o));
          setLocalOrders(Array.from(map.values()));
        }
        setContacts(contactRes.records || []);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [tenant?.id, orders],
  );

  useEffect(() => {
    loadData(false);
  }, [tenant?.id]);

  // Análise automática dos últimos 90 dias
  const allCandidates = useMemo(() => {
    return analyzeRepurchaseCandidates({
      orders: localOrders,
      products,
      tenant,
      promotions,
      contacts,
    });
  }, [localOrders, products, tenant, promotions, contacts]);

  // Separação nas 3 abas anti-spam: Pendentes (No Ponto), Já Contatados (15 dias), Ignorados
  const partitioned = useMemo(() => {
    const nowMs = Date.now();
    const pending: RepurchaseCandidate[] = [];
    const contacted: RepurchaseCandidate[] = [];
    const ignored: RepurchaseCandidate[] = [];

    for (const cand of allCandidates) {
      const rec = cand.contactRecord;
      if (!rec) {
        pending.push(cand);
        continue;
      }

      if (rec.status === 'ignored') {
        ignored.push(cand);
        continue;
      }

      const contactedMs = new Date(rec.contacted_at).getTime();
      const within15Days =
        !Number.isNaN(contactedMs) && nowMs - contactedMs <= FIFTEEN_DAYS_MS;

      if (rec.status === 'contacted' && within15Days) {
        contacted.push(cand);
      } else {
        pending.push(cand);
      }
    }

    return { pending, contacted, ignored };
  }, [allCandidates]);

  // Indicadores do topo
  const metrics = useMemo(() => {
    const currentMonthKey = getBrazilMonthKey(new Date());
    const contactedThisMonth = (contacts || []).filter((c) => {
      if (c.status !== 'contacted' || !c.contacted_at) return false;
      const d = new Date(c.contacted_at);
      if (Number.isNaN(d.getTime())) return false;
      return getBrazilMonthKey(d) === currentMonthKey;
    }).length;

    const recoverableRevenue = partitioned.pending.reduce(
      (sum, c) => sum + c.recoverableRevenue,
      0,
    );

    return {
      dueTodayCount: partitioned.pending.length,
      recoverableRevenue,
      contactedThisMonth,
    };
  }, [partitioned.pending, contacts]);

  // Lista filtrada pela aba ativa, categoria de ciclo e busca textual
  const visibleCandidates = useMemo(() => {
    const base =
      activeTab === 'pending'
        ? partitioned.pending
        : activeTab === 'contacted'
          ? partitioned.contacted
          : partitioned.ignored;

    const q = searchQuery.trim().toLowerCase();

    return base.filter((cand) => {
      if (cycleFilter === 'uso_continuo') {
        const hasCont =
          cand.cycleCategories.includes('uso_continuo_30') ||
          cand.cycleCategories.includes('uso_continuo_60');
        if (!hasCont) return false;
      } else if (cycleFilter === 'bebe_fraldas') {
        if (!cand.cycleCategories.includes('bebe_fraldas')) return false;
      } else if (cycleFilter === 'geral') {
        if (!cand.cycleCategories.includes('geral')) return false;
      }

      if (!q) return true;
      const nameMatch = cand.customerName.toLowerCase().includes(q);
      const phoneMatch = cand.normalizedPhone.includes(q.replace(/\D/g, '') || q);
      const itemMatch = cand.items.some((i) => i.name.toLowerCase().includes(q));
      return nameMatch || phoneMatch || itemMatch;
    });
  }, [activeTab, partitioned, cycleFilter, searchQuery]);

  const handleMarkStatus = async (
    candidate: RepurchaseCandidate,
    status: 'contacted' | 'ignored',
  ) => {
    const nowIso = new Date().toISOString();
    const optimistic: RepurchaseContactRecord = {
      tenant_id: tenant.id,
      customer_phone: candidate.normalizedPhone,
      product_signature: candidate.productSignature,
      status,
      last_order_id: candidate.lastOrderId,
      contacted_at: nowIso,
    };

    setContacts((prev) => [
      optimistic,
      ...prev.filter(
        (r) => normalizePhoneBR(r.customer_phone) !== candidate.normalizedPhone,
      ),
    ]);

    await saveRepurchaseContact(optimistic);

    if (status === 'contacted') {
      toast.success(`Lembrete registrado para ${candidate.firstName}.`);
    } else {
      toast.success(`${candidate.firstName} movido para Ignorados.`);
    }
  };

  const handleRestoreCandidate = async (candidate: RepurchaseCandidate) => {
    setContacts((prev) =>
      prev.filter(
        (r) => normalizePhoneBR(r.customer_phone) !== candidate.normalizedPhone,
      ),
    );
    await removeRepurchaseContact(tenant.id, candidate.normalizedPhone);
    toast.success(`${candidate.firstName} restaurado para Pendentes.`);
  };

  const handleCopyMagicLink = async (candidate: RepurchaseCandidate) => {
    const ok = await copyTextSafely(candidate.magicLink);
    if (ok) {
      setCopiedKey(candidate.key);
      toast.success('Link 1-Toque copiado!');
      setTimeout(() => {
        setCopiedKey((curr) => (curr === candidate.key ? null : curr));
      }, 2200);
    } else {
      toast.error('Não foi possível copiar o link.');
    }
  };

  const handleSaveTemplate = () => {
    const clean = templateDraft.trim() || DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE;
    saveRepurchaseTemplate(tenant.id, clean);
    setSavedTemplate(clean);
    setTemplateDraft(clean);
    setIsTemplateOpen(false);
    toast.success('Modelo de mensagem WhatsApp salvo!');
  };

  const handleResetTemplate = () => {
    setTemplateDraft(DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE);
    saveRepurchaseTemplate(tenant.id, DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE);
    setSavedTemplate(DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE);
    toast.success('Mensagem restaurada para o padrão.');
  };

  const samplePreview = useMemo(() => {
    const previewCandidate: RepurchaseCandidate = visibleCandidates[0] ||
      allCandidates[0] || {
        key: 'sample',
        customerName: 'Maria Silva',
        firstName: 'Maria',
        customerPhone: '21999998888',
        normalizedPhone: '21999998888',
        lastOrderId: 'PED-01',
        lastOrderDate: new Date().toISOString(),
        daysSinceLastOrder: 28,
        cycleCategories: ['uso_continuo_30'],
        items: [
          {
            productKey: 'sample',
            productId: '40797',
            lookupId: '40797',
            name: 'Losartana 50mg 30 Comp',
            quantity: 1,
            lastPurchasedAt: new Date().toISOString(),
            daysSincePurchase: 28,
            cycleCategory: 'uso_continuo_30',
            cycleLabel: 'Uso Contínuo (22-40d)',
            minDays: 22,
            maxDays: 40,
            inStock: true,
            currentUnitPrice: 14.9,
            subtotal: 14.9,
          },
        ],
        inStockItems: [],
        outOfStockItems: [],
        recoverableRevenue: 14.9,
        productSignature: 'sample',
        magicLink: `https://${tenant.slug || 'sua-farmacia'}.farmaflow.online/?repetir=40797:1&origem=recompra`,
      };
    return formatRepurchaseWhatsAppMessage(
      templateDraft,
      previewCandidate,
      tenant.name || 'sua drogaria',
    );
  }, [templateDraft, visibleCandidates, allCandidates, tenant.name, tenant.slug]);

  return (
    <div className="space-y-6 pb-16">
      {/* Cabeçalho Principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 flex items-center gap-2.5">
            <RotateCcw size={22} className="text-teal-600 shrink-0" />
            Radar de Recompra
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Clientes dos últimos 90 dias no momento ideal de reposição, com conferência real de estoque e link de pedido em 1 toque.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsTemplateOpen((v) => !v)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap ${
              isTemplateOpen
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <SlidersHorizontal size={15} />
            Modelo WhatsApp
          </button>
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap disabled:opacity-60"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Indicadores do Topo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold">Clientes no Ponto Hoje</span>
            <Users size={17} className="text-teal-600 shrink-0" />
          </div>
          <p className="text-3xl font-black text-gray-900 tracking-tight mt-2 tabular-nums">
            {metrics.dueTodayCount}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Prontos para lembrete sem spam
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold">Receita Estimada Recuperável</span>
            <DollarSign size={17} className="text-emerald-600 shrink-0" />
          </div>
          <p className="text-3xl font-black text-emerald-700 tracking-tight mt-2 tabular-nums">
            {formatCurrencyBRL(metrics.recoverableRevenue)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Soma apenas de itens em estoque hoje
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold">Contatados no Mês</span>
            <Send size={17} className="text-blue-600 shrink-0" />
          </div>
          <p className="text-3xl font-black text-gray-900 tracking-tight mt-2 tabular-nums">
            {metrics.contactedThisMonth}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Lembretes disparados neste mês
          </p>
        </div>
      </div>

      {/* Editor de Modelo de Mensagem WhatsApp (colapsável) */}
      {isTemplateOpen && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-gray-900">
                Modelo da Mensagem de Lembrete (WhatsApp)
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Variáveis disponíveis: <span className="font-mono text-gray-700">{'{nome}'}</span>,{' '}
                <span className="font-mono text-gray-700">{'{produtos}'}</span>,{' '}
                <span className="font-mono text-gray-700">{'{farmacia}'}</span> e{' '}
                <span className="font-mono text-gray-700">{'{link}'}</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsTemplateOpen(false)}
              className="p-2 text-gray-400 hover:text-gray-700 rounded-lg"
              aria-label="Fechar editor"
            >
              <X size={18} />
            </button>
          </div>

          <textarea
            value={templateDraft}
            onChange={(e) => setTemplateDraft(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800 focus:bg-white focus:border-teal-500 focus:outline-none transition-colors"
            placeholder="Digite a mensagem de recompra..."
          />

          <div className="rounded-xl bg-gray-50 border border-gray-200/80 p-3.5">
            <p className="text-[11px] font-bold text-gray-500 mb-1">
              Prévia da mensagem
            </p>
            <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed break-words">
              {samplePreview}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleResetTemplate}
              className="px-3.5 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Restaurar Padrão
            </button>
            <button
              type="button"
              onClick={handleSaveTemplate}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white transition-colors"
            >
              Salvar Modelo
            </button>
          </div>
        </div>
      )}

      {/* Barra de Abas + Filtros de Ciclo + Busca */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Abas de Status */}
          <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200/70 self-start overflow-x-auto max-w-full">
            {(
              [
                {
                  id: 'pending' as StatusTab,
                  label: 'Pendentes (No Ponto)',
                  count: partitioned.pending.length,
                },
                {
                  id: 'contacted' as StatusTab,
                  label: 'Já Contatados (15d)',
                  count: partitioned.contacted.length,
                },
                {
                  id: 'ignored' as StatusTab,
                  label: 'Ignorados',
                  count: partitioned.ignored.length,
                },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    active
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="tabular-nums text-[11px] text-gray-400">
                    ({tab.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Busca Rápida */}
          <div className="relative w-full lg:w-72">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente, telefone ou produto..."
              className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:border-teal-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Filtro de Ciclo de Reposição */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
          <span className="text-xs font-semibold text-gray-500 mr-1">
            Ciclo:
          </span>
          {CYCLE_FILTERS.map((opt) => {
            const active = cycleFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setCycleFilter(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap border ${
                  active
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista de Clientes no Radar */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="bg-white rounded-2xl border border-gray-200 p-5 animate-pulse space-y-3"
            >
              <div className="h-4 w-48 bg-gray-200 rounded" />
              <div className="h-3 w-72 bg-gray-100 rounded" />
              <div className="h-12 w-full bg-gray-100 rounded-xl" />
            </div>
          ))}
        </div>
      ) : visibleCandidates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center space-y-2">
          <RotateCcw size={28} className="mx-auto text-gray-300" />
          <h3 className="text-base font-black text-gray-800">
            {activeTab === 'pending'
              ? 'Nenhum cliente no ponto de recompra neste filtro'
              : activeTab === 'contacted'
                ? 'Nenhum cliente contatado nos últimos 15 dias'
                : 'Nenhum cliente ignorado'}
          </h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
            {activeTab === 'pending'
              ? 'O radar analisa automaticamente pedidos válidos dos últimos 90 dias e exibe clientes quando seus itens de uso contínuo, bebê ou recorrentes entram na janela ideal de reposição (ocultando quem já recomprou).'
              : 'Os registros de contato ficam organizados aqui para evitar envio duplicado de mensagens.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleCandidates.map((cand) => {
            const waMessage = formatRepurchaseWhatsAppMessage(
              savedTemplate,
              cand,
              tenant.name || 'nossa drogaria',
            );
            const waHref = buildRepurchaseWhatsAppHref(
              cand.normalizedPhone,
              waMessage,
            );
            const isCopied = copiedKey === cand.key;
            const cycleSummary = Array.from(
              new Set(cand.items.map((i) => i.cycleLabel)),
            ).join(' · ');

            return (
              <article
                key={cand.key}
                className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4"
              >
                {/* Cabeçalho do Cliente (metadados limpos sem excesso de pills) */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-gray-900 truncate">
                      {cand.customerName}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                      <span className="font-mono tabular-nums text-gray-700 font-semibold">
                        {formatPhoneDisplay(cand.normalizedPhone)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        Último pedido há {cand.daysSinceLastOrder}{' '}
                        {cand.daysSinceLastOrder === 1 ? 'dia' : 'dias'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{cycleSummary}</span>
                    </div>
                  </div>

                  <div className="sm:text-right shrink-0">
                    <p className="text-[11px] font-semibold text-gray-500">
                      Estimativa em estoque
                    </p>
                    <p className="text-lg font-black text-emerald-700 tabular-nums">
                      {formatCurrencyBRL(cand.recoverableRevenue)}
                    </p>
                  </div>
                </div>

                {/* Lista de Produtos para Reposição com Conferência Real de Estoque */}
                <div className="divide-y divide-gray-100 border-t border-b border-gray-100">
                  {cand.items.map((item) => (
                    <div
                      key={`${cand.key}-${item.productKey}`}
                      className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">
                          <span className="tabular-nums text-gray-500 mr-1.5">
                            {item.quantity}x
                          </span>
                          {item.name}
                        </p>
                        <p className="text-xs text-gray-500 tabular-nums">
                          Comprado há {item.daysSincePurchase} dias · {item.cycleLabel}
                        </p>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        {item.inStock ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 tabular-nums whitespace-nowrap">
                            <CheckCircle2 size={13} className="shrink-0" />
                            Em estoque ({formatCurrencyBRL(item.currentUnitPrice)})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200 whitespace-nowrap">
                            <PackageX size={13} className="shrink-0" />
                            Sem estoque
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Rodapé de Ações */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-gray-500">
                    {cand.contactRecord?.status === 'contacted' &&
                      cand.contactRecord.contacted_at && (
                        <span>
                          Contatado em{' '}
                          {new Date(
                            cand.contactRecord.contacted_at,
                          ).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        void handleMarkStatus(cand, 'contacted');
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors whitespace-nowrap"
                    >
                      <MessageCircle size={15} />
                      Lembrar no WhatsApp
                    </a>

                    <button
                      type="button"
                      onClick={() => handleCopyMagicLink(cand)}
                      className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 transition-colors whitespace-nowrap"
                    >
                      {isCopied ? (
                        <>
                          <Check size={14} className="text-emerald-600" />
                          Link Copiado
                        </>
                      ) : (
                        <>
                          <Copy size={14} />
                          Copiar Link 1-Toque
                        </>
                      )}
                    </button>

                    {activeTab === 'ignored' ? (
                      <button
                        type="button"
                        onClick={() => handleRestoreCandidate(cand)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold text-teal-700 hover:bg-teal-50 border border-teal-200 transition-colors whitespace-nowrap"
                      >
                        <Undo2 size={14} />
                        Restaurar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleMarkStatus(cand, 'ignored')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors whitespace-nowrap"
                      >
                        <EyeOff size={14} />
                        Ignorar
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
