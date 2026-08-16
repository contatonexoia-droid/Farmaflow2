import React, { useEffect, useState } from 'react';
import { Activity, Clock, ShieldCheck, ShieldAlert, Monitor, Terminal } from 'lucide-react';

interface Integration {
  id: string;
  tenant_id: string;
  machine_id: string;
  is_active: boolean;
  last_seen: string | null;
  tenants: {
    name: string;
  };
}

export const StatusMonitor: React.FC = () => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    try {
      const response = await fetch('/api/v1/integration/status');
      if (response.ok) {
        const { data } = await response.json();
        setIntegrations(data || []);
      }
    } catch (error) {
      console.error("Erro ao buscar status:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Atualiza a cada 30 segundos
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatus = (lastSeen: string | null) => {
    if (!lastSeen) return { label: 'Desconhecido', color: 'bg-gray-100 text-gray-600', icon: <Terminal className="w-3.5 h-3.5" /> };
    
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffInMinutes = (now.getTime() - lastSeenDate.getTime()) / (1000 * 60);

    if (diffInMinutes < 2) {
      return { label: 'Online', color: 'bg-emerald-100 text-emerald-700', icon: <ShieldCheck className="w-3.5 h-3.5" /> };
    }
    return { label: 'Offline', color: 'bg-red-100 text-red-700', icon: <ShieldAlert className="w-3.5 h-3.5" /> };
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin text-emerald-600">
          <Activity className="w-8 h-8" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-600">
          <Monitor className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-black text-gray-900">Monitor de Agentes</h2>
          <p className="text-sm font-medium text-gray-500">
            Acompanhe o status de conexão dos Agentes Desktop em tempo real
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="py-4 px-4 text-xs font-black text-gray-400 uppercase tracking-wider">Farmácia</th>
              <th className="py-4 px-4 text-xs font-black text-gray-400 uppercase tracking-wider">Machine ID</th>
              <th className="py-4 px-4 text-xs font-black text-gray-400 uppercase tracking-wider">Último Ping</th>
              <th className="py-4 px-4 text-xs font-black text-gray-400 uppercase tracking-wider text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {integrations.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm font-medium text-gray-500">
                  Nenhuma integração encontrada.
                </td>
              </tr>
            ) : (
              integrations.map((integration) => {
                const status = getStatus(integration.last_seen);
                return (
                  <tr key={integration.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-4 px-4">
                      <span className="font-bold text-gray-900">{integration.tenants?.name || 'Desconhecido'}</span>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm font-medium text-gray-600 font-mono">
                        {integration.machine_id || 'N/A'}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      {integration.last_seen ? (
                        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-600">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          {new Date(integration.last_seen).toLocaleString('pt-BR')}
                        </div>
                      ) : (
                        <span className="text-sm font-medium text-gray-400">Nunca</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black ${status.color}`}>
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
