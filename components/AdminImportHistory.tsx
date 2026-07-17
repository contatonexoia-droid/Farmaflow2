
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

  // Carrega e limpa o histórico
  useEffect(() => {
    const loadLogs = async () => {
        let loadedSessions: ImportSession[] = [];
        
        // 1. Tenta carregar do localStorage
        const raw = localStorage.getItem('ff_import_history');
        if (raw) {
            try {
                const allSessions: ImportSession[] = JSON.parse(raw);
                const now = Date.now();
                const oneDay = 24 * 60 * 60 * 1000;
                
                // Filtra sessões deste tenant e que tenham menos de 24h
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
        
        // 2. Tenta carregar do Supabase (para evitar sumir ao deslogar)
        try {
            const { data, error } = await supabase
                .from('integration_logs')
                .select('*')
                .eq('tenant_id', tenant.id)
                .eq('endpoint', 'spreadsheet_import')
                .order('created_at', { ascending: false })
                .limit(20);
                
            if (data && !error) {
                const dbSessions: ImportSession[] = data.map(log => {
                    const pay = log.payload;
                    return {
                        id: log.id,
                        tenantId: log.tenant_id,
                        timestamp: pay?.timestamp || new Date(log.created_at).getTime(),
                        items: Array.isArray(pay?.items) ? pay.items : []
                    };
                });
                
                // Mescla os dois, evitando duplicados por id ou por proximidade de timestamp
                const mergedMap = new Map<string, ImportSession>();
                
                // Insere do banco primeiro (prioridade persistente)
                dbSessions.forEach(s => {
                    if (s.id) mergedMap.set(s.id, s);
                });
                
                // Insere do localStorage
                loadedSessions.forEach(s => {
                    const hasSimilar = Array.from(mergedMap.values()).some(existing => 
                        Math.abs(existing.timestamp - s.timestamp) < 10000 // 10 segundos de diferença
                    );
                    if (!mergedMap.has(s.id) && !hasSimilar) {
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
          s.items.some(item => 
              item.name.toLowerCase().includes(term) || 
              item.code.toLowerCase().includes(term)
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
              <p className="text-gray-400 font-medium max-w-xs mx-auto">Importações aparecem aqui por 24 horas para sua conferência.</p>
          </div>
      );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
            <div>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Histórico de Importação</h2>
                <p className="text-gray-500 text-sm font-medium flex items-center gap-1.5 mt-1">
                    <Clock size={14} className="text-emerald-500" /> Histórico persistente salvo em nuvem
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
            {filteredSessions.map(session => (
                <div key={session.id} className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                    <div className="bg-gray-50/50 p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-brand shadow-sm border border-gray-100">
                                <CalendarDays size={24} />
                            </div>
                            <div>
                                <h4 className="font-black text-gray-900 leading-none">Sessão {formatDate(session.timestamp)}</h4>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1.5">{session.items.length} itens processados nesta carga</p>
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
            ))}
        </div>
    </div>
  );
};
