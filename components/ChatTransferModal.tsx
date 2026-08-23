import React, { useState, useEffect } from 'react';
import { X, Search, User, Inbox } from 'lucide-react';
import { supabase } from '../services/supabase';

interface ChatTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransfer: (data: { userId?: string, inboxId?: string }) => void;
  tenantId?: string; // made optional for backwards compat if needed, but we pass it
}

export const ChatTransferModal: React.FC<ChatTransferModalProps> = ({ isOpen, onClose, onTransfer, tenantId }) => {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'USERS' | 'INBOXES'>('INBOXES');
  
  const [users, setUsers] = useState<any[]>([]);
  const [inboxes, setInboxes] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && tenantId) {
      fetchData();
    }
  }, [isOpen, tenantId]);

  const fetchData = async () => {
    try {
      // Fetch inboxes for transfer (all active departments of this store)
      const inboxRes = await fetch(`/api/v1/inboxes?storeId=${tenantId}&forTransfer=true`);
      if (inboxRes.ok) {
        const json = await inboxRes.json();
        if (json.data && Array.isArray(json.data)) {
          setInboxes(json.data);
        }
      } else {
        const { data: inboxData } = await supabase.from('inboxes').select('*').eq('store_id', tenantId);
        if (inboxData) setInboxes(inboxData);
      }
    } catch (_) {}

    try {
      // Fetch users with auth token for RBAC endpoint
      let token = "";
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        token = sessionData?.session?.access_token || "";
      } catch (_) {}

      const headers: Record<string, string> = {
        'x-tenant-id': tenantId || "default"
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const userRes = await fetch(`/api/v1/team/users?tenantId=${tenantId}`, { headers });
      if (userRes.ok) {
        const json = await userRes.json();
        if (json.data && Array.isArray(json.data)) {
          setUsers(json.data);
          return;
        }
      }

      const { data: tenantUsers } = await supabase.from('tenant_users').select('*').eq('tenant_id', tenantId);
      if (tenantUsers && tenantUsers.length > 0) {
        setUsers(tenantUsers.map(u => ({ id: u.id, full_name: u.name, role: u.role })));
        return;
      }

      const { data: userData } = await supabase.from('profiles').select('*').eq('store_id', tenantId);
      if (userData) setUsers(userData);
    } catch (_) {}
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden relative animate-in fade-in zoom-in duration-200">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="font-bold text-gray-800">Transferir Conversa</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex border-b border-gray-100">
          <button 
            className={`flex-1 py-3 text-sm font-bold transition-colors ${tab === 'INBOXES' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setTab('INBOXES')}
          >
            Departamentos
          </button>
          <button 
            className={`flex-1 py-3 text-sm font-bold transition-colors ${tab === 'USERS' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}
            onClick={() => setTab('USERS')}
          >
            Atendentes
          </button>
        </div>

        <div className="p-4">
          <div className="relative mb-4">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input 
              type="text" 
              placeholder={tab === 'INBOXES' ? "Buscar departamento..." : "Buscar atendente..."}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {tab === 'INBOXES' && inboxes.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).map(inbox => (
              <button
                key={inbox.id}
                onClick={() => {
                  onTransfer({ inboxId: inbox.id });
                  onClose();
                }}
                className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
              >
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
                  <Inbox className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <span className="font-bold text-gray-700 text-sm block">{inbox.name}</span>
                  {inbox.description && <span className="text-xs text-gray-500 block truncate">{inbox.description}</span>}
                </div>
              </button>
            ))}

            {tab === 'USERS' && users.filter(u => u.full_name?.toLowerCase().includes(search.toLowerCase())).map(u => (
              <button
                key={u.id}
                onClick={() => {
                  onTransfer({ userId: u.id });
                  onClose();
                }}
                className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
              >
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <span className="font-bold text-gray-700 text-sm block">{u.full_name || 'Usuário Sem Nome'}</span>
                  <span className="text-[10px] uppercase font-black text-gray-500 block">{u.role}</span>
                </div>
              </button>
            ))}
            
            {tab === 'INBOXES' && inboxes.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-4">Nenhuma caixa de entrada encontrada.</p>
            )}
            {tab === 'USERS' && users.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-4">Nenhum atendente encontrado.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
