import React, { useState, useEffect } from 'react';
import { Users, Plus, X, Loader2, Shield, Check } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

interface TeamsSettingsProps {
  tenantId: string;
}

export const TeamsSettings: React.FC<TeamsSettingsProps> = ({ tenantId }) => {
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', description: '' });
  const [formLoading, setFormLoading] = useState(false);

  // Members management
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [savingMember, setSavingMember] = useState<string | null>(null);

  useEffect(() => {
    fetchTeams();
    fetchUsers();
  }, [tenantId]);

  const fetchTeams = async () => {
    try {
      const res = await fetch(`/api/v1/teams?storeId=${tenantId}`);
      if (res.ok) {
        const json = await res.json();
        setTeams(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const savedToken = localStorage.getItem('ff_session');
      let token = '';
      if (savedToken) {
        token = JSON.parse(savedToken).access_token;
      }
      const res = await fetch(`/api/v1/team/users?tenantId=${tenantId}`, {
        headers: {
          'x-tenant-id': tenantId,
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (res.ok) {
        const json = await res.json();
        setUsers(json.data || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveTeam = async () => {
    if (!formData.name) {
      toast.error('O nome do time é obrigatório');
      return;
    }
    setFormLoading(true);
    try {
      const method = formData.id ? 'PUT' : 'POST';
      const url = formData.id ? `/api/v1/teams/${formData.id}` : `/api/v1/teams`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, store_id: tenantId })
      });
      if (!res.ok) throw new Error('Erro ao salvar time');
      toast.success('Time salvo com sucesso!');
      setIsModalOpen(false);
      fetchTeams();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este time? Todos os vínculos serão perdidos.')) return;
    try {
      const res = await fetch(`/api/v1/teams/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Erro ao excluir time');
      toast.success('Time excluído com sucesso');
      fetchTeams();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const openMembersModal = async (team: any) => {
    setSelectedTeam(team);
    setIsMembersModalOpen(true);
    setMembersLoading(true);
    try {
      const res = await fetch(`/api/v1/teams/${team.id}/members`);
      if (res.ok) {
        const json = await res.json();
        setTeamMembers(json.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setMembersLoading(false);
    }
  };

  const toggleMember = async (userId: string) => {
    if (!selectedTeam || savingMember) return;
    setSavingMember(userId);
    
    // Optimistic UI
    const isMember = teamMembers.includes(userId);
    const newMembers = isMember ? teamMembers.filter(id => id !== userId) : [...teamMembers, userId];
    setTeamMembers(newMembers);
    
    try {
      const res = await fetch(`/api/v1/teams/${selectedTeam.id}/members/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (!res.ok) {
        throw new Error('Erro ao atualizar membro');
      }
      const data = await res.json();
      setTeamMembers(data.data || []);
    } catch (e: any) {
      toast.error(e.message);
      // Revert optimism
      setTeamMembers(isMember ? [...teamMembers, userId] : teamMembers.filter(id => id !== userId));
    } finally {
      setSavingMember(null);
    }
  };

  return (
    <div className="animate-in fade-in duration-300">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-900">Times e Equipes</h3>
          <p className="text-sm text-gray-500">Agrupe operadores em times (ex: Vendas, Financeiro)</p>
        </div>
        <button
          onClick={() => { setFormData({ id: '', name: '', description: '' }); setIsModalOpen(true); }}
          className="bg-emerald-600 text-white font-bold px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-emerald-700 transition-colors"
        >
          <Plus size={18} /> Novo Time
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-12 flex justify-center text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : teams.length === 0 ? (
          <div className="col-span-full py-12 bg-white rounded-3xl border border-gray-100 flex flex-col items-center justify-center text-gray-400">
            <Users className="w-12 h-12 mb-3 opacity-20" />
            <p className="font-bold">Nenhum time configurado.</p>
          </div>
        ) : (
          teams.map(team => (
            <div key={team.id} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 border border-emerald-100">
                  <Users className="w-6 h-6" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openMembersModal(team)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-bold">Membros</button>
                  <button onClick={() => { setFormData(team); setIsModalOpen(true); }} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-bold">Editar</button>
                </div>
              </div>
              <h4 className="font-black text-gray-900 text-lg">{team.name}</h4>
              <p className="text-sm text-gray-500 mt-1 flex-1">{team.description || 'Sem descrição'}</p>
            </div>
          ))
        )}
      </div>

      {/* MODAL CREATE/EDIT */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-xl text-gray-900">{formData.id ? 'Editar Time' : 'Novo Time'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-[11px] font-black text-gray-500 uppercase">Nome do Time</label>
                <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-50 border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm" placeholder="Ex: Financeiro" />
              </div>
              <div>
                <label className="text-[11px] font-black text-gray-500 uppercase">Descrição</label>
                <input type="text" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-gray-50 border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm" placeholder="Opcional" />
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-between">
              {formData.id ? (
                <button onClick={() => handleDeleteTeam(formData.id)} className="text-red-500 font-bold px-4 py-2 hover:bg-red-50 rounded-xl">Excluir</button>
              ) : <div></div>}
              <button onClick={handleSaveTeam} disabled={formLoading} className="bg-emerald-600 text-white font-bold px-6 py-2 rounded-xl flex items-center gap-2">
                {formLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MEMBERS MODAL */}
      {isMembersModalOpen && selectedTeam && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <div>
                <h3 className="font-black text-xl text-gray-900">Membros: {selectedTeam.name}</h3>
              </div>
              <button onClick={() => setIsMembersModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {membersLoading ? (
                <div className="py-8 flex justify-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
              ) : (
                users.map(user => {
                  const userId = user.supabase_user_id;
                  const isMember = userId ? teamMembers.includes(userId) : false;
                  return (
                    <div 
                      key={user.id} 
                      onClick={() => userId && toggleMember(userId)}
                      className={`flex items-center justify-between p-3 rounded-xl border-2 ${userId ? 'cursor-pointer' : 'opacity-50'} ${isMember ? 'border-emerald-500 bg-emerald-50' : 'border-gray-100 hover:border-gray-200'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isMember ? 'bg-emerald-200 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {user.full_name?.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{user.full_name}</p>
                          <p className="text-[10px] uppercase font-black text-gray-500">{user.role}</p>
                        </div>
                      </div>
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center border ${isMember ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300'}`}>
                         {savingMember === userId ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : (isMember && <Check className="w-4 h-4" />)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
