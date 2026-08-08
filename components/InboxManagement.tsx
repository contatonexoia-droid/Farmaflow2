import React, { useState, useEffect } from 'react';
import { Inbox, Plus, Settings, Users, X, Check, Trash2, Smartphone, Shield, Loader2, Building2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import toast, { Toaster } from 'react-hot-toast';

interface InboxManagementProps {
  tenantId: string;
}

export const InboxManagement: React.FC<InboxManagementProps> = ({ tenantId }) => {
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', description: '', whatsapp_instance_id: '' });
  const [formLoading, setFormLoading] = useState(false);
  
  // Managing members
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [selectedInbox, setSelectedInbox] = useState<any>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [inboxMembers, setInboxMembers] = useState<string[]>([]); // array of user_ids
  const [membersLoading, setMembersLoading] = useState(false);
  const [savingMember, setSavingMember] = useState<string | null>(null);
  const [whatsappInstances, setWhatsappInstances] = useState<any[]>([]);

  useEffect(() => {
    fetchInboxes();
    fetchTeam();
    fetchWhatsappInstances();
  }, [tenantId]);

  
  const fetchWhatsappInstances = async () => {
    try {
      const res = await fetch(`/api/v1/whatsapp/instances?tenantId=${tenantId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setWhatsappInstances(json.data);
          return;
        }
      }

      const { data, error } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('store_id', tenantId);
      if (error) throw error;
      setWhatsappInstances(data || []);
    } catch (e) {
      console.warn("[InboxManagement] whatsapp_instances fetch warning:", e);
    }
  };

  const fetchInboxes = async () => {
    setLoading(true);
    try {
      // 1. Try server API
      const res = await fetch(`/api/v1/inboxes?storeId=${tenantId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setInboxes(json.data);
          localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify(json.data));
          setLoading(false);
          return;
        }
      }

      // 2. Try Supabase direct
      const { data, error } = await supabase
        .from('inboxes')
        .select('*')
        .eq('store_id', tenantId)
        .order('created_at', { ascending: true });
        
      if (!error && data) {
        setInboxes(data);
        localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify(data));
      } else {
        throw error;
      }
    } catch (e) {
      console.warn("[InboxManagement] Could not fetch inboxes from database, loading fallback:", e);
      const saved = localStorage.getItem(`inboxes_${tenantId}`);
      if (saved) {
        try { setInboxes(JSON.parse(saved)); } catch (_) {}
      } else {
        const defaultInbox = [{
          id: `inbox_default_${tenantId}`,
          store_id: tenantId,
          name: 'Geral / Atendimento',
          description: 'Caixa de entrada principal para recebimento de mensagens',
          whatsapp_instance_id: null,
          created_at: new Date().toISOString()
        }];
        setInboxes(defaultInbox);
        localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify(defaultInbox));
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchTeam = async () => {
    try {
      // 1. Try server endpoint
      const res = await fetch(`/api/v1/team/users?tenantId=${tenantId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.length > 0) {
          setTeam(json.data);
          return;
        }
      }

      // 2. Try tenant_users table
      const { data: tenantUsers, error: tuErr } = await supabase
        .from('tenant_users')
        .select('*')
        .eq('tenant_id', tenantId);

      if (!tuErr && tenantUsers && tenantUsers.length > 0) {
        setTeam(tenantUsers.map(u => ({ id: u.id, supabase_user_id: u.supabase_user_id, full_name: u.name, role: u.role, is_active: u.is_active !== false })));
        return;
      }

      // 3. Safe try profiles table without throwing unhandled error
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('store_id', tenantId);

      if (!pErr && profiles) {
        setTeam(profiles);
        return;
      }

      // Fallback team
      setTeam([
        { id: 'user_admin', full_name: 'Atendente Balcão', role: 'ADMIN', is_active: true }
      ]);
    } catch (e) {
      console.warn("[InboxManagement] Team fetch warning:", e);
      setTeam([
        { id: 'user_admin', full_name: 'Atendente Balcão', role: 'ADMIN', is_active: true }
      ]);
    }
  };

  const handleSaveInbox = async () => {
    if (!formData.name) return;
    setFormLoading(true);
    try {
      let savedInbox: any = null;

      if (formData.id) {
        // Edit existing
        const res = await fetch(`/api/v1/inboxes/${formData.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            whatsapp_instance_id: formData.whatsapp_instance_id || null
          })
        });

        if (res.ok) {
          const json = await res.json();
          savedInbox = json.data;
        } else {
          // Direct Supabase fallback
          const payload = { name: formData.name, description: formData.description, whatsapp_instance_id: formData.whatsapp_instance_id || null };
          await supabase.from('inboxes').update(payload).eq('id', formData.id);
          savedInbox = { id: formData.id, store_id: tenantId, ...payload };
        }

        setInboxes(prev => prev.map(item => item.id === formData.id ? { ...item, name: formData.name, description: formData.description, whatsapp_instance_id: formData.whatsapp_instance_id || null } : item));
      } else {
        // Create new
        const res = await fetch('/api/v1/inboxes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            store_id: tenantId,
            name: formData.name,
            description: formData.description,
            whatsapp_instance_id: formData.whatsapp_instance_id || null
          })
        });

        if (res.ok) {
          const json = await res.json();
          savedInbox = json.data;
        } else {
          const newObj = {
            id: `inbox_${Date.now()}`,
            store_id: tenantId,
            name: formData.name,
            description: formData.description,
            whatsapp_instance_id: formData.whatsapp_instance_id || null,
            created_at: new Date().toISOString()
          };
          try {
            const { data } = await supabase.from('inboxes').insert([{ store_id: tenantId, name: formData.name, description: formData.description, whatsapp_instance_id: formData.whatsapp_instance_id || null }]).select().single();
            savedInbox = data || newObj;
          } catch (_) {
            savedInbox = newObj;
          }
        }

        setInboxes(prev => [...prev, savedInbox]);
      }

      // Update localStorage fallback
      const currentInboxes = JSON.parse(localStorage.getItem(`inboxes_${tenantId}`) || '[]');
      if (formData.id) {
        const updated = currentInboxes.map((i: any) => i.id === formData.id ? { ...i, name: formData.name, description: formData.description, whatsapp_instance_id: formData.whatsapp_instance_id || null } : i);
        localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify(updated));
      } else {
        localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify([...currentInboxes, savedInbox]));
      }

      setIsModalOpen(false);
      fetchInboxes();
    } catch (e) {
      console.warn("[InboxManagement] Exception saving inbox, executing resilient fallback:", e);
      const fallbackInbox = {
        id: formData.id || `inbox_${Date.now()}`,
        store_id: tenantId,
        name: formData.name,
        description: formData.description,
        whatsapp_instance_id: formData.whatsapp_instance_id || null,
        created_at: new Date().toISOString()
      };
      setInboxes(prev => formData.id ? prev.map(i => i.id === formData.id ? fallbackInbox : i) : [...prev, fallbackInbox]);
      setIsModalOpen(false);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteInbox = async (id: string) => {
    if (!window.confirm("Deseja realmente excluir esta caixa de entrada?")) return;
    try {
      await fetch(`/api/v1/inboxes/${id}`, { method: 'DELETE' });
      await supabase.from('inboxes').delete().eq('id', id);
    } catch (e) {
      console.warn("[InboxManagement] Delete warning:", e);
    }
    setInboxes(prev => prev.filter(i => i.id !== id));
    const current = JSON.parse(localStorage.getItem(`inboxes_${tenantId}`) || '[]');
    localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify(current.filter((i: any) => i.id !== id)));
  };

  const openMembersModal = async (inbox: any) => {
    setSelectedInbox(inbox);
    setIsMembersModalOpen(true);
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/v1/inboxes/${inbox.id}/members`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setInboxMembers(json.data);
          setMembersLoading(false);
          return;
        }
      }

      const { data } = await supabase
        .from('inbox_members')
        .select('user_id')
        .eq('inbox_id', inbox.id);
      
      setInboxMembers((data || []).map(m => m.user_id));
    } catch (e) {
      console.warn("[InboxManagement] Fetch members warning:", e);
      const savedMembers = localStorage.getItem(`inbox_members_${inbox.id}`);
      setInboxMembers(savedMembers ? JSON.parse(savedMembers) : []);
    } finally {
      setMembersLoading(false);
    }
  };

  const toggleMember = async (userId: string) => {
    if (!selectedInbox || savingMember) return;
    setSavingMember(userId);
    const isMember = inboxMembers.includes(userId);
    const originalMembers = [...inboxMembers];
    const newMembers = isMember ? inboxMembers.filter(id => id !== userId) : [...inboxMembers, userId];
    
    // Atualização otimista
    setInboxMembers(newMembers);

    try {
      const res = await fetch(`/api/v1/inboxes/${selectedInbox.id}/members/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Erro na API ao atualizar membro');
      }

      localStorage.setItem(`inbox_members_${selectedInbox.id}`, JSON.stringify(newMembers));
      toast.success(isMember ? 'Acesso removido com sucesso!' : 'Acesso concedido com sucesso!');
    } catch (e: any) {
      console.error("[InboxManagement] Toggle member error:", e);
      // Reverte estado em caso de falha
      setInboxMembers(originalMembers);
      toast.error(e.message || 'Falha ao atualizar permissões');
    } finally {
      setSavingMember(null);
    }
  };

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <Toaster position="top-right" />
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
           <h3 className="text-xl font-bold text-gray-900 mb-1 flex items-center gap-2"><Inbox className="w-6 h-6 text-emerald-600"/> Caixas de Entrada (Departamentos)</h3>
           <p className="text-sm text-gray-500">Organize os chats por setores e defina quem pode acessá-los.</p>
        </div>
        <button 
          onClick={() => { setFormData({ id: '', name: '', description: '', whatsapp_instance_id: '' }); setIsModalOpen(true); }}
          className="bg-emerald-600 text-white font-bold px-6 py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
        >
          <Plus size={18} /> Nova Caixa
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-12 flex justify-center text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : inboxes.length === 0 ? (
           <div className="col-span-full py-12 bg-white rounded-3xl border border-gray-100 flex flex-col items-center justify-center text-gray-400">
             <Inbox className="w-12 h-12 mb-3 opacity-20" />
             <p className="font-bold">Nenhuma caixa de entrada configurada.</p>
             <p className="text-sm mt-1">Crie caixas como "Vendas", "Financeiro" para organizar o chat.</p>
           </div>
        ) : (
          inboxes.map(inbox => (
            <div key={inbox.id} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 flex flex-col transition-all hover:shadow-md relative overflow-hidden group">
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="bg-emerald-50 text-emerald-600 p-3 rounded-2xl">
                  <Inbox className="w-6 h-6" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setFormData({ id: inbox.id, name: inbox.name, description: inbox.description || '', whatsapp_instance_id: inbox.whatsapp_instance_id || '' }); setIsModalOpen(true); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-gray-200 hover:border-emerald-200">
                    <Settings className="w-3.5 h-3.5" /> Editar Caixa
                  </button>
                  <button onClick={() => handleDeleteInbox(inbox.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="relative z-10 mb-4">
                <h4 className="font-bold text-gray-900 text-lg">{inbox.name}</h4>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{inbox.description || 'Sem descrição'}</p>
              </div>

              <div className="mt-auto space-y-3 relative z-10">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-50 p-2 rounded-xl">
                   <Smartphone className="w-4 h-4" /> 
                   {inbox.whatsapp_instance_id ? 'WhatsApp Conectado' : 'Sem WhatsApp Padrão'}
                </div>
                <button onClick={() => openMembersModal(inbox)} className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-2.5 rounded-xl transition-colors text-sm">
                   <Users className="w-4 h-4" /> Gerenciar Acessos
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal Caixa de Entrada */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-xl text-gray-900">{formData.id ? 'Editar Caixa' : 'Nova Caixa de Entrada'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-5">
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Nome do Departamento</label>
                  <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm" placeholder="Ex: Vendas Balcão" />
               </div>
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Descrição</label>
                  <input type="text" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm" placeholder="Opcional" />
               </div>
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-1"><Smartphone className="w-3 h-3"/> Instância WhatsApp Padrão</label>
                  <select value={formData.whatsapp_instance_id} onChange={e => setFormData({...formData, whatsapp_instance_id: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm">
                    <option value="">(Nenhuma)</option>
                    {whatsappInstances.map(inst => (
                      <option key={inst.id || inst.instance_name} value={inst.id || inst.instance_name}>
                        {inst.instance_name} {inst.phone_number ? `(${inst.phone_number})` : ''}
                      </option>
                    ))}
                  </select>
               </div>
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50/50">
               <button onClick={handleSaveInbox} disabled={formLoading || !formData.name} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-black uppercase tracking-wider text-xs py-4 px-8 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg">
                 {formLoading ? <Loader2 className="animate-spin w-4 h-4" /> : 'Salvar Configurações'}
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Gerenciar Membros */}
      {isMembersModalOpen && selectedInbox && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <div>
                <h3 className="font-black text-xl text-gray-900">Acesso: {selectedInbox.name}</h3>
                <p className="text-xs text-gray-500">Quem pode ver e responder chats nesta caixa</p>
              </div>
              <button onClick={() => setIsMembersModalOpen(false)} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm"><X size={20}/></button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {membersLoading ? (
                <div className="py-8 flex justify-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : (
                team.map(member => {
                  const memberUserId = member.supabase_user_id;
                  const hasAccess = memberUserId ? inboxMembers.includes(memberUserId) : false;
                  return (
                    <div 
                      key={member.id} 
                      onClick={() => {
                        if (memberUserId) {
                          toggleMember(memberUserId);
                        } else {
                          toast.error('Este usuário não possui vínculo com uma conta de autenticação (supabase_user_id).');
                        }
                      }}
                      className={`flex items-center justify-between p-3 rounded-xl border-2 ${memberUserId ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'} transition-all ${hasAccess ? 'border-indigo-500 bg-indigo-50' : 'border-gray-100 hover:border-gray-200'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasAccess ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                          {member.full_name?.substring(0,2).toUpperCase() || <Shield className="w-5 h-5"/>}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{member.full_name}</p>
                          <p className="text-[10px] uppercase font-black tracking-wider text-gray-500">{member.role}</p>
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center border ${hasAccess ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                         {savingMember === memberUserId ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> : (hasAccess && <Check className="w-4 h-4" />)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-gray-50/50">
               <button onClick={() => setIsMembersModalOpen(false)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase tracking-wider text-xs py-3.5 rounded-xl transition-all shadow-lg">
                 Salvar Alterações
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
