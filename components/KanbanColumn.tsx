import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { 
  Users, 
  Bot, 
  Clock, 
  ShoppingBag, 
  UserCheck, 
  CheckCircle2,
  Sparkles,
  Inbox,
  Plus
} from 'lucide-react';
import { KanbanColumnConfig, KanbanStageId } from '../types';
import { KanbanCard } from './KanbanCard';

export interface KanbanColumnProps {
  column: KanbanColumnConfig;
  conversations: any[];
  onOpenConversation: (conversation: any) => void;
  onQuickMoveStage?: (conversationId: string, targetStage: KanbanStageId) => void;
  onToggleBot?: (conversationId: string, currentStatus: boolean) => void;
  searchFilter?: string;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  conversations,
  onOpenConversation,
  onQuickMoveStage,
  onToggleBot,
  searchFilter = ''
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: 'Column',
      column
    }
  });

  // Filter conversations by local search if passed
  const filteredItems = searchFilter
    ? conversations.filter(c => {
        const name = c.contact?.name || '';
        const phone = c.contact?.phone_number || '';
        const lastMsg = c.last_message_content || '';
        const q = searchFilter.toLowerCase();
        return name.toLowerCase().includes(q) || phone.includes(q) || lastMsg.toLowerCase().includes(q);
      })
    : conversations;

  const getColumnIcon = (iconName: string) => {
    switch (iconName) {
      case 'Users':
        return <Users size={16} className="text-blue-600" />;
      case 'Bot':
        return <Bot size={16} className="text-purple-600" />;
      case 'Clock':
        return <Clock size={16} className="text-amber-600" />;
      case 'ShoppingBag':
        return <ShoppingBag size={16} className="text-emerald-600" />;
      case 'UserCheck':
        return <UserCheck size={16} className="text-rose-600" />;
      case 'CheckCircle2':
        return <CheckCircle2 size={16} className="text-slate-600" />;
      default:
        return <Inbox size={16} className="text-purple-600" />;
    }
  };

  return (
    <div
      ref={setNodeRef}
      id={`kanban-col-${column.id}`}
      className={`flex flex-col flex-shrink-0 w-80 md:w-84 max-h-full rounded-3xl border transition-all duration-200 ${
        isOver
          ? 'bg-purple-50/60 border-purple-400 ring-2 ring-purple-300 shadow-lg'
          : 'bg-gray-50/90 border-gray-200/80 shadow-xs'
      }`}
    >
      {/* Column Header */}
      <div className="p-4 border-b border-gray-200/70 bg-white/70 backdrop-blur-xs rounded-t-3xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${column.badgeBg} ${column.borderColor}`}>
              {getColumnIcon(column.iconName)}
            </div>
            <div>
              <h3 className="font-black text-gray-900 text-sm tracking-tight leading-tight flex items-center gap-2">
                <span>{column.title}</span>
              </h3>
              <p className="text-[11px] text-gray-500 font-medium leading-tight mt-0.5">
                {column.subtitle}
              </p>
            </div>
          </div>

          <span className={`px-2.5 py-1 text-xs font-black rounded-full border shadow-2xs ${column.badgeBg} ${column.badgeText} ${column.borderColor}`}>
            {filteredItems.length}
          </span>
        </div>
      </div>

      {/* Cards List Container */}
      <div className="flex-1 p-3 overflow-y-auto space-y-3 min-h-[160px] max-h-[calc(100vh-280px)] scrollbar-thin scrollbar-thumb-gray-300">
        <SortableContext
          items={filteredItems.map(c => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {filteredItems.length > 0 ? (
            filteredItems.map((conv) => (
              <KanbanCard
                key={conv.id}
                conversation={conv}
                onOpenConversation={onOpenConversation}
                onQuickMoveStage={onQuickMoveStage}
                onToggleBot={onToggleBot}
              />
            ))
          ) : (
            <div className={`h-36 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-4 text-center transition-colors ${
              isOver 
                ? 'border-purple-400 bg-purple-100/40 text-purple-700' 
                : 'border-gray-200 text-gray-400 bg-white/40'
            }`}>
              <Inbox size={24} className="mb-1.5 opacity-60" />
              <p className="text-xs font-bold">Nenhuma conversa aqui</p>
              <p className="text-[10px] opacity-75 mt-0.5">Arraste um card para esta etapa</p>
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
};
