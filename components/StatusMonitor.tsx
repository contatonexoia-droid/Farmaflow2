import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Clock, ShieldCheck, ShieldAlert, Monitor, Terminal, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '../services/supabase';

interface Integration {
  id: string;
  tenant_id: string;
  erp_type?: string | null;
  machine_id: string;
  is_active: boolean;
  has_active_token?: boolean;
  last_seen: string | null;
  last_product_sync?: string | null;
  tenants?: {
    id?: string;
    name?: string;
    slug?: string;
    erp_type?: string;
    last_product_sync?: string;
  };
}

interface StatusMonitorProps {
  tenantId?: string;
}

export const StatusMonitor: React.FC<StatusMonitorProps> = ({ tenantId }) => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const isInovafarmaIntegration = (item: Integration): boolean => {
    const erp = String(item.erp_type || item.tenants?.erp_type || '').toLowerCase().trim();
    const machine = String(item.machine_id || '').toLowerCase();
    return erp === 'inovafarma' || machine.includes('inovafarma');
  };

  const parseSafeTimestamp = (raw?: string | null): Date | null => {
    if (!raw || !String(raw).trim()) return null;
    let str = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(str)) {
      str = str.replace(/\s+/, 'T');
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
      str = `${str}Z`;
    }
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
  };

  const pickBestNonFutureIso = (candidates: Array<string | null | undefined>): string | null => {
    const nowMs = Date.now();
    const validPastMs: number[] = [];
    let hadAnyValidDate = false;

    for (const c of candidates) {
      const parsed = parseSafeTimestamp(c);
      if (!parsed) continue;
      hadAnyValidDate = true;
      const ms = parsed.getTime();
      // Ignora timestamps no futuro (> Date.now() + 60000) para não esconder o heartbeat real
      if (ms <= nowMs + 60000) {
        validPastMs.push(ms);
      }
    }

    if (validPastMs.length > 0) {
      return new Date(Math.max(...validPastMs)).toISOString();
    }
    if (hadAnyValidDate) {
      return new Date(nowMs).toISOString();
    }
    return null;
  };

  const getEffectiveLastSeen = (item: Integration): string | null => {
    return pickBestNonFutureIso([
      item.last_seen,
      item.last_product_sync,
      item.tenants?.last_product_sync,
    ]);
  };

  const formatSaoPauloDateTime = (raw?: string | null): string => {
    const parsed = parseSafeTimestamp(raw);
    if (!parsed) return 'Nunca';
    return parsed.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  };

  const fetchStatus = useCallback(async () => {
    try {
      setRefreshing(true);
      setErrorMessage(null);
      const url = tenantId 
        ? `/api/v1/integration/status?tenantId=${encodeURIComponent(tenantId)}` 
        : '/api/v1/integration/status';
      
      let fetchedData: Integration[] | null = null;

      try {
        const response = await fetch(url);
        if (response.ok) {
          const json = await response.json();
          fetchedData = json.data || [];
        }
      } catch (fetchErr: any) {
        console.warn("[StatusMonitor] Falha na rota API direta, tentando fallback via Supabase:", fetchErr?.message);
      }

      // Se a rota REST falhar ou não retornar dados, fallback para consulta direta no Supabase
      if (!fetchedData) {
        try {
          let query = supabase.from('agent_integrations').select('*');
          if (tenantId) {
            query = query.eq('tenant_id', tenantId);
          }
          const { data: agentRows } = await query;
          
          let tenantQuery = supabase.from('tenants').select('*');
          if (tenantId) {
            tenantQuery = tenantQuery.eq('id', tenantId);
          }
          const { data: tenantRows } = await tenantQuery;

          const tenantMap = new Map<string, any>();
          if (tenantRows) {
            for (const t of tenantRows) {
              tenantMap.set(t.id, t);
            }
          }

          const fallbackList: Integration[] = [];
          const processedTenantIds = new Set<string>();

          if (tenantRows && tenantRows.length > 0) {
            for (const t of tenantRows) {
              processedTenantIds.add(t.id);
              const agentRow = (agentRows || []).find((r: any) => r.tenant_id === t.id);
              const erpType = String(t.erp_type || '').toLowerCase().trim();
              const isInova =
                erpType === 'inovafarma' ||
                String(agentRow?.machine_id || '').toLowerCase().includes('inovafarma');
              const creds = t.smart_banners?._erpCredentials || {};
              const lastProdSync = pickBestNonFutureIso([
                t.last_product_sync,
                creds.last_product_sync,
              ]);
              const bestLastSeen = pickBestNonFutureIso([
                agentRow?.last_seen,
                t.agent_last_seen,
                t.last_seen,
                creds.last_seen,
                lastProdSync,
              ]);

              fallbackList.push({
                id: agentRow?.id || t.id,
                tenant_id: t.id,
                erp_type: isInova ? 'inovafarma' : erpType || null,
                machine_id: isInova
                  ? 'API Cloud (Inovafarma)'
                  : agentRow?.machine_id || 'Servidor Local',
                is_active: agentRow?.is_active ?? true,
                has_active_token: isInova
                  ? Boolean(creds.erp_login || creds.has_erp_access_token || creds.erp_access_token_enc)
                  : false,
                last_seen: bestLastSeen,
                last_product_sync: lastProdSync,
                tenants: {
                  id: t.id,
                  name: t.name,
                  slug: t.slug,
                  erp_type: isInova ? 'inovafarma' : erpType || undefined,
                  last_product_sync: lastProdSync || undefined,
                },
              });
            }
          } else if (agentRows && agentRows.length > 0) {
            for (const row of agentRows) {
              if (processedTenantIds.has(row.tenant_id)) continue;
              const t = tenantMap.get(row.tenant_id);
              const isInova =
                String(t?.erp_type || '').toLowerCase().trim() === 'inovafarma' ||
                String(row.machine_id || '').toLowerCase().includes('inovafarma');
              const bestRowSeen = pickBestNonFutureIso([
                row.last_seen,
                t?.agent_last_seen,
                t?.last_seen,
                t?.last_product_sync,
              ]);
              fallbackList.push({
                id: row.id,
                tenant_id: row.tenant_id,
                erp_type: isInova ? 'inovafarma' : t?.erp_type || null,
                machine_id: isInova
                  ? 'API Cloud (Inovafarma)'
                  : row.machine_id || 'Servidor Local',
                is_active: row.is_active ?? true,
                last_seen: bestRowSeen,
                last_product_sync: pickBestNonFutureIso([t?.last_product_sync]),
                tenants: t
                  ? {
                      id: t.id,
                      name: t.name,
                      slug: t.slug,
                      erp_type: t.erp_type,
                      last_product_sync: pickBestNonFutureIso([t?.last_product_sync]) || undefined,
                    }
                  : undefined,
              });
            }
          }
          fetchedData = fallbackList;
        } catch (dbErr: any) {
          console.warn("[StatusMonitor] Fallback Supabase também falhou:", dbErr?.message);
        }
      }

      if (fetchedData !== null) {
        setIntegrations(fetchedData);
      } else {
        setErrorMessage("Não foi possível conectar ao servidor de status no momento.");
      }
    } catch (error: any) {
      console.error("Erro ao buscar status:", error);
      setErrorMessage(error?.message || "Erro ao buscar status de conexão.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchStatus();
    // Atualiza a cada 20 segundos
    const interval = setInterval(fetchStatus, 20000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const formatRelativeTime = (lastSeen: string | null): string => {
    const lastSeenDate = parseSafeTimestamp(lastSeen);
    if (!lastSeenDate) return 'Sem sinal registrado';
    const diffMs = Date.now() - lastSeenDate.getTime();
    if (isNaN(diffMs) || diffMs < 0) return 'Agora mesmo';

    const diffSeconds = Math.floor(diffMs / 1000);
    if (diffSeconds < 60) return `Há ${diffSeconds}s`;

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `Há ${diffMinutes} min`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `Há ${diffHours}h ${diffMinutes % 60}m`;

    const diffDays = Math.floor(diffHours / 24);
    return `Há ${diffDays}d`;
  };

  const getStatus = (integration: Integration) => {
    const isInova = isInovafarmaIntegration(integration);
    const effectiveLastSeen = getEffectiveLastSeen(integration);
    const lastSeenDate = parseSafeTimestamp(effectiveLastSeen);

    if (isInova) {
      if (lastSeenDate) {
        const diffInMinutes = (Date.now() - lastSeenDate.getTime()) / (1000 * 60);
        // Lojas Inovafarma (API Cloud): exibe badge verde "Online (API)" se houve sinal nas últimas 2 horas (120 min)
        if (!isNaN(diffInMinutes) && diffInMinutes <= 120) {
          return {
            label: 'Online (API)',
            color: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
            dot: 'bg-emerald-500 animate-pulse',
            icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />,
          };
        }
      }

      if (integration.has_active_token) {
        return {
          label: 'Online (API)',
          color: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60',
          dot: 'bg-emerald-500 animate-pulse',
          icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />,
        };
      }
    }

    if (!lastSeenDate) {
      return { 
        label: 'Desconectado', 
        color: 'bg-gray-100 text-gray-600', 
        dot: 'bg-gray-400',
        icon: <Terminal className="w-3.5 h-3.5" /> 
      };
    }
    
    const diffInMinutes = (Date.now() - lastSeenDate.getTime()) / (1000 * 60);

    // Online: ping recente em até 5 minutos (intervalo normal do agente local)
    if (diffInMinutes < 5) {
      return { 
        label: isInova ? 'Online (API)' : 'Online', 
        color: 'bg-emerald-50 text-emerald-700 border border-emerald-200/60', 
        dot: 'bg-emerald-500 animate-pulse',
        icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> 
      };
    }

    // Instável / Alerta: ping entre 5 e 15 minutos
    if (diffInMinutes < 15) {
      return { 
        label: 'Instável', 
        color: 'bg-amber-50 text-amber-700 border border-amber-200/60', 
        dot: 'bg-amber-500',
        icon: <Clock className="w-3.5 h-3.5 text-amber-600" /> 
      };
    }

    // Offline: sem sinal há mais de 15 minutos (ou > 2h para API Cloud sem token ativo)
    return { 
      label: 'Offline', 
      color: 'bg-red-50 text-red-700 border border-red-200/60', 
      dot: 'bg-red-500',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-red-600" /> 
    };
  };

  const filteredIntegrations = integrations.filter(item => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const name = (item.tenants?.name || '').toLowerCase();
    const slug = (item.tenants?.slug || '').toLowerCase();
    const machine = (isInovafarmaIntegration(item) ? 'api cloud (inovafarma)' : (item.machine_id || '')).toLowerCase();
    const tenantIdStr = (item.tenant_id || '').toLowerCase();
    return name.includes(term) || slug.includes(term) || machine.includes(term) || tenantIdStr.includes(term);
  });

  const onlineCount = integrations.filter(i => {
    const st = getStatus(i);
    return st.label.startsWith('Online');
  }).length;

  const offlineCount = integrations.length - onlineCount;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border border-gray-100 shadow-sm">
        <Activity className="w-8 h-8 animate-spin text-emerald-600 mb-3" />
        <p className="text-sm font-medium text-gray-500">Carregando monitor de agentes...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-600">
            <Monitor className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900">Monitor do Agente Desktop</h2>
            <p className="text-sm font-medium text-gray-500">
              Acompanhe o status de conexão dos servidores locais e integrações API Cloud (Inovafarma) em tempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
          {/* Quick Metrics */}
          <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-100 text-xs font-bold">
            <span className="flex items-center gap-1 text-emerald-700">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              {onlineCount} Online
            </span>
            <span className="text-gray-300">|</span>
            <span className="flex items-center gap-1 text-gray-600">
              <span className="w-2 h-2 rounded-full bg-red-400"></span>
              {offlineCount} Offline
            </span>
          </div>

          {/* Refresh button */}
          <button
            type="button"
            onClick={fetchStatus}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl border border-gray-200 text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
            title="Atualizar status agora"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-600' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={fetchStatus}
            className="ml-auto underline font-bold hover:text-amber-950 cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Search Filter (if multiple integrations) */}
      {integrations.length > 2 && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar por nome da farmácia, @slug ou machine id..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2 text-xs font-medium text-gray-800 placeholder-gray-400 focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors"
          />
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-gray-100 rounded-2xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/70 border-b border-gray-100">
              <th className="py-3.5 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Farmácia / Loja</th>
              <th className="py-3.5 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Machine ID</th>
              <th className="py-3.5 px-4 text-xs font-black text-gray-500 uppercase tracking-wider">Último Sinal (Heartbeat)</th>
              <th className="py-3.5 px-4 text-xs font-black text-gray-500 uppercase tracking-wider text-right">Status do Agente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredIntegrations.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center">
                  <AlertCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-gray-700">
                    {integrations.length === 0 
                      ? 'Nenhum Agente Desktop registrado ainda.' 
                      : 'Nenhuma farmácia encontrada para a busca.'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {integrations.length === 0 
                      ? 'Gere um token de ativação e instale o aplicativo no computador da farmácia.' 
                      : 'Verifique o termo digitado no campo de busca acima.'}
                  </p>
                </td>
              </tr>
            ) : (
              filteredIntegrations.map((integration) => {
                const isInova = isInovafarmaIntegration(integration);
                const effectiveLastSeen = getEffectiveLastSeen(integration);
                const status = getStatus(integration);
                const relativeTime = formatRelativeTime(effectiveLastSeen);
                const fullDate = formatSaoPauloDateTime(effectiveLastSeen);
                const displayMachineId = isInova
                  ? 'API Cloud (Inovafarma)'
                  : (integration.machine_id || 'Servidor Local');

                return (
                  <tr key={integration.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-4 px-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-900 text-sm">{integration.tenants?.name || 'Farmácia Principal'}</span>
                        {integration.tenants?.slug && (
                          <span className="text-xs text-gray-400 font-mono">@{integration.tenants.slug}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono ${
                          isInova
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {displayMachineId}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      {effectiveLastSeen ? (
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-gray-800">
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            <span>{relativeTime}</span>
                          </div>
                          <span className="text-[11px] text-gray-400">{fullDate}</span>
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-gray-400">
                          {isInova ? 'Sincronização Automática Ativa (a cada 15 min)' : 'Aguardando 1º sinal'}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${status.color}`}>
                        <span className={`w-2 h-2 rounded-full ${status.dot}`}></span>
                        {status.icon}
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
