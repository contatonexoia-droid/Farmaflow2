import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { toast } from 'react-hot-toast';
import {
  Kanban,
  Search,
  RefreshCw,
  Filter,
  Users,
  Bot,
  UserCheck,
  ShoppingBag,
  Clock,
  CheckCircle2,
  SlidersHorizontal,
  X,
  MessageSquare,
  Sparkles,
  Phone,
  Tag,
  Truck,
  CreditCard,
  PackageCheck
} from 'lucide-react';
import { KanbanColumnConfig, KanbanStageId } from '../types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { supabase } from '../services/supabase';

// Definição das 6 colunas padrão do fluxo simplificado de delivery FarmaFlow
export const DEFAULT_KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    id: 'novos_triagem',
    title: 'Novos / Triagem',
    subtitle: 'Entrada & Boas-Vindas automáticas',
    color: '#3b82f6',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    borderColor: 'border-blue-200',
    iconName: 'Users',
    order: 1
  },
  {
    id: 'ia_atendendo',
    title: 'IA Atendendo',
    subtitle: 'Agente de IA interagindo',
    color: '#8b5cf6',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-700',
    borderColor: 'border-purple-200',
    iconName: 'Bot',
    order: 2
  },
  {
    id: 'em_atendimento',
    title: 'Em Atendimento',
    subtitle: 'Balcão / Atendimento Humano',
    color: '#f43f5e',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-700',
    borderColor: 'border-rose-200',
    iconName: 'UserCheck',
    order: 3
  },
  {
    id: 'aguardando_pagamento',
    title: 'Aguardando Pagamento',
    subtitle: 'PIX ou Link Webloja enviado',
    color: '#f59e0b',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    borderColor: 'border-amber-200',
    iconName: 'Clock',
    order: 4
  },
  {
    id: 'saiu_entrega',
    title: 'Em Separação / Delivery',
    subtitle: 'Separação e motoboy em rota',
    color: '#10b981',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    borderColor: 'border-emerald-200',
    iconName: 'Truck',
    order: 5
  },
  {
    id: 'finalizado',
    title: 'Finalizados',
    subtitle: 'Entrega concluída e encerrado',
    color: '#64748b',
    badgeBg: 'bg-slate-50',
    badgeText: 'text-slate-700',
    borderColor: 'border-slate-200',
    iconName: 'CheckCircle2',
    order: 6
  }
];

export interface ChatKanbanProps {
  tenantId: string;
  currentUser?: any;
  userRole?: string;
  conversations: any[];
  onConversationsChange?: (updatedConversations: any[]) => void;
  onOpenConversation: (conversation: any) => void;
  inboxes?: any[];
  teams?: any[];
  availableLabels?: any[];
  onRefresh?: () => void;
}

/**
 * Função de mapeamento e normalização com total retrocompatibilidade
 * para estágios legados, variantes e agentes de IA.
 */
export function normalizeKanbanStage(stageOrStatus: string | undefined | null, conv?: any): KanbanStageId {
  if (!stageOrStatus) {
    if (conv) {
      if (conv.status === 'CLOSED' || conv.status === 'finalizado' || conv.status === 'concluido' || conv.status === 'concluida') return 'finalizado';
      if (conv.status === 'PENDING' || conv.status === 'WAITING' || conv.status === 'aguardando_pagamento') return 'aguardando_pagamento';
      if (conv.bot_handoff_reason === 'STORE_REDIRECT') return 'aguardando_pagamento';
      const isHuman =
        conv.is_human_controlled === true ||
        Boolean(conv.assigned_user_id) ||
        Boolean(conv.assigned_to) ||
        conv.is_bot_active === false ||
        conv.status === 'human_takeover' ||
        conv.status === 'HUMAN' ||
        conv.status === 'em_atendimento';
      if (isHuman) return 'em_atendimento';
      if (conv.is_bot_active === true || conv.status === 'bot' || conv.status === 'BOT' || conv.status === 'ia_atendendo') return 'ia_atendendo';
    }
    return 'novos_triagem';
  }

  const s = String(stageOrStatus).toLowerCase().trim();

  // 1. 'novos_triagem': aceitar 'novos_triagem' | 'triagem' | 'novos' | legados ('novos_clientes', 'new', 'open')
  if (
    s === 'novos_triagem' ||
    s === 'triagem' ||
    s === 'novos' ||
    s === 'novos_clientes' ||
    s === 'new' ||
    s === 'open'
  ) {
    return 'novos_triagem';
  }

  // 2. 'ia_atendendo': aceitar 'ia_atendendo' | 'bot' | 'ia'
  if (
    s === 'ia_atendendo' ||
    s === 'bot' ||
    s === 'ia'
  ) {
    return 'ia_atendendo';
  }

  // 3. 'em_atendimento': aceitar 'em_atendimento' | 'atendimento_humano' | 'humano' | 'human' | 'human_takeover' | 'balcao'
  if (
    s === 'em_atendimento' ||
    s === 'atendimento_humano' ||
    s === 'humano' ||
    s === 'human' ||
    s === 'human_takeover' ||
    s === 'balcao'
  ) {
    return 'em_atendimento';
  }

  // 4. 'aguardando_pagamento': aceitar 'aguardando_pagamento' | 'pagamento' | 'enviado_webloja' | 'aguardando_resposta' | 'store_redirect' | 'waiting' | 'pending'
  if (
    s === 'aguardando_pagamento' ||
    s === 'pagamento' ||
    s === 'enviado_webloja' ||
    s === 'aguardando_resposta' ||
    s === 'store_redirect' ||
    s === 'waiting' ||
    s === 'pending'
  ) {
    return 'aguardando_pagamento';
  }

  // 5. 'saiu_entrega': aceitar 'saiu_entrega' | 'delivery' | 'em_separacao' | 'separacao' | 'rota'
  if (
    s === 'saiu_entrega' ||
    s === 'delivery' ||
    s === 'em_separacao' ||
    s === 'separacao' ||
    s === 'rota'
  ) {
    return 'saiu_entrega';
  }

  // 6. 'finalizado': aceitar 'finalizado' | 'concluido' | 'concluida' | 'finalizada' | 'closed'
  if (
    s === 'finalizado' ||
    s === 'concluido' ||
    s === 'concluida' ||
    s === 'finalizada' ||
    s === 'closed'
  ) {
    return 'finalizado';
  }

  return 'novos_triagem';
}

/**
 * Determina dinamicamente o estágio correto da conversa aplicando as regras de delivery FarmaFlow
 */
export function getConversationKanbanStage(conv: any): KanbanStageId {
  if (!conv) return 'novos_triagem';

  if (conv.kanban_stage) {
    return normalizeKanbanStage(conv.kanban_stage, conv);
  }

  if (conv.stage) {
    return normalizeKanbanStage(conv.stage, conv);
  }

  if (conv.status === 'CLOSED' || conv.status === 'finalizado' || conv.status === 'concluido') return 'finalizado';
  if (conv.status === 'PENDING' || conv.status === 'WAITING' || conv.status === 'aguardando_pagamento') return 'aguardando_pagamento';
  if (conv.bot_handoff_reason === 'STORE_REDIRECT') return 'aguardando_pagamento';

  const isHumanControlled = 
    conv.is_human_controlled === true ||
    Boolean(conv.assigned_user_id) ||
    Boolean(conv.assigned_to) ||
    conv.is_bot_active === false ||
    conv.status === 'human_takeover' ||
    conv.status === 'HUMAN' ||
    conv.status === 'em_atendimento';

  if (isHumanControlled) {
    return 'em_atendimento';
  }

  if (conv.is_bot_active === true || conv.status === 'bot' || conv.status === 'BOT') {
    return 'ia_atendendo';
  }

  return 'novos_triagem';
}

export const ChatKanban: React.FC<ChatKanbanProps> = ({
  tenantId,
  currentUser,
  userRole,
  conversations,
  onConversationsChange,
  onOpenConversation,
  inboxes = [],
  teams = [],
  availableLabels = [],
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const isOperador = (userRole || '').toLowerCase() === 'operador';
  const [selectedInboxId, setSelectedInboxId] = useState(() => (inboxes.length === 1 ? inboxes[0].id : 'all'));
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [selectedTagId, setSelectedTagId] = useState('all');
  const [activeCard, setActiveCard] = useState<any | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Controle de Optimistic UI para evitar flickering/race-conditions do Realtime
  const [lockedConversations, setLockedConversations] = useState<Set<string>>(new Set());
  const [optimisticState, setOptimisticState] = useState<any[]>([]);

  const effectiveConversations = useMemo(() => {
    if (lockedConversations.size === 0) return conversations;
    return conversations.map(c => {
      if (lockedConversations.has(c.id)) {
        const opt = optimisticState.find(optC => optC.id === c.id);
        if (opt) return opt;
      }
      return c;
    });
  }, [conversations, lockedConversations, optimisticState]);

  useEffect(() => {
    if (inboxes.length === 1) {
      setSelectedInboxId(inboxes[0].id);
    } else if (isOperador && inboxes.length > 1 && selectedInboxId === 'all') {
      setSelectedInboxId(inboxes[0].id);
    }
  }, [inboxes, isOperador]);

  // Configuração avançada dos sensores para DnD-Kit (Suporte perfeito para Desktop Mouse e Mobile Touch)
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 8, // 8px de movimento para iniciar no desktop via mouse
    },
  });

  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: 250, // Pressionar e segurar por 250ms no mobile para diferenciar de scroll vertical
      tolerance: 6, // Tolerância de até 6px durante o delay
    },
  });

  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });

  const sensors = useSensors(mouseSensor, touchSensor, keyboardSensor);

  // Filtro geral de conversas
  const filteredConversations = useMemo(() => {
    // Lista de IDs de caixas permitidas que vieram pelas props do componente
    const allowedInboxIdsSet = new Set(inboxes.map(i => i.id));

    return effectiveConversations.filter(conv => {
      // Se for operador, só pode visualizar conversas pertencentes às caixas permitidas
      if (isOperador) {
        if (!conv.inbox_id || !allowedInboxIdsSet.has(conv.inbox_id)) {
          return false;
        }
      }

      // Filtro por Caixa de Entrada selecionada
      if (selectedInboxId !== 'all' && conv.inbox_id !== selectedInboxId) return false;
      // Filtro por Time
      if (selectedTeamId !== 'all' && conv.team_id !== selectedTeamId) return false;
      // Filtro por Tag / Label
      if (selectedTagId !== 'all') {
        const hasTag = conv.labels && conv.labels.some((l: any) => l.id === selectedTagId);
        if (!hasTag) return false;
      }
      // Filtro por busca textual
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const contactName = (conv.contact?.name || '').toLowerCase();
        const contactPhone = (conv.contact?.phone_number || '');
        const lastMsg = (conv.last_message_content || '').toLowerCase();
        return contactName.includes(q) || contactPhone.includes(q) || lastMsg.includes(q);
      }
      return true;
    });
  }, [effectiveConversations, inboxes, isOperador, selectedInboxId, selectedTeamId, selectedTagId, searchQuery]);

  // Agrupamento de conversas pelas 6 colunas do Kanban com filtro tolerante a aliases
  const columnConversations = useMemo(() => {
    const map: Record<KanbanStageId, any[]> = {
      novos_triagem: [],
      ia_atendendo: [],
      em_atendimento: [],
      aguardando_pagamento: [],
      saiu_entrega: [],
      finalizado: []
    } as any;

    filteredConversations.forEach(conv => {
      const rawStage = (conv.kanban_stage || conv.stage || '').toLowerCase().trim();
      const stage = getConversationKanbanStage(conv);

      // Filtro tolerante a aliases (novos_triagem / triagem / novos)
      if (stage === 'novos_triagem' || rawStage === 'novos_triagem' || rawStage === 'triagem' || rawStage === 'novos') {
        map.novos_triagem.push(conv);
      } else if (stage === 'ia_atendendo' || rawStage === 'ia_atendendo' || rawStage === 'bot' || rawStage === 'ia') {
        map.ia_atendendo.push(conv);
      } else if (stage === 'em_atendimento' || rawStage === 'em_atendimento' || rawStage === 'atendimento_humano' || rawStage === 'humano' || rawStage === 'balcao') {
        map.em_atendimento.push(conv);
      } else if (stage === 'aguardando_pagamento' || rawStage === 'aguardando_pagamento' || rawStage === 'pagamento' || rawStage === 'enviado_webloja' || rawStage === 'aguardando_resposta') {
        map.aguardando_pagamento.push(conv);
      // Filtro tolerante a aliases (saiu_entrega / delivery / em_separacao)
      } else if (stage === 'saiu_entrega' || rawStage === 'saiu_entrega' || rawStage === 'delivery' || rawStage === 'em_separacao' || rawStage === 'separacao') {
        map.saiu_entrega.push(conv);
      } else if (stage === 'finalizado' || rawStage === 'finalizado' || rawStage === 'concluido' || rawStage === 'closed') {
        map.finalizado.push(conv);
      } else if (map[stage]) {
        map[stage].push(conv);
      } else {
        map.novos_triagem.push(conv);
      }
    });

    // Ordenar cada coluna pela data da última mensagem (mais recentes no topo)
    Object.keys(map).forEach((k) => {
      const key = k as KanbanStageId;
      if (Array.isArray(map[key])) {
        map[key].sort((a, b) => {
          const tA = new Date(a.last_message_at || a.created_at || 0).getTime();
          const tB = new Date(b.last_message_at || b.created_at || 0).getTime();
          return tB - tA;
        });
      }
    });

    return map;
  }, [filteredConversations]);

  // Handler de Início de Arrasto
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const found = conversations.find(c => c.id === active.id);
    if (found) {
      setActiveCard(found);
    }
  };

  // Handler de Término de Arrasto
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Identificar a conversa que foi arrastada
    const draggedConv = conversations.find(c => c.id === activeId);
    if (!draggedConv) return;

    const sourceStage = getConversationKanbanStage(draggedConv);

    // Identificar se o drop ocorreu sobre uma coluna ou sobre outro card
    let targetStage: KanbanStageId | null = null;

    if (DEFAULT_KANBAN_COLUMNS.some(col => col.id === overId)) {
      targetStage = overId as KanbanStageId;
    } else {
      // Over em outro card: descobrir em qual estágio aquele card está
      const overConv = conversations.find(c => c.id === overId);
      if (overConv) {
        targetStage = getConversationKanbanStage(overConv);
      }
    }

    if (!targetStage || targetStage === sourceStage) {
      return;
    }

    // 1. Atualização Otimista na UI com as novas etapas de delivery
    const isTargetTriagem = targetStage === 'novos_triagem';
    const isTargetBot = targetStage === 'ia_atendendo';
    const isTargetHumano = targetStage === 'em_atendimento';
    const isTargetFinalizado = targetStage === 'finalizado';
    const isTargetAguardando = targetStage === 'aguardando_pagamento';

    const updatedConv = {
      ...draggedConv,
      kanban_stage: targetStage,
      stage: targetStage,
      status: isTargetFinalizado
        ? 'CLOSED'
        : isTargetAguardando
        ? 'PENDING'
        : isTargetHumano
        ? 'human_takeover'
        : isTargetBot
        ? 'bot'
        : 'OPEN',
      is_bot_active: isTargetBot,
      is_human_controlled: isTargetHumano,
      assigned_user_id: isTargetBot || isTargetTriagem ? null : (isTargetHumano && currentUser?.id ? currentUser.id : draggedConv.assigned_user_id),
      assigned_to: isTargetBot || isTargetTriagem ? null : (isTargetHumano && currentUser?.id ? currentUser.id : draggedConv.assigned_to),
      bot_interaction_count: isTargetTriagem || isTargetBot ? 0 : draggedConv.bot_interaction_count,
      bot_handoff_reason: isTargetTriagem || isTargetBot ? null : draggedConv.bot_handoff_reason,
      bot_handoff_at: isTargetTriagem || isTargetBot ? null : draggedConv.bot_handoff_at,
      updated_at: new Date().toISOString()
    };

    const previousConversations = [...conversations];
    
    // Atualiza estado otimista interno
    setOptimisticState(prev => {
      const filtered = prev.filter(p => p.id !== activeId);
      return [...filtered, updatedConv];
    });
    setLockedConversations(prev => new Set(prev).add(activeId));

    const nextConversations = conversations.map(c => c.id === activeId ? updatedConv : c);
    if (onConversationsChange) {
      onConversationsChange(nextConversations);
    }

    // 2. Persistência no Backend & Supabase (gravando kanban_stage e stage simultaneamente)
    try {
      setIsUpdating(true);

      const payload: Record<string, any> = {
        kanban_stage: targetStage,
        stage: targetStage,
        status: updatedConv.status,
        is_bot_active: updatedConv.is_bot_active,
        is_human_controlled: updatedConv.is_human_controlled,
        updated_at: new Date().toISOString()
      };
      if (updatedConv.assigned_user_id !== undefined) {
        payload.assigned_user_id = updatedConv.assigned_user_id;
      }
      if (isTargetTriagem || isTargetBot) {
        payload.bot_interaction_count = 0;
        payload.bot_handoff_reason = null;
        payload.bot_handoff_at = null;
      }

      // 1. Atualiza o banco Supabase (Operação Principal com kanban_stage e stage)
      const { error: dbError } = await supabase
        .from('chat_conversations')
        .update(payload)
        .eq('id', activeId);

      if (dbError) throw dbError; // Apenas erros do Supabase revertem o Kanban

      // 2. Dispara automações externas (Operação Secundária isolada sem rollback invasivo)
      try {
        const res = await fetch(`/api/v1/chat/conversations/${activeId}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: tenantId,
            stage: targetStage,
            kanban_stage: targetStage,
            is_bot_active: updatedConv.is_bot_active,
            is_human_controlled: updatedConv.is_human_controlled,
            manual: true,
            is_manual_move: true,
            assignedUserId: isTargetHumano && currentUser?.id ? currentUser.id : undefined
          })
        });
        if (!res.ok) {
          console.warn(`Aviso: Falha ao disparar automação do estágio (Status ${res.status}), mas a movimentação manual foi mantida.`);
        }
      } catch (apiErr) {
        console.warn("Aviso: Falha ao disparar automação do estágio, mas a movimentação manual no Kanban foi mantida:", apiErr);
      }
    } catch (e) {
      console.error('Erro no banco de dados ao mover card do Kanban:', e);
      toast.error('Erro ao mover card. Alteração revertida.');
      if (onConversationsChange) {
        onConversationsChange(previousConversations);
      }
    } finally {
      setIsUpdating(false);
      // Mantém trava otimista temporária para absorver broadcasts concorrentes
      setTimeout(() => {
        setLockedConversations(prev => {
          const n = new Set(prev);
          n.delete(activeId);
          return n;
        });
      }, 1500);
    }
  };

  // Quick Move Stage
  const handleQuickMoveStage = async (conversationId: string, targetStage: KanbanStageId) => {
    const targetConv = conversations.find(c => c.id === conversationId);
    if (!targetConv) return;

    const isTargetTriagem = targetStage === 'novos_triagem';
    const isTargetBot = targetStage === 'ia_atendendo';
    const isTargetHumano = targetStage === 'em_atendimento';
    const isTargetFinalizado = targetStage === 'finalizado';
    const isTargetAguardando = targetStage === 'aguardando_pagamento';

    const updatedConv = {
      ...targetConv,
      kanban_stage: targetStage,
      stage: targetStage,
      status: isTargetFinalizado
        ? 'CLOSED'
        : isTargetAguardando
        ? 'PENDING'
        : isTargetHumano
        ? 'human_takeover'
        : isTargetBot
        ? 'bot'
        : 'OPEN',
      is_bot_active: isTargetBot,
      is_human_controlled: isTargetHumano,
      assigned_user_id: isTargetBot || isTargetTriagem ? null : targetConv.assigned_user_id,
      assigned_to: isTargetBot || isTargetTriagem ? null : targetConv.assigned_to,
      bot_interaction_count: isTargetTriagem || isTargetBot ? 0 : targetConv.bot_interaction_count,
      bot_handoff_reason: isTargetTriagem || isTargetBot ? null : targetConv.bot_handoff_reason,
      bot_handoff_at: isTargetTriagem || isTargetBot ? null : targetConv.bot_handoff_at
    };

    const previousConversations = [...conversations];
    setOptimisticState(prev => {
      const filtered = prev.filter(p => p.id !== conversationId);
      return [...filtered, updatedConv];
    });
    setLockedConversations(prev => new Set(prev).add(conversationId));

    if (onConversationsChange) {
      onConversationsChange(conversations.map(c => c.id === conversationId ? updatedConv : c));
    }

    try {
      // 1. Atualiza o banco Supabase (Operação Principal)
      const { error: dbError } = await supabase
        .from('chat_conversations')
        .update({
          kanban_stage: targetStage,
          stage: targetStage,
          status: updatedConv.status,
          is_bot_active: updatedConv.is_bot_active,
          is_human_controlled: updatedConv.is_human_controlled,
          bot_interaction_count: isTargetTriagem || isTargetBot ? 0 : undefined,
          bot_handoff_reason: isTargetTriagem || isTargetBot ? null : undefined,
          bot_handoff_at: isTargetTriagem || isTargetBot ? null : undefined,
          updated_at: new Date().toISOString()
        })
        .eq('id', conversationId);

      if (dbError) throw dbError; // Apenas erros do banco revertem o Kanban

      // 2. Dispara automações externas (Operação Secundária isolada)
      try {
        const res = await fetch(`/api/v1/chat/conversations/${conversationId}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeId: tenantId, 
            stage: targetStage, 
            kanban_stage: targetStage,
            is_bot_active: isTargetBot,
            is_human_controlled: isTargetHumano,
            manual: true,
            is_manual_move: true
          })
        });
        if (!res.ok) {
          console.warn(`Aviso: Falha ao disparar automação (Status ${res.status}). A movimentação foi mantida.`);
        }
      } catch (apiErr) {
        console.warn("Aviso: Falha ao disparar automação externa. A movimentação no Kanban foi mantida:", apiErr);
      }
    } catch (e) {
      console.error('Erro ao atualizar estágio no banco:', e);
      toast.error('Falha ao atualizar o card no banco. Revertendo...');
      if (onConversationsChange) onConversationsChange(previousConversations);
    } finally {
      setTimeout(() => {
        setLockedConversations(prev => {
          const n = new Set(prev);
          n.delete(conversationId);
          return n;
        });
      }, 1500);
    }
  };

  // Toggle Bot Status
  const handleToggleBot = async (conversationId: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    const targetConv = conversations.find(c => c.id === conversationId);
    if (!targetConv) return;

    const targetStage: KanbanStageId = nextStatus ? 'ia_atendendo' : 'em_atendimento';
    const updatedConv = {
      ...targetConv,
      is_bot_active: nextStatus,
      is_human_controlled: !nextStatus,
      assigned_user_id: nextStatus ? null : targetConv.assigned_user_id,
      assigned_to: nextStatus ? null : targetConv.assigned_to,
      bot_interaction_count: nextStatus ? 0 : targetConv.bot_interaction_count,
      bot_handoff_reason: nextStatus ? null : targetConv.bot_handoff_reason,
      bot_handoff_at: nextStatus ? null : targetConv.bot_handoff_at,
      kanban_stage: targetStage,
      stage: targetStage,
      status: nextStatus ? 'bot' : 'human_takeover'
    };

    if (onConversationsChange) {
      onConversationsChange(conversations.map(c => c.id === conversationId ? updatedConv : c));
    }

    try {
      await fetch(`/api/v1/chat/conversations/${conversationId}/toggle-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: tenantId, isBotActive: nextStatus })
      });

      try {
        const { error } = await supabase
          .from('chat_conversations')
          .update({
            is_bot_active: nextStatus,
            is_human_controlled: !nextStatus,
            kanban_stage: targetStage,
            stage: targetStage,
            status: updatedConv.status,
            updated_at: new Date().toISOString()
          })
          .eq('id', conversationId);

        if (error) {
          console.error("Erro detalhado do Supabase:", error.message, error.details, error.hint);
        }
      } catch (err: any) {
        console.error("Exceção Fallback Supabase:", err.message);
      }
    } catch (e) {
      console.error('Erro ao alterar bot:', e);
    }
  };

  // Totais rápidos para métricas das 6 etapas de delivery
  const totalCount = filteredConversations.length;
  const triagemCount = columnConversations.novos_triagem?.length || 0;
  const iaCount = columnConversations.ia_atendendo?.length || 0;
  const atendimentoCount = columnConversations.em_atendimento?.length || 0;
  const pagamentoCount = columnConversations.aguardando_pagamento?.length || 0;
  const deliveryCount = columnConversations.saiu_entrega?.length || 0;
  const finalizadoCount = columnConversations.finalizado?.length || 0;

  return (
    <div className="flex flex-col h-full bg-slate-100/70 select-none overflow-hidden">
      {/* Top Filter & Toolbar */}
      <div className="bg-white px-4 md:px-6 py-3 border-b border-gray-200/90 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        {/* Left: Title & Quick Stats */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center shadow-sm">
              <Kanban size={18} />
            </div>
            <div>
              <h2 className="font-black text-gray-900 text-base leading-tight flex items-center gap-2">
                <span>Fluxo Delivery Farmácia</span>
                {isUpdating && (
                  <span className="text-[10px] text-purple-600 font-semibold animate-pulse flex items-center gap-1">
                    <RefreshCw size={10} className="animate-spin" /> Salvando...
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Arraste os cards pelas 6 etapas do fluxo de entrega
              </p>
            </div>
          </div>

          {/* Quick Stat Pills */}
          <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-gray-200">
            <span className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-gray-200/80">
              <span>Total:</span>
              <span className="font-mono text-purple-700">{totalCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-blue-200">
              <Users size={12} />
              <span>Triagem:</span>
              <span className="font-mono">{triagemCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-purple-200">
              <Bot size={12} />
              <span>IA:</span>
              <span className="font-mono">{iaCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-rose-50 text-rose-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-rose-200">
              <UserCheck size={12} />
              <span>Balcão:</span>
              <span className="font-mono">{atendimentoCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-amber-200">
              <Clock size={12} />
              <span>Pagamento:</span>
              <span className="font-mono">{pagamentoCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-emerald-200">
              <Truck size={12} />
              <span>Delivery:</span>
              <span className="font-mono">{deliveryCount}</span>
            </span>
          </div>
        </div>

        {/* Right: Search, Filter Selects & Refresh */}
        <div className="flex items-center gap-2 flex-wrap flex-1 justify-end">
          {/* Search Box */}
          <div className="relative min-w-[200px] md:min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente, tel ou mensagem..."
              className="w-full pl-9 pr-7 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium text-gray-800 placeholder-gray-400 outline-none focus:border-purple-500 focus:bg-white transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Inbox Filter */}
          {inboxes.length === 1 ? (
            <div className="py-1.5 px-3 bg-purple-50 border border-purple-200 text-purple-800 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-2xs">
              <span>Setor: {inboxes[0].name}</span>
            </div>
          ) : inboxes.length > 1 ? (
            <select
              value={selectedInboxId}
              onChange={(e) => setSelectedInboxId(e.target.value)}
              className="py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:border-purple-500 cursor-pointer"
            >
              {!isOperador && <option value="all">Todas as Caixas</option>}
              {inboxes.map((inbox) => (
                <option key={inbox.id} value={inbox.id}>
                  {inbox.name}
                </option>
              ))}
            </select>
          ) : null}

          {/* Team Filter */}
          {teams.length > 0 && (
            <select
              value={selectedTeamId}
              onChange={(e) => setSelectedTeamId(e.target.value)}
              className="py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todos os Times</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          )}

          {/* Label / Tag Filter */}
          {availableLabels.length > 0 && (
            <select
              value={selectedTagId}
              onChange={(e) => setSelectedTagId(e.target.value)}
              className="py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todas as Etiquetas</option>
              {availableLabels.map((lbl) => (
                <option key={lbl.id} value={lbl.id}>
                  🏷️ {lbl.name}
                </option>
              ))}
            </select>
          )}

          {/* Refresh Button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Atualizar conversas"
              className="p-2 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl border border-gray-200 transition-colors shadow-2xs"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Main Kanban DnD Canvas - 5 Colunas */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex items-start gap-5 h-full min-w-max pb-2">
            {DEFAULT_KANBAN_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                conversations={columnConversations[column.id] || []}
                onOpenConversation={onOpenConversation}
                onQuickMoveStage={handleQuickMoveStage}
                onToggleBot={handleToggleBot}
                searchFilter={searchQuery}
              />
            ))}
          </div>

          {/* Overlay flutuante com feedback visual durante o arraste */}
          <DragOverlay>
            {activeCard ? (
              <KanbanCard
                conversation={activeCard}
                onOpenConversation={() => {}}
                isOverlay={true}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
};

