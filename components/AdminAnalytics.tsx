import React, { useEffect, useState } from "react";
import { PharmacyConfig } from "../types";
import { supabase } from "../services/supabase";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  Cell,
  PieChart,
  Pie
} from "recharts";
import { Eye, Smartphone, TrendingUp, Loader2, Download, Calendar, ArrowUpRight, ArrowDownRight, Package } from "lucide-react";

interface AdminAnalyticsProps {
  tenant: PharmacyConfig;
}

export const AdminAnalytics: React.FC<AdminAnalyticsProps> = ({ tenant }) => {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7days' | '30days'>('7days');
  const [stats, setStats] = useState<any>({
    recent: [],
    totals: { views: 0, installs: 0 },
    sources: [],
    topProducts: []
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        let fromDateStr = "";
        let toDateStr = "";
        const now = new Date();
        const todayStr = now.toISOString().split("T")[0];

        if (dateRange === 'today') {
            fromDateStr = todayStr;
            toDateStr = todayStr;
        } else if (dateRange === 'yesterday') {
            const yest = new Date();
            yest.setDate(yest.getDate() - 1);
            fromDateStr = yest.toISOString().split("T")[0];
            toDateStr = fromDateStr;
        } else if (dateRange === '7days') {
            const past = new Date();
            past.setDate(past.getDate() - 7);
            fromDateStr = past.toISOString().split("T")[0];
            toDateStr = todayStr;
        } else if (dateRange === '30days') {
            const past = new Date();
            past.setDate(past.getDate() - 30);
            fromDateStr = past.toISOString().split("T")[0];
            toDateStr = todayStr;
        }

        const { data: recentStats, error } = await supabase
          .from("store_analytics")
          .select("*")
          .eq("tenant_id", tenant.id)
          .gte("date", fromDateStr)
          .lte("date", toDateStr)
          .order("date", { ascending: true });
        
        if (error && error.code !== "42P01" && error.code !== "PGRST204") {
          throw new Error(`Failed to load recent analytics: ${error.message}`);
        }
        
        // Formata os dados pro gráfico e calcula o total
        const formattedRecent = (recentStats || []).map((item: any) => {
            const parts = item.date.split('-');
            return {
                ...item,
                displayDate: `${parts[2]}/${parts[1]}`
            };
        });

        // Garantir que dias sem dados apareçam no grafico para 7 e 30 dias (opcional, mas bom pra UI)
        let finalChartData = formattedRecent;
        if ((dateRange === '7days' || dateRange === '30days') && finalChartData.length === 0) {
            // Apenas para mostrar o gráfico zerado
            finalChartData = [{ displayDate: 'Sem dados', views_count: 0 }];
        }

        const totalViews = (recentStats || []).reduce((acc: number, curr: any) => acc + curr.views_count, 0);
        const totalInstalls = (recentStats || []).reduce((acc: number, curr: any) => acc + (curr.pwa_installs_count || 0), 0);
        
        // GET REAL DATA FOR SOURCES AND TOP PRODUCTS FROM access_logs
        const { data: accessLogs, error: logsError } = await supabase
          .from("access_logs")
          .select("source, product_name")
          .eq("tenant_id", tenant.id)
          .gte("created_at", fromDateStr + "T00:00:00Z")
          .lte("created_at", toDateStr + "T23:59:59Z");
          
        if (logsError && logsError.code !== "42P01") {
          console.warn("Failed to load access_logs", logsError);
        }

        // Aggregate sources
        const sourceMap: Record<string, number> = {};
        const productMap: Record<string, number> = {};
        
        if (accessLogs && accessLogs.length > 0) {
           accessLogs.forEach(log => {
               const s = log.source || 'direct';
               sourceMap[s] = (sourceMap[s] || 0) + 1;
               
               if (log.product_name) {
                  productMap[log.product_name] = (productMap[log.product_name] || 0) + 1;
               }
           });
        }
        
        const sourceData = Object.keys(sourceMap).map(k => ({
           name: k === 'direct' ? 'Direto / Link' : k.charAt(0).toUpperCase() + k.slice(1),
           value: sourceMap[k]
        })).sort((a, b) => b.value - a.value);
        
        const topProductsData = Object.keys(productMap).map(k => ({
           name: k,
           views: productMap[k]
        })).sort((a, b) => b.views - a.views).slice(0, 5);

        const displaySourceData = sourceData.length > 0 ? sourceData : [
           { name: 'Sem dados suficientes', value: 1 }
        ];

        setStats({ 
          recent: finalChartData, 
          totals: { views: totalViews, installs: totalInstalls },
          sources: displaySourceData,
          topProducts: topProductsData
        });

      } catch (err: any) {
        console.error("Error fetching analytics:", err);
        setErrorMsg(err.message || String(err));
      } finally {
        setLoading(false);
      }
    };
    
    if (tenant?.id) fetchAnalytics();
  }, [tenant, dateRange]);

  const handleExport = () => {
    setIsExporting(true);
    try {
        // Criar um CSV simples com os dados atuais
        const csvContent = "data:text/csv;charset=utf-8," 
            + "Relatório de Analytics - FarmaFlow\n\n"
            + `Período,${dateRange}\n`
            + `Total de Visualizações,${stats.totals.views}\nTotal de Instalações,${stats.totals.installs}\n\n`
            + "Data,Visualizações,Instalações\n"
            + stats.recent.map((e: any) => `${e.date || e.displayDate},${e.views_count},${e.pwa_installs_count || 0}`).join("\n") + "\n\n"
            + "Origens de Tráfego\nOrigem,Visualizações\n"
            + stats.sources.map((s: any) => `${s.name},${s.value}`).join("\n") + "\n\n"
            + "Top 5 Produtos\nProduto,Visualizações\n"
            + stats.topProducts.map((p: any) => `${p.name},${p.views}`).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `analytics_${tenant.slug}_${dateRange}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch(err) {
        console.error(err);
        alert("Erro ao exportar relatório.");
    } finally {
        setTimeout(() => setIsExporting(false), 500);
    }
  };

  if (errorMsg) {
    return (
      <div className="bg-red-50 text-red-500 p-8 rounded-3xl border border-red-100">
        <h3 className="font-bold mb-2">Erro ao carregar dados de monitoramento</h3>
        <p>{errorMsg}</p>
      </div>
    );
  }

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
              <h1 className="text-3xl font-black tracking-tight text-gray-900 group flex items-center gap-3">
                  <TrendingUp className="text-blue-500 w-8 h-8" />
                  Monitoramento & Engajamento
              </h1>
              <p className="text-gray-500 mt-2 font-medium">Analise o tráfego e o comportamento dos clientes no seu catálogo.</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              {/* Filtro de Período Dinâmico */}
              <div className="relative">
                  <select 
                      className="appearance-none bg-white border border-gray-200 text-gray-700 font-bold py-3 pl-10 pr-10 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer w-full sm:w-auto"
                      value={dateRange}
                      onChange={(e) => setDateRange(e.target.value as any)}
                  >
                      <option value="today">Hoje</option>
                      <option value="yesterday">Ontem</option>
                      <option value="7days">Últimos 7 dias</option>
                      <option value="30days">Últimos 30 dias</option>
                  </select>
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
              </div>

              {/* Botão Exportar */}
              <button 
                  onClick={handleExport}
                  disabled={loading || isExporting}
                  className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-black text-sm hover:bg-gray-800 transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
              >
                  {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                  Exportar Relatório
              </button>
          </div>
      </div>

      {loading ? (
        <div className="flex bg-white items-center justify-center p-12 w-full rounded-3xl border border-gray-100 shadow-sm relative overflow-hidden h-[400px]">
          <Loader2 className="animate-spin text-gray-400" size={48} />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total de Instalações</p>
                <h2 className="text-4xl font-black text-gray-900 tracking-tight">{stats.totals.installs}</h2>
                <div className="flex items-center gap-1 mt-2 text-emerald-600 font-bold text-xs">
                    <ArrowUpRight size={14} /> <span>No período selecionado</span>
                </div>
              </div>
              <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center relative z-10">
                <Smartphone className="w-8 h-8 text-emerald-500" />
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total de Visualizações</p>
                <h2 className="text-4xl font-black text-gray-900 tracking-tight">{stats.totals.views}</h2>
                <div className="flex items-center gap-1 mt-2 text-emerald-600 font-bold text-xs">
                    <ArrowUpRight size={14} /> <span>No período selecionado</span>
                </div>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
                 <Eye className="w-8 h-8 text-blue-500" />
              </div>
            </div>
            
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Maior Origem</p>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight line-clamp-1">{stats.sources[0]?.name || 'N/A'}</h2>
                <div className="flex items-center gap-1 mt-2 text-blue-600 font-bold text-xs">
                    <span>Responsável por {stats.totals.views > 0 ? Math.round((stats.sources[0]?.value / stats.totals.views) * 100) : 0}%</span>
                </div>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
                 <Smartphone className="w-8 h-8 text-indigo-500" />
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between relative overflow-hidden">
              <div className="relative z-10">
                <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Produto Destaque</p>
                <h2 className="text-xl font-black text-gray-900 tracking-tight line-clamp-1">{stats.topProducts[0]?.name || 'N/A'}</h2>
                <div className="flex items-center gap-1 mt-2 text-amber-600 font-bold text-xs">
                    <span>{stats.topProducts[0]?.views || 0} visualizações</span>
                </div>
              </div>
              <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0">
                 <Package className="w-8 h-8 text-amber-500" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Gráfico Principal de Linha */}
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm lg:col-span-2">
                <h3 className="text-lg font-bold text-gray-900 mb-6">Desempenho de Tráfego</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.recent} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12, fontWeight: 'bold'}} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF', fontSize: 12, fontWeight: 'bold'}} dx={-10} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                        itemStyle={{ fontWeight: 'normal' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="views_count" 
                        name="Acessos Totais"
                        stroke="#3B82F6" 
                        strokeWidth={4}
                        dot={{ r: 4, strokeWidth: 2 }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="pwa_installs_count" 
                        name="Instalações"
                        stroke="#10B981" 
                        strokeWidth={4}
                        dot={{ r: 4, strokeWidth: 2 }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Gráfico de Origem de Tráfego */}
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col">
                <h3 className="text-lg font-bold text-gray-900 mb-2">Origem do Acesso</h3>
                <p className="text-xs text-gray-500 mb-6 font-medium">De onde vêm seus clientes</p>
                <div className="flex-1 min-h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.sources}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {stats.sources.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                      />
                      <Legend 
                        layout="vertical" 
                        verticalAlign="middle" 
                        align="right"
                        iconType="circle"
                        wrapperStyle={{ fontSize: '12px', fontWeight: 'bold', color: '#4B5563' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
          </div>

          {/* Produtos Mais Visualizados (Tabela) */}
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Produtos Mais Visualizados no Período</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                            <th className="p-4 text-xs font-black uppercase text-gray-400 tracking-wider rounded-tl-xl">Produto</th>
                            <th className="p-4 text-xs font-black uppercase text-gray-400 tracking-wider text-right rounded-tr-xl">Visualizações (Cliques)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {stats.topProducts.map((product: any, idx: number) => (
                            <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                                <td className="p-4 font-bold text-gray-900 flex items-center gap-3">
                                    <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 shrink-0">{idx + 1}</span>
                                    {product.name}
                                </td>
                                <td className="p-4 font-black text-blue-600 text-right">{product.views}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {stats.topProducts.length === 0 && (
                <div className="p-8 text-center text-gray-500 font-medium">Nenhum dado de produto registrado no período.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
