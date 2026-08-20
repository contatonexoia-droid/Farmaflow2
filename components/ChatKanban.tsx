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
  Tag
} from 'lucide-react';
import { KanbanColumnConfig, KanbanStageId } from '../types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';

// Definição das colunas padrão do Kanban FarmaFlow
export const DEFAULT_KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    id: 'NEW',
    title: 'Novos Clientes',
    subtitle: 'Triagem & Primeiro contato',
    color: '#3b82f6',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    borderColor: 'border-blue-200',
    iconName: 'Users',
    order: 1
  },
  {
    id: 'BOT',
    title: 'IA Atendendo',
    subtitle: 'Respostas automáticas inteligentes',
    color: '#8b5cf6',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-700',
    borderColor: 'border-purple-200',
    iconName: 'Bot',
    order: 2
  },
  {
    id: 'WAITING',
    title: 'Aguardando Resposta',
    subtitle: 'Esperando retorno do cliente',
    color: '#f59e0b',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    borderColor: 'border-amber-200',
    iconName: 'Clock',
    order: 3
  },
  {
    id: 'STORE_REDIRECT',
    title: 'Enviado p/ Webloja',
    subtitle: 'Com link do catálogo e checkout',
    color: '#10b981',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    borderColor: 'border-emerald-200',
    iconName: 'ShoppingBag',
    order: 4
  },
  {
    id: 'HUMAN',
    title: 'Atendimento Humano',
    subtitle: 'Balconistas & Farmacêuticos',
    color: '#f43f5e',
    badgeBg: 'bg-rose-50',
    badgeText: 'text-rose-700',
    borderColor: 'border-rose-200',
    iconName: 'UserCheck',
    order: 5
  },
  {
    id: 'CLOSED',
    title: 'Finalizados',
    subtitle: 'Atendimentos concluídos',
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

// Determina dinamicamente o estágio correto da conversa com unificação estrita das regras de IA vs Atendimento Humano
export function getConversationKanbanStage(conv: any): KanbanStageId {
  if (!conv) return 'NEW';
  if (conv.status === 'CLOSED' || conv.kanban_stage === 'CLOSED') return 'CLOSED';

  const isHumanControlled = 
    conv.is_human_controlled === true ||
    Boolean(conv.assigned_user_id) ||
    Boolean(conv.assigned_to) ||
    conv.is_bot_active === false ||
    conv.status === 'human_takeover' ||
    conv.status === 'HUMAN';

  if (isHumanControlled) {
    if (conv.kanban_stage === 'WAITING' || conv.status === 'PENDING') return 'WAITING';
    if (conv.kanban_stage === 'STORE_REDIRECT' || conv.bot_handoff_reason === 'STORE_REDIRECT') return 'STORE_REDIRECT';
    return 'HUMAN';
  }

  // Regra Estrita: Coluna "IA Atendendo" só aceita is_bot_active === true E is_human_controlled === false E assigned_user_id === null
  if (conv.is_bot_active !== false && !conv.is_human_controlled && !conv.assigned_user_id && !conv.assigned_to) {
    if (conv.kanban_stage === 'WAITING' || conv.status === 'PENDING') return 'WAITING';
    if (conv.kanban_stage === 'STORE_REDIRECT' || conv.bot_handoff_reason === 'STORE_REDIRECT') return 'STORE_REDIRECT';
    if (conv.kanban_stage === 'NEW' && conv.bot_interaction_count === 0 && !conv.last_message_content) return 'NEW';
    return 'BOT';
  }

  if (conv.kanban_stage === 'WAITING' || conv.status === 'PENDING') return 'WAITING';
  if (conv.kanban_stage === 'STORE_REDIRECT' || conv.bot_handoff_reason === 'STORE_REDIRECT') return 'STORE_REDIRECT';
  if (conv.kanban_stage === 'NEW') return 'NEW';
  return 'HUMAN';
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
  const [selectedInboxId, setSelectedInboxId] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState('all');
  const [selectedTagId, setSelectedTagId] = useState('all');
  const [activeCard, setActiveCard] = useState<any | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

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
    return conversations.filter(conv => {
      // Filtro por Caixa de Entrada
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
  }, [conversations, selectedInboxId, selectedTeamId, selectedTagId, searchQuery]);

  // Agrupamento de conversas por coluna do Kanban
  const columnConversations = useMemo(() => {
    const map: Record<KanbanStageId, any[]> = {
      NEW: [],
      BOT: [],
      WAITING: [],
      STORE_REDIRECT: [],
      HUMAN: [],
      CLOSED: []
    };

    filteredConversations.forEach(conv => {
      const stage = getConversationKanbanStage(conv);
      if (map[stage]) {
        map[stage].push(conv);
      } else {
        map.HUMAN.push(conv);
      }
    });

    // Ordenar cada coluna pela data da última mensagem (mais recentes no topo)
    Object.keys(map).forEach((k) => {
      const key = k as KanbanStageId;
      map[key].sort((a, b) => {
        const tA = new Date(a.last_message_at || a.created_at || 0).getTime();
        const tB = new Date(b.last_message_at || b.created_at || 0).getTime();
        return tB - tA;
      });
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

    // 1. Atualização Otimista na UI
    const isTargetBot = targetStage === 'BOT';
    const isTargetHuman = targetStage === 'HUMAN';
    const updatedConv = {
      ...draggedConv,
      kanban_stage: targetStage,
      status: targetStage === 'CLOSED' 
        ? 'CLOSED' 
        : targetStage === 'WAITING' 
        ? 'PENDING' 
        : isTargetBot 
        ? 'bot' 
        : isTargetHuman 
        ? 'human_takeover' 
        : 'OPEN',
      is_bot_active: isTargetBot,
      is_human_controlled: isTargetHuman || !isTargetBot,
      assigned_user_id: isTargetBot ? null : (isTargetHuman && currentUser?.id ? currentUser.id : draggedConv.assigned_user_id),
      assigned_to: isTargetBot ? null : (isTargetHuman && currentUser?.id ? currentUser.id : draggedConv.assigned_to),
      updated_at: new Date().toISOString()
    };

    const nextConversations = conversations.map(c => c.id === activeId ? updatedConv : c);
    if (onConversationsChange) {
      onConversationsChange(nextConversations);
    }

    // 2. Persistência no Backend & Supabase
    try {
      setIsUpdating(true);
      const res = await fetch(`/api/v1/chat/conversations/${activeId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: tenantId,
          stage: targetStage,
          assignedUserId: targetStage === 'HUMAN' && currentUser?.id ? currentUser.id : undefined
        })
      });

      if (!res.ok) {
        console.warn('Erro ao atualizar estágio no servidor. Revertendo...');
        if (onConversationsChange) {
          onConversationsChange(conversations);
        }
      }
    } catch (e) {
      console.error('Erro de conexão ao mover card do Kanban:', e);
      if (onConversationsChange) {
        onConversationsChange(conversations);
      }
    } finally {
      setIsUpdating(false);
    }
  };

  // Quick Move Stage
  const handleQuickMoveStage = async (conversationId: string, targetStage: KanbanStageId) => {
    const targetConv = conversations.find(c => c.id === conversationId);
    if (!targetConv) return;

    const isTargetBot = targetStage === 'BOT';
    const isTargetHuman = targetStage === 'HUMAN';
    const updatedConv = {
      ...targetConv,
      kanban_stage: targetStage,
      status: targetStage === 'CLOSED' 
        ? 'CLOSED' 
        : targetStage === 'WAITING' 
        ? 'PENDING' 
        : isTargetBot 
        ? 'bot' 
        : isTargetHuman 
        ? 'human_takeover' 
        : 'OPEN',
      is_bot_active: isTargetBot,
      is_human_controlled: isTargetHuman || !isTargetBot,
      assigned_user_id: isTargetBot ? null : targetConv.assigned_user_id,
      assigned_to: isTargetBot ? null : targetConv.assigned_to,
      bot_interaction_count: isTargetBot ? 0 : targetConv.bot_interaction_count,
      bot_handoff_reason: isTargetBot ? null : targetConv.bot_handoff_reason,
      bot_handoff_at: isTargetBot ? null : targetConv.bot_handoff_at
    };

    if (onConversationsChange) {
      onConversationsChange(conversations.map(c => c.id === conversationId ? updatedConv : c));
    }

    try {
      await fetch(`/api/v1/chat/conversations/${conversationId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: tenantId, stage: targetStage })
      });
    } catch (e) {
      console.error('Erro ao atualizar estágio:', e);
    }
  };

  // Toggle Bot Status
  const handleToggleBot = async (conversationId: string, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    const targetConv = conversations.find(c => c.id === conversationId);
    if (!targetConv) return;

    const targetStage: KanbanStageId = nextStatus ? 'BOT' : 'HUMAN';
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
    } catch (e) {
      console.error('Erro ao alterar bot:', e);
    }
  };

  // Totais rápidos para métricas
  const totalCount = filteredConversations.length;
  const botCount = columnConversations.BOT.length;
  const humanCount = columnConversations.HUMAN.length;
  const newCount = columnConversations.NEW.length;
  const waitingCount = columnConversations.WAITING.length;

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
                <span>Quadro Kanban de Atendimento</span>
                {isUpdating && (
                  <span className="text-[10px] text-purple-600 font-semibold animate-pulse flex items-center gap-1">
                    <RefreshCw size={10} className="animate-spin" /> Salvando...
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-500 font-medium">
                Arraste os cards entre as colunas para gerenciar o fluxo
              </p>
            </div>
          </div>

          {/* Quick Stat Pills */}
          <div className="hidden lg:flex items-center gap-2 pl-3 border-l border-gray-200">
            <span className="px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-gray-200/80">
              <span>Total:</span>
              <span className="font-mono text-purple-700">{totalCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-purple-200">
              <Bot size={12} />
              <span>IA:</span>
              <span className="font-mono">{botCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-rose-50 text-rose-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-rose-200">
              <UserCheck size={12} />
              <span>Balcão:</span>
              <span className="font-mono">{humanCount}</span>
            </span>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs font-black rounded-xl flex items-center gap-1.5 border border-amber-200">
              <Clock size={12} />
              <span>Aguardando:</span>
              <span className="font-mono">{waitingCount}</span>
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
          {inboxes.length > 0 && (
            <select
              value={selectedInboxId}
              onChange={(e) => setSelectedInboxId(e.target.value)}
              className="py-1.5 px-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value="all">Todas as Caixas</option>
              {inboxes.map((inbox) => (
                <option key={inbox.id} value={inbox.id}>
                  {inbox.name}
                </option>
              ))}
            </select>
          )}

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

      {/* Main Kanban DnD Canvas */}
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
