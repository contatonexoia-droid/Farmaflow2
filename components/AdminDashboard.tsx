import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Order, CouponRule, PromotionRule, PharmacyConfig } from '../types';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { CalendarDays, TrendingUp, DollarSign, X, ExternalLink, Copy, CheckCircle, Clock, ShoppingBag, Globe, Info, Tag, Percent, Search, SearchX, Users, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { getEmptySearches, isSupabaseConfigured, getTenants, getOrdersByTenant } from '../services/storage';
import { supabase } from '../services/supabase';

interface AdminDashboardProps {
  orders: Order[];
  tenantId: string;
  tenant?: PharmacyConfig;
  onNavigateToStore: () => void;
  recentAlerts?: any[];
  coupons?: CouponRule[];
  promotions?: PromotionRule[];
  onNavigateToProducts?: () => void;
  onNavigateToOrders?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  orders, 
  tenantId,
  tenant, 
  onNavigateToStore, 
  recentAlerts = [],
  coupons = [],
  promotions = [],
  onNavigateToProducts,
  onNavigateToOrders
}) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [couponSearch, setCouponSearch] = useState('');
  const [promotionSearch, setPromotionSearch] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('ALL_NETWORK');
  const [branches, setBranches] = useState<PharmacyConfig[]>([]);
  const [copied, setCopied] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [emptySearches, setEmptySearches] = useState<{term: string, count: number}[]>([]);
  const [lastSync, setLastSync] = useState(new Date());
  const [isSyncing, setIsSyncing] = useState(false);
  const [alertsGlow, setAlertsGlow] = useState(false);
  const [searchGlow, setSearchGlow] = useState(false);
  const [allOrders, setAllOrders] = useState<Order[]>(orders);
  const prevAlertsRef = useRef(recentAlerts.length);
  const prevSearchesRef = useRef(emptySearches.length);

  const loadNetworkData = async () => {
    if (!tenant?.id) return;
    
    if (tenant.isNetworkMaster) {
      const allStores = await getTenants();
      const networkId = tenant.networkId || tenant.id;
      const networkStores = allStores.filter(store => store.networkId === networkId || store.id === networkId);
      
      const promises = networkStores.map(store => getOrdersByTenant(store.id));
      const results = await Promise.all(promises);
      
      const flatOrders = results.flat();
      const uniqueOrders = Array.from(new Map(flatOrders.map(o => [o.id, o])).values());
      setAllOrders(uniqueOrders);
    } else {
      const tenantOrders = await getOrdersByTenant(tenant.id);
      setAllOrders(tenantOrders);
    }
  };

  useEffect(() => {
    loadNetworkData();
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    getTenants().then(t => setBranches(t.filter(br => 
      br.networkId === tenant.id && br.id !== tenant.id
    )));
  }, [tenant?.networkId, tenant?.id]);

  const storeUrl = useMemo(() => {
    if (tenant?.custom_domain) return `https://${tenant.custom_domain}`;
    const rawSlug = tenant?.slug || tenantId || "";
    const cleanSlug = rawSlug
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    return `https://${cleanSlug}.farmaflow.online`;
  }, [tenant, tenantId]);

  const fetchSearches = async () => {
      const searches = await getEmptySearches(tenantId);
      setEmptySearches(searches);
  };
  
  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
        await fetchSearches();
        await loadNetworkData();
    } catch(e) {
        // ignore errors
    } finally {
        setLastSync(new Date());
        setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchSearches();
    
    // Polling a cada 30 segundos (fallback + keep-alive)
    const interval = setInterval(() => {
        handleSync();
    }, 30000);

    let channel: any;
    if (isSupabaseConfigured()) {
        channel = supabase
            .channel(`public:search_logs:tenant_id=eq.${tenantId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'search_logs',
                    filter: `tenant_id=eq.${tenantId}`
                },
                (payload) => {
                    const newLog = payload.new;
                    if (newLog.results_count === 0) {
                        // Refresh the searches
                        fetchSearches();
                    }
                }
            )
            .subscribe();
    }

    return () => {
        clearInterval(interval);
        if (channel) supabase.removeChannel(channel);
    };
  }, [tenantId]);

  useEffect(() => {
      if (recentAlerts.length > prevAlertsRef.current) {
          setAlertsGlow(true);
          setTimeout(() => setAlertsGlow(false), 2000);
      }
      prevAlertsRef.current = recentAlerts.length;
  }, [recentAlerts]);

  useEffect(() => {
      if (emptySearches.length !== prevSearchesRef.current) {
          setSearchGlow(true);
          setTimeout(() => setSearchGlow(false), 2000);
      }
      prevSearchesRef.current = emptySearches.length;
  }, [emptySearches]);
  
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

  const applyPreset = (type: 'today' | 'week' | 'month' | 'all') => {
    const today = new Date();
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    if (type === 'all') {
      setStartDate('');
      setEndDate('');
      return;
    }

    setEndDate(formatDate(today));
    if (type === 'today') {
      setStartDate(formatDate(today));
    } else if (type === 'week') {
      const past = new Date();
      past.setDate(today.getDate() - 7);
      setStartDate(formatDate(past));
    } else if (type === 'month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(formatDate(firstDay));
    }
  };

  const filteredOrders = useMemo(() => {
    let baseOrders = allOrders;
    if (selectedBranchId === 'ALL_NETWORK') {
        baseOrders = allOrders;
    } else {
        baseOrders = allOrders.filter(o => o.tenantId === selectedBranchId);
    }

    return baseOrders.filter(o => {
      if (!o.date) return false;
      const orderDate = o.date.split('T')[0];
      if (startDate && orderDate < startDate) return false;
      if (endDate && orderDate > endDate) return false;
      return true;
    });
  }, [allOrders, startDate, endDate, selectedBranchId]);

  const stats = useMemo(() => {
    const confirmedOrders = filteredOrders.filter(o => o.status === 'confirmed' || o.status === 'dispatched');
    const totalRevenue = confirmedOrders.reduce((acc, curr) => acc + curr.total, 0);
    const totalItems = confirmedOrders.reduce((acc, curr) => acc + curr.items.reduce((a, c) => a + c.quantity, 0), 0);
    const pendingOrders = filteredOrders.filter(o => o.status.toLowerCase() === 'pending' || o.status.toLowerCase() === 'pendente');
    const pendingCount = pendingOrders.length;
    const pendingValue = pendingOrders.reduce((acc, curr) => acc + curr.total, 0);
    const averageTicket = confirmedOrders.length > 0 ? totalRevenue / confirmedOrders.length : 0;
    
    const previousOrders = allOrders.filter(o => {
      if (!startDate) return false;
      const orderDate = o.date.split('T')[0];
      return orderDate < startDate;
    });
    const previousPhones = new Set(previousOrders.map(o => o.customer?.phone).filter(Boolean));
    const currentPhones = new Set(filteredOrders.map(o => o.customer?.phone).filter(Boolean));
    let newClients = 0;
    currentPhones.forEach(phone => {
      if (!previousPhones.has(phone)) newClients++;
    });
    if (!startDate) newClients = currentPhones.size;

    return {
      revenue: totalRevenue,
      count: confirmedOrders.length,
      items: totalItems,
      pending: pendingCount,
      pendingValue,
      avgTicket: averageTicket,
      newClients
    };
  }, [filteredOrders, allOrders, startDate]);

  const recentOrdersList = useMemo(() => {
    return [...filteredOrders].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
  }, [filteredOrders]);

  const chartData = useMemo(() => {
    const map = new Map();
    const confirmed = filteredOrders.filter(o => o.status === 'confirmed');
    const sorted = [...confirmed].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    sorted.forEach(o => {
        const dateObj = new Date(o.date);
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        const label = `${day}/${month}`;
        const current = map.get(label) || { revenue: 0, orders: 0, items: 0 };
        const itemsCount = o.items.reduce((acc, item) => acc + item.quantity, 0);

        map.set(label, {
          revenue: current.revenue + o.total,
          orders: current.orders + 1,
          items: current.items + itemsCount
        });
    });

    return Array.from(map.entries()).map(([date, data]) => ({ 
        date, 
        revenue: data.revenue,
        orders: data.orders,
        items: data.items
    }));
  }, [filteredOrders]);

  const promotionStats = useMemo(() => {
    const usageMap = new Map<string, { id: string, name: string, count: number, totalDiscount: number }>();
    
    filteredOrders.forEach(order => {
      order.items.forEach(item => {
        if (item.appliedPromotionId) {
          const promoId = item.appliedPromotionId;
          const promo = promotions.find(p => p.id === promoId);
          const name = promo?.name || 'Promoção Excluída';
          
          const current = usageMap.get(promoId) || { id: promoId, name, count: 0, totalDiscount: 0 };
          
          if (!promotionSearch || name.toLowerCase().includes(promotionSearch.toLowerCase())) {
            usageMap.set(promoId, {
              ...current,
              count: current.count + 1,
              totalDiscount: current.totalDiscount + (item.promotionDiscount || 0)
            });
          }
        }
      });
    });

    return Array.from(usageMap.values()).sort((a, b) => b.count - a.count);
  }, [filteredOrders, promotionSearch, promotions]);

  const couponStats = useMemo(() => {
    const usageMap = new Map<string, { code: string, count: number, totalDiscount: number }>();
    
    filteredOrders.forEach(order => {
      if (order.appliedCoupon) {
        const current = usageMap.get(order.appliedCoupon) || { code: order.appliedCoupon, count: 0, totalDiscount: 0 };
        if (!couponSearch || order.appliedCoupon.toLowerCase().includes(couponSearch.toLowerCase())) {
          usageMap.set(order.appliedCoupon, {
            ...current,
            count: current.count + 1,
            totalDiscount: current.totalDiscount + (order.couponDiscount || 0)
          });
        }
      }
    });

    return Array.from(usageMap.values()).sort((a, b) => b.count - a.count);
  }, [filteredOrders, couponSearch]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'confirmed': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'cancelled': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendente';
      case 'confirmed': return 'Confirmado';
      case 'cancelled': return 'Cancelado';
      default: return status;
    }
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const theme = {
    cardBg: isDarkMode ? 'bg-gray-800' : 'bg-white',
    cardBorder: isDarkMode ? 'border-gray-700' : 'border-gray-100',
    textPrimary: isDarkMode ? 'text-white' : 'text-gray-900',
    textSecondary: isDarkMode ? 'text-gray-400' : 'text-gray-500',
    chartGrid: isDarkMode ? '#374151' : '#f1f5f9',
    chartText: isDarkMode ? '#9ca3af' : '#94a3af',
    tooltipBg: isDarkMode ? '#1f2937' : '#fff',
    filterBg: isDarkMode ? 'bg-gray-700' : 'bg-gray-50',
    filterBorder: isDarkMode ? 'border-gray-600' : 'border-gray-100',
    inputBg: isDarkMode ? 'bg-gray-900' : 'bg-white',
  };

  return (
    <div className={`space-y-6 animate-in fade-in duration-500 pb-10 transition-colors ${isDarkMode ? 'bg-gray-900 text-white' : ''} h-full`}>
      
      <div className={`flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        <div>
          <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black tracking-tight">Dashboard</h2>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full border border-emerald-200">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-wider">Tempo Real</span>
              </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm font-medium text-gray-500">Visão geral de desempenho</p>
            <span className="text-gray-300">•</span>
            <button 
              onClick={handleSync}
              disabled={isSyncing}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-brand transition-colors"
            >
                <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                {isSyncing ? "Sincronizando..." : `Atualizado ás ${lastSync.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
            </button>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
            {tenant?.isNetworkMaster && (
                <div className={`p-1 rounded-xl border ${theme.filterBg} ${theme.filterBorder}`}>
                    <select 
                        value={selectedBranchId}
                        onChange={(e) => setSelectedBranchId(e.target.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${theme.filterBg} ${theme.textPrimary} outline-none`}
                    >
                        <option value="ALL_NETWORK">Ver Total da Rede</option>
                        {tenant && <option value={tenant.id}>{tenant.name} (Matriz)</option>}
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>
            )}
            <div className={`flex p-1 rounded-xl border shrink-0 ${theme.filterBg} ${theme.filterBorder}`}>
                {[{ id: 'today', label: 'Hoje' }, { id: 'week', label: '7 Dias' }, { id: 'month', label: 'Mês' }, { id: 'all', label: 'Total' }].map((preset) => (
                    <button 
                        key={preset.id} 
                        onClick={() => applyPreset(preset.id as any)} 
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${ (preset.id === 'all' && !startDate && !endDate) || (preset.id === 'today' && startDate === new Date().toISOString().split('T')[0]) ? `${isDarkMode ? 'bg-brand text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm border border-gray-200'}` : 'text-gray-500 hover:text-gray-700' }`}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>

            <div className={`flex items-center rounded-xl border overflow-hidden ${theme.cardBorder}`}>
                <input 
                    type="date" 
                    className={`px-3 py-2 text-xs font-bold w-[120px] outline-none ${theme.inputBg} ${isDarkMode ? 'text-white' : 'text-gray-700'}`}
                    value={startDate} 
                    onChange={(e) => setStartDate(e.target.value)}
                />
                <span className={`px-2 text-xs font-black ${theme.filterBg} ${theme.textSecondary}`}>ATÉ</span>
                <input 
                    type="date" 
                    className={`px-3 py-2 text-xs font-bold w-[120px] outline-none ${theme.inputBg} ${isDarkMode ? 'text-white' : 'text-gray-700'}`}
                    value={endDate} 
                    onChange={(e) => setEndDate(e.target.value)}
                />
            </div>
            
            {(startDate || endDate) && (
                <button onClick={() => applyPreset('all')} className={`p-2 rounded-xl transition-all border ${isDarkMode ? 'bg-red-900/20 text-red-400 border-red-900/30 hover:bg-red-900/40' : 'bg-red-50 text-red-500 border-red-100 hover:bg-red-100'}`}>
                    <X size={16} />
                </button>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`p-5 rounded-2xl border shadow-sm group ${theme.cardBg} ${theme.cardBorder}`}>
          <div className="flex justify-between items-start mb-2">
              <span className={`text-xs font-black px-2 py-1 rounded-md ${isDarkMode ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>Vendas Hoje</span>
              <DollarSign size={18} className={isDarkMode ? 'text-emerald-500' : 'text-emerald-400'}/>
          </div>
          <p className={`text-2xl font-black tracking-tight ${theme.textPrimary}`}>R$ {stats.revenue.toFixed(2)}</p>
          <p className={`text-[11px] font-bold mt-1 ${theme.textSecondary}`}>{stats.count} pedidos confirmados</p>
        </div>

        <div className={`p-5 rounded-2xl border shadow-sm group ${theme.cardBg} ${theme.cardBorder}`}>
          <div className="flex justify-between items-start mb-2">
              <span className={`text-xs font-black px-2 py-1 rounded-md ${isDarkMode ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>Pendentes</span>
              <Clock size={18} className={isDarkMode ? 'text-amber-500' : 'text-amber-400'}/>
          </div>
          <p className={`text-2xl font-black tracking-tight ${theme.textPrimary}`}>R$ {stats.pendingValue.toFixed(2)}</p>
          <p className={`text-[11px] font-bold mt-1 ${theme.textSecondary}`}>Aguardando aprovação ({stats.pending} pedidos)</p>
        </div>

        <div className={`p-5 rounded-2xl border shadow-sm group ${theme.cardBg} ${theme.cardBorder}`}>
          <div className="flex justify-between items-start mb-2">
              <span className={`text-xs font-black px-2 py-1 rounded-md ${isDarkMode ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-50 text-purple-600'}`}>Ticket Médio</span>
              <TrendingUp size={18} className={isDarkMode ? 'text-purple-500' : 'text-purple-400'}/>
          </div>
          <p className={`text-2xl font-black tracking-tight ${theme.textPrimary}`}>R$ {stats.avgTicket.toFixed(2)}</p>
          <p className={`text-[11px] font-bold mt-1 ${theme.textSecondary}`}>Por pedido aprovado</p>
        </div>

        <div className={`p-5 rounded-2xl border shadow-sm group ${theme.cardBg} ${theme.cardBorder}`}>
            <div className="flex justify-between items-start mb-2">
                <span className={`text-xs font-black px-2 py-1 rounded-md ${isDarkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>Novos Clientes</span>
                <Users size={18} className={isDarkMode ? 'text-blue-500' : 'text-blue-400'}/>
            </div>
            <p className={`text-2xl font-black tracking-tight ${theme.textPrimary}`}>{stats.newClients}</p>
            <p className={`text-[11px] font-bold mt-1 ${theme.textSecondary}`}>No período selecionado</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Coluna 1: Operacional */}
        <div className="lg:col-span-5 flex flex-col gap-6">
            <div className={`p-6 rounded-2xl border shadow-sm flex flex-col ${theme.cardBg} ${theme.cardBorder}`}>
                <div className="mb-4">
                    <h3 className={`text-lg font-black flex items-center gap-2 ${theme.textPrimary}`}><TrendingUp size={18} className="text-emerald-500"/> Faturamento Semanal</h3>
                </div>
                <div className="w-full h-[250px]">
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#059669" stopOpacity={0.2}/>
                              <stop offset="35%" stopColor="#059669" stopOpacity={0.05}/>
                              <stop offset="95%" stopColor="#059669" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.chartGrid} />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: theme.chartText, fontSize: 10, fontWeight: 600}} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{fill: theme.chartText, fontSize: 10, fontWeight: 600}} tickFormatter={(v) => `R$${v}`} />
                        <Tooltip 
                          contentStyle={{borderRadius: '12px', border: '1px solid '+theme.chartGrid, boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', backgroundColor: theme.tooltipBg}}
                          formatter={(v: number) => [`R$ ${v.toFixed(2)}`, 'Receita']}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#059669" strokeWidth={3} fill="url(#colorTotal)" />
                    </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
                        <p className="font-bold text-center text-sm">Nenhum dado financeiro para o período selecionado.</p>
                    </div>
                )}
                </div>
            </div>

            <div className={`rounded-2xl border shadow-sm overflow-hidden flex flex-col ${theme.cardBg} ${theme.cardBorder}`}>
                <div className={`p-4 border-b flex justify-between items-center ${theme.cardBorder}`}>
                    <h3 className={`text-lg font-black flex items-center gap-2 ${theme.textPrimary}`}><ShoppingBag size={18} className="text-blue-500"/> Últimos Pedidos Recebidos</h3>
                    {onNavigateToOrders && (
                        <button onClick={onNavigateToOrders} className="text-xs font-bold text-brand hover:underline">Ver todos</button>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className={`text-xs text-gray-500 bg-gray-50 uppercase font-black ${isDarkMode ? 'bg-gray-800' : ''}`}>
                            <tr>
                                <th className="px-4 py-3">ID / Data</th>
                                <th className="px-4 py-3">Cliente</th>
                                <th className="px-4 py-3">Valor</th>
                                <th className="px-4 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {recentOrdersList.length > 0 ? recentOrdersList.map(order => (
                                <tr key={order.id} className={`hover:bg-gray-50/50 ${isDarkMode ? 'hover:bg-gray-700/30 divide-gray-700' : ''}`}>
                                    <td className="px-4 py-3">
                                        <p className={`font-bold ${theme.textPrimary}`}>#{order.id.split('-')[0].toUpperCase()}</p>
                                        <p className="text-[10px] text-gray-400">{new Date(order.date).toLocaleDateString()} {new Date(order.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className={`font-bold ${theme.textPrimary}`}>{order.customer?.name}</p>
                                        <p className="text-[10px] text-gray-400">{order.customer?.phone}</p>
                                    </td>
                                    <td className={`px-4 py-3 font-bold ${theme.textPrimary}`}>
                                        R$ {order.total.toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border ${getStatusColor(order.status)}`}>
                                            {getStatusText(order.status)}
                                        </span>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={4} className="px-4 py-8 text-center text-sm font-bold text-gray-400">Nenhum pedido encontrado.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        {/* Coluna 2: Marketing */}
        <div className="lg:col-span-4 flex flex-col gap-6">
            <div className={`p-5 rounded-2xl border shadow-sm flex flex-col ${theme.cardBg} ${theme.cardBorder}`}>
                <div className="mb-4 flex flex-col">
                    <h3 className={`text-[13px] font-black flex items-center gap-2 uppercase tracking-wide ${theme.textPrimary}`}><Percent size={16} className="text-blue-500"/> Desempenho Promoções</h3>
                </div>

                <div className="overflow-y-auto max-h-[250px] pr-1 space-y-2">
                    {promotionStats.length > 0 ? (
                        <div className="space-y-2">
                            {promotionStats.slice(0, 5).map((stat, idx) => (
                                <div key={stat.id} className={`p-3 rounded-xl border flex items-center justify-between ${isDarkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-100'}`}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[(idx + 2) % COLORS.length] }} />
                                        <div className="min-w-0">
                                            <h4 className={`font-bold text-xs truncate max-w-[120px] ${theme.textPrimary}`} title={stat.name}>{stat.name}</h4>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase">Desc: R$ {stat.totalDiscount.toFixed(2)}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-1 rounded-md text-[10px] font-black shrink-0 ${isDarkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                                        {stat.count} itens
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-gray-400 py-8">
                            <Percent size={24} className="mb-2 opacity-20" />
                            <p className="text-xs font-bold text-center">Nenhuma promoção aplicada.</p>
                        </div>
                    )}
                </div>
            </div>

            <div className={`p-5 rounded-2xl border shadow-sm flex flex-col ${theme.cardBg} ${theme.cardBorder}`}>
                <div className="mb-4 flex flex-col">
                    <h3 className={`text-[13px] font-black flex items-center gap-2 uppercase tracking-wide ${theme.textPrimary}`}><Tag size={16} className="text-emerald-500"/> Desempenho Cupons</h3>
                </div>

                <div className="overflow-y-auto max-h-[250px] pr-1 space-y-2">
                    {couponStats.length > 0 ? (
                        <div className="space-y-2">
                            {couponStats.slice(0, 5).map((stat, idx) => (
                                <div key={stat.code} className={`p-3 rounded-xl border flex items-center justify-between ${isDarkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-100'}`}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 font-black text-xs">
                                            <Tag size={14}/>
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className={`font-bold text-xs truncate max-w-[120px] ${theme.textPrimary}`} title={stat.code}>{stat.code}</h4>
                                            <p className="text-[9px] text-gray-400 font-bold uppercase">Desc: R$ {stat.totalDiscount.toFixed(2)}</p>
                                        </div>
                                    </div>
                                    <span className={`px-2 py-1 rounded-md text-[10px] font-black shrink-0 ${isDarkMode ? 'bg-gray-600 text-gray-300' : 'bg-gray-50 text-gray-600'}`}>
                                        {stat.count} usos
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-gray-400 py-8">
                            <Tag size={24} className="mb-2 opacity-20" />
                            <p className="text-xs font-bold text-center">Nenhum cupom aplicado.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Coluna 3: Alertas e Ações */}
        <div className="lg:col-span-3 flex flex-col gap-6">
            
            <div className={`p-5 rounded-2xl border shadow-sm ${theme.cardBg} ${theme.cardBorder}`}>
                <h3 className={`text-[10px] font-black mb-4 uppercase tracking-widest text-gray-400`}>Ações Rápidas</h3>
                <div className="space-y-3">
                    {onNavigateToOrders && (
                        <button onClick={onNavigateToOrders} className="w-full py-3 px-4 bg-brand hover:brightness-110 text-white rounded-xl font-bold flex items-center justify-start gap-3 transition-all active:scale-[0.98]">
                            <ShoppingBag size={18} /> Novo Pedido Balcão
                        </button>
                    )}
                    {onNavigateToProducts && (
                        <button onClick={onNavigateToProducts} className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-start gap-3 transition-colors border-2 active:scale-[0.98] ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600' : 'bg-gray-50 border-gray-100 text-gray-700 hover:border-gray-200'}`}>
                            <Plus size={18} className="text-emerald-500" /> Cadastrar Produto
                        </button>
                    )}
                    <a href={storeUrl} target="_blank" rel="noopener noreferrer" className={`w-full py-3 px-4 rounded-xl font-bold flex items-center justify-start gap-3 transition-colors border-2 active:scale-[0.98] ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600' : 'bg-gray-50 border-gray-100 text-gray-700 hover:border-gray-200'}`}>
                        <Globe size={18} className="text-blue-500" /> Ver Loja Online
                    </a>
                    
                    <div className="pt-3 mt-1 border-t border-gray-100 dark:border-gray-700">
                      <p className={`text-[10px] font-black mb-2 uppercase tracking-widest text-gray-400`}>Link da sua Loja</p>
                      <div className={`flex items-center justify-between p-2 rounded-xl border-2 border-dashed ${isDarkMode ? 'bg-gray-800 border-gray-600 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                          <span className="text-xs font-medium truncate max-w-[140px] select-all">
                              {storeUrl}
                          </span>
                          <button 
                              onClick={() => {
                                  navigator.clipboard.writeText(storeUrl);
                                  setCopied(true);
                                  setTimeout(() => setCopied(false), 2000);
                              }}
                              className={`p-1.5 rounded-lg transition-colors ${copied ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
                              title="Copiar link"
                          >
                              {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                          </button>
                      </div>
                      <a 
                          href={`https://wa.me/?text=${encodeURIComponent(`Olá! Confira nossas ofertas em nossa loja online: ${storeUrl}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 w-full py-2.5 px-4 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] text-xs"
                      >
                          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" className="css-i6dzq1"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                          Compartilhar no WhatsApp
                      </a>
                    </div>
                </div>
            </div>

            <div className={`p-5 rounded-2xl border shadow-sm transition-all duration-500 ${alertsGlow ? 'ring-4 ring-orange-400/50 shadow-orange-500/20' : ''} ${theme.cardBg} ${theme.cardBorder}`}>
                <div className="mb-4 flex flex-col">
                    <h3 className={`text-[13px] font-black flex items-center gap-2 uppercase tracking-wide ${theme.textPrimary}`}><AlertCircle size={16} className="text-orange-500"/> Últimos Alertas</h3>
                </div>
                {recentAlerts && recentAlerts.length > 0 ? (
                    <div className="space-y-2 max-h-[250px] overflow-y-auto">
                        {recentAlerts.map((alert, idx) => (
                            <div key={idx} className={`p-3 rounded-xl border ${isDarkMode ? 'bg-orange-900/30 border-orange-800' : 'bg-orange-50/50 border-orange-100'}`}>
                                <p className={`font-bold text-xs ${isDarkMode ? 'text-orange-300' : 'text-orange-800'}`}>{alert.title}</p>
                                <p className={`text-[10px] ${isDarkMode ? 'text-orange-400/80' : 'text-orange-600/80'} mt-1`}>{alert.message}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center text-gray-400 py-8">
                        <CheckCircle size={24} className="mb-2 opacity-20 text-emerald-500" />
                        <p className="text-xs font-bold text-center">Nenhum alerta recente.</p>
                    </div>
                )}
            </div>

            <div className={`p-5 rounded-2xl border shadow-sm transition-all duration-500 ${searchGlow ? 'ring-4 ring-purple-400/50 shadow-purple-500/20' : ''} ${theme.cardBg} ${theme.cardBorder}`}>
                <div className="mb-4">
                    <h3 className={`text-[13px] font-black flex items-center gap-2 uppercase tracking-wide ${theme.textPrimary}`}><SearchX size={16} className="text-purple-500"/> Buscas sem resultado</h3>
                    <p className={`text-[10px] mt-1 ${theme.textSecondary}`}>O que seus clientes procuram e não encontram</p>
                </div>
                <div className="overflow-y-auto max-h-[250px] space-y-2">
                    {emptySearches.length > 0 ? (
                        <div className="space-y-2">
                            {emptySearches.map((search, idx) => (
                                <div key={idx} className={`p-3 border rounded-xl flex items-center justify-between ${isDarkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-gray-50/50'}`}>
                                    <span className={`text-xs font-bold ${theme.textPrimary} max-w-[150px] truncate`}>{search.term}</span>
                                    <span className={`text-[10px] font-black px-2 py-1 rounded-md ${isDarkMode ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>{search.count}x</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center text-gray-400 py-6">
                            <CheckCircle size={24} className="mb-2 opacity-20 text-emerald-500" />
                            <p className="text-xs font-bold text-center">Nenhum registro encontrado.</p>
                        </div>
                    )}
                </div>
            </div>
            
        </div>

      </div>
    </div>
  );
};
