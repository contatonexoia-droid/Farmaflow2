import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  Bot, 
  User, 
  Clock, 
  ExternalLink, 
  MessageSquare, 
  CheckCircle2, 
  ArrowRight,
  Sparkles,
  Phone,
  Tag,
  AlertCircle,
  MoreHorizontal
} from 'lucide-react';
import { KanbanStageId } from '../types';

export interface KanbanCardProps {
  conversation: any;
  onOpenConversation: (conversation: any) => void;
  onQuickMoveStage?: (conversationId: string, targetStage: KanbanStageId) => void;
  onToggleBot?: (conversationId: string, currentStatus: boolean) => void;
  isOverlay?: boolean;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  conversation,
  onOpenConversation,
  onQuickMoveStage,
  onToggleBot,
  isOverlay = false
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: conversation.id,
    data: {
      type: 'Conversation',
      conversation
    },
    disabled: isOverlay
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition || 'transform 200ms ease',
    opacity: isDragging ? 0.35 : 1,
    touchAction: 'manipulation'
  };

  const contactName = conversation.contact?.name || conversation.contact?.phone_number || 'Cliente';
  const phoneNumber = conversation.contact?.phone_number || '';
  const lastMessage = conversation.last_message_content || 'Sem mensagens recentes';
  const unreadCount = conversation.unread_count || 0;
  
  // Consistência estrita: se for controlado por humano, atribuído a atendente ou bot pausado, não é bot ativo
  const isHumanControlled = 
    conversation.is_human_controlled === true || 
    Boolean(conversation.assigned_user_id) || 
    Boolean(conversation.assigned_to) || 
    conversation.is_bot_active === false || 
    conversation.status === 'human_takeover' || 
    conversation.status === 'HUMAN';
  const isBotActive = !isHumanControlled && conversation.is_bot_active !== false;
  const botCount = conversation.bot_interaction_count || 0;

  // Format relative time
  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMin / 60);

      if (diffMin < 1) return 'Agora';
      if (diffMin < 60) return `${diffMin}m`;
      if (diffHours < 24) return `${diffHours}h`;
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    } catch {
      return '';
    }
  };

  // Avatar initials background color generator
  const getAvatarGradient = (name: string) => {
    const colors = [
      'from-blue-600 to-indigo-600',
      'from-purple-600 to-pink-600',
      'from-emerald-600 to-teal-600',
      'from-amber-500 to-orange-600',
      'from-rose-500 to-red-600'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  const initials = contactName
    .split(' ')
    .slice(0, 2)
    .map((n: string) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      id={`kanban-card-${conversation.id}`}
      className={`group relative bg-white rounded-2xl p-3.5 border transition-all duration-200 cursor-grab active:cursor-grabbing select-none ${
        isOverlay
          ? 'shadow-2xl ring-2 ring-purple-500 border-purple-300 scale-105 rotate-1 z-50'
          : 'shadow-sm hover:shadow-md border-gray-200/90 hover:border-purple-300'
      }`}
    >
      {/* Top Row: Avatar, Contact info, Timestamp & Unread */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex-shrink-0">
            {conversation.contact?.avatar_url ? (
              <img
                src={conversation.contact.avatar_url}
                alt={contactName}
                className="w-9 h-9 rounded-xl object-cover ring-2 ring-gray-100"
              />
            ) : (
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${getAvatarGradient(contactName)} text-white flex items-center justify-center font-black text-xs shadow-sm`}>
                {initials || <User size={14} />}
              </div>
            )}
            {/* Status dot */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                isBotActive ? 'bg-purple-500' : 'bg-emerald-500'
              }`}
              title={isBotActive ? 'Bot de IA Ativo' : 'Atendimento Humano'}
            />
          </div>

          <div className="min-w-0">
            <h4 className="font-bold text-gray-900 text-xs md:text-sm truncate leading-tight flex items-center gap-1.5">
              <span>{contactName}</span>
            </h4>
            {phoneNumber && (
              <p className="text-[10px] text-gray-400 font-mono truncate flex items-center gap-1 mt-0.5">
                <Phone size={9} />
                <span>{phoneNumber}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-0.5">
            <Clock size={10} />
            {formatTime(conversation.last_message_at)}
          </span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 bg-rose-500 text-white font-black text-[9px] rounded-full min-w-4 text-center animate-pulse">
              {unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* Message Preview */}
      <div className="mt-2.5 bg-gray-50/80 p-2.5 rounded-xl border border-gray-100">
        <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed font-normal">
          {lastMessage}
        </p>
      </div>

      {/* Badges / Labels / AI Counter row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {/* IA vs Humano Badge */}
        {isBotActive ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 border border-purple-200 text-purple-700 text-[10px] font-bold rounded-lg shadow-2xs">
            <Bot size={11} className="text-purple-600" />
            <span>IA Ativa</span>
            <span className="font-mono text-[9px] bg-purple-200/70 text-purple-900 px-1 rounded">
              {botCount}/4
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold rounded-lg shadow-2xs">
            <User size={11} className="text-emerald-600" />
            <span>Humano</span>
          </span>
        )}

        {/* Assigned operator badge */}
        {conversation.assigned_user_id && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-medium rounded-lg">
            <span>👤 Atribuído</span>
          </span>
        )}

        {/* Labels / Tags */}
        {conversation.labels && conversation.labels.map((lbl: any) => (
          <span
            key={lbl.id || lbl.name}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-md border"
            style={{
              backgroundColor: `${lbl.color || '#6b7280'}15`,
              color: lbl.color || '#374151',
              borderColor: `${lbl.color || '#6b7280'}30`
            }}
          >
            <Tag size={8} />
            <span>{lbl.name}</span>
          </span>
        ))}
      </div>

      {/* Card Footer Actions (Visible on hover/mobile) */}
      <div className="mt-3 pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onOpenConversation(conversation)}
          className="flex-1 py-1.5 px-2.5 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 group-hover:bg-purple-600 group-hover:text-white shadow-2xs"
        >
          <MessageSquare size={12} />
          <span>Atender</span>
        </button>

        {onToggleBot && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onToggleBot(conversation.id, isBotActive)}
            title={isBotActive ? "Pausar IA e assumir no balcão" : "Reativar IA para este cliente"}
            className={`p-1.5 rounded-xl border text-xs font-bold transition-colors ${
              isBotActive
                ? 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
                : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200'
            }`}
          >
            <Bot size={13} />
          </button>
        )}
      </div>
    </div>
  );
};
