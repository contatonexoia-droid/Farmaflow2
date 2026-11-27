import React, { useState, useEffect } from 'react';
import { Inbox, Plus, Settings, Users, X, Check, Trash2, Smartphone, Shield, Loader2, Building2, Globe, MessageSquare, Instagram, MessageCircle, QrCode, RefreshCw, Zap, Search, CheckSquare, Square, Mail, AlertCircle, RotateCcw, Bot } from 'lucide-react';
import { supabase } from '../services/supabase';
import toast, { Toaster } from 'react-hot-toast';
import { WhatsAppConnectModal } from './WhatsAppConnectModal';

interface InboxManagementProps {
  tenantId: string;
}

interface CollaboratorProfile {
  id: string;
  tenant_user_id: string;
  supabase_user_id?: string;
  name: string;
  email?: string;
  role: string;
  is_active?: boolean;
}

export const InboxManagement: React.FC<InboxManagementProps> = ({ tenantId }) => {
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    whatsapp_instance_id: '',
    channel_type: 'whatsapp',
    channel_mode: 'shared' as 'shared' | 'exclusive',
    ai_routing_enabled: false,
    is_available_for_routing: true
  });
  const [isManipulacao, setIsManipulacao] = useState(false);
  const [togglingRoutingId, setTogglingRoutingId] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [connectInboxId, setConnectInboxId] = useState<string | null>(null);
  const [connectInboxExclusive, setConnectInboxExclusive] = useState<boolean>(false);
  const [connectInitialInstanceName, setConnectInitialInstanceName] = useState<string | undefined>(undefined);
  const [isGlobalConnectModalOpen, setIsGlobalConnectModalOpen] = useState(false);
  
  // Managing members/access
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [selectedInbox, setSelectedInbox] = useState<any>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorProfile[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);
  const [collaboratorSearch, setCollaboratorSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [whatsappInstances, setWhatsappInstances] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);

  useEffect(() => {
    fetchStoreType();
    fetchInboxes();
    fetchTeam();
    fetchWhatsappInstances();
    fetchTeams();
  }, [tenantId]);

  const fetchStoreType = async () => {
    try {
      const res = await fetch(`/api/v1/tenants/${tenantId}/settings`);
      if (res.ok) {
        const json = await res.json();
        const st = json?.store_type || json?.storeType || json?.data?.store_type;
        if (st) setIsManipulacao(st === 'manipulacao');
      }
    } catch (_) {}
  };

  const fetchTeams = async () => {
    try {
      const res = await fetch(`/api/v1/teams?storeId=${tenantId}`);
      if (res.ok) {
        const json = await res.json();
        setTeams(json.data || []);
      }
    } catch (e) {
      console.warn("[InboxManagement] Error fetching teams:", e);
    }
  };

  const fetchInboxTeams = async (inboxId: string) => {
    try {
      const res = await fetch(`/api/v1/inboxes/${inboxId}/teams`);
      if (res.ok) {
        const json = await res.json();
        setSelectedTeamIds(json.data || []);
      }
    } catch (e) {
      console.warn("[InboxManagement] Error fetching inbox teams:", e);
    }
  };

  
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
        if (json.store_type === 'manipulacao') {
          setIsManipulacao(true);
        } else if (json.store_type === 'drogaria') {
          setIsManipulacao(false);
        }
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
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const saved = localStorage.getItem(`inboxes_${tenantId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const validInboxes = Array.isArray(parsed)
            ? parsed.filter((ib: any) => ib && typeof ib.id === 'string' && uuidRegex.test(ib.id))
            : [];
          setInboxes(validInboxes);
        } catch (_) {
          setInboxes([]);
        }
      } else {
        setInboxes([]);
      }
    } finally {
      setLoading(false);
    }
  };

  const getAuthHeaders = async () => {
    let token = '';
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token || '';
    } catch (_) {}

    if (!token) {
      const saved = localStorage.getItem('ff_session');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          token = parsed.access_token || parsed.token || '';
        } catch (_) {}
      }
    }

    return {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  };

  const fetchTeam = async () => {
    try {
      // 1. Try server endpoint with authentication headers
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/team/users?tenantId=${tenantId}`, { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.length > 0) {
          setTeam(json.data);
          return;
        }
      }

      // 2. Query tenant_users table directly
      const { data: tenantUsers, error: tuErr } = await supabase
        .from('tenant_users')
        .select('id, supabase_user_id, name, email, role, tenant_id')
        .eq('tenant_id', tenantId);

      if (tuErr) {
        console.error('Erro Supabase tenant_users:', tuErr);
      } else if (tenantUsers && tenantUsers.length > 0) {
        setTeam(tenantUsers.map(u => ({
          id: u.id || u.supabase_user_id,
          supabase_user_id: u.supabase_user_id || u.id,
          full_name: u.name || u.email?.split('@')[0] || 'Colaborador',
          email: u.email || '',
          role: u.role || 'operador',
          is_active: true
        })));
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

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const isExclusiveInstanceName = (name?: string | null) => {
    const n = String(name || '').trim().toLowerCase();
    return n.startsWith('inbox_ex_') || n.includes('_excl');
  };

  const instanceUsageCount = whatsappInstances.reduce<Record<string, number>>((acc, inst) => {
    if (!inst?.id) return acc;
    const count = inboxes.filter(ib => {
      if ((ib.channel_type || 'whatsapp') !== 'whatsapp') return false;
      return ib.whatsapp_instance_id === inst.id || ib.whatsapp_instance_id === inst.instance_name;
    }).length;
    acc[inst.id] = count;
    return acc;
  }, {});

  const primaryConnectedInstance = (() => {
    const validInsts = whatsappInstances.filter(i => UUID_PATTERN.test(String(i.id || '')));
    if (validInsts.length === 0) return null;
    const nonExclusivePool = validInsts.filter(i => !isExclusiveInstanceName(i.instance_name));
    const pool = nonExclusivePool.length > 0 ? nonExclusivePool : validInsts;

    const score = (i: any) => {
      let s = 0;
      const n = String(i.instance_name || '').toLowerCase();
      const refs = instanceUsageCount[i.id] || 0;
      if (i.status === 'CONNECTED') s += 1000;
      if (n.startsWith('store_')) s += 300;
      if (refs > 1) s += 200;
      else if (refs === 1) s += 50;
      return s;
    };

    const sorted = [...pool].sort((a, b) => {
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });
    return sorted[0] || null;
  })();

  const createExclusiveInstanceFallback = async (targetInboxId: string) => {
    const cleanInbox = String(targetInboxId || '')
      .replace(/^inbox_/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
    const baseSegment = (cleanInbox || Math.random().toString(36).slice(2, 10)).slice(0, 20);
    const suffix = Math.random().toString(16).slice(2, 8);
    const alreadyExists = whatsappInstances.some(
      i => String(i.instance_name || '').toLowerCase() === `inbox_ex_${baseSegment}`
    );
    const instanceName = alreadyExists
      ? `inbox_ex_${baseSegment.slice(0, 14)}_${suffix}`
      : `inbox_ex_${baseSegment}`;

    try {
      const { data: instData } = await supabase
        .from('whatsapp_instances')
        .insert([{
          store_id: tenantId,
          instance_name: instanceName,
          status: 'DISCONNECTED',
          phone_number: null,
          updated_at: new Date().toISOString()
        }])
        .select('id, instance_name')
        .single();
      if (instData?.id) {
        return { instanceId: instData.id as string, instanceName: instData.instance_name as string };
      }
    } catch (_) {}
    return { instanceId: null, instanceName };
  };

  const handleSaveInbox = async () => {
    const trimmedName = (formData.name || '').trim();
    if (!trimmedName) {
      toast.error('O nome da caixa de entrada é obrigatório.');
      return;
    }
    setFormLoading(true);
    try {
      let savedInbox: any = null;
      const isWhatsappChannel = !formData.channel_type || formData.channel_type === 'whatsapp';
      const channelMode: 'shared' | 'exclusive' = formData.channel_mode === 'exclusive' ? 'exclusive' : 'shared';

      // No modo Compartilhado (padrão), vincula automaticamente à instância CONNECTED da loja
      // sem criar nova instância na Evolution API.
      const rawSelectedId = formData.whatsapp_instance_id && formData.whatsapp_instance_id.trim() !== ''
        ? formData.whatsapp_instance_id.trim()
        : null;
      const cleanInstanceId = !isWhatsappChannel
        ? null
        : channelMode === 'shared'
          ? (primaryConnectedInstance?.id || (rawSelectedId && UUID_PATTERN.test(rawSelectedId) ? rawSelectedId : null))
          : (rawSelectedId && UUID_PATTERN.test(rawSelectedId) && rawSelectedId !== primaryConnectedInstance?.id ? rawSelectedId : null);

      const shouldOpenExclusiveConnectAfterSave =
        isWhatsappChannel && channelMode === 'exclusive' && !cleanInstanceId;

      const routingPayload = isManipulacao
        ? {
            ai_routing_enabled: Boolean(formData.ai_routing_enabled),
            is_available_for_routing: formData.is_available_for_routing !== false,
          }
        : {};

      if (formData.id) {
        // Edit existing
        const res = await fetch(`/api/v1/inboxes/${formData.id}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId
          },
          body: JSON.stringify({
            store_id: tenantId,
            name: trimmedName,
            description: formData.description || '',
            whatsapp_instance_id: cleanInstanceId,
            channel_type: formData.channel_type || 'whatsapp',
            channel_mode: channelMode,
            ...routingPayload
          })
        });

        if (res.ok) {
          const json = await res.json();
          savedInbox = json.data;
        } else {
          // Direct Supabase fallback (omits channel_type to match DB schema)
          let fallbackInstId = cleanInstanceId && UUID_PATTERN.test(cleanInstanceId) ? cleanInstanceId : null;
          let fallbackExclusiveName: string | undefined = undefined;
          if (shouldOpenExclusiveConnectAfterSave) {
            const createdEx = await createExclusiveInstanceFallback(formData.id);
            fallbackInstId = createdEx.instanceId;
            fallbackExclusiveName = createdEx.instanceName;
          }
          const dbPayload: any = { 
            name: trimmedName, 
            description: formData.description || '', 
            whatsapp_instance_id: fallbackInstId 
          };
          await supabase.from('inboxes').update(dbPayload).eq('id', formData.id);
          savedInbox = {
            id: formData.id,
            store_id: tenantId,
            ...dbPayload,
            ...routingPayload,
            channel_type: formData.channel_type || 'whatsapp',
            ...(fallbackExclusiveName ? { exclusive_instance_name: fallbackExclusiveName } : {})
          };
        }

        const resolvedInstId = savedInbox?.whatsapp_instance_id ?? cleanInstanceId;
        setInboxes(prev => prev.map(item => item.id === formData.id ? { 
          ...item, 
          name: trimmedName, 
          description: formData.description || '', 
          whatsapp_instance_id: resolvedInstId, 
          channel_type: formData.channel_type || 'whatsapp',
          ...routingPayload
        } : item));
        toast.success('Caixa de entrada atualizada com sucesso!');
      } else {
        // Create new
        const res = await fetch('/api/v1/inboxes', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId
          },
          body: JSON.stringify({
            store_id: tenantId,
            name: trimmedName,
            description: formData.description || '',
            whatsapp_instance_id: cleanInstanceId,
            channel_type: formData.channel_type || 'whatsapp',
            channel_mode: channelMode,
            ...routingPayload
          })
        });

        if (res.ok) {
          const json = await res.json();
          savedInbox = json.data;
        } else {
          const newInboxUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : undefined;
          let fallbackInstId = cleanInstanceId && UUID_PATTERN.test(cleanInstanceId) ? cleanInstanceId : null;
          let fallbackExclusiveName: string | undefined = undefined;
          if (shouldOpenExclusiveConnectAfterSave && newInboxUuid) {
            const createdEx = await createExclusiveInstanceFallback(newInboxUuid);
            fallbackInstId = createdEx.instanceId;
            fallbackExclusiveName = createdEx.instanceName;
          }
          const dbPayload: any = {
            ...(newInboxUuid ? { id: newInboxUuid } : {}),
            store_id: tenantId,
            name: trimmedName,
            description: formData.description || null,
            whatsapp_instance_id: fallbackInstId
          };
          const { data, error } = await supabase.from('inboxes').insert([dbPayload]).select().single();
          if (error || !data) {
            throw new Error(error?.message || 'Não foi possível criar a caixa de entrada no banco de dados.');
          }
          savedInbox = {
            ...data,
            channel_type: formData.channel_type || 'whatsapp',
            ...(fallbackExclusiveName ? { exclusive_instance_name: fallbackExclusiveName } : {})
          };
        }

        setInboxes(prev => [...prev, savedInbox]);
        toast.success(
          channelMode === 'shared'
            ? 'Caixa de entrada criada e vinculada ao WhatsApp da loja!'
            : 'Caixa de entrada criada! Conecte o número exclusivo via QR Code.'
        );
      }

      // Save associated teams
      if (savedInbox && savedInbox.id && selectedTeamIds.length > 0) {
        await fetch(`/api/v1/inboxes/${savedInbox.id}/teams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify({ teamIds: selectedTeamIds })
        }).catch(err => console.warn("Error saving inbox teams:", err));
      }

      // Update localStorage cache
      const currentInboxes = JSON.parse(localStorage.getItem(`inboxes_${tenantId}`) || '[]');
      if (formData.id) {
        const updated = currentInboxes.map((i: any) => i.id === formData.id ? { 
          ...i, 
          name: trimmedName, 
          description: formData.description || '', 
          whatsapp_instance_id: savedInbox?.whatsapp_instance_id ?? cleanInstanceId, 
          channel_type: formData.channel_type || 'whatsapp' 
        } : i);
        localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify(updated));
      } else if (savedInbox) {
        localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify([...currentInboxes, savedInbox]));
      }

      setIsModalOpen(false);
      await fetchInboxes();
      await fetchWhatsappInstances();

      // Apenas abre o modal exclusivo se o usuário escolheu explicitamente "Conectar outro número (Exclusivo)"
      if (shouldOpenExclusiveConnectAfterSave && savedInbox?.id) {
        const fallbackExclusiveName = `inbox_ex_${String(savedInbox.id).replace(/^inbox_/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20)}`;
        const exclusiveTargetName = savedInbox.exclusive_instance_name || fallbackExclusiveName;
        setConnectInboxId(savedInbox.id);
        setConnectInboxExclusive(true);
        setConnectInitialInstanceName(exclusiveTargetName);
      }
    } catch (e: any) {
      console.error("[InboxManagement] Erro ao salvar caixa de entrada:", e);
      toast.error(e?.message || 'Erro ao salvar caixa de entrada. Tente novamente.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteInbox = async (id: string) => {
    if (!window.confirm("Deseja realmente excluir esta caixa de entrada?")) return;
    try {
      await fetch(`/api/v1/inboxes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: tenantId ? { 'x-tenant-id': tenantId } : undefined
      });
      await supabase.from('department_access').delete().eq('department_id', id);
      await supabase.from('inboxes').delete().eq('id', id);
    } catch (e) {
      console.warn("[InboxManagement] Delete warning:", e);
    }
    setInboxes(prev => prev.filter(i => i.id !== id));
    const current = JSON.parse(localStorage.getItem(`inboxes_${tenantId}`) || '[]');
    localStorage.setItem(`inboxes_${tenantId}`, JSON.stringify(current.filter((i: any) => i.id !== id)));
    localStorage.removeItem(`department_access_${id}`);
    localStorage.removeItem(`inbox_members_${id}`);
  };

  const formatRole = (role?: string) => {
    const r = (role || '').toLowerCase().trim();
    if (r.includes('admin') || r.includes('matriz')) return 'Admin Matriz';
    if (r.includes('owner') || r.includes('propriet')) return 'Proprietário';
    if (r.includes('gerente')) return 'Gerente';
    if (r.includes('entreg')) return 'Entregador';
    if (['chat_agent', 'chat_only', 'atendente_chat', 'atendente de chat'].includes(r)) return 'Atendente de Chat';
    return 'Operador / Balconista';
  };

  const openMembersModal = async (inbox: any) => {
    setSelectedInbox(inbox);
    setIsMembersModalOpen(true);
    setMembersLoading(true);
    setLoadError(null);
    setCollaborators([]);
    setSelectedUserIds([]);
    setCollaboratorSearch('');

    try {
      const departmentId = inbox.id;
      const activeTenantId = tenantId || inbox.store_id || inbox.tenant_id || localStorage.getItem('ff_tenant_id') || localStorage.getItem('farmaflow_current_tenant_id') || '';

      // 1. CONSULTA DE COLABORADORES: Buscar na tabela 'tenant_users' com tenant_id
      let fetchedCollaborators: CollaboratorProfile[] = [];
      let hadAnyError = false;

      try {
        let tuQuery = supabase
          .from('tenant_users')
          .select('id, supabase_user_id, name, email, role, tenant_id');

        if (activeTenantId) {
          tuQuery = tuQuery.eq('tenant_id', activeTenantId);
        }

        const { data: tuData, error: tuErr } = await tuQuery;

        if (tuErr) {
          console.error('Erro Supabase tenant_users:', tuErr);
          hadAnyError = true;
        } else if (tuData && Array.isArray(tuData) && tuData.length > 0) {
          fetchedCollaborators = tuData.map(u => ({
            id: u.supabase_user_id || u.id,
            tenant_user_id: u.id,
            supabase_user_id: u.supabase_user_id || '',
            name: u.name || u.email?.split('@')[0] || 'Colaborador',
            email: u.email || '',
            role: u.role || 'operador',
            is_active: true
          }));
        }
      } catch (e: any) {
        console.error('Erro Supabase tenant_users:', e);
        hadAnyError = true;
      }

      // Fallback: Buscar via API /api/v1/team/users com JWT nos headers
      if (fetchedCollaborators.length === 0) {
        try {
          const headers = await getAuthHeaders();
          const res = await fetch(`/api/v1/team/users?tenantId=${activeTenantId}`, { headers });
          if (res.ok) {
            const json = await res.json();
            if (json.data && Array.isArray(json.data) && json.data.length > 0) {
              fetchedCollaborators = json.data.map((u: any) => ({
                id: u.supabase_user_id || u.id,
                tenant_user_id: u.id,
                supabase_user_id: u.supabase_user_id || '',
                name: u.full_name || u.name || 'Colaborador',
                email: u.email || '',
                role: u.role || 'operador',
                is_active: u.is_active !== false
              }));
            }
          } else {
            console.warn('[InboxManagement] Fallback /api/v1/team/users status:', res.status);
            if (res.status === 401 || res.status === 403 || res.status >= 500) {
              hadAnyError = true;
            }
          }
        } catch (apiErr) {
          console.warn('[InboxManagement] API /api/v1/team/users error:', apiErr);
          hadAnyError = true;
        }
      }

      // Filtra apenas colaboradores ativos
      const activeCollaborators = fetchedCollaborators.filter(p => p.is_active !== false);
      setCollaborators(activeCollaborators);

      // Se houve erro e a lista terminou vazia, exibir aviso com botão de tentar novamente
      if (activeCollaborators.length === 0 && hadAnyError) {
        setLoadError("Não foi possível carregar a lista de colaboradores de tenant_users. Verifique a conexão.");
      }

      // 2. BUSCA DE ACESSOS: Buscar acessos já existentes na tabela 'department_access' onde 'department_id' = departmentId
      let initialSelectedUserIds: string[] = [];

      try {
        let accessQuery = supabase
          .from('department_access')
          .select('user_id, tenant_id')
          .eq('department_id', departmentId);

        if (activeTenantId) {
          accessQuery = accessQuery.eq('tenant_id', activeTenantId);
        }

        const { data: accessRows, error: aErr } = await accessQuery;

        if (!aErr && accessRows && accessRows.length > 0) {
          const savedUserIds = accessRows.map((r: any) => r.user_id).filter(Boolean);
          // Mapeia para o ID usado na UI (preferência por supabase_user_id / id)
          initialSelectedUserIds = activeCollaborators
            .filter(c =>
              savedUserIds.includes(c.id) ||
              (c.supabase_user_id && savedUserIds.includes(c.supabase_user_id)) ||
              (c.tenant_user_id && savedUserIds.includes(c.tenant_user_id))
            )
            .map(c => c.id);
        }
      } catch (e) {
        console.warn("[InboxManagement] department_access fetch warning:", e);
      }

      // Fallback para inbox_members se department_access não tiver registros
      if (initialSelectedUserIds.length === 0) {
        try {
          const { data: memberRows } = await supabase
            .from('inbox_members')
            .select('user_id')
            .eq('inbox_id', departmentId);

          if (memberRows && memberRows.length > 0) {
            const savedMemberIds = memberRows.map((m: any) => m.user_id).filter(Boolean);
            initialSelectedUserIds = activeCollaborators
              .filter(c =>
                savedMemberIds.includes(c.id) ||
                (c.supabase_user_id && savedMemberIds.includes(c.supabase_user_id)) ||
                (c.tenant_user_id && savedMemberIds.includes(c.tenant_user_id))
              )
              .map(c => c.id);
          }
        } catch (_) {}
      }

      // Fallback para endpoint da API
      if (initialSelectedUserIds.length === 0) {
        try {
          const headers = await getAuthHeaders();
          const res = await fetch(`/api/v1/inboxes/${departmentId}/members`, { headers });
          if (res.ok) {
            const json = await res.json();
            if (json.data && Array.isArray(json.data)) {
              initialSelectedUserIds = activeCollaborators
                .filter(c =>
                  json.data.includes(c.id) ||
                  (c.supabase_user_id && json.data.includes(c.supabase_user_id)) ||
                  (c.tenant_user_id && json.data.includes(c.tenant_user_id))
                )
                .map(c => c.id);
            }
          }
        } catch (_) {}
      }

      // Fallback para cache local
      if (initialSelectedUserIds.length === 0) {
        const cached = localStorage.getItem(`department_access_${departmentId}`) || localStorage.getItem(`inbox_members_${departmentId}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) {
              initialSelectedUserIds = activeCollaborators
                .filter(c =>
                  parsed.includes(c.id) ||
                  (c.supabase_user_id && parsed.includes(c.supabase_user_id)) ||
                  (c.tenant_user_id && parsed.includes(c.tenant_user_id))
                )
                .map(c => c.id);
            }
          } catch (_) {}
        }
      }

      // 3. Define estado inicial marcando os checkboxes dos colaboradores que já possuem vínculo salvo
      setSelectedUserIds(initialSelectedUserIds);
    } catch (err: any) {
      console.error("[InboxManagement] Erro ao carregar acessos do departamento:", err);
      setLoadError("Erro ao comunicar com o banco de dados. Verifique a conexão.");
      toast.error("Erro ao carregar permissões do departamento.");
    } finally {
      setMembersLoading(false);
    }
  };

  const handleToggleUserAccess = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleSelectAllCollaborators = () => {
    const activeFiltered = collaborators
      .filter(c =>
        c.name.toLowerCase().includes(collaboratorSearch.toLowerCase()) ||
        (c.email && c.email.toLowerCase().includes(collaboratorSearch.toLowerCase())) ||
        c.role.toLowerCase().includes(collaboratorSearch.toLowerCase())
      )
      .map(c => c.id);

    const allSelected = activeFiltered.length > 0 && activeFiltered.every(id => selectedUserIds.includes(id));

    if (allSelected) {
      setSelectedUserIds(prev => prev.filter(id => !activeFiltered.includes(id)));
    } else {
      setSelectedUserIds(prev => Array.from(new Set([...prev, ...activeFiltered])));
    }
  };

  const handleSaveDepartmentAccess = async () => {
    if (!selectedInbox) return;
    setSavingAccess(true);
    const departmentId = selectedInbox.id;
    const activeTenantId = tenantId || selectedInbox.store_id || selectedInbox.tenant_id || localStorage.getItem('ff_tenant_id') || localStorage.getItem('farmaflow_current_tenant_id') || '';

    try {
      // 1. Remova os acessos antigos do departamento na tabela 'department_access' para o 'department_id'
      try {
        let delQuery = supabase
          .from('department_access')
          .delete()
          .eq('department_id', departmentId);

        if (activeTenantId) {
          delQuery = delQuery.eq('tenant_id', activeTenantId);
        }

        const { error: delErr } = await delQuery;

        if (delErr) {
          console.warn("[InboxManagement] department_access delete warning:", delErr);
        }
      } catch (e) {
        console.warn("[InboxManagement] department_access delete exception:", e);
      }

      // Remove também de inbox_members para compatibilidade total
      try {
        await supabase
          .from('inbox_members')
          .delete()
          .eq('inbox_id', departmentId);
      } catch (_) {}

      // 2. Insira os novos registros contendo department_id, user_id consistente e tenant_id ativo
      if (selectedUserIds.length > 0) {
        const recordsToInsert = selectedUserIds.map(selectedId => {
          const colab = collaborators.find(c =>
            c.id === selectedId ||
            c.tenant_user_id === selectedId ||
            c.supabase_user_id === selectedId
          );
          // GARANTIA DE USO DO ID DA TABELA tenant_users CONFORME SOLICITADO
          const finalUserId = colab?.tenant_user_id || colab?.id || selectedId;
          
          return {
            department_id: departmentId,
            user_id: finalUserId,
            tenant_id: activeTenantId,
            created_at: new Date().toISOString()
          };
        });

        try {
          const { error: insErr } = await supabase
            .from('department_access')
            .insert(recordsToInsert);

          if (insErr) {
            console.warn("[InboxManagement] department_access insert warning:", insErr);
          }
        } catch (e) {
          console.warn("[InboxManagement] department_access insert exception:", e);
        }

        // Também insere em inbox_members para total retrocompatibilidade
        try {
          await supabase
            .from('inbox_members')
            .insert(recordsToInsert.map(r => ({
              inbox_id: departmentId,
              user_id: r.user_id
            })));
        } catch (_) {}

        // Sincroniza com o backend Express enviando também o tenant_id para que a store grave corretamente
        try {
          const headers = await getAuthHeaders();
          await fetch(`/api/v1/inboxes/${departmentId}/members`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
              userIds: recordsToInsert.map(r => r.user_id),
              tenantId: activeTenantId
            })
          });
        } catch (_) {}
      } else {
        // Se nenhum estiver marcado, envia lista vazia para o backend
        try {
          const headers = await getAuthHeaders();
          await fetch(`/api/v1/inboxes/${departmentId}/members`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
              userIds: [],
              tenantId: activeTenantId 
            })
          });
        } catch (_) {}
      }

      // Atualiza cache no localStorage
      localStorage.setItem(`department_access_${departmentId}`, JSON.stringify(selectedUserIds));
      localStorage.setItem(`inbox_members_${departmentId}`, JSON.stringify(selectedUserIds));

      // 3. Exiba um toast/alerta de sucesso e feche o modal
      toast.success('Permissões de acesso salvas com sucesso!');
      setIsMembersModalOpen(false);
    } catch (error: any) {
      console.error("[InboxManagement] Erro ao salvar acessos:", error);
      toast.error('Erro ao salvar permissões de acesso: ' + (error.message || 'Tente novamente.'));
    } finally {
      setSavingAccess(false);
    }
  };

  const handleToggleInboxAvailability = async (inbox: any) => {
    if (!isManipulacao || !inbox?.id) return;
    const nextAvailable = !(inbox.is_available_for_routing !== false);
    setTogglingRoutingId(inbox.id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/inboxes/${inbox.id}/routing`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          store_id: tenantId,
          is_available_for_routing: nextAvailable
        })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Falha ao atualizar disponibilidade da caixa.');
      }
      setInboxes(prev =>
        prev.map(item =>
          item.id === inbox.id
            ? { ...item, is_available_for_routing: nextAvailable }
            : item
        )
      );
      toast.success(nextAvailable ? 'Caixa disponível para receber atendimentos da IA!' : 'Caixa pausada para novos atendimentos da fila.');
      fetchInboxes();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao alterar disponibilidade.');
    } finally {
      setTogglingRoutingId(null);
    }
  };

  return (
    <div className="animate-in fade-in duration-300 pb-10">
      <Toaster position="top-right" />
      
      {/* Header with Title and Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
           <h3 className="text-xl font-black text-gray-900 mb-1 flex items-center gap-2">
             <Inbox className="w-6 h-6 text-emerald-600"/> Caixas de Entrada (Departamentos)
           </h3>
           <p className="text-sm text-gray-500">Organize canais de atendimento por setores e conecte com o WhatsApp Evolution.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => setIsGlobalConnectModalOpen(true)}
            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300/80 font-bold px-5 py-3 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-xs text-sm"
          >
            <Smartphone className="w-4 h-4 text-emerald-600" />
            <QrCode className="w-4 h-4 text-emerald-600" />
            <span>Conectar WhatsApp (Evolution)</span>
          </button>
          
          <button 
            onClick={() => {
              setFormData({
                id: '',
                name: '',
                description: '',
                whatsapp_instance_id: primaryConnectedInstance?.id || '',
                channel_type: 'whatsapp',
                channel_mode: 'shared',
                ai_routing_enabled: false,
                is_available_for_routing: true
              });
              setSelectedTeamIds([]);
              setIsModalOpen(true);
            }}
            className="bg-emerald-600 text-white font-bold px-6 py-3 rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20 text-sm"
          >
            <Plus size={18} /> Nova Caixa
          </button>
        </div>
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
             <p className="text-sm mt-1">Crie caixas como "Vendas", "Atendimento" para organizar as mensagens.</p>
           </div>
        ) : (
          inboxes.map(inbox => (
            <div key={inbox.id} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 flex flex-col transition-all hover:shadow-md relative overflow-hidden group">
              <div className="flex justify-between items-start mb-4 relative z-10">
                <div className="bg-emerald-50 text-emerald-600 p-3 rounded-2xl">
                  {inbox.channel_type === 'widget' ? (
                    <Globe className="w-6 h-6 text-blue-600" />
                  ) : inbox.channel_type === 'sms' ? (
                    <MessageSquare className="w-6 h-6 text-orange-500" />
                  ) : inbox.channel_type === 'instagram' ? (
                    <Instagram className="w-6 h-6 text-pink-500" />
                  ) : (
                    <Smartphone className="w-6 h-6 text-emerald-600" />
                  )}
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const linkedInst = whatsappInstances.find(
                        i => i.id === inbox.whatsapp_instance_id || i.instance_name === inbox.whatsapp_instance_id
                      );
                      const effInstId = linkedInst?.id || primaryConnectedInstance?.id || inbox.whatsapp_instance_id || '';
                      const sharedCount = effInstId
                        ? inboxes.filter(other => {
                            if ((other.channel_type || 'whatsapp') !== 'whatsapp') return false;
                            const otherDirect = whatsappInstances.find(
                              i => i.id === other.whatsapp_instance_id || i.instance_name === other.whatsapp_instance_id
                            );
                            const otherEffId = otherDirect?.id || primaryConnectedInstance?.id || other.whatsapp_instance_id || '';
                            return Boolean(otherEffId) && otherEffId === effInstId;
                          }).length
                        : 0;
                      const isExclusiveInst = sharedCount <= 1 && Boolean(
                        linkedInst &&
                        (
                          isExclusiveInstanceName(linkedInst.instance_name) ||
                          (primaryConnectedInstance && linkedInst.id !== primaryConnectedInstance.id)
                        )
                      );
                      setFormData({
                        id: inbox.id,
                        name: inbox.name,
                        description: inbox.description || '',
                        whatsapp_instance_id: isExclusiveInst
                          ? (linkedInst?.id || '')
                          : (primaryConnectedInstance?.id || inbox.whatsapp_instance_id || ''),
                        channel_type: inbox.channel_type || 'whatsapp',
                        channel_mode: isExclusiveInst ? 'exclusive' : 'shared',
                        ai_routing_enabled: Boolean(inbox.ai_routing_enabled),
                        is_available_for_routing: inbox.is_available_for_routing !== false
                      });
                      setSelectedTeamIds([]);
                      fetchInboxTeams(inbox.id);
                      setIsModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors border border-gray-200 hover:border-emerald-200"
                  >
                    <Settings className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button onClick={() => handleDeleteInbox(inbox.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="relative z-10 mb-4">
                <h4 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                  {inbox.name}
                </h4>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{inbox.description || 'Sem descrição'}</p>
                {isManipulacao && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 bg-gray-50/90 border border-gray-200/80 rounded-xl px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-purple-700 bg-purple-100/80 px-2 py-0.5 rounded-md">
                        <Bot className="w-3 h-3" /> {inbox.ai_routing_enabled ? 'Fila IA Ativa' : 'Fora da IA'}
                      </span>
                      {(() => {
                        const activeCount = Number(inbox.active_conversations_count || 0);
                        const available = inbox.is_available_for_routing !== false;
                        if (!available) {
                          return (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                              Pausada para fila
                            </span>
                          );
                        }
                        if (activeCount === 0) {
                          return (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                              0 ativos • Livre
                            </span>
                          );
                        }
                        return (
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-orange-100 text-orange-800">
                            {activeCount} {activeCount === 1 ? 'ativo' : 'ativos'} • Ocupado
                          </span>
                        );
                      })()}
                    </div>
                    {inbox.ai_routing_enabled && (
                      <button
                        type="button"
                        disabled={togglingRoutingId === inbox.id}
                        onClick={() => handleToggleInboxAvailability(inbox)}
                        className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg transition-colors border ${
                          inbox.is_available_for_routing !== false
                            ? 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                            : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                        }`}
                        title="Alternar disponibilidade imediata para receber atendimentos da IA"
                      >
                        {togglingRoutingId === inbox.id
                          ? 'Salvando...'
                          : inbox.is_available_for_routing !== false
                            ? 'Recebendo'
                            : 'Reativar'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-auto space-y-3 relative z-10">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-50 p-2.5 rounded-2xl border border-gray-100">
                  {inbox.channel_type === 'widget' ? (
                    <span className="flex items-center gap-1.5 text-blue-600"><Globe className="w-4 h-4" /> Site / Widget</span>
                  ) : inbox.channel_type === 'sms' ? (
                    <span className="flex items-center gap-1.5 text-orange-500"><MessageSquare className="w-4 h-4" /> SMS</span>
                  ) : inbox.channel_type === 'instagram' ? (
                    <span className="flex items-center gap-1.5 text-pink-500"><Instagram className="w-4 h-4" /> Instagram</span>
                  ) : (
                    <div className="flex flex-col gap-2 w-full">
                      {(() => {
                        const directInstance = whatsappInstances.find(
                          i => i.id === inbox.whatsapp_instance_id || i.instance_name === inbox.whatsapp_instance_id
                        );
                        const instance = directInstance || primaryConnectedInstance;
                        const isConnected = instance?.status === 'CONNECTED';
                        const effectiveInstanceId = instance?.id || inbox.whatsapp_instance_id || '';
                        const sharedInstanceCount = effectiveInstanceId
                          ? inboxes.filter(other => {
                              if ((other.channel_type || 'whatsapp') !== 'whatsapp') return false;
                              const otherDirect = whatsappInstances.find(
                                i => i.id === other.whatsapp_instance_id || i.instance_name === other.whatsapp_instance_id
                              );
                              const otherEffId = otherDirect?.id || primaryConnectedInstance?.id || other.whatsapp_instance_id || '';
                              return Boolean(otherEffId) && otherEffId === effectiveInstanceId;
                            }).length
                          : 0;
                        const isSharedInstance = sharedInstanceCount > 1;
                        const isExclusive = !isSharedInstance && Boolean(
                          directInstance &&
                          (
                            isExclusiveInstanceName(directInstance.instance_name) ||
                            (primaryConnectedInstance && directInstance.id !== primaryConnectedInstance.id)
                          )
                        );
                        const instName = instance?.instance_name || 'Aguardando conexão';
                        const phone = instance?.phone_number;

                        const openConnectModal = () => {
                          if (isExclusive) {
                            setConnectInboxId(inbox.id);
                            setConnectInboxExclusive(true);
                            setConnectInitialInstanceName(directInstance?.instance_name);
                          } else {
                            setIsGlobalConnectModalOpen(true);
                          }
                        };

                        return (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="flex items-center gap-1.5 text-emerald-700 font-bold"><Smartphone className="w-4 h-4" /> WhatsApp Evolution</span>
                              <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${
                                isExclusive
                                  ? 'bg-indigo-100 text-indigo-900'
                                  : 'bg-emerald-100/80 text-emerald-900'
                              }`}>
                                {isExclusive ? 'Exclusivo' : 'Compartilhado'}
                              </span>
                            </div>

                            <div className="flex flex-col gap-1.5 w-full bg-white p-2.5 rounded-xl border border-gray-200/80 shadow-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] uppercase font-black tracking-wider text-gray-400">Instância</span>
                                <span className="text-[11px] font-mono font-bold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[140px]">
                                  {instName}
                                </span>
                              </div>

                              {phone && (
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] uppercase font-black tracking-wider text-gray-400">Número</span>
                                  <span className="text-[11px] font-bold text-gray-800">
                                    {phone}
                                  </span>
                                </div>
                              )}

                              <div className="flex items-center justify-between pt-1 border-t border-gray-100 mt-0.5">
                                <span className="text-[10px] uppercase font-black tracking-wider text-gray-400">Status</span>
                                {isConnected ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Conectado
                                    </span>
                                    <button
                                      onClick={openConnectModal}
                                      className="text-[11px] font-bold text-gray-500 hover:text-emerald-700 underline ml-1"
                                    >
                                      Gerenciar
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={openConnectModal}
                                    className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shadow-xs"
                                  >
                                    <QrCode className="w-3.5 h-3.5" /> Conectar WhatsApp
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <button onClick={() => openMembersModal(inbox)} className="w-full flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold py-2.5 rounded-xl transition-colors text-sm">
                   <Users className="w-4 h-4" /> Gerenciar Acessos
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* WhatsApp Modal for specific exclusive inbox */}
      <WhatsAppConnectModal
        isOpen={!!connectInboxId}
        onClose={() => {
          setConnectInboxId(null);
          setConnectInboxExclusive(false);
          setConnectInitialInstanceName(undefined);
          fetchInboxes();
          fetchWhatsappInstances();
        }}
        tenantId={tenantId}
        inboxId={connectInboxId || undefined}
        inboxName={inboxes.find(i => i.id === connectInboxId)?.name}
        exclusive={connectInboxExclusive}
        initialInstanceName={connectInitialInstanceName}
      />

      {/* WhatsApp Modal for Global Store instance (Compartilhado) */}
      <WhatsAppConnectModal
        isOpen={isGlobalConnectModalOpen}
        onClose={() => {
          setIsGlobalConnectModalOpen(false);
          fetchInboxes();
          fetchWhatsappInstances();
        }}
        tenantId={tenantId}
        initialInstanceName={primaryConnectedInstance?.instance_name}
      />

      {/* Modal Caixa de Entrada */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-xl text-gray-900">{formData.id ? 'Editar Caixa' : 'Nova Caixa de Entrada'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm"><X size={20}/></button>
            </div>
            <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Nome do Departamento / Canal *</label>
                  <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm" placeholder="Ex: Atendimento Balcão" />
               </div>
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Descrição</label>
                  <input type="text" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm" placeholder="Opcional" />
               </div>
               
               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Tipo de Canal de Entrada</label>
                  <select 
                    value={formData.channel_type || 'whatsapp'} 
                    onChange={e => setFormData({...formData, channel_type: e.target.value, whatsapp_instance_id: e.target.value === 'whatsapp' ? formData.whatsapp_instance_id : ''})} 
                    className="w-full bg-gray-50 focus:bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl py-3 px-4 outline-none font-bold text-gray-800 text-sm"
                  >
                    <option value="whatsapp">WhatsApp Evolution API (Recomendado)</option>
                    <option value="widget">Site / Widget (Chat de Atendimento)</option>
                    <option value="sms">SMS (Torpedos Celular)</option>
                    <option value="instagram">Instagram Direct</option>
                  </select>
               </div>

               {(formData.channel_type === 'whatsapp' || !formData.channel_type) && (
                 <div className="space-y-3 bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black text-emerald-900 uppercase tracking-widest flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5 text-emerald-600"/> Vínculo com WhatsApp
                      </label>
                      <button 
                        type="button" 
                        onClick={fetchWhatsappInstances} 
                        className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" /> Atualizar
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label
                        onClick={() =>
                          setFormData({
                            ...formData,
                            channel_mode: 'shared',
                            whatsapp_instance_id: primaryConnectedInstance?.id || ''
                          })
                        }
                        className={`flex items-start gap-2.5 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                          formData.channel_mode !== 'exclusive'
                            ? 'border-emerald-500 bg-white shadow-xs'
                            : 'border-transparent bg-white/70 hover:border-emerald-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="whatsapp_channel_mode"
                          checked={formData.channel_mode !== 'exclusive'}
                          onChange={() =>
                            setFormData({
                              ...formData,
                              channel_mode: 'shared',
                              whatsapp_instance_id: primaryConnectedInstance?.id || ''
                            })
                          }
                          className="mt-0.5 accent-emerald-600"
                        />
                        <div className="text-xs">
                          <div className="font-bold text-gray-900">
                            Compartilhado (Mesmo WhatsApp da loja)
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {primaryConnectedInstance
                              ? `Usa automaticamente ${primaryConnectedInstance.instance_name}${primaryConnectedInstance.phone_number ? ` (${primaryConnectedInstance.phone_number})` : ''} sem criar nova instância.`
                              : 'Será vinculado automaticamente assim que o WhatsApp da loja for conectado.'}
                          </p>
                        </div>
                      </label>

                      <label
                        onClick={() => {
                          const keepCurrentExclusive =
                            formData.channel_mode === 'exclusive' &&
                            formData.whatsapp_instance_id !== primaryConnectedInstance?.id;
                          setFormData({
                            ...formData,
                            channel_mode: 'exclusive',
                            whatsapp_instance_id: keepCurrentExclusive ? formData.whatsapp_instance_id : ''
                          });
                        }}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                          formData.channel_mode === 'exclusive'
                            ? 'border-indigo-500 bg-white shadow-xs'
                            : 'border-transparent bg-white/70 hover:border-indigo-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="whatsapp_channel_mode"
                          checked={formData.channel_mode === 'exclusive'}
                          onChange={() => {
                            const keepCurrentExclusive =
                              formData.channel_mode === 'exclusive' &&
                              formData.whatsapp_instance_id !== primaryConnectedInstance?.id;
                            setFormData({
                              ...formData,
                              channel_mode: 'exclusive',
                              whatsapp_instance_id: keepCurrentExclusive ? formData.whatsapp_instance_id : ''
                            });
                          }}
                          className="mt-0.5 accent-indigo-600"
                        />
                        <div className="text-xs">
                          <div className="font-bold text-gray-900">
                            Conectar outro número de WhatsApp (Exclusivo)
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            Cria ou vincula uma instância dedicada apenas para esta caixa de entrada.
                          </p>
                        </div>
                      </label>
                    </div>

                    {formData.channel_mode === 'exclusive' && (
                      <div className="pt-1 space-y-2">
                        <select 
                          value={
                            formData.whatsapp_instance_id === primaryConnectedInstance?.id
                              ? ''
                              : formData.whatsapp_instance_id
                          } 
                          onChange={e => setFormData({...formData, whatsapp_instance_id: e.target.value})} 
                          className="w-full bg-white border border-indigo-200 focus:border-indigo-500 rounded-xl py-2.5 px-3 outline-none font-bold text-gray-800 text-xs"
                        >
                          <option value="">(Conectar novo número exclusivo via QR Code ao salvar)</option>
                          {whatsappInstances
                            .filter(inst => {
                              if (!UUID_PATTERN.test(String(inst.id || ''))) return false;
                              if (primaryConnectedInstance && inst.id === primaryConnectedInstance.id) return false;
                              if (String(inst.instance_name || '').toLowerCase().startsWith('store_')) return false;
                              if ((instanceUsageCount[inst.id] || 0) > 1) return false;
                              const usedByOtherInbox = inboxes.some(
                                other =>
                                  other.id !== formData.id &&
                                  (other.whatsapp_instance_id === inst.id || other.whatsapp_instance_id === inst.instance_name)
                              );
                              if (usedByOtherInbox) return false;
                              return true;
                            })
                            .map(inst => (
                              <option key={inst.id} value={inst.id}>
                                {inst.instance_name} {inst.phone_number ? `(${inst.phone_number})` : ''} - {inst.status || 'OFFLINE'}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                 </div>
               )}

               {isManipulacao && (
                 <div className="space-y-3 bg-purple-50/70 p-4 rounded-2xl border border-purple-200/80">
                   <div className="flex items-center gap-2">
                     <Bot className="w-4 h-4 text-purple-700" />
                     <label className="text-[11px] font-black text-purple-900 uppercase tracking-widest">
                       IA Orquestradora (Manipulação)
                     </label>
                   </div>
                   <label className="flex items-start gap-2.5 cursor-pointer bg-white p-3 rounded-xl border border-purple-100">
                     <input
                       type="checkbox"
                       checked={Boolean(formData.ai_routing_enabled)}
                       onChange={e => setFormData({ ...formData, ai_routing_enabled: e.target.checked })}
                       className="mt-0.5 rounded text-purple-600 focus:ring-purple-500"
                     />
                     <div>
                       <span className="text-xs font-bold text-gray-900 block">Participar da distribuição automática da IA</span>
                       <span className="text-[11px] text-gray-500 block">Permite que a IA encaminhe clientes triados automaticamente para esta caixa.</span>
                     </div>
                   </label>
                   <label className="flex items-start gap-2.5 cursor-pointer bg-white p-3 rounded-xl border border-purple-100">
                     <input
                       type="checkbox"
                       checked={formData.is_available_for_routing !== false}
                       onChange={e => setFormData({ ...formData, is_available_for_routing: e.target.checked })}
                       className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                     />
                     <div>
                       <span className="text-xs font-bold text-gray-900 block">Disponível para receber atendimentos agora</span>
                       <span className="text-[11px] text-gray-500 block">Desmarque se a atendente estiver em pausa, almoço ou fora do expediente.</span>
                     </div>
                   </label>
                 </div>
               )}

               <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Times / Equipes Vinculadas</label>
                  {teams.length === 0 ? (
                    <p className="text-xs text-gray-400 font-medium">Nenhum time cadastrado para vincular.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {teams.map(t => {
                        const isSelected = selectedTeamIds.includes(t.id);
                        return (
                          <div
                            key={t.id}
                            onClick={() => {
                              setSelectedTeamIds(prev =>
                                isSelected ? prev.filter(id => id !== t.id) : [...prev, t.id]
                              );
                            }}
                            className={`flex items-center gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                              isSelected
                                ? 'border-emerald-500 bg-emerald-50/50 text-emerald-900'
                                : 'border-gray-100 hover:border-gray-200 text-gray-700'
                            }`}
                          >
                            <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                              isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-300 bg-white'
                            }`}>
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                            <span className="text-xs font-bold truncate">{t.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
               </div>
            </div>
            <div className="p-6 border-t border-gray-100 bg-gray-50/50">
               <button 
                 onClick={handleSaveInbox} 
                 disabled={formLoading || !formData.name.trim()} 
                 className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-black uppercase tracking-wider text-xs py-4 px-8 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg"
               >
                 {formLoading ? <Loader2 className="animate-spin w-4 h-4" /> : 'Salvar Caixa de Entrada'}
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Gerenciar Membros / Permissões de Acesso */}
      {isMembersModalOpen && selectedInbox && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[88vh]">
            {/* Cabeçalho do Modal */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/80 shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-100 text-indigo-700 p-2.5 rounded-2xl">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-gray-900 leading-tight">
                    Acesso: {selectedInbox.name}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Selecione quais colaboradores podem ver e atender conversas neste departamento
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsMembersModalOpen(false)} 
                className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-xs transition-colors border border-gray-200"
              >
                <X size={18} />
              </button>
            </div>
            
            {/* Barra de Filtro e Seleção Rápida */}
            <div className="p-4 border-b border-gray-100 bg-white space-y-3 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                  type="text" 
                  value={collaboratorSearch}
                  onChange={e => setCollaboratorSearch(e.target.value)}
                  placeholder="Buscar colaborador por nome, e-mail ou cargo..."
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 focus:bg-white border border-gray-200 focus:border-indigo-500 rounded-xl outline-none text-xs font-semibold text-gray-800 transition-all placeholder:text-gray-400"
                />
                {collaboratorSearch && (
                  <button 
                    onClick={() => setCollaboratorSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {!membersLoading && collaborators.length > 0 && (
                <div className="flex items-center justify-between px-1 text-xs">
                  <span className="font-bold text-gray-500">
                    <span className="text-indigo-600 font-extrabold">{selectedUserIds.length}</span> de {collaborators.length} selecionado(s)
                  </span>
                  <button
                    type="button"
                    onClick={handleSelectAllCollaborators}
                    className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline"
                  >
                    {collaborators.every(c => selectedUserIds.includes(c.id)) ? 'Desmarcar Todos' : 'Selecionar Todos'}
                  </button>
                </div>
              )}
            </div>

            {/* Lista Rolável de Colaboradores */}
            <div className="p-4 flex-1 overflow-y-auto space-y-2.5 min-h-[220px]">
              {membersLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  <p className="text-xs font-bold text-gray-500">Carregando colaboradores e permissões...</p>
                </div>
              ) : loadError ? (
                <div className="py-8 text-center flex flex-col items-center justify-center px-4 bg-amber-50/70 border border-amber-200/80 rounded-2xl">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-2.5 shadow-xs">
                    <AlertCircle className="w-6 h-6" />
                  </div>
                  <p className="font-black text-gray-900 text-sm">Erro ao carregar colaboradores</p>
                  <p className="text-xs text-gray-600 mt-1 max-w-xs mb-4 leading-relaxed">
                    {loadError}
                  </p>
                  <button
                    type="button"
                    onClick={() => openMembersModal(selectedInbox)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Tentar Novamente</span>
                  </button>
                </div>
              ) : collaborators.length === 0 ? (
                <div className="py-10 text-center flex flex-col items-center justify-center text-gray-400 px-4">
                  <Shield className="w-10 h-10 mb-2 opacity-30 text-indigo-600" />
                  <p className="font-bold text-gray-700 text-sm">Nenhum colaborador encontrado</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-xs">
                    Cadastre atendentes na aba de Equipe / Colaboradores para conceder acessos a este departamento.
                  </p>
                </div>
              ) : (
                (() => {
                  const filtered = collaborators.filter(c => 
                    c.name.toLowerCase().includes(collaboratorSearch.toLowerCase()) ||
                    (c.email && c.email.toLowerCase().includes(collaboratorSearch.toLowerCase())) ||
                    c.role.toLowerCase().includes(collaboratorSearch.toLowerCase())
                  );

                  if (filtered.length === 0) {
                    return (
                      <div className="py-8 text-center text-gray-400 text-xs">
                        Nenhum colaborador corresponde à busca "{collaboratorSearch}".
                      </div>
                    );
                  }

                  return filtered.map(member => {
                    const isChecked = selectedUserIds.includes(member.id);

                    return (
                      <div 
                        key={member.id} 
                        onClick={() => handleToggleUserAccess(member.id)}
                        className={`flex items-center justify-between p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                          isChecked 
                            ? 'border-indigo-500 bg-indigo-50/70 shadow-xs' 
                            : 'border-gray-100 hover:border-gray-200 bg-white hover:bg-gray-50/50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          {/* Checkbox de seleção */}
                          <div className={`w-5 h-5 rounded-lg flex items-center justify-center border transition-colors shrink-0 ${
                            isChecked 
                              ? 'bg-indigo-600 border-indigo-600 text-white' 
                              : 'border-gray-300 bg-white'
                          }`}>
                            {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>

                          {/* Avatar / Iniciais */}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                            isChecked 
                              ? 'bg-indigo-200 text-indigo-800' 
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {member.name.substring(0, 2).toUpperCase() || <Shield className="w-4 h-4" />}
                          </div>

                          {/* Nome e Detalhes */}
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 text-sm truncate">{member.name}</p>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                              {member.email && (
                                <span className="text-xs text-gray-500 truncate max-w-[180px]">
                                  {member.email}
                                </span>
                              )}
                              <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                                member.role.toLowerCase().includes('admin') || member.role.toLowerCase().includes('matriz')
                                  ? 'bg-purple-100 text-purple-800'
                                  : member.role.toLowerCase().includes('gerente')
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : ['chat_agent', 'chat_only', 'atendente_chat', 'atendente de chat'].includes(member.role.toLowerCase().trim())
                                  ? 'bg-teal-100 text-teal-800'
                                  : 'bg-blue-100 text-blue-800'
                              }`}>
                                {formatRole(member.role)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Status Visual */}
                        <div className="shrink-0 text-right">
                          <span className={`text-[11px] font-bold px-2 py-1 rounded-lg ${
                            isChecked ? 'text-indigo-700 bg-indigo-100/80 font-extrabold' : 'text-gray-400 bg-gray-100'
                          }`}>
                            {isChecked ? 'Com Acesso' : 'Sem Acesso'}
                          </span>
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
            
            {/* Rodapé com Ações */}
            <div className="p-4 border-t border-gray-100 bg-gray-50/80 flex items-center gap-3 shrink-0">
              <button 
                type="button"
                onClick={() => setIsMembersModalOpen(false)}
                disabled={savingAccess}
                className="flex-1 bg-white hover:bg-gray-100 text-gray-700 font-bold text-xs py-3.5 px-4 rounded-xl border border-gray-200 transition-colors uppercase tracking-wider"
              >
                Cancelar
              </button>
              <button 
                type="button"
                onClick={handleSaveDepartmentAccess} 
                disabled={savingAccess || membersLoading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-black uppercase tracking-wider text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-600/20"
              >
                {savingAccess ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <span>SALVAR ALTERAÇÕES</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
