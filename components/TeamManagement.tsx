import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Shield, CheckCircle, Trash2, Edit3, X, Loader2, Search } from 'lucide-react';
import { supabase } from '../services/supabase';

interface TeamManagementProps {
  tenantId: string;
}

const ROLES = [
  { id: 'owner', label: 'Proprietário', color: 'bg-purple-100 text-purple-800', border: 'border-purple-200', desc: 'Acesso total' },
  { id: 'admin', label: 'Administrador', color: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-200', desc: 'Configurações e financeiro' },
  { id: 'gerente', label: 'Gerente', color: 'bg-blue-100 text-blue-800', border: 'border-blue-200', desc: 'Gestão de catálogo e pedidos' },
  { id: 'operador', label: 'Operador', color: 'bg-orange-100 text-orange-800', border: 'border-orange-200', desc: 'Pedidos e estoque' },
  { id: 'entregador', label: 'Entregador', color: 'bg-gray-100 text-gray-800', border: 'border-gray-200', desc: 'Apenas entregas' }
];

export const TeamManagement: React.FC<TeamManagementProps> = ({ tenantId }) => {
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', email: '', role: 'operador', is_active: true, password: '' });
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
        if (isMounted) {
          setLoadingAuth(false);
        }
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null);
        setLoadingAuth(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!loadingAuth && user) {
      fetchTeam();
    }
  }, [tenantId, loadingAuth, user]);

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
    };
  };

  const fetchTeam = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/tenants/${tenantId}/users`, { headers });
      if (res.ok) {
        const json = await res.json();
        setTeam(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setFormData({ id: '', name: '', email: '', role: 'operador', is_active: true, password: '' });
    setError('');
    setIsModalOpen(true);
  };

  const openEditModal = (user: any) => {
    setFormData({ ...user, password: '' });
    setError('');
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.email || (!formData.id && !formData.password)) {
      setError('Preencha os campos obrigatórios.');
      return;
    }
    setFormLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const method = formData.id ? 'PATCH' : 'POST';
      const url = formData.id 
        ? `/api/v1/tenants/${tenantId}/users/${formData.id}` 
        : `/api/v1/tenants/${tenantId}/users`;

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

  const handleDelete = async (employeeId: string) => {
    if (!window.confirm("Certeza que deseja excluir este funcionário definitivamente?")) return;
    try {
      const { error: deleteError } = await supabase.from('tenant_users').delete().eq('id', employeeId);
      if (deleteError) throw deleteError;
      
      setTeam(prev => prev.filter(emp => emp.id !== employeeId));
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Erro ao excluir funcionário");
    }
  };

  const filteredTeam = team.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
           <h3 className="text-xl font-bold text-gray-900 mb-1">Membros da Equipe</h3>
           <p className="text-sm text-gray-500">Gerencie os acessos e funções dos seus funcionários.</p>
        </div>
        <button 
          onClick={openAddModal}
          className="bg-brand text-white font-bold px-6 py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-600 transition-colors shrink-0 shadow-lg shadow-brand/20"
        >
          <UserPlus size={18} /> Novo Funcionário
        </button>
      </div>

      <div className="relative mb-6">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search size={18} className="text-gray-400" />
        </div>
        <input 
          type="text" 
          placeholder="Buscar por nome ou e-mail..." 
          className="w-full bg-gray-50 border border-gray-100 placeholder-gray-400 text-gray-900 rounded-2xl py-3 pl-11 pr-4 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-all font-medium"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white border border-gray-100 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Funcionário</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Acesso / Função</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider">Status</th>
                <th className="py-4 px-6 font-black text-[11px] text-gray-400 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loadingAuth || loading ? (
                <tr><td colSpan={4} className="py-12 text-center text-gray-400"><Loader2 className="animate-spin mx-auto w-6 h-6" /></td></tr>
              ) : filteredTeam.length === 0 ? (
                <tr><td colSpan={4} className="py-12 text-center text-gray-400 font-medium">Nenhum funcionário encontrado.</td></tr>
              ) : (
                filteredTeam.map(user => {
                  const roleCfg = ROLES.find(r => r.id === user.role) || ROLES[3];
                  return (
                    <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-bold text-gray-900">{user.name}</div>
                        <div className="text-xs text-gray-500">{user.email}</div>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center px-2.5 py-1 ${roleCfg.color} border ${roleCfg.border} text-xs font-bold rounded-lg uppercase tracking-wide`}>
                          <Shield size={12} className="mr-1" /> {roleCfg.label}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                         {user.is_active ? (
                            <span className="flex items-center text-emerald-600 text-sm font-bold gap-1"><CheckCircle size={14}/> Ativo</span>
                         ) : (
                            <span className="flex items-center text-red-500 text-sm font-bold gap-1"><X size={14}/> Bloqueado</span>
                         )}
                      </td>
                      <td className="py-4 px-6 text-right space-x-2">
                        <button onClick={() => openEditModal(user)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"><Edit3 size={18} /></button>
                        <button onClick={() => handleDelete(user.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                           <Trash2 size={18} />
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
              <h3 className="font-black text-xl text-gray-900">{formData.id ? 'Editar Funcionário' : 'Novo Funcionário'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm shrink-0"><X size={20}/></button>
            </div>
            
            <div className="p-6 space-y-5 overflow-y-auto">
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Nome Completo</label>
                  <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-brand rounded-xl py-3 px-4 outline-none font-bold text-gray-800 transition-colors" placeholder="Ex: João Silva" />
               </div>
               
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">E-mail (Acesso)</label>
                  <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-brand rounded-xl py-3 px-4 outline-none font-bold text-gray-800 transition-colors" placeholder="joao@drogaria.com" readOnly={!!formData.id} />
               </div>

               {!formData.id && (
                 <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Senha Provisória</label>
                    <input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-brand rounded-xl py-3 px-4 outline-none font-bold text-gray-800 transition-colors" placeholder="Mínimo 6 caracteres" />
                 </div>
               )}

               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Função no Sistema</label>
                  <div className="grid grid-cols-1 gap-2">
                    {ROLES.slice(1).map(role => (
                       <label key={role.id} className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${formData.role === role.id ? 'border-brand bg-brand/5' : 'border-gray-100 hover:border-gray-200'}`}>
                          <div className="flex flex-col">
                            <span className="font-bold text-sm text-gray-900">{role.label}</span>
                            <span className="text-xs text-gray-500">{role.desc}</span>
                          </div>
                          <input type="radio" name="role" value={role.id} checked={formData.role === role.id} onChange={e => setFormData({...formData, role: e.target.value})} className="accent-brand w-4 h-4" />
                       </label>
                    ))}
                  </div>
               </div>

               {error && <div className="text-red-500 text-sm font-bold p-3 bg-red-50 rounded-xl">{error}</div>}
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end shrink-0">
               <button 
                 onClick={handleSave}
                 disabled={formLoading}
                 className="bg-emerald-600 hover:bg-brand text-white font-black uppercase tracking-wider text-sm py-4 px-8 rounded-xl flex items-center gap-2 transition-all shadow-lg"
               >
                 {formLoading ? <Loader2 className="animate-spin w-5 h-5 mx-auto" /> : (formData.id ? 'Salvar Edição' : 'Criar Conta')}
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
