import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Send, FileText, Image as ImageIcon, Paperclip, User, Users, Clock, ShoppingBag, CreditCard, MessageSquare, Lock, AlertCircle, RefreshCw, Smartphone, ChevronLeft, ChevronDown, ChevronUp, Info, BarChart2, CheckCircle2, UserPlus, Inbox, MoreVertical, Kanban, LayoutList, Columns, QrCode, Pill, Sparkles, Calendar, X, Download, Smile } from 'lucide-react';
import { ChatTransferModal } from './ChatTransferModal';
import { AiChatCopilot } from './AiChatCopilot';
import { ChatKanban } from './ChatKanban';
import { WhatsAppConnectModal } from './WhatsAppConnectModal';
import { supabase } from '../services/supabase';
import { calculateItemDepletionForecast, isProductContinuousUse } from '../utils/pharmaContext';

// Helper to determine active tenant logic for demo
const DEMO_TENANT_ID = 'tenant-id'; // Assume this for now if not passed

const FILTER_TABS = [
  { id: 'todas', label: 'Todas' },
  { id: 'minhas', label: 'Minhas' },
  { id: 'nao_atribuidas', label: 'Não Atribuídas' },
  { id: 'finalizadas', label: 'Finalizadas' }
];

export const ChatCentral = ({ currentUser, userRole, tenantId = DEMO_TENANT_ID }: any) => {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
  const [filter, setFilter] = useState('todas'); // minhas, nao_atribuidas, todas, finalizadas
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInboxId, setSelectedInboxId] = useState('all');
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [allowedInboxIds, setAllowedInboxIds] = useState<string[]>([]);
  const messagesEndRef = useRef<any>(null);

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<'LIST' | 'CHAT' | 'SIDEBAR'>('LIST');
  const [chatDisplayMode, setChatDisplayMode] = useState<'SPLIT' | 'KANBAN'>('KANBAN');

  const handleOpenFromKanban = (conv: any) => {
    setSelectedConversation(conv);
    setChatDisplayMode('SPLIT');
    setActiveView('CHAT');
  };

  // Customer Context Data
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [continuousUseData, setContinuousUseData] = useState<any>(null);
  const [isFetchingContext, setIsFetchingContext] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState<string[]>([]);

  const toggleOrderAccordion = (orderId: string) => {
    setExpandedOrderIds(prev => 
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };


  // --- STATES & HANDLERS FOR LABELS & CANNED RESPONSES ---
  const [availableLabels, setAvailableLabels] = useState<any[]>([]);
  const [cannedResponses, setCannedResponses] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [selectedTagId, setSelectedTagId] = useState('all');
  const [isLabelPopoverOpen, setIsLabelPopoverOpen] = useState(false);
  const [isCannedDropdownOpen, setIsCannedDropdownOpen] = useState(false);
  const [filteredCanned, setFilteredCanned] = useState<any[]>([]);
  const [cannedSearch, setCannedSearch] = useState('');
  const [activeCannedIndex, setActiveCannedIndex] = useState(0);

  const fetchLabelsAndCanned = async () => {
    try {
      const resLabels = await fetch(`/api/v1/chat/labels?tenantId=${tenantId}`);
      if (resLabels.ok) {
        const jsonLabels = await resLabels.json();
        if (jsonLabels?.data) setAvailableLabels(jsonLabels.data);
      }
      const resCanned = await fetch(`/api/v1/chat/canned-responses?tenantId=${tenantId}`);
      if (resCanned.ok) {
        const jsonCanned = await resCanned.json();
        if (jsonCanned?.data) setCannedResponses(jsonCanned.data);
      }
      const resTeams = await fetch(`/api/v1/teams?storeId=${tenantId}`);
      if (resTeams.ok) {
        const jsonTeams = await resTeams.json();
        if (jsonTeams?.data) setTeams(jsonTeams.data);
      }
    } catch (e) {
      console.warn("Error loading labels, canned responses, or teams:", e);
    }
  };

  useEffect(() => {
    fetchLabelsAndCanned();
  }, [tenantId]);

  const toggleLabelOnConversation = async (labelId: string) => {
    if (!selectedConversation) return;
    const currentLabels = selectedConversation.labels || [];
    const hasLabel = currentLabels.some((l: any) => l.id === labelId);
    let newLabels;
    if (hasLabel) {
      newLabels = currentLabels.filter((l: any) => l.id !== labelId);
    } else {
      const labelToAdd = availableLabels.find((l: any) => l.id === labelId);
      newLabels = [...currentLabels, labelToAdd].filter(Boolean);
    }

    const updatedConv = { ...selectedConversation, labels: newLabels };
    setSelectedConversation(updatedConv);
    setConversations(prev => prev.map(c => c.id === selectedConversation.id ? updatedConv : c));

    try {
      await fetch(`/api/v1/chat/conversations/${selectedConversation.id}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelIds: newLabels.map((l: any) => l.id) })
      });
    } catch (e) {
      console.error("Error setting labels:", e);
    }
  };

  const handleMessageInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessageInput(val);

    const lastSlashIdx = val.lastIndexOf('/');
    if (lastSlashIdx >= 0 && (lastSlashIdx === 0 || val[lastSlashIdx - 1] === ' ')) {
      const query = val.slice(lastSlashIdx + 1).toLowerCase();
      if (!query.includes(' ')) {
        const filtered = cannedResponses.filter(cr => 
          cr.shortcut.toLowerCase().includes(query) || 
          cr.text.toLowerCase().includes(query)
        );
        setFilteredCanned(filtered);
        setCannedSearch(query);
        setIsCannedDropdownOpen(filtered.length > 0);
        setActiveCannedIndex(0);
        return;
      }
    }
    setIsCannedDropdownOpen(false);
  };

  const handleCannedKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isCannedDropdownOpen && filteredCanned.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveCannedIndex(prev => (prev + 1) % filteredCanned.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveCannedIndex(prev => (prev - 1 + filteredCanned.length) % filteredCanned.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectCannedResponse(filteredCanned[activeCannedIndex]);
      } else if (e.key === 'Escape') {
        setIsCannedDropdownOpen(false);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const selectCannedResponse = (cr: any) => {
    const lastSlashIdx = messageInput.lastIndexOf('/');
    const prefix = messageInput.slice(0, lastSlashIdx);
    setMessageInput(prefix + cr.text);
    setIsCannedDropdownOpen(false);
  };

  const [localUser, setLocalUser] = useState<any>(currentUser || null);
  const [localRole, setLocalRole] = useState<string>(userRole || '');

  useEffect(() => {
    if (currentUser) {
      setLocalUser(currentUser);
    }
    if (userRole) {
      setLocalRole(userRole);
    }
  }, [currentUser, userRole]);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        let extraData: any = {};
        try {
          const { data: tu } = await supabase
            .from('tenant_users')
            .select('id, supabase_user_id, role, tenant_id')
            .or(`supabase_user_id.eq.${user.id},id.eq.${user.id},email.eq.${user.email}`)
            .limit(1)
            .maybeSingle();
          if (tu) {
            extraData = tu;
          }
        } catch (_) {}

        setLocalUser({
          ...user,
          supabase_user_id: extraData.supabase_user_id || user.id,
          tenant_user_id: extraData.id,
          tenant_id: extraData.tenant_id
        });
        if (!localRole) {
          setLocalRole((extraData.role || user.user_metadata?.role || '').toLowerCase());
        }
      }
    };
    if (!localUser) {
      fetchUser();
    }
  }, []);

  const cleanRole = (localRole || userRole || '').toLowerCase().trim();
  const isOperador = ['operador', 'operator', 'atendente', 'balconista'].includes(cleanRole);
  const userId = localUser?.tenant_user_id || localUser?.id || currentUser?.tenant_user_id || currentUser?.id;

  // Anti-collision state
  const [otherUserViewing, setOtherUserViewing] = useState<string | null>(null);

  // Reaction picker active message
  const [activeReactionPickerMsgId, setActiveReactionPickerMsgId] = useState<string | null>(null);

  const handleReactToMessage = async (msg: any, emoji: string) => {
    if (!selectedConversation) return;
    setActiveReactionPickerMsgId(null);

    const prevReaction = msg.reaction;
    const isRemoving = prevReaction === emoji || emoji === '';
    const newEmoji = isRemoving ? '' : emoji;

    // Atualização otimista imediata na UI
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msg.id) {
          const currentReactions: any[] = Array.isArray(m.reactions) ? [...m.reactions] : [];
          const filtered = currentReactions.filter((r) => r.fromMe !== true && r.sender !== 'USER');
          if (newEmoji) {
            filtered.push({
              emoji: newEmoji,
              sender: 'USER',
              fromMe: true,
              created_at: new Date().toISOString()
            });
          }
          return {
            ...m,
            reaction: newEmoji || (filtered.length > 0 ? filtered[filtered.length - 1].emoji : null),
            reactions: filtered
          };
        }
        return m;
      })
    );

    try {
      await fetch('/api/v1/chat/react', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          messageId: msg.id,
          emoji: newEmoji
        })
      });
    } catch (e) {
      console.warn('Erro ao enviar reação:', e);
    }
  };

  useEffect(() => {
    // 1. Inscrição no Supabase Realtime para mensagens e reações do chat
    const channel = supabase
      .channel(`chat_messages_realtime_${tenantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const row: any = payload.new;
          if (row) {
            let parsedReactions = row.reactions;
            if (typeof parsedReactions === 'string') {
              try {
                parsedReactions = JSON.parse(parsedReactions);
              } catch (_) {
                parsedReactions = [];
              }
            }
            if (!Array.isArray(parsedReactions)) {
              parsedReactions = row.reaction ? [{ emoji: row.reaction, created_at: row.created_at }] : [];
            }
            const formattedMsg = {
              ...row,
              reaction: row.reaction || (parsedReactions.length > 0 ? parsedReactions[parsedReactions.length - 1].emoji : null),
              reactions: parsedReactions
            };

            if (
              selectedConversation &&
              row.conversation_id === selectedConversation.id
            ) {
              setMessages((prev) => {
                const existingIdx = prev.findIndex((m) => m.id === row.id || (row.remote_id && m.remote_id === row.remote_id));
                if (existingIdx >= 0) {
                  const next = [...prev];
                  next[existingIdx] = {
                    ...next[existingIdx],
                    ...formattedMsg
                  };
                  return next;
                }
                if (payload.eventType === 'INSERT') {
                  return [...prev, formattedMsg];
                }
                return prev;
              });
            }
            fetchConversations();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_conversations' },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    // 2. Short-polling fallback seguro para ambientes sem WebSocket ou sincronização garantida
    const intervalId = setInterval(() => {
      fetchConversations();
      if (selectedConversation?.id) {
        fetchMessages(selectedConversation.id);
      }
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(intervalId);
    };
  }, [tenantId, selectedConversation?.id]);

  useEffect(() => {
    fetchInboxes();
  }, [tenantId, userId, cleanRole]);

  useEffect(() => {
    fetchConversations();
  }, [tenantId, isOperador, userId, selectedInboxId]);

  // Contadores dinâmicos para as abas de status
  const tabCounters = useMemo(() => {
    let todas = 0;
    let minhas = 0;
    let naoAtribuidas = 0;
    let finalizadas = 0;

    conversations.forEach((c: any) => {
      // Se houver filtro de caixa selecionado, considera no cálculo
      if (selectedInboxId !== 'all' && c.inbox_id !== selectedInboxId) return;
      if (selectedTeamId !== 'all' && c.team_id !== selectedTeamId) return;

      const isClosed = c.status === 'CLOSED' || c.kanban_stage === 'CLOSED';
      if (isClosed) {
        finalizadas++;
      } else {
        todas++;
        const isMine =
          (userId && c.assigned_user_id === userId) ||
          (localUser?.id && c.assigned_user_id === localUser.id) ||
          (localUser?.email && c.assigned_user_id === localUser.email);
        if (isMine) minhas++;
        if (!c.assigned_user_id || c.assigned_user_id === '') naoAtribuidas++;
      }
    });

    return { todas, minhas, naoAtribuidas, finalizadas };
  }, [conversations, selectedInboxId, selectedTeamId, userId, localUser]);

  // Contadores dinâmicos de Atendimentos Hoje e Aguardando na Fila (Dashboard rápido)
  const { atendimentosHoje, aguardandoFila } = useMemo(() => {
    let hojeCount = 0;
    let filaCount = 0;

    const isDateToday = (dateStr?: string) => {
      if (!dateStr) return false;
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return false;
        const today = new Date();
        return (
          d.getDate() === today.getDate() &&
          d.getMonth() === today.getMonth() &&
          d.getFullYear() === today.getFullYear()
        );
      } catch {
        return false;
      }
    };

    conversations.forEach((c: any) => {
      if (selectedInboxId !== 'all' && c.inbox_id !== selectedInboxId) return;
      if (selectedTeamId !== 'all' && c.team_id !== selectedTeamId) return;

      const isClosed = c.status === 'CLOSED' || c.kanban_stage === 'CLOSED';

      // Atendimentos que tiveram atividade (mensagens, criação ou atualização) hoje
      const hasActivityToday =
        isDateToday(c.last_message_at) ||
        isDateToday(c.updated_at) ||
        isDateToday(c.created_at);

      if (hasActivityToday) {
        hojeCount++;
      }

      // Aguardando na Fila: conversas abertas/ativas sem atendente atribuído ou em estágio de espera/triagem
      if (!isClosed) {
        const isUnassigned = !c.assigned_user_id || c.assigned_user_id === '';
        const isWaiting =
          c.status === 'PENDING' ||
          c.status === 'WAITING' ||
          c.kanban_stage === 'NEW' ||
          c.kanban_stage === 'WAITING' ||
          c.kanban_stage === 'QUEUE';

        if (isUnassigned || isWaiting) {
          filaCount++;
        }
      }
    });

    return {
      atendimentosHoje: hojeCount,
      aguardandoFila: filaCount
    };
  }, [conversations, selectedInboxId, selectedTeamId]);

  // Lista de conversas estritamente filtrada pelo critério ativo na interface
  const displayedConversations = useMemo(() => {
    return conversations.filter((conv: any) => {
      // 1. Permissão de Operador por Caixa de Entrada
      if (isOperador) {
        if (allowedInboxIds.length === 1) {
          if (conv.inbox_id && conv.inbox_id !== allowedInboxIds[0]) return false;
        } else if (allowedInboxIds.length > 1 && conv.inbox_id) {
          if (!allowedInboxIds.includes(conv.inbox_id)) return false;
        }
      }

      // 2. Filtro de Caixa de Entrada selecionada
      if (selectedInboxId !== 'all' && conv.inbox_id !== selectedInboxId) {
        return false;
      }

      // 3. Filtro por Time
      if (selectedTeamId !== 'all' && conv.team_id !== selectedTeamId) {
        return false;
      }

      // 4. Filtro por Etiqueta / Tag
      if (selectedTagId !== 'all') {
        const hasTag = conv.labels && Array.isArray(conv.labels) && conv.labels.some((l: any) => l.id === selectedTagId || l.name === selectedTagId);
        if (!hasTag) return false;
      }

      // 5. Filtro por Busca Textual (Nome, Telefone ou Última Mensagem)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const contactName = (conv.contact?.name || '').toLowerCase();
        const contactPhone = (conv.contact?.phone_number || '').replace(/\D/g, '');
        const qDigits = q.replace(/\D/g, '');
        const lastMsg = (conv.last_message_content || '').toLowerCase();

        const matchName = contactName.includes(q);
        const matchPhone = qDigits && contactPhone.includes(qDigits);
        const matchMsg = lastMsg.includes(q);

        if (!matchName && !matchPhone && !matchMsg) return false;
      }

      // 6. Filtro por Aba de Status (Todas, Minhas, Não Atribuídas, Finalizadas)
      const isClosed = conv.status === 'CLOSED' || conv.kanban_stage === 'CLOSED';
      const isMine =
        (userId && conv.assigned_user_id === userId) ||
        (localUser?.id && conv.assigned_user_id === localUser.id) ||
        (localUser?.email && conv.assigned_user_id === localUser.email);
      const isUnassigned = !conv.assigned_user_id || conv.assigned_user_id === '';

      const normalizedFilter = filter.toLowerCase().trim();

      if (normalizedFilter === 'finalizadas') {
        return isClosed;
      }

      // Todas as abas ativas excluem conversas finalizadas
      if (isClosed) {
        return false;
      }

      if (normalizedFilter === 'minhas') {
        return isMine;
      }

      if (normalizedFilter === 'nao_atribuidas' || normalizedFilter === 'não atribuídas' || normalizedFilter === 'nao atribuidas') {
        return isUnassigned;
      }

      // 'todas' exibe todas as conversas ativas (não fechadas)
      return true;
    });
  }, [conversations, filter, searchQuery, selectedInboxId, selectedTeamId, selectedTagId, userId, localUser, isOperador, allowedInboxIds]);

  useEffect(() => {
    if (selectedConversation) {
      fetchMessages(selectedConversation.id);
      setActiveView('CHAT');
      
      // Simulate real-time presence check
      setOtherUserViewing(null);
      if (selectedConversation.id === '2') {
        setTimeout(() => {
          setOtherUserViewing('Ana Silva');
        }, 3000);
      }
    }
  }, [selectedConversation]);

  useEffect(() => {
    if (isOperador && inboxes.length > 0) {
      if (selectedInboxId === 'all' || !inboxes.some(i => i.id === selectedInboxId)) {
        setSelectedInboxId(inboxes[0].id);
      }
    }
  }, [inboxes, isOperador, selectedInboxId]);

  useEffect(() => {
    if (selectedConversation && isOperador && selectedConversation.inbox_id && allowedInboxIds.length > 0) {
      if (!allowedInboxIds.includes(selectedConversation.inbox_id)) {
        setSelectedConversation(null);
        alert("Acesso negado: Você não tem permissão para visualizar conversas desta caixa de entrada.");
      }
    }
  }, [selectedConversation, allowedInboxIds, isOperador]);

  const fetchInboxes = async () => {
    try {
      const currentTenantId = tenantId || localUser?.tenant_id || currentUser?.tenant_id || localStorage.getItem('ff_tenant_id') || localStorage.getItem('farmaflow_current_tenant_id') || '';

      const headers: Record<string, string> = {};
      if (currentTenantId) headers['x-tenant-id'] = currentTenantId;
      if (userId) headers['x-user-id'] = userId;
      if (cleanRole) headers['x-user-role'] = cleanRole;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.access_token) {
          headers['authorization'] = `Bearer ${sessionData.session.access_token}`;
        }
      } catch (_) {}

      const queryParams = userId ? `&userId=${encodeURIComponent(userId)}&role=${encodeURIComponent(cleanRole)}` : '';
      const res = await fetch(`/api/v1/inboxes?storeId=${encodeURIComponent(currentTenantId || tenantId || 'default')}${queryParams}`, {
        headers
      });

      if (res.ok) {
        const json = await res.json();
        const serverInboxes = Array.isArray(json.data) ? json.data : [];

        if (isOperador) {
          // O backend é a autoridade estrita para operadores (bypassa RLS via Service Role e filtra por department_access)
          setInboxes(serverInboxes);
          const serverAllowedIds = serverInboxes.map((i: any) => i.id);
          setAllowedInboxIds(serverAllowedIds);

          if (serverInboxes.length === 1) {
            setSelectedInboxId(serverInboxes[0].id);
          } else if (serverInboxes.length > 1) {
            if (selectedInboxId === 'all' || !serverInboxes.some((i: any) => i.id === selectedInboxId)) {
              setSelectedInboxId(serverInboxes[0].id);
            }
          } else {
            setSelectedInboxId('none');
          }
          return;
        }

        if (serverInboxes.length > 0) {
          setInboxes(serverInboxes);
          return;
        }
      }

      // Se for operador e a chamada de backend falhar ou retornar vazio, NUNCA expor caixas indevidas
      if (isOperador) {
        setInboxes([]);
        setAllowedInboxIds([]);
        setSelectedInboxId('none');
        return;
      }

      // Fallback APENAS para Admins / Proprietários em novas lojas
      const { data, error } = await supabase
        .from('inboxes')
        .select('*')
        .eq('store_id', currentTenantId || tenantId);

      if (!error && data && data.length > 0) {
        setInboxes(data);
      } else {
        const saved = localStorage.getItem(`inboxes_${currentTenantId || tenantId}`);
        if (saved) {
          try {
            setInboxes(JSON.parse(saved));
          } catch (_) {
            setInboxes([{ id: `inbox_default_${currentTenantId || tenantId}`, name: 'Geral / Atendimento', store_id: currentTenantId || tenantId }]);
          }
        } else {
          setInboxes([{ id: `inbox_default_${currentTenantId || tenantId}`, name: 'Geral / Atendimento', store_id: currentTenantId || tenantId }]);
        }
      }
    } catch (e) {
      console.warn("Error fetching inboxes", e);
      if (isOperador) {
        setInboxes([]);
        setAllowedInboxIds([]);
      }
    }
  };

  const fetchConversations = async () => {
    try {
      const currentTenantId = tenantId || localUser?.tenant_id || currentUser?.tenant_id || localStorage.getItem('ff_tenant_id') || localStorage.getItem('farmaflow_current_tenant_id') || '';

      const headers: Record<string, string> = {};
      if (currentTenantId) headers['x-tenant-id'] = currentTenantId;
      if (userId) headers['x-user-id'] = userId;
      if (cleanRole) headers['x-user-role'] = cleanRole;

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.access_token) {
          headers['authorization'] = `Bearer ${sessionData.session.access_token}`;
        }
      } catch (_) {}

      const targetInboxParam = (isOperador && inboxes.length === 1) ? inboxes[0].id : (selectedInboxId !== 'all' ? selectedInboxId : 'all');
      const queryParams = userId ? `&userId=${encodeURIComponent(userId)}&role=${encodeURIComponent(cleanRole)}` : '';

      const res = await fetch(`/api/v1/chat/conversations?tenantId=${encodeURIComponent(currentTenantId || tenantId || 'default')}&inboxId=${encodeURIComponent(targetInboxParam)}${queryParams}`, {
        headers
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data)) {
          const list = json.data.map((c: any) => {
            const isHuman = c.is_human_controlled === true || Boolean(c.assigned_user_id) || Boolean(c.assigned_to) || c.is_bot_active === false || c.status === 'human_takeover' || c.status === 'HUMAN';
            let stage = c.kanban_stage || c.stage;
            if (!stage) {
              if (c.status === 'CLOSED' || c.status === 'finalizado') stage = 'finalizado';
              else if (c.status === 'PENDING' || c.status === 'WAITING' || c.bot_handoff_reason === 'STORE_REDIRECT') stage = 'aguardando_pagamento';
              else if (c.status === 'saiu_entrega' || c.status === 'delivery') stage = 'saiu_entrega';
              else if (isHuman) stage = 'em_atendimento';
              else if (c.is_bot_active !== false) stage = 'ia_atendendo';
              else stage = 'novos_triagem';
            }
            return {
              ...c,
              contact: c.contact || { name: 'Cliente sem nome', phone_number: '' },
              is_human_controlled: isHuman,
              is_bot_active: !isHuman && c.is_bot_active !== false,
              kanban_stage: stage,
              stage: stage
            };
          });

          if (list.length > 0) {
            setConversations(list);
            try {
              localStorage.setItem(`chat_conversations_${currentTenantId || tenantId}`, JSON.stringify(list));
            } catch (_) {}
          } else {
            // Se veio vazio, só atualiza para vazio se as caixas já foram resolvidas, evitando limpar o cache na inicialização
            if (!isOperador || inboxes.length > 0) {
              setConversations([]);
            }
          }
          return;
        }
      }

      if (isOperador) {
        // Se a chamada de backend falhar temporariamente, preserva o estado e cache local
        const saved = localStorage.getItem(`chat_conversations_${currentTenantId || tenantId}`);
        if (saved) {
          try {
            setConversations(JSON.parse(saved));
          } catch (_) {}
        }
        return;
      }

      let query = supabase
        .from('chat_conversations')
        .select('*, contact:chat_contacts(name, phone_number)')
        .eq('store_id', currentTenantId || tenantId)
        .order('last_message_at', { ascending: false });

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        let list = data.map((c: any) => {
          const isHuman = c.is_human_controlled === true || Boolean(c.assigned_user_id) || Boolean(c.assigned_to) || c.is_bot_active === false || c.status === 'human_takeover' || c.status === 'HUMAN';
          let stage = c.kanban_stage || c.stage;
          if (!stage) {
            if (c.status === 'CLOSED' || c.status === 'finalizado') stage = 'finalizado';
            else if (c.status === 'PENDING' || c.status === 'WAITING' || c.bot_handoff_reason === 'STORE_REDIRECT') stage = 'aguardando_pagamento';
            else if (c.status === 'saiu_entrega' || c.status === 'delivery') stage = 'saiu_entrega';
            else if (isHuman) stage = 'em_atendimento';
            else if (c.is_bot_active !== false) stage = 'ia_atendendo';
            else stage = 'novos_triagem';
          }
          return {
            ...c,
            contact: c.contact || { name: 'Cliente sem nome', phone_number: '' },
            is_human_controlled: isHuman,
            is_bot_active: !isHuman && c.is_bot_active !== false,
            kanban_stage: stage,
            stage: stage
          };
        });
        setConversations(list);
      } else {
        const saved = localStorage.getItem(`chat_conversations_${currentTenantId || tenantId}`);
        if (saved) {
          try {
            let list = JSON.parse(saved).map((c: any) => {
              const isHuman = c.is_human_controlled === true || Boolean(c.assigned_user_id) || Boolean(c.assigned_to) || c.is_bot_active === false || c.status === 'human_takeover' || c.status === 'HUMAN';
              let stage = c.kanban_stage || c.stage;
              if (!stage) {
                if (c.status === 'CLOSED' || c.status === 'finalizado') stage = 'finalizado';
                else if (c.status === 'PENDING' || c.status === 'WAITING' || c.bot_handoff_reason === 'STORE_REDIRECT') stage = 'aguardando_pagamento';
                else if (c.status === 'saiu_entrega' || c.status === 'delivery') stage = 'saiu_entrega';
                else if (isHuman) stage = 'em_atendimento';
                else if (c.is_bot_active !== false) stage = 'ia_atendendo';
                else stage = 'novos_triagem';
              }
              return {
                ...c,
                contact: c.contact || { name: 'Cliente sem nome', phone_number: '' },
                is_human_controlled: isHuman,
                is_bot_active: !isHuman && c.is_bot_active !== false,
                kanban_stage: stage,
                stage: stage
              };
            });
            setConversations(list);
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn("Error fetching conversations", e);
      if (isOperador) {
        setConversations([]);
      }
    }
  };

  const fetchMessages = async (conversationId: string) => {
    try {
      const queryParams = userId ? `&userId=${userId}&role=${cleanRole}` : '';
      const res = await fetch(`/api/v1/chat/messages?conversationId=${conversationId}${queryParams}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setMessages(json.data);
          return;
        }
      }

      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (!error && data) {
        if (isOperador && allowedInboxIds.length > 0) {
          const conv = conversations.find(c => c.id === conversationId);
          if (conv && conv.inbox_id && !allowedInboxIds.includes(conv.inbox_id)) {
            setMessages([]);
            return;
          }
        }
        const formatted = data.map((row: any) => {
          let parsedReactions = row.reactions;
          if (typeof parsedReactions === 'string') {
            try {
              parsedReactions = JSON.parse(parsedReactions);
            } catch (_) {
              parsedReactions = [];
            }
          }
          if (!Array.isArray(parsedReactions)) {
            parsedReactions = row.reaction ? [{ emoji: row.reaction, created_at: row.created_at }] : [];
          }
          return {
            ...row,
            reaction: row.reaction || (parsedReactions.length > 0 ? parsedReactions[parsedReactions.length - 1].emoji : null),
            reactions: parsedReactions
          };
        });
        setMessages(formatted);
      }
    } catch (e) {
      console.warn("Error fetching messages", e);
    }
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedConversation) return;
    const textToSend = messageInput.trim();
    setMessageInput('');

    const tempMsg = {
      id: `temp_${Date.now()}`,
      conversation_id: selectedConversation.id,
      sender_type: 'USER',
      content: textToSend,
      is_private: isPrivateNote,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempMsg]);

    try {
      const res = await fetch('/api/v1/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          conversation_id: selectedConversation.id,
          content: textToSend,
          is_private: isPrivateNote,
          sender_type: 'USER',
          userId: userId,
          role: cleanRole
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setMessages(prev => {
            const alreadyExists = prev.some(m => m.id === json.data.id);
            if (alreadyExists) {
              return prev.filter(m => m.id !== tempMsg.id);
            }
            return prev.map(m => m.id === tempMsg.id ? json.data : m);
          });
          setSelectedConversation((prev: any) => prev ? { ...prev, last_message_content: textToSend, last_message_at: new Date().toISOString() } : prev);
          fetchConversations();
          return;
        }
      }

      // Supabase direct fallback
      const { data, error } = await supabase
        .from('chat_messages')
        .insert([{
          conversation_id: selectedConversation.id,
          sender_type: 'USER',
          content: textToSend,
          is_private: isPrivateNote
        }])
        .select()
        .single();

      if (!error && data) {
        setMessages(prev => prev.map(m => m.id === tempMsg.id ? data : m));
      }
    } catch (e) {
      console.warn("Error sending message:", e);
    }
  };

  const fetchCustomerContext = async () => {
    if (!selectedConversation || !selectedConversation.contact) {
      setCustomerOrders([]);
      setContinuousUseData(null);
      return;
    }

    setIsFetchingContext(true);
    try {
      let phone = selectedConversation.contact.phone_number;
      if (!phone) {
        setIsFetchingContext(false);
        return;
      }
      
      phone = String(phone).replace(/\D/g, ""); // clean non-digits

      // 1. Tenta a API dedicada de contexto enriquecido com itens e produtos
      try {
        const res = await fetch(`/api/v1/chat/patient-context?storeId=${encodeURIComponent(tenantId)}&phone=${encodeURIComponent(phone)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            setContinuousUseData(json.continuousUse || null);
            const fetchedOrders = json.orders || [];
            setCustomerOrders(fetchedOrders);
            if (fetchedOrders.length > 0) {
              setExpandedOrderIds([String(fetchedOrders[0].id || '0')]);
            }
            return;
          }
        }
      } catch (apiErr) {
        console.warn("API de contexto do paciente falhou, usando fallback direto:", apiErr);
      }

      // 2. Fallback: Consulta direta Supabase
      const { data: contactsData, error: contactsErr } = await supabase
        .from('contacts')
        .select('*')
        .eq('store_id', tenantId)
        .like('phone', `%${phone}%`)
        .maybeSingle();

      if (!contactsErr && contactsData && contactsData.custom_attributes) {
        const attrs = contactsData.custom_attributes;
        if (attrs.uso_continuo) {
          setContinuousUseData(attrs);
        } else {
          setContinuousUseData(null);
        }
      } else {
        setContinuousUseData(null);
      }

      // Fetch orders
      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!ordersErr && ordersData) {
        const matchedOrders = ordersData.filter((o: any) => {
          if (!o.customer || !o.customer.phone) return false;
          const oPhone = String(o.customer.phone).replace(/\D/g, "");
          return oPhone === phone || oPhone.includes(phone) || phone.includes(oPhone);
        }).slice(0, 5); // top 5
        setCustomerOrders(matchedOrders);
        if (matchedOrders.length > 0) {
          setExpandedOrderIds([String(matchedOrders[0].id || '0')]);
        }
      } else {
        setCustomerOrders([]);
      }
    } catch (err) {
      console.log("Failed to fetch customer context:", err);
    } finally {
      setIsFetchingContext(false);
    }
  };

  useEffect(() => {
    fetchCustomerContext();
  }, [selectedConversation?.contact?.phone_number]);

  const handleAssumeConversation = () => {
    if (!selectedConversation) return;
    const updated = { 
      ...selectedConversation, 
      assigned_user_id: userId || 'my-user-id', 
      is_human_controlled: true,
      is_bot_active: false,
      status: 'human_takeover',
      kanban_stage: 'em_atendimento'
    };
    setSelectedConversation(updated);
    setConversations(conversations.map(c => c.id === updated.id ? updated : c));
  };

  const handleSelectConversation = (conv: any) => {
    if (isOperador && conv.inbox_id && allowedInboxIds.length > 0) {
      if (!allowedInboxIds.includes(conv.inbox_id)) {
        alert("Acesso negado: Você não tem permissão para visualizar conversas desta caixa de entrada.");
        return;
      }
    }
    setSelectedConversation(conv);
  };

  const handleTransfer = async (transferData: { userId?: string, inboxId?: string }) => {
    if (!selectedConversation) return;
    
    const convId = selectedConversation.id;
    const currentTenantId = tenantId || localUser?.tenant_id || currentUser?.tenant_id || "default";

    // Optimistic UI update
    let updated = { ...selectedConversation };
    
    if (transferData.userId) {
       updated.assigned_user_id = transferData.userId;
       updated.assigned_to = transferData.userId;
       updated.is_human_controlled = true;
       updated.is_bot_active = false;
       updated.status = 'human_takeover';
       updated.kanban_stage = 'em_atendimento';
       updated.stage = 'em_atendimento';
    }
    
    if (transferData.inboxId) {
       updated.inbox_id = transferData.inboxId;
       if (!transferData.userId) {
         updated.assigned_user_id = null;
         updated.assigned_to = null;
         updated.is_human_controlled = false;
         updated.is_bot_active = false;
         updated.status = 'OPEN';
         updated.kanban_stage = 'novos_triagem';
         updated.stage = 'novos_triagem';
       }
    }

    // Se o operador transferiu para um departamento fora de suas caixas permitidas,
    // a conversa sai da sua visualização de forma suave
    const isTransferredAwayFromOperator = isOperador && transferData.inboxId && allowedInboxIds.length > 0 && !allowedInboxIds.includes(transferData.inboxId);

    if (isTransferredAwayFromOperator) {
      setSelectedConversation(null);
      setConversations(prev => prev.filter(c => c.id !== convId));
    } else {
      setSelectedConversation(updated);
      setConversations(prev => prev.map(c => c.id === convId ? updated : c));
    }

    try {
      let token = "";
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        token = sessionData?.session?.access_token || "";
      } catch (_) {}

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-tenant-id': currentTenantId,
        'x-user-id': userId || "",
        'x-user-role': cleanRole || ""
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/chat/conversations/${convId}/transfer`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          storeId: currentTenantId,
          tenantId: currentTenantId,
          conversationId: convId,
          inboxId: transferData.inboxId,
          userId: transferData.userId,
          fromUserId: userId
        })
      });

      if (res.ok) {
        if (!isTransferredAwayFromOperator) {
          fetchMessages(convId);
        }
        fetchConversations();
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.error("Erro na transferência de conversa:", errJson.error || res.statusText);
      }
    } catch (err) {
      console.error("Exceção ao disparar transferência de conversa:", err);
    }
  };

  const handleToggleBot = async () => {
    if (!selectedConversation) return;
    const currentStatus = selectedConversation.is_bot_active !== false && !selectedConversation.is_human_controlled && !selectedConversation.assigned_user_id;
    const nextStatus = !currentStatus;
    
    // Optimistic UI update
    const updated = { 
      ...selectedConversation, 
      is_bot_active: nextStatus,
      is_human_controlled: !nextStatus,
      assigned_user_id: nextStatus ? null : selectedConversation.assigned_user_id,
      assigned_to: nextStatus ? null : selectedConversation.assigned_to,
      bot_interaction_count: nextStatus ? 0 : selectedConversation.bot_interaction_count,
      bot_handoff_reason: nextStatus ? null : selectedConversation.bot_handoff_reason,
      bot_handoff_at: nextStatus ? null : selectedConversation.bot_handoff_at,
      status: nextStatus ? 'bot' : 'human_takeover',
      kanban_stage: nextStatus ? 'novos_triagem' : 'em_atendimento'
    };
    setSelectedConversation(updated);
    setConversations(conversations.map(c => c.id === updated.id ? updated : c));

    try {
      await fetch(`/api/v1/chat/conversations/${selectedConversation.id}/toggle-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: tenantId, isBotActive: nextStatus })
      });
    } catch (e) {
      console.error("Erro ao alterar estado do bot:", e);
    }
  };

  const handleCloseConversation = () => {
    if (!selectedConversation) return;
    const updated = { ...selectedConversation, status: 'CLOSED', kanban_stage: 'finalizado' };
    setSelectedConversation(null);
    setConversations(conversations.map(c => c.id === updated.id ? updated : c));
    setActiveView('LIST');
  };

  return (
    <div className="flex flex-col h-screen bg-white md:rounded-2xl md:shadow-xl overflow-hidden border-0 md:border md:border-gray-100 md:m-4 relative">
      {/* GLOBAL TOP BAR: Mode switcher (Kanban vs Split Chat) */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between z-30 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-emerald-600" />
            <h1 className="font-black text-gray-900 text-sm md:text-base tracking-tight">Central de Atendimento FarmaFlow</h1>
          </div>
        </div>

        <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 shadow-2xs">
          <button
            type="button"
            onClick={() => setChatDisplayMode('KANBAN')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              chatDisplayMode === 'KANBAN'
                ? 'bg-white text-purple-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Kanban size={14} />
            <span className="hidden sm:inline">Painel Kanban</span>
            <span className="sm:hidden">Kanban</span>
          </button>

          <button
            type="button"
            onClick={() => setChatDisplayMode('SPLIT')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              chatDisplayMode === 'SPLIT'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <LayoutList size={14} />
            <span className="hidden sm:inline">Chat em Lista</span>
            <span className="sm:hidden">Lista</span>
          </button>
        </div>
      </div>

      {chatDisplayMode === 'KANBAN' ? (
        <div className="flex-1 overflow-hidden">
          <ChatKanban
            tenantId={tenantId}
            currentUser={localUser}
            userRole={cleanRole}
            conversations={conversations}
            onConversationsChange={(updated) => setConversations(updated)}
            onOpenConversation={handleOpenFromKanban}
            inboxes={inboxes}
            teams={teams}
            availableLabels={availableLabels}
            onRefresh={fetchConversations}
          />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden relative">
          {/* COLUMN 1: Lista de Conversas */}
          <div className={`${activeView === 'LIST' ? 'flex' : 'hidden'} md:flex w-full md:w-1/3 lg:w-1/4 border-r border-gray-200 bg-gray-50 flex-col absolute inset-0 md:relative z-20`}>
            <div className="p-4 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-emerald-600" /> Conversas
                </h2>
                {!isOperador && (
                  <button
                    onClick={() => setIsConnectModalOpen(true)}
                    title="Conectar WhatsApp Evolution"
                    className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-xl transition-all shadow-2xs"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="hidden sm:inline">WhatsApp</span>
                  </button>
                )}
              </div>

          {/* Manager Dashboard Widget */}
          <div className="mb-4 bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-bold text-gray-500 flex items-center gap-1"><BarChart2 className="w-3 h-3"/> Hoje</p>
              <p className="text-sm font-black text-gray-800">{atendimentosHoje} {atendimentosHoje === 1 ? 'Atendimento' : 'Atendimentos'}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-orange-500">Na Fila</p>
              <p className="text-sm font-black text-gray-800">{aguardandoFila} Aguardando</p>
            </div>
          </div>
          
          {(!isOperador || inboxes.length > 1) ? (
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Inbox className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <select 
                  value={selectedInboxId}
                  onChange={(e) => setSelectedInboxId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-xl pl-9 pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 font-bold appearance-none truncate"
                >
                  {!isOperador ? (
                    <option value="all">Todas as Caixas (Inboxes)</option>
                  ) : null}
                  {inboxes.map(inbox => (
                    <option key={inbox.id} value={inbox.id}>{inbox.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : inboxes.length === 1 ? (
            <div className="flex gap-2 mb-3">
              <div className="w-full bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs rounded-xl px-3 py-2 font-bold flex items-center gap-2">
                <Inbox className="w-4 h-4 text-emerald-600" />
                <span>Setor: {inboxes[0].name}</span>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Users className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
              <select 
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-xl pl-9 pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 font-bold appearance-none truncate"
              >
                <option value="all">Todos os Times</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            
            <div className="relative flex-1">
              <span className="w-4 h-4 absolute left-3 top-2.5 text-gray-400">🏷️</span>
              <select 
                value={selectedTagId}
                onChange={(e) => setSelectedTagId(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-xl pl-9 pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 font-bold appearance-none truncate"
              >
                <option value="all">Todas as Tags</option>
                {availableLabels.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input 
              type="text" 
              placeholder="Buscar cliente ou telefone..." 
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-colors"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex gap-2 mt-4 overflow-x-auto pb-2 scrollbar-hide">
            {FILTER_TABS.map(tab => {
              const isActive = filter.toLowerCase().trim() === tab.id;
              const count = tab.id === 'todas' ? tabCounters.todas
                          : tab.id === 'minhas' ? tabCounters.minhas
                          : tab.id === 'nao_atribuidas' ? tabCounters.naoAtribuidas
                          : tabCounters.finalizadas;
              return (
                <button 
                  key={tab.id}
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shadow-2xs ${
                    isActive 
                      ? 'bg-emerald-600 text-white shadow-xs' 
                      : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                    isActive ? 'bg-emerald-700 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {displayedConversations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6 text-center space-y-3">
              <MessageSquare size={48} className="text-gray-300" />
              <p className="font-bold text-sm text-gray-700">Nenhuma conversa encontrada</p>
              <p className="text-xs text-gray-500 max-w-xs">
                {searchQuery 
                  ? `Nenhum resultado para "${searchQuery}". Tente outro termo ou limpe a busca.` 
                  : filter === 'minhas' 
                  ? 'Você não possui conversas atribuídas no momento.' 
                  : filter === 'nao_atribuidas' 
                  ? 'Não há conversas pendentes na fila de espera.' 
                  : filter === 'finalizadas' 
                  ? 'Nenhum atendimento finalizado registrado neste filtro.' 
                  : 'Nenhuma conversa ativa no momento.'}
              </p>
              {(searchQuery || selectedTagId !== 'all' || selectedTeamId !== 'all') && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedTagId('all');
                    setSelectedTeamId('all');
                  }}
                  className="mt-2 text-xs font-bold text-emerald-600 hover:underline"
                >
                  Limpar todos os filtros
                </button>
              )}
            </div>
          )}
          {displayedConversations.map(conv => {
            const inboxName = inboxes.find(i => i.id === conv.inbox_id)?.name || 'Geral';
            const contactDisplayName = conv.contact?.name || conv.contact?.phone_number || 'Cliente';
            
            return (
              <div 
                key={conv.id}
                onClick={() => handleSelectConversation(conv)}
                className={`p-3 rounded-xl cursor-pointer transition-all border ${
                  selectedConversation?.id === conv.id 
                    ? 'bg-emerald-50 border-emerald-300 shadow-2xs' 
                    : 'bg-white hover:bg-gray-100 border-gray-100 shadow-2xs'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-bold text-gray-900 text-sm truncate max-w-[70%]">{contactDisplayName}</span>
                  <span className="text-[10px] font-medium text-gray-400">
                    {conv.last_message_at 
                      ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) 
                      : ''}
                  </span>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500 truncate w-3/4">{conv.last_message_content || 'Nova conversa iniciada'}</span>
                  {conv.unread_count > 0 && (
                    <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Inbox className="w-2 h-2"/> {inboxName}
                  </span>
                  {conv.status === 'CLOSED' || conv.kanban_stage === 'CLOSED' ? (
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                      Finalizado
                    </span>
                  ) : !conv.assigned_user_id ? (
                    <span className="text-[9px] font-black uppercase tracking-wider text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">
                      Fila
                    </span>
                  ) : (
                    <span className="text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                      Atribuído
                    </span>
                  )}
                  {conv.labels && conv.labels.map((lbl: any) => (
                    <span
                      key={lbl.id}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white shadow-2xs"
                      style={{ backgroundColor: lbl.color || '#10b981' }}
                    >
                      {lbl.name}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* COLUMN 2: Janela de Chat Principal */}
      <div className={`${activeView === 'CHAT' ? 'flex' : 'hidden'} md:flex w-full md:w-1/2 lg:w-2/4 flex-col bg-[#f0f2f5] absolute inset-0 md:relative z-10`}>
        {selectedConversation ? (
          <>
            {/* Header */}
            <div className="min-h-16 py-2 px-3 md:px-4 bg-white border-b border-gray-200 flex items-center justify-between gap-2 shadow-sm z-20 relative">
              <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                <button 
                  onClick={() => setActiveView('LIST')}
                  className="md:hidden p-1.5 -ml-1 text-gray-500 hover:bg-gray-100 rounded-full shrink-0"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-200 rounded-full flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 md:w-5 md:h-5 text-gray-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-800 text-sm md:text-base leading-tight truncate">{selectedConversation.contact.name}</h3>
                    
                    {/* Label Manager Popover Trigger */}
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setIsLabelPopoverOpen(!isLabelPopoverOpen)}
                        className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center"
                        title="Gerenciar Etiquetas"
                      >
                        <span className="text-[10px] font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded transition-all flex items-center gap-1 border border-gray-200">
                          Etiquetas +
                        </span>
                      </button>

                      {isLabelPopoverOpen && (
                        <>
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => setIsLabelPopoverOpen(false)}
                          />
                          <div className="absolute left-0 mt-2 w-56 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-2 text-xs">
                            <p className="font-semibold text-gray-700 mb-2 px-1">Gerenciar Etiquetas</p>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {availableLabels.length === 0 ? (
                                <p className="text-gray-400 text-[10px] p-2 text-center">Nenhuma etiqueta cadastrada</p>
                              ) : (
                                availableLabels.map((lbl) => {
                                  const isChecked = (selectedConversation.labels || []).some((l: any) => l.id === lbl.id);
                                  return (
                                    <button
                                      key={lbl.id}
                                      onClick={() => toggleLabelOnConversation(lbl.id)}
                                      className="w-full flex items-center justify-between p-1.5 hover:bg-gray-50 rounded-lg transition-colors text-left"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: lbl.color }} />
                                        <span className="text-gray-700 font-medium">{lbl.name}</span>
                                      </div>
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {}} // handled by click
                                        className="rounded text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5"
                                      />
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <p className="text-[10px] md:text-[11px] text-gray-500 font-mono truncate">{selectedConversation.contact?.phone_number}</p>
                    <span className="text-[9px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded shrink-0">
                      {inboxes.find(i => i.id === selectedConversation.inbox_id)?.name || 'Sem Caixa'}
                    </span>
                    
                    {/* Bot IA Status Indicator & Toggle */}
                    <button
                      onClick={handleToggleBot}
                      className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1 transition-all border shrink-0 ${
                        selectedConversation.is_bot_active !== false
                          ? 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                      }`}
                      title={selectedConversation.is_bot_active !== false ? 'Clique para pausar o robô de IA nesta conversa' : 'Clique para reativar o robô de IA'}
                    >
                      <span>{selectedConversation.is_bot_active !== false ? '🤖 Bot Ativo' : '👤 Humano'}</span>
                      {selectedConversation.is_bot_active !== false && (
                        <span className="opacity-75 font-mono">({selectedConversation.bot_interaction_count || 0}/4)</span>
                      )}
                    </button>

                    {/* Visual labels in active chat header */}
                    {selectedConversation.labels && selectedConversation.labels.map((lbl: any) => (
                      <span
                        key={lbl.id}
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white shadow-xs shrink-0"
                        style={{ backgroundColor: lbl.color }}
                      >
                        {lbl.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Desktop Actions */}
              <div className="hidden md:flex items-center gap-2 shrink-0">
                <button 
                  onClick={() => setActiveView('SIDEBAR')}
                  className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
                  title="Contexto Farmacêutico"
                >
                  <Info className="w-5 h-5" />
                </button>
                
                {selectedConversation.assigned_user_id ? (
                  <>
                    <button 
                      onClick={() => setIsTransferModalOpen(true)}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
                    >
                      Transferir
                    </button>
                    <button 
                      onClick={handleCloseConversation}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg transition-colors"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Finalizar
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={handleAssumeConversation}
                    className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                  >
                    <UserPlus className="w-3 h-3" /> Assumir
                  </button>
                )}
              </div>

              {/* Mobile Actions */}
              <div className="flex md:hidden items-center gap-1.5 shrink-0 relative">
                <button 
                  onClick={() => setActiveView('SIDEBAR')}
                  className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors"
                  title="Contexto Farmacêutico"
                >
                  <Info className="w-5 h-5" />
                </button>

                {!selectedConversation.assigned_user_id ? (
                  <button 
                    onClick={handleAssumeConversation}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> <span>Assumir</span>
                  </button>
                ) : (
                  <div className="relative">
                    <button 
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      className="p-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                      title="Mais Ações"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>
                    
                    {isMenuOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setIsMenuOpen(false)}
                        />
                        <div className="absolute right-0 top-full mt-2 w-52 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-gray-100 py-1.5 z-[100] origin-top-right animate-in fade-in zoom-in-95">
                          <button 
                            onClick={() => {
                              setIsTransferModalOpen(true);
                              setIsMenuOpen(false);
                            }}
                            className="w-full text-left px-4 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <UserPlus className="w-4 h-4 text-gray-500" />
                            Transferir Atendimento
                          </button>
                          <button 
                            onClick={() => {
                              handleCloseConversation();
                              setIsMenuOpen(false);
                            }}
                            className="w-full text-left px-4 py-2.5 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <CheckCircle2 className="w-4 h-4 text-red-500" />
                            Finalizar Conversa
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Anti-collision Banner */}
            {otherUserViewing && (
              <div className="bg-orange-50 border-b border-orange-100 px-4 py-2 flex items-center gap-2 text-orange-700 text-xs font-bold shadow-sm z-10 animate-in slide-in-from-top-2">
                <AlertCircle className="w-4 h-4 animate-pulse" />
                ⚠️ {otherUserViewing} está visualizando/digitando nesta conversa
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, index) => {
                const rawUrl = msg.mediaUrl || msg.media_url || msg.url || msg.file_url;
                const isInternalWhatsApp = typeof rawUrl === 'string' && (rawUrl.includes('whatsapp.net') || rawUrl.includes('whatsapp.com'));
                // Mídia utilizável diretamente: Data URI ou URL pública que não seja do mmg.whatsapp.net
                const mediaUrl = isInternalWhatsApp ? undefined : rawUrl;
                const msgType = (msg.type || msg.mediaType || msg.media_type || '').toLowerCase();
                
                const isImage = msgType === 'image' || 
                  (rawUrl && (rawUrl.startsWith('data:image') || /\.(jpg|jpeg|png|webp|gif|bmp|svg)($|\?)/i.test(rawUrl))) ||
                  (!msgType && msg.content === '[Imagem]');
                  
                const isAudio = msgType === 'audio' || 
                  (rawUrl && (rawUrl.startsWith('data:audio') || /\.(ogg|oga|opus|mp3|wav|m4a|aac)($|\?)/i.test(rawUrl))) ||
                  (!msgType && msg.content === '[Áudio]');

                const isVideo = msgType === 'video' || (rawUrl && (rawUrl.startsWith('data:video') || /\.(mp4|webm|mov)($|\?)/i.test(rawUrl)));
                const isDocument = msgType === 'document' || (rawUrl && /\.(pdf|doc|docx|xls|xlsx|txt)($|\?)/i.test(rawUrl));

                return (
                  <div key={`${msg.id || 'msg'}_${index}`} className={`flex ${msg.sender_type === 'CUSTOMER' ? 'justify-start' : 'justify-end'} group relative`}>
                    <div className={`max-w-[85%] md:max-w-[70%] p-3 rounded-2xl shadow-sm relative ${
                      msg.is_private 
                        ? 'bg-[#fff9c4] border border-[#fbc02d] text-gray-800 rounded-tr-none' 
                        : msg.sender_type === 'CUSTOMER' 
                          ? 'bg-white text-gray-800 rounded-tl-none' 
                          : 'bg-[#dcf8c6] text-gray-800 rounded-tr-none'
                    }`}>
                      {msg.is_private && (
                        <div className="flex items-center gap-1 text-[10px] font-black text-[#f57f17] uppercase mb-1">
                          <Lock className="w-3 h-3" /> Nota Interna
                        </div>
                      )}

                      {/* Renderização Condicional de Mídia / Texto */}
                      {isImage ? (
                        mediaUrl ? (
                          <div className="my-1">
                            <img 
                              src={mediaUrl} 
                              alt="Imagem da Conversa" 
                              className="max-w-xs max-h-72 rounded-lg cursor-pointer object-cover hover:opacity-95 transition-opacity border border-black/10 shadow-sm"
                              onClick={() => setSelectedImagePreview(mediaUrl)}
                              onError={(e) => {
                                // Se falhar ao renderizar a imagem, oculta a tag quebrada e mostra o indicador amigável
                                e.currentTarget.style.display = 'none';
                                const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                            <div style={{ display: 'none' }} className="items-center gap-1.5 text-sm italic text-gray-600 my-1 bg-black/5 p-2 rounded-lg">
                              <ImageIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>{msg.content || '[Imagem]'}</span>
                            </div>
                            {msg.content && msg.content !== '[Imagem]' && (
                              <p className="text-sm mt-1.5 whitespace-pre-wrap">{msg.content}</p>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-sm italic text-gray-600 my-1 bg-black/5 p-2 rounded-lg">
                            <ImageIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>{msg.content || '[Imagem Recebida]'}</span>
                          </div>
                        )
                      ) : isAudio ? (
                        mediaUrl ? (
                          <div className="my-1">
                            <audio 
                              controls 
                              src={mediaUrl} 
                              className="my-1 max-w-full rounded-lg"
                              preload="metadata"
                            />
                            {msg.content && msg.content !== '[Áudio]' && (
                              <p className="text-xs text-gray-500 mt-1 italic">{msg.content}</p>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-sm italic text-gray-600 my-1 bg-black/5 p-2 rounded-lg">
                            <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>{msg.content || '[Áudio Recebido]'}</span>
                          </div>
                        )
                      ) : isVideo ? (
                        mediaUrl ? (
                          <div className="my-1">
                            <video controls src={mediaUrl} className="max-w-xs max-h-72 rounded-lg my-1 shadow-sm" />
                            {msg.content && msg.content !== '[Vídeo]' && (
                              <p className="text-sm mt-1.5 whitespace-pre-wrap">{msg.content}</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        )
                      ) : isDocument ? (
                        mediaUrl ? (
                          <div className="my-1">
                            <a href={mediaUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-2.5 bg-emerald-50 text-emerald-800 rounded-lg hover:bg-emerald-100 transition-colors text-xs font-bold border border-emerald-200">
                              <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span className="truncate">{msg.content && msg.content !== '[Documento]' ? msg.content : 'Visualizar / Baixar Documento'}</span>
                              <Download className="w-3.5 h-3.5 ml-auto shrink-0" />
                            </a>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        )
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      )}

                      <span className="text-[10px] text-gray-500 block text-right mt-1">
                        {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : ''}
                      </span>

                      {/* WhatsApp-Native Reaction Floating Badge */}
                      {((Array.isArray(msg.reactions) && msg.reactions.length > 0) || msg.reaction) && (
                        <div 
                          className={`absolute -bottom-2.5 ${
                            msg.sender_type === 'CUSTOMER' ? 'left-3' : 'right-3'
                          } flex items-center gap-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm rounded-full px-1.5 py-0.5 z-10 cursor-pointer select-none hover:scale-110 transition-transform`}
                          title={
                            Array.isArray(msg.reactions) && msg.reactions.length > 0
                              ? msg.reactions.map((r: any) => `${r.emoji} (${r.fromMe ? 'Atendente' : 'Cliente'})`).join(', ')
                              : `Reação: ${msg.reaction}`
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveReactionPickerMsgId(activeReactionPickerMsgId === msg.id ? null : msg.id);
                          }}
                        >
                          {Array.isArray(msg.reactions) && msg.reactions.length > 0 ? (
                            <>
                              {Array.from(new Set(msg.reactions.map((r: any) => r.emoji))).slice(0, 3).map((em: any, emIdx) => (
                                <span key={emIdx} className="text-xs leading-none">{em}</span>
                              ))}
                              {msg.reactions.length > 1 && (
                                <span className="text-[10px] font-semibold text-gray-500 ml-0.5">{msg.reactions.length}</span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs leading-none">{msg.reaction}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Quick Reaction Action Button (Hover) */}
                    {!msg.is_private && (
                      <div className={`absolute top-1/2 -translate-y-1/2 ${
                        msg.sender_type === 'CUSTOMER' ? '-right-8' : '-left-8'
                      } opacity-0 group-hover:opacity-100 transition-opacity flex items-center z-20`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveReactionPickerMsgId(activeReactionPickerMsgId === msg.id ? null : msg.id);
                          }}
                          className="p-1 rounded-full bg-white dark:bg-gray-800 text-gray-400 hover:text-amber-500 shadow-sm border border-gray-200 dark:border-gray-700 transition-all hover:scale-110"
                          title="Reagir com emoji"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Popup Emoji Reaction Bar */}
                    {activeReactionPickerMsgId === msg.id && (
                      <div 
                        className={`absolute z-30 -top-8 ${
                          msg.sender_type === 'CUSTOMER' ? 'left-0' : 'right-0'
                        } bg-white dark:bg-gray-800 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 px-2 py-1 flex items-center gap-1.5 animate-in zoom-in-95 duration-150`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleReactToMessage(msg, emoji)}
                            className={`text-base p-1 hover:scale-125 transition-transform rounded-full ${
                              msg.reaction === emoji ? 'bg-amber-100 dark:bg-amber-900/40 ring-1 ring-amber-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                        {msg.reaction && (
                          <button
                            type="button"
                            onClick={() => handleReactToMessage(msg, '')}
                            className="text-[10px] text-gray-400 hover:text-red-500 px-1 py-0.5 font-bold hover:bg-red-50 rounded"
                            title="Remover reação"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            {selectedConversation.assigned_user_id ? (
              <div className="p-3 md:p-4 bg-gray-50 border-t border-gray-200 pb-safe">
                                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsPrivateNote(false)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${!isPrivateNote ? 'bg-emerald-100 text-emerald-700' : 'text-gray-500 hover:bg-gray-200'}`}
                    >
                      <MessageSquare className="w-3 h-3 inline mr-1" /> Cliente
                    </button>
                    <button 
                      onClick={() => setIsPrivateNote(true)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isPrivateNote ? 'bg-yellow-100 text-yellow-700' : 'text-gray-500 hover:bg-gray-200'}`}
                    >
                      <Lock className="w-3 h-3 inline mr-1" /> Interna
                    </button>
                  </div>
                  
                  {/* Assistente de IA para Atendentes (Copilot) */}
                  <AiChatCopilot
                    tenantId={tenantId}
                    currentMessage={messageInput}
                    onApplyText={(newText) => setMessageInput(newText)}
                    disabled={!!otherUserViewing}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 bg-white rounded-xl border border-gray-300 shadow-sm flex items-end p-1 relative">
                    {/* Canned Responses Autocomplete Overlay */}
                    {isCannedDropdownOpen && filteredCanned.length > 0 && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-gray-100">
                        <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider flex justify-between">
                          <span>Respostas Rápidas</span>
                          <span>Navegue com ↑↓ e pressione Enter</span>
                        </div>
                        {filteredCanned.map((cr, idx) => (
                          <div
                            key={cr.id}
                            onClick={() => selectCannedResponse(cr)}
                            className={`px-3 py-2 text-sm cursor-pointer transition-colors flex flex-col ${
                              idx === activeCannedIndex ? 'bg-emerald-50 text-emerald-900 font-medium' : 'hover:bg-gray-50 text-gray-700'
                            }`}
                          >
                            <span className="text-xs font-bold font-mono text-emerald-600">/{cr.shortcut}</span>
                            <span className="text-xs text-gray-500 truncate">{cr.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button className="p-2 text-gray-400 hover:text-emerald-600 transition-colors">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <textarea 
                      value={messageInput}
                      onChange={handleMessageInputChange}
                      placeholder={
                        otherUserViewing 
                        ? `Aguarde, ${otherUserViewing} está digitando...` 
                        : isPrivateNote ? "Nota interna..." : "Digite '/' para respostas rápidas..."
                      }
                      disabled={!!otherUserViewing}
                      className={`flex-1 max-h-32 p-2 outline-none resize-none text-sm ${isPrivateNote ? 'bg-[#fffde7]' : 'bg-transparent'} ${otherUserViewing ? 'cursor-not-allowed opacity-50' : ''}`}
                      rows={1}
                      onKeyDown={handleCannedKeyDown}
                    />
                  </div>
                  <button 
                    onClick={handleSendMessage}
                    disabled={!messageInput.trim() || !!otherUserViewing}
                    className={`p-3 rounded-xl flex items-center justify-center transition-all shadow-md ${
                      messageInput.trim() && !otherUserViewing
                        ? isPrivateNote ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-gray-50 border-t border-gray-200 text-center flex flex-col items-center justify-center pb-safe">
                <p className="text-sm font-bold text-gray-600 mb-3">Esta conversa está na fila de atendimento.</p>
                <button 
                  onClick={handleAssumeConversation}
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" /> Assumir Atendimento
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center hidden md:flex">
            <MessageSquare className="w-16 h-16 mb-4 opacity-20" />
            <p>Selecione uma conversa para iniciar o atendimento</p>
          </div>
        )}
      </div>

      {/* COLUMN 3: Sidebar Contexto Farmacêutico */}
      <div className={`${activeView === 'SIDEBAR' ? 'flex' : 'hidden'} md:flex w-full md:w-1/6 lg:w-1/4 bg-white border-l border-gray-200 flex-col absolute inset-0 md:relative z-30`}>
        
        {/* Mobile Header for Sidebar */}
        <div className="md:hidden h-16 px-4 border-b border-gray-200 flex items-center bg-gray-50">
          <button 
            onClick={() => setActiveView('CHAT')}
            className="p-2 -ml-2 text-gray-500 hover:bg-gray-200 rounded-full mr-2"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h2 className="font-bold text-gray-800">Contexto do Paciente</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {selectedConversation ? (
            <div className="space-y-6">
              <div className="text-center">
                <div className="w-20 h-20 bg-emerald-100 rounded-full mx-auto flex items-center justify-center mb-3">
                  <User className="w-10 h-10 text-emerald-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-800">{selectedConversation.contact.name}</h2>
                <p className="text-sm text-gray-500">{selectedConversation.contact?.phone_number}</p>
                {customerOrders.length > 0 && (
                  <div className="mt-2 inline-block px-2 py-1 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-lg border border-emerald-100">
                    Já comprou na loja
                  </div>
                )}
              </div>

              {continuousUseData && (
                <div className="space-y-3">
                  <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" /> Uso Contínuo (Ficha Cadastral)
                  </h3>
                  <div className="bg-amber-50/70 p-3 rounded-xl border border-amber-200/80 shadow-xs">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-gray-800 text-sm">{continuousUseData.medicamento_nome || 'Medicamento de Uso Contínuo'}</p>
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-extrabold rounded-md flex items-center gap-1">
                        <Pill className="w-3 h-3" /> Cadastrado
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      Última compra: {continuousUseData.ultimo_pedido_at ? new Date(continuousUseData.ultimo_pedido_at).toLocaleDateString('pt-BR') : 'N/A'}
                    </p>
                    <p className="text-xs font-bold text-amber-700 mt-1">
                      Ciclo de recompra: {continuousUseData.dias_intervalo || 30} dias
                    </p>
                    <button 
                      onClick={() => {
                        const med = continuousUseData.medicamento_nome || 'seu medicamento de uso contínuo';
                        setMessageInput(`Olá, ${selectedConversation?.contact?.name || 'Cliente'}! Notamos que o ciclo do seu tratamento com *${med}* está na época de renovação. Deseja que separemos o seu pedido para entrega hoje?`);
                        setActiveView('CHAT');
                      }}
                      className="mt-2 w-full py-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-bold rounded-lg hover:bg-amber-100 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" /> Oferecer Reposição
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-emerald-600" /> Últimos Pedidos ({customerOrders.length})
                  </h3>
                  {customerOrders.length > 0 && (
                    <span className="text-[10px] text-gray-400 font-medium">Toque para ver itens</span>
                  )}
                </div>

                {isFetchingContext ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 bg-gray-50 rounded-xl border border-gray-100">
                    <RefreshCw className="w-5 h-5 text-emerald-500 animate-spin" />
                    <p className="text-xs text-gray-400">Carregando pedidos e receitas...</p>
                  </div>
                ) : customerOrders.length > 0 ? (
                  <div className="space-y-2.5">
                    {customerOrders.map((order: any, idx: number) => {
                      const orderId = String(order.id || idx);
                      const isExpanded = expandedOrderIds.includes(orderId);
                      const orderDate = order.created_at || order.date;
                      const formattedDate = orderDate ? new Date(orderDate).toLocaleDateString('pt-BR') : 'Data recente';
                      const items: any[] = Array.isArray(order.items) ? order.items : [];
                      
                      // Conta se há itens de uso contínuo no pedido
                      const continuousItemsCount = items.filter(it => isProductContinuousUse(it)).length;

                      return (
                        <div 
                          key={orderId} 
                          className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs transition-all hover:border-gray-300"
                        >
                          {/* Order Header / Accordion Trigger */}
                          <div 
                            onClick={() => toggleOrderAccordion(orderId)}
                            className="p-3 bg-gray-50/70 hover:bg-gray-100/70 cursor-pointer flex items-center justify-between transition-colors select-none"
                          >
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-black text-gray-800">
                                  #{order.id ? String(order.id).substring(0, 6).toUpperCase() : `PED-${idx + 1}`}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.2 bg-gray-200 text-gray-700 font-bold rounded">
                                  {formattedDate}
                                </span>
                                {continuousItemsCount > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 font-bold rounded flex items-center gap-1">
                                    <Pill className="w-2.5 h-2.5" /> {continuousItemsCount} Uso Contínuo
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                                {items.length > 0 ? `${items.length} ${items.length === 1 ? 'item' : 'itens'}` : 'Detalhes do pedido'} - <span className="capitalize">{order.status || 'Finalizado'}</span>
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-sm font-extrabold text-emerald-600 whitespace-nowrap">
                                R$ {Number(order.total || 0).toFixed(2).replace('.', ',')}
                              </span>
                              <div className="p-1 rounded-full text-gray-400 hover:text-gray-600">
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </div>
                            </div>
                          </div>

                          {/* Accordion Content: Items list with Continuous Use & Forecast */}
                          {isExpanded && (
                            <div className="p-3 bg-white border-t border-gray-100 space-y-3">
                              {items.length > 0 ? (
                                <div className="space-y-2.5">
                                  {items.map((item: any, iIdx: number) => {
                                    const forecast = calculateItemDepletionForecast(orderDate, item);
                                    const itemQty = Math.max(1, Number(item.quantity) || 1);
                                    const itemPrice = Number(item.price || item.unit_price || 0);

                                    return (
                                      <div 
                                        key={item.id || iIdx}
                                        className={`p-2.5 rounded-lg border text-xs ${
                                          forecast.isContinuousUse 
                                            ? 'bg-emerald-50/40 border-emerald-200/70' 
                                            : 'bg-gray-50/50 border-gray-100'
                                        }`}
                                      >
                                        {/* Item Title & Price */}
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="flex-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="font-extrabold text-gray-800">
                                                {itemQty}x {item.name || item.product_name || 'Produto'}
                                              </span>
                                              {forecast.isContinuousUse && (
                                                <span className="px-1.5 py-0.2 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-wider rounded flex items-center gap-0.5 shadow-2xs">
                                                  <Pill className="w-2.5 h-2.5" /> Uso Contínuo
                                                </span>
                                              )}
                                            </div>
                                            {item.presentation && (
                                              <p className="text-[10px] text-gray-500 mt-0.5">{item.presentation}</p>
                                            )}
                                          </div>
                                          <span className="font-bold text-gray-700 whitespace-nowrap">
                                            R$ {(itemPrice * itemQty).toFixed(2).replace('.', ',')}
                                          </span>
                                        </div>

                                        {/* Continuous Use Depletion Forecast Card */}
                                        {forecast.isContinuousUse && (
                                          <div className={`mt-2 p-2 rounded-md border flex flex-col gap-1.5 ${
                                            forecast.urgency === 'OVERDUE'
                                              ? 'bg-red-50 border-red-200 text-red-800'
                                              : forecast.urgency === 'URGENT'
                                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                                : forecast.urgency === 'UPCOMING'
                                                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                                                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                          }`}>
                                            <div className="flex items-center justify-between gap-1">
                                              <div className="flex items-center gap-1.5 font-bold text-[11px]">
                                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                                <span>{forecast.statusText}</span>
                                              </div>
                                              <span className="text-[10px] font-semibold opacity-80 whitespace-nowrap">
                                                Término: {forecast.endDateFormatted}
                                              </span>
                                            </div>

                                            <div className="flex items-center justify-between pt-1 border-t border-black/5 gap-2">
                                              <span className="text-[10px] opacity-75">
                                                Estimativa: {forecast.durationDays} dias ({itemQty > 1 ? `${itemQty} caixas` : '1 caixa'})
                                              </span>
                                              <button 
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setMessageInput(forecast.suggestedMessage);
                                                  setActiveView('CHAT');
                                                }}
                                                className="px-2 py-0.5 bg-white font-bold text-[10px] rounded shadow-2xs hover:bg-gray-50 transition-colors border border-current shrink-0 cursor-pointer flex items-center gap-1"
                                              >
                                                <Sparkles className="w-2.5 h-2.5" /> Oferecer Reposição
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 text-center py-1">Itens não detalhados neste pedido.</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 px-4 bg-gray-50 rounded-xl border border-gray-100">
                    <ShoppingBag className="w-8 h-8 mx-auto text-gray-300 mb-1" />
                    <p className="text-xs text-gray-500 font-medium">Nenhum pedido anterior localizado para este telefone.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center p-4">
              <p className="text-gray-400 text-sm">O contexto do cliente aparecerá aqui ao selecionar uma conversa.</p>
            </div>
          )}
        </div>
      </div>
      </div>
      )}

      <ChatTransferModal 
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        onTransfer={handleTransfer}
        tenantId={tenantId}
      />

      <WhatsAppConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => {
          setIsConnectModalOpen(false);
          fetchConversations();
          fetchInboxes();
        }}
        tenantId={tenantId}
      />

      {/* Modal de Pré-visualização de Imagem / Lightbox */}
      {selectedImagePreview && (
        <div 
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedImagePreview(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => setSelectedImagePreview(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 p-2 rounded-full bg-black/60 transition-colors shadow-lg cursor-pointer"
              title="Fechar"
            >
              <X className="w-6 h-6" />
            </button>
            <img 
              src={selectedImagePreview} 
              alt="Visualização da Imagem" 
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border border-white/20" 
            />
          </div>
        </div>
      )}
    </div>
  );
};
