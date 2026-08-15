import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, CheckCircle, Trash2, Edit3, X, Loader2, Search, Building2 } from 'lucide-react';
import { supabase } from '../services/supabase';

interface TeamManagementProps {
  tenantId: string;
  session?: any;
}

// Perfis permitidos para cadastro e edição pelo painel da loja
const STORE_ALLOWED_ROLES = [
  { 
    id: 'gerente', 
    label: 'Gerente', 
    color: 'bg-emerald-100 text-emerald-800', 
    border: 'border-emerald-200', 
    desc: 'Gestão da loja atual' 
  },
  { 
    id: 'operador', 
    label: 'Operador / Balconista', 
    color: 'bg-blue-100 text-blue-800', 
    border: 'border-blue-200', 
    desc: 'Atendimento e chat' 
  }
];

// Mapeamento visual para exibição de qualquer cargo existente na listagem
const ROLE_DISPLAY_MAP: Record<string, { label: string; color: string; border: string }> = {
  admin: { label: 'Admin Matriz', color: 'bg-purple-100 text-purple-800', border: 'border-purple-200' },
  matriz: { label: 'Admin Matriz', color: 'bg-purple-100 text-purple-800', border: 'border-purple-200' },
  admin_matriz: { label: 'Admin Matriz', color: 'bg-purple-100 text-purple-800', border: 'border-purple-200' },
  owner: { label: 'Proprietário', color: 'bg-amber-100 text-amber-800', border: 'border-amber-200' },
  gerente: { label: 'Gerente', color: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-200' },
  operador: { label: 'Operador / Balconista', color: 'bg-blue-100 text-blue-800', border: 'border-blue-200' },
  balconista: { label: 'Operador / Balconista', color: 'bg-blue-100 text-blue-800', border: 'border-blue-200' },
  entregador: { label: 'Entregador', color: 'bg-orange-100 text-orange-800', border: 'border-orange-200' }
};

import { TeamsSettings } from './TeamsSettings';

export const TeamManagement: React.FC<TeamManagementProps> = ({ tenantId, session }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'teams'>('users');
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', full_name: '', email: '', role: 'operador', is_active: true, password: '', store_id: tenantId });
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    const initializeAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (isMounted) {
          setUser(session?.user ?? null);
        }
      } catch (error) {
        console.error("Erro ao recuperar sessão:", error);
      } finally {
        if (isMounted) setLoadingAuth(false);
      }
    };

    initializeAuth();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!loadingAuth && user) {
      fetchTeam();
    }
  }, [tenantId, loadingAuth, user]);

  const getAuthHeaders = async () => {
    let token = session?.access_token;
    if (!token) {
        const saved = localStorage.getItem('ff_session');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                token = parsed.access_token;
            } catch (e) {}
        }
    }
    return {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  };

  const fetchTeam = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/team/users?tenantId=${tenantId}`, { headers });
      if (res.ok) {
        const json = await res.json();
        
        // Profiles table might not contain email (it's in auth.users). 
        // We'd typically join or use an Edge Function. But we simulate it here:
        setTeam(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setFormData({ id: '', full_name: '', email: '', role: 'operador', is_active: true, password: '', store_id: tenantId });
    setError('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.full_name || (!formData.id && (!formData.email || !formData.password))) {
      setError('Preencha os campos obrigatórios.');
      return;
    }
    setFormLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const method = formData.id ? 'PATCH' : 'POST';
      const url = formData.id 
        ? `/api/v1/team/users/${formData.id}` 
        : `/api/v1/team/users`;

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(formData)
      });
      
      const responseText = await res.text();
      let responseData: any = {};
      try {
        responseData = JSON.parse(responseText);
      } catch (err) {
        throw new Error(responseText ? `Erro no servidor: ${responseText.substring(0, 150)}` : 'Erro ao processar requisição.');
      }
      
      if (!res.ok) throw new Error(responseData.error || 'Erro ao salvar usuário.');
      
      setIsModalOpen(false);
      fetchTeam();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (userProfile: any) => {
    if (!window.confirm(userProfile.is_active ? "Desativar o acesso deste funcionário?" : "Reativar o acesso deste funcionário?")) return;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/team/users/${userProfile.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ is_active: !userProfile.is_active })
      });
      
      if (!res.ok) throw new Error("Erro ao atualizar status.");
      
      fetchTeam();
    } catch (e: any) {
      alert(e.message || "Erro ao atualizar status");
    }
  };

  const filteredTeam = team.filter(t => 
    t.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <div className="flex border-b border-gray-100 mb-8 overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-6 py-4 font-bold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'users' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Usuários e Permissões
        </button>
        <button
          onClick={() => setActiveTab('teams')}
          className={`px-6 py-4 font-bold text-sm border-b-2 whitespace-nowrap transition-colors ${activeTab === 'teams' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Equipes e Times
        </button>
      </div>

      {activeTab === 'users' ? (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
            <div>
               <h3 className="text-xl font-bold text-gray-900 mb-1">Colaboradores da Loja</h3>
               <p className="text-sm text-gray-500">Gerencie perfis, acesso a filiais e funções do sistema.</p>
            </div>
            <button 
              onClick={openAddModal}
              className="bg-emerald-600 text-white font-bold px-6 py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shrink-0 shadow-lg shadow-emerald-600/20"
            >
              <UserPlus size={18} /> Novo Colaborador
            </button>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-gray-400" />
            </div>
            <input 
              type="text" 
              placeholder="Buscar por nome..." 
              className="w-full bg-gray-50 border border-gray-100 placeholder-gray-400 text-gray-900 rounded-2xl py-3 pl-11 pr-4 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all font-medium text-sm"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="bg-white border border-gray-100 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Colaborador</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Loja (Store ID)</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Perfil (Role)</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Status</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Cadastro</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loadingAuth || loading ? (
                <tr><td colSpan={6} className="py-12 text-center text-gray-400"><Loader2 className="animate-spin mx-auto w-6 h-6" /></td></tr>
              ) : filteredTeam.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center text-gray-400 font-medium">Nenhum funcionário encontrado na tabela de perfis.</td></tr>
              ) : (
                filteredTeam.map(t => {
                  const roleKey = (t.role || 'operador').toLowerCase();
                  const roleCfg = ROLE_DISPLAY_MAP[roleKey] || { label: t.role || 'Operador', color: 'bg-blue-100 text-blue-800', border: 'border-blue-200' };
                  return (
                    <tr key={t.id} className={`border-b border-gray-50 transition-colors ${!t.is_active ? 'opacity-50 grayscale' : 'hover:bg-gray-50/50'}`}>
                      <td className="py-4 px-6">
                        <div className="font-bold text-gray-900">{t.full_name}</div>
                        <div className="text-xs text-gray-500 font-mono mt-1">{t.email || `${t.id.substring(0, 8)}...`}</div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded-lg inline-flex">
                           <Building2 size={12}/> {t.store_id?.substring(0,6) || 'N/A'}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center px-2.5 py-1 ${roleCfg.color} border ${roleCfg.border} text-[10px] font-black rounded-lg uppercase tracking-wide`}>
                          <Shield size={10} className="mr-1.5" /> {roleCfg.label}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                         {t.is_active ? (
                            <span className="flex items-center text-emerald-600 text-xs font-bold gap-1"><CheckCircle size={14}/> Ativo</span>
                         ) : (
                            <span className="flex items-center text-red-500 text-xs font-bold gap-1"><X size={14}/> Inativo</span>
                         )}
                      </td>
                      <td className="py-4 px-6 text-xs text-gray-500">
                         {new Date(t.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-4 px-6 text-right space-x-2">
                        <button 
                          onClick={() => handleToggleActive(t)} 
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm ${t.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                        >
                           {t.is_active ? 'Desativar Acesso' : 'Reativar'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
              <h3 className="font-black text-xl text-gray-900">{formData.id ? 'Editar Colaborador' : 'Adicionar Colaborador'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm shrink-0"><X size={20}/></button>
            </div>
            
            <div className="p-6 space-y-5 overflow-y-auto">
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Nome Completo</label>
                  <input type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 transition-colors text-sm" placeholder="Ex: João da Silva" />
               </div>
               
               {!formData.id && (
                 <>
                   <div className="space-y-1.5">
                      <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">E-mail (Acesso Auth)</label>
                      <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 transition-colors text-sm" placeholder="joao@farmaflow.com" />
                   </div>

                   <div className="space-y-1.5">
                      <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Senha Provisória</label>
                      <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 transition-colors text-sm" placeholder="Mínimo 6 caracteres" />
                   </div>
                 </>
               )}

               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Perfil de Permissão (Role)</label>
                  <div className="grid grid-cols-1 gap-2">
                    {STORE_ALLOWED_ROLES.map(role => (
                       <label key={role.id} className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${formData.role === role.id ? 'border-emerald-500 bg-emerald-50' : 'border-gray-100 hover:border-gray-200'}`}>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-gray-900">{role.label}</span>
                            <span className="text-[11px] text-gray-500">{role.desc}</span>
                          </div>
                          <input type="radio" name="role" value={role.id} checked={formData.role === role.id} onChange={e => setFormData({...formData, role: e.target.value})} className="accent-emerald-600 w-4 h-4" />
                       </label>
                    ))}
                  </div>
               </div>

               {error && <div className="text-red-500 text-xs font-bold p-3 bg-red-50 rounded-xl border border-red-100">{error}</div>}
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end shrink-0">
               <button 
                 onClick={handleSave}
                 disabled={formLoading}
                 className="bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-wider text-xs py-4 px-8 rounded-xl flex items-center gap-2 transition-all shadow-lg"
               >
                 {formLoading ? <Loader2 className="animate-spin w-4 h-4 mx-auto" /> : (formData.id ? 'Salvar Edição' : 'Criar Acesso')}
               </button>
            </div>
          </div>
        </div>
      )}
        </>
      ) : (
        <TeamsSettings tenantId={tenantId} />
      )}
    </div>
  );
};
