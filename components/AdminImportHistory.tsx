
import React, { useState, useEffect, useMemo } from 'react';
import { PharmacyConfig } from '../types';
import { History, Trash2, Clock, Package, CheckCircle2, AlertCircle, CalendarDays, Search, X } from 'lucide-react';
import { supabase } from '../services/supabase';

interface AuditItem {
    name: string;
    code: string;
    status: 'updated' | 'created' | 'no-change';
    details: string;
}

interface ImportSession {
    id: string;
    tenantId: string;
    timestamp: number;
    source?: string;
    totalProcessed?: number;
    newItems?: number;
    updatedItems?: number;
    items: AuditItem[];
}

interface AdminImportHistoryProps {
  tenant: PharmacyConfig;
}

export const AdminImportHistory: React.FC<AdminImportHistoryProps> = ({ tenant }) => {
  const [sessions, setSessions] = useState<ImportSession[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Debouncing for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Carrega e limpa o histórico (Planilhas CSV/Excel + API Inovafarma)
  useEffect(() => {
    const loadLogs = async () => {
        let loadedSessions: ImportSession[] = [];
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        
        // 1. Tenta carregar do localStorage
        const raw = localStorage.getItem('ff_import_history');
        if (raw) {
            try {
                const allSessions: ImportSession[] = JSON.parse(raw);
                const validSessions = allSessions.filter(s => {
                    const isRecent = (now - s.timestamp) < oneDay;
                    const isThisTenant = s.tenantId === tenant.id;
                    return isRecent && isThisTenant;
                });
                loadedSessions = [...validSessions];
            } catch (e) {
                console.error("Erro ao carregar histórico local:", e);
            }
        }
        
        // 2. Carrega do Supabase (via API backend e cliente Supabase para cobrir RLS)
        try {
            let rawLogs: any[] = [];

            try {
                const apiRes = await fetch(`/api/integration/logs/${tenant.id}`);
                if (apiRes.ok) {
                    const apiData = await apiRes.json();
                    if (Array.isArray(apiData)) {
                        rawLogs = apiData;
                    }
                }
            } catch (_) {}

            const { data: sbData, error } = await supabase
                .from('integration_logs')
                .select('*')
                .eq('tenant_id', tenant.id)
                .in('endpoint', ['spreadsheet_import', 'inovafarma_sync', '/inovafarma/sync', '/inovafarma/produtosalterados'])
                .order('created_at', { ascending: false })
                .limit(50);

            if (sbData && !error) {
                const seenIds = new Set(rawLogs.map((l: any) => l.id));
                for (const row of sbData) {
                    if (!seenIds.has(row.id)) {
                        rawLogs.push(row);
                    }
                }
            }

            if (rawLogs.length > 0) {
                const dbSessions: ImportSession[] = [];
                const seenSessionPayloadIds = new Set<string>();
                const spreadsheetLogs = rawLogs.filter(
                    (l: any) => l.endpoint === 'spreadsheet_import' || l.endpoint === 'inovafarma_sync'
                );

                for (const log of spreadsheetLogs) {
                    const pay = log.payload || {};
                    const sessionKey = String(pay.id || log.id);
                    if (seenSessionPayloadIds.has(sessionKey)) continue;
                    seenSessionPayloadIds.add(sessionKey);

                    const ts = pay.timestamp || new Date(log.created_at).getTime();
                    const isInova =
                        log.endpoint === 'inovafarma_sync' ||
                        pay.source === 'API Inovafarma' ||
                        pay.origin === 'API Inovafarma' ||
                        String(pay.id || '').startsWith('INOVA_');
                    dbSessions.push({
                        id: sessionKey,
                        tenantId: log.tenant_id,
                        timestamp: ts,
                        source: isInova ? 'API Inovafarma' : (pay.source || 'Planilha CSV/Excel'),
                        totalProcessed: pay.totalProcessed,
                        newItems: pay.newItems,
                        updatedItems: pay.updatedItems,
                        items: Array.isArray(pay.items) ? pay.items : []
                    });
                }

                // Agrupa e consolida lotes de sincronização do Inovafarma (/inovafarma/sync) nas últimas 24h
                // somando todos os lotes da mesma execução multi-lote (ex: 1500 + 1395 = 2895)
                const inovaSyncLogs = rawLogs
                    .filter(
                        (l: any) =>
                            (l.endpoint === '/inovafarma/sync' || l.endpoint === '/inovafarma/produtosalterados') &&
                            l.status === 'SUCCESS'
                    )
                    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

                interface ConsolidatedSyncRun {
                    id: string;
                    tenantId: string;
                    timestamp: number;
                    cnpj: string;
                    received: number;
                    created: number;
                    updated: number;
                    skipped: number;
                }

                const consolidatedRuns: ConsolidatedSyncRun[] = [];
                let activeRun: ConsolidatedSyncRun | null = null;

                for (const syncLog of inovaSyncLogs) {
                    const logTs = new Date(syncLog.created_at).getTime();
                    if (now - logTs >= oneDay) continue;

                    const pay = syncLog.payload || {};
                    const offset = Number(pay.offset || 1);
                    const batchReceived = Number(pay.batchReceivedCount ?? pay.receivedCount ?? pay.totalFetched ?? 0);
                    const batchCreated = Number(pay.batchCreatedCount ?? pay.createdCount ?? pay.insertedCount ?? 0);
                    const batchUpdated = Number(pay.batchUpdatedCount ?? pay.updatedCount ?? 0);
                    const batchSkipped = Number(pay.batchSkippedCount ?? pay.skippedCount ?? 0);

                    const isContinuation =
                        activeRun !== null &&
                        offset > 1 &&
                        Math.abs(logTs - activeRun.timestamp) < 15 * 60 * 1000;

                    if (!isContinuation || !activeRun) {
                        activeRun = {
                            id: syncLog.id,
                            tenantId: syncLog.tenant_id,
                            timestamp: logTs,
                            cnpj: String(pay.cnpj || 'INOVAFARMA'),
                            received: batchReceived,
                            created: batchCreated,
                            updated: batchUpdated,
                            skipped: batchSkipped
                        };
                        consolidatedRuns.push(activeRun);
                    } else {
                        activeRun.id = syncLog.id;
                        activeRun.timestamp = logTs;
                        if (pay.totalReceivedConsolidated !== undefined) {
                            activeRun.received = Math.max(activeRun.received + batchReceived, Number(pay.totalReceivedConsolidated));
                            activeRun.created = Math.max(activeRun.created + batchCreated, Number(pay.totalCreatedConsolidated ?? 0));
                            activeRun.updated = Math.max(activeRun.updated + batchUpdated, Number(pay.totalUpdatedConsolidated ?? 0));
                            activeRun.skipped = activeRun.skipped + batchSkipped;
                        } else {
                            activeRun.received += batchReceived;
                            activeRun.created += batchCreated;
                            activeRun.updated += batchUpdated;
                            activeRun.skipped += batchSkipped;
                        }
                    }
                }

                for (const run of consolidatedRuns) {
                    if (run.created <= 0 && run.updated <= 0) continue;

                    const summaryText = `Origem: API Inovafarma | Total recebidos: ${run.received} | Novos cadastrados: ${run.created} | Atualizados: ${run.updated}${run.skipped > 0 ? ` | Ignorados: ${run.skipped}` : ''}`;

                    // Verifica se já existe sessão em dbSessions ou loadedSessions desta mesma execução;
                    // se existir mas estiver com contador parcial de apenas um lote (ex: 1500 < 2895), atualiza para o consolidado!
                    const matchingDbSession = dbSessions.find(
                        s => s.source === 'API Inovafarma' && Math.abs(s.timestamp - run.timestamp) < 15 * 60 * 1000
                    );

                    if (matchingDbSession) {
                        if ((matchingDbSession.totalProcessed || 0) < run.received) {
                            matchingDbSession.totalProcessed = run.received;
                            matchingDbSession.newItems = Math.max(matchingDbSession.newItems || 0, run.created);
                            matchingDbSession.updatedItems = Math.max(matchingDbSession.updatedItems || 0, run.updated);
                            if (Array.isArray(matchingDbSession.items) && matchingDbSession.items.length > 0) {
                                const firstItem = matchingDbSession.items[0];
                                if (
                                    firstItem.name.startsWith('RESUMO') ||
                                    firstItem.name.startsWith('Resumo')
                                ) {
                                    firstItem.details = summaryText;
                                }
                            }
                        }
                        continue;
                    }

                    dbSessions.push({
                        id: run.id,
                        tenantId: run.tenantId,
                        timestamp: run.timestamp,
                        source: 'API Inovafarma',
                        totalProcessed: run.received,
                        newItems: run.created,
                        updatedItems: run.updated,
                        items: [
                            {
                                name: 'RESUMO DA SINCRONIZAÇÃO (ORIGEM: API INOVAFARMA)',
                                code: run.cnpj,
                                status: run.created > 0 ? 'created' : 'updated',
                                details: summaryText
                            }
                        ]
                    });
                }

                // Mescla banco e localStorage evitando duplicados e mantendo sempre a sessão com maior total consolidado
                const mergedMap = new Map<string, ImportSession>();

                dbSessions.forEach(s => {
                    if (s.id) mergedMap.set(s.id, s);
                });

                loadedSessions.forEach(s => {
                    const similarExisting = Array.from(mergedMap.values()).find(
                        existing =>
                            Math.abs(existing.timestamp - s.timestamp) < 15 * 60 * 1000 &&
                            (existing.source || 'Planilha CSV/Excel') === (s.source || 'Planilha CSV/Excel')
                    );
                    if (similarExisting) {
                        if ((s.totalProcessed || 0) > (similarExisting.totalProcessed || 0)) {
                            similarExisting.totalProcessed = s.totalProcessed;
                            similarExisting.newItems = s.newItems;
                            similarExisting.updatedItems = s.updatedItems;
                            if (s.items && s.items.length > (similarExisting.items?.length || 0)) {
                                similarExisting.items = s.items;
                            }
                        }
                    } else if (!mergedMap.has(s.id)) {
                        mergedMap.set(s.id, s);
                    }
                });

                loadedSessions = Array.from(mergedMap.values());
            }
        } catch (supabaseErr) {
            console.error("Erro ao carregar histórico do Supabase:", supabaseErr);
        }
        
        setSessions(loadedSessions.sort((a, b) => b.timestamp - a.timestamp));
    };

    loadLogs();
  }, [tenant.id]);

  const filteredSessions = useMemo(() => {
      if (!debouncedSearchTerm) return sessions;
      const term = debouncedSearchTerm.toLowerCase();
      return sessions.filter(s => 
          (s.source && s.source.toLowerCase().includes(term)) ||
          s.items.some(item => 
              item.name.toLowerCase().includes(term) || 
              item.code.toLowerCase().includes(term) ||
              item.details.toLowerCase().includes(term)
          )
      );
  }, [sessions, debouncedSearchTerm]);

  const formatDate = (ts: number) => {
      return new Date(ts).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
      });
  };

  if (sessions.length === 0) {
      return (
          <div className="bg-white p-20 rounded-[3rem] text-center border-2 border-dashed border-gray-100 animate-in fade-in">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <History size={40} className="text-gray-200" />
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-2">Nenhum Log Recente</h3>
              <p className="text-gray-400 font-medium max-w-xs mx-auto">Importações via planilha e sincronizações da API Inovafarma aparecem aqui por 24 horas para sua conferência.</p>
          </div>
      );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
            <div>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Histórico de Importação e Sincronização ERP</h2>
                <p className="text-gray-500 text-sm font-medium flex items-center gap-1.5 mt-1">
                    <Clock size={14} className="text-emerald-500" /> Histórico persistente salvo em nuvem (Planilhas CSV/Excel &amp; API Inovafarma)
                </p>
            </div>
            <div className="relative group w-full md:w-64">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand transition-colors" size={18} />
                <input 
                    type="text" 
                    placeholder="Pesquisar no histórico..." 
                    className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-brand transition-all font-bold text-sm text-gray-900"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>
        </div>

        <div className="space-y-6">
            {filteredSessions.map(session => {
                const isInovafarma = session.source === 'API Inovafarma';
                return (
                <div key={session.id} className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                    <div className="bg-gray-50/50 p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-brand shadow-sm border border-gray-100">
                                <CalendarDays size={24} />
                            </div>
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-black text-gray-900 leading-none">Sessão {formatDate(session.timestamp)}</h4>
                                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                                        isInovafarma
                                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                                            : 'bg-blue-50 text-blue-700 border-blue-200'
                                    }`}>
                                        Origem: {session.source || 'Planilha CSV/Excel'}
                                    </span>
                                </div>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1.5">
                                    {session.totalProcessed !== undefined
                                        ? `${session.totalProcessed} recebidos • ${session.newItems ?? 0} novos • ${session.updatedItems ?? 0} atualizados`
                                        : `${session.items.length} itens processados nesta carga`}
                                </p>
                            </div>
                        </div>
                        <span className="bg-emerald-100 text-emerald-700 px-4 py-1.5 rounded-full text-[10px] font-black uppercase border border-emerald-200">
                            Carga Concluída
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50/30 text-[10px] font-black uppercase text-gray-400 border-b border-gray-100">
                                <tr>
                                    <th className="p-4 pl-8">Produto</th>
                                    <th className="p-4">Código</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4 pr-8">Informações da Alteração</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {session.items.filter(i => 
                                    !searchTerm || 
                                    i.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                    i.code.toLowerCase().includes(searchTerm.toLowerCase())
                                ).slice(0, 500).map((item, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="p-4 pl-8">
                                            <p className="font-bold text-gray-900 text-sm">{item.name}</p>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-xs font-mono font-bold text-gray-400">#{item.code}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase ${
                                                item.status === 'created' ? 'bg-blue-50 text-blue-600 border border-blue-100' : 
                                                item.status === 'updated' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 
                                                'bg-gray-50 text-gray-400 border border-gray-200'
                                            }`}>
                                                {item.status === 'created' ? 'Novo Item' : item.status === 'updated' ? 'Atualizado' : 'Inalterado'}
                                            </span>
                                        </td>
                                        <td className="p-4 pr-8">
                                            <p className="text-xs font-bold text-gray-600 leading-relaxed">{item.details}</p>
                                        </td>
                                    </tr>
                                ))}
                                {session.items.filter(i => 
                                    !searchTerm || 
                                    i.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                    i.code.toLowerCase().includes(searchTerm.toLowerCase())
                                ).length > 500 && (
                                    <tr className="bg-gray-50/50">
                                        <td colSpan={4} className="p-4 text-center text-gray-500 font-bold text-sm">
                                            + {session.items.filter(i => 
                                                !searchTerm || 
                                                i.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                                i.code.toLowerCase().includes(searchTerm.toLowerCase())
                                            ).length - 500} outros itens (ocultos para melhor performance)
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
            })}
        </div>
    </div>
  );
};
