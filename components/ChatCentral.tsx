import React, { useState, useEffect, useRef } from 'react';
import { Search, Send, FileText, Image as ImageIcon, Paperclip, User, Clock, ShoppingBag, CreditCard, MessageSquare, Lock, AlertCircle, RefreshCw, Smartphone, ChevronLeft, Info, BarChart2, CheckCircle2, UserPlus, Inbox } from 'lucide-react';
import { WhatsAppConnectModal } from './WhatsAppConnectModal';
import { ChatTransferModal } from './ChatTransferModal';
import { supabase } from '../services/supabase';

// Helper to determine active tenant logic for demo
const DEMO_TENANT_ID = 'tenant-id'; // Assume this for now if not passed

export const ChatCentral = ({ currentUser, userRole, tenantId = DEMO_TENANT_ID }: any) => {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [filter, setFilter] = useState('todas'); // minhas, nao_atribuidas, todas, finalizadas
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInboxId, setSelectedInboxId] = useState('all');
  const [inboxes, setInboxes] = useState<any[]>([]);
  const [allowedInboxIds, setAllowedInboxIds] = useState<string[]>([]);
  const messagesEndRef = useRef<any>(null);

  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [activeView, setActiveView] = useState<'LIST' | 'CHAT' | 'SIDEBAR'>('LIST');

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
        setLocalUser(user);
        if (!localRole) {
          setLocalRole((user.user_metadata?.role || '').toLowerCase());
        }
      }
    };
    if (!localUser) {
      fetchUser();
    }
  }, []);

  const cleanRole = (localRole || '').toLowerCase();
  const isOperador = cleanRole === 'operador';
  const userId = localUser?.id;

  // Anti-collision state
  const [otherUserViewing, setOtherUserViewing] = useState<string | null>(null);

  useEffect(() => {
    // 1. Inscrição no Supabase Realtime para mensagens do chat
    const channel = supabase
      .channel(`chat_messages_realtime_${tenantId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const newMsg = payload.new;
          if (newMsg) {
            if (
              selectedConversation &&
              newMsg.conversation_id === selectedConversation.id
            ) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
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
  }, [tenantId]);

  useEffect(() => {
    if (isOperador && selectedInboxId === 'all') {
      return;
    }
    fetchConversations();
  }, [filter, searchQuery, selectedInboxId, tenantId, isOperador]);

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
      let allowedIds: string[] = [];
      if (isOperador && userId) {
        const { data: memberRows } = await supabase
          .from('inbox_members')
          .select('inbox_id')
          .eq('user_id', userId);
        if (memberRows) {
          allowedIds = memberRows.map((r: any) => r.inbox_id);
          setAllowedInboxIds(allowedIds);
        }
      }

      const queryParams = userId ? `&userId=${userId}&role=${cleanRole}` : '';
      const res = await fetch(`/api/v1/inboxes?storeId=${tenantId}${queryParams}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.length > 0) {
          let list = json.data;
          if (isOperador && userId && allowedIds.length > 0) {
            list = list.filter((i: any) => allowedIds.includes(i.id));
          }
          setInboxes(list);
          return;
        }
      }

      const { data, error } = await supabase
        .from('inboxes')
        .select('*')
        .eq('store_id', tenantId);
        
      if (!error && data && data.length > 0) {
        let list = data;
        if (isOperador && userId && allowedIds.length > 0) {
          list = list.filter((i: any) => allowedIds.includes(i.id));
        }
        setInboxes(list);
      } else {
        const saved = localStorage.getItem(`inboxes_${tenantId}`);
        if (saved) {
          try {
            let list = JSON.parse(saved);
            if (isOperador && userId && allowedIds.length > 0) {
              list = list.filter((i: any) => allowedIds.includes(i.id));
            }
            setInboxes(list);
          } catch (_) {}
        } else {
          setInboxes([{ id: `inbox_default_${tenantId}`, name: 'Geral / Atendimento', store_id: tenantId }]);
        }
      }
    } catch (e) {
      console.warn("Error fetching inboxes", e);
      const saved = localStorage.getItem(`inboxes_${tenantId}`);
      if (saved) {
        try { setInboxes(JSON.parse(saved)); } catch (_) {}
      }
    }
  };

  const fetchConversations = async () => {
    if (isOperador && selectedInboxId === 'all') {
      return;
    }
    try {
      let allowedIds = allowedInboxIds;
      if (isOperador && userId && allowedIds.length === 0) {
        const { data: memberRows } = await supabase
          .from('inbox_members')
          .select('inbox_id')
          .eq('user_id', userId);
        if (memberRows) {
          allowedIds = memberRows.map((r: any) => r.inbox_id);
          setAllowedInboxIds(allowedIds);
        }
      }

      const queryParams = userId ? `&userId=${userId}&role=${cleanRole}` : '';
      const res = await fetch(`/api/v1/chat/conversations?tenantId=${tenantId}&inboxId=${selectedInboxId}${queryParams}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          let list = json.data;
          if (isOperador && userId) {
            list = list.filter((c: any) => c.inbox_id && allowedIds.includes(c.inbox_id));
          }
          setConversations(list);
          return;
        }
      }

      let query = supabase
        .from('chat_conversations')
        .select('*, contact:chat_contacts(name, phone_number)')
        .eq('store_id', tenantId)
        .order('last_message_at', { ascending: false });

      if (selectedInboxId !== 'all') {
        query = query.eq('inbox_id', selectedInboxId);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        let list = data;
        if (isOperador && userId) {
          list = list.filter((c: any) => c.inbox_id && allowedIds.includes(c.inbox_id));
        }
        setConversations(list);
      } else {
        const saved = localStorage.getItem(`chat_conversations_${tenantId}`);
        if (saved) {
          try {
            let list = JSON.parse(saved);
            if (isOperador && userId) {
              list = list.filter((c: any) => c.inbox_id && allowedIds.includes(c.inbox_id));
            }
            setConversations(list);
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn("Error fetching conversations", e);
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
        setMessages(data);
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

  const handleAssumeConversation = () => {
    if (!selectedConversation) return;
    const updated = { ...selectedConversation, assigned_user_id: 'my-user-id', status: 'OPEN' };
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

  const handleTransfer = (transferData: { userId?: string, inboxId?: string }) => {
    if (!selectedConversation) return;
    
    // Optimistic UI update
    let updated = { ...selectedConversation };
    
    if (transferData.userId) {
       updated.assigned_user_id = transferData.userId;
       updated.status = 'OPEN';
       // We can also clear inbox if needed, or just change user
    }
    
    if (transferData.inboxId) {
       updated.inbox_id = transferData.inboxId;
       updated.assigned_user_id = null; // Send back to queue of that inbox
       updated.status = 'PENDING';
    }

    setSelectedConversation(updated);
    setConversations(conversations.map(c => c.id === updated.id ? updated : c));
  };

  const handleCloseConversation = () => {
    if (!selectedConversation) return;
    const updated = { ...selectedConversation, status: 'CLOSED' };
    setSelectedConversation(null);
    setConversations(conversations.map(c => c.id === updated.id ? updated : c));
    setActiveView('LIST');
  };

  return (
    <div className="flex h-screen bg-white md:rounded-2xl md:shadow-xl overflow-hidden border-0 md:border md:border-gray-100 md:m-4 relative">
      
      {/* COLUMN 1: Lista de Conversas */}
      <div className={`${activeView === 'LIST' ? 'flex' : 'hidden'} md:flex w-full md:w-1/3 lg:w-1/4 border-r border-gray-200 bg-gray-50 flex-col absolute inset-0 md:relative z-20`}>
        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-emerald-600" /> Chat
            </h2>
            <button 
              onClick={() => setIsConnectModalOpen(true)}
              className="p-2 bg-emerald-100 text-emerald-700 rounded-xl hover:bg-emerald-200 transition-colors"
              title="Gerenciar Conexão WhatsApp"
            >
              <Smartphone className="w-5 h-5" />
            </button>
          </div>

          {/* Manager Dashboard Widget */}
          <div className="mb-4 bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase font-bold text-gray-500 flex items-center gap-1"><BarChart2 className="w-3 h-3"/> Hoje</p>
              <p className="text-sm font-black text-gray-800">124 Atendimentos</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-orange-500">Na Fila</p>
              <p className="text-sm font-black text-gray-800">5 Aguardando</p>
            </div>
          </div>
          
          {(!isOperador || inboxes.length > 1) ? (
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Inbox className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <select 
                  value={selectedInboxId}
                  onChange={(e) => setSelectedInboxId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-xl pl-9 pr-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500 font-bold appearance-none"
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
            {['Minhas', 'Não Atribuídas', 'Todas', 'Finalizadas'].map(f => (
              <button 
                key={f}
                onClick={() => setFilter(f.toLowerCase())}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${
                  filter === f.toLowerCase() ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          
          {conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6 text-center space-y-3">
              <MessageSquare size={48} className="text-gray-300" />
              <p className="font-bold text-sm">Nenhuma conversa encontrada</p>
              <p className="text-xs">As mensagens recebidas aparecerão aqui.</p>
            </div>
          )}
          {conversations.map(conv => {
            const inboxName = inboxes.find(i => i.id === conv.inbox_id)?.name || 'Sem Caixa';
            
            return (
              <div 
                key={conv.id}
                onClick={() => handleSelectConversation(conv)}
                className={`p-3 rounded-xl cursor-pointer transition-colors ${
                  selectedConversation?.id === conv.id ? 'bg-emerald-50 border border-emerald-200' : 'bg-white hover:bg-gray-100 border border-transparent'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-bold text-gray-800 text-sm truncate">{conv.contact.name}</span>
                  <span className="text-[10px] text-gray-400">
                    {conv.last_message_at 
                      ? new Date(conv.last_message_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) 
                      : ''}
                  </span>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-500 truncate w-3/4">{conv.last_message_content || 'Nova conversa'}</span>
                  {conv.unread_count > 0 && (
                    <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {conv.unread_count}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Inbox className="w-2 h-2"/> {inboxName}
                  </span>
                  {!conv.assigned_user_id && (
                    <span className="text-[9px] font-black uppercase tracking-wider text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">
                      Fila
                    </span>
                  )}
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
            <div className="h-16 px-4 bg-white border-b border-gray-200 flex items-center justify-between shadow-sm z-10">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setActiveView('LIST')}
                  className="md:hidden p-2 -ml-2 text-gray-500 hover:bg-gray-100 rounded-full"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                  <User className="w-5 h-5 text-gray-500" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 leading-tight">{selectedConversation.contact.name}</h3>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-gray-500">{selectedConversation.contact?.phone_number}</p>
                    <span className="text-[9px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">
                      {inboxes.find(i => i.id === selectedConversation.inbox_id)?.name || 'Sem Caixa'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setActiveView('SIDEBAR')}
                  className="md:hidden p-2 text-indigo-600 bg-indigo-50 rounded-xl"
                  title="Contexto Farmacêutico"
                >
                  <Info className="w-5 h-5" />
                </button>
                
                {selectedConversation.assigned_user_id ? (
                  <>
                    <button 
                      onClick={() => setIsTransferModalOpen(true)}
                      className="hidden md:block px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
                    >
                      Transferir
                    </button>
                    <button 
                      onClick={handleCloseConversation}
                      className="hidden md:flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg transition-colors"
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
              {messages.map((msg, index) => (
                <div key={`${msg.id || 'msg'}_${index}`} className={`flex ${msg.sender_type === 'CUSTOMER' ? 'justify-start' : 'justify-end'}`}>
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
                    <p className="text-sm">{msg.content}</p>
                    <span className="text-[10px] text-gray-500 block text-right mt-1">
                      {msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : ''}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            {selectedConversation.assigned_user_id ? (
              <div className="p-3 md:p-4 bg-gray-50 border-t border-gray-200 pb-safe">
                <div className="flex items-center gap-2 mb-2">
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
                <div className="flex items-end gap-2">
                  <div className="flex-1 bg-white rounded-xl border border-gray-300 shadow-sm flex items-end p-1 relative">
                    <button className="p-2 text-gray-400 hover:text-emerald-600 transition-colors">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <textarea 
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder={
                        otherUserViewing 
                        ? `Aguarde, ${otherUserViewing} está digitando...` 
                        : isPrivateNote ? "Nota interna..." : "Mensagem..."
                      }
                      disabled={!!otherUserViewing}
                      className={`flex-1 max-h-32 p-2 outline-none resize-none text-sm ${isPrivateNote ? 'bg-[#fffde7]' : 'bg-transparent'} ${otherUserViewing ? 'cursor-not-allowed opacity-50' : ''}`}
                      rows={1}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
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
                <div className="mt-2 inline-block px-2 py-1 bg-blue-50 text-blue-600 text-xs font-bold rounded-lg border border-blue-100">
                  Cliente VIP
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> Uso Contínuo
                </h3>
                <div className="bg-red-50 p-3 rounded-xl border border-red-100">
                  <p className="font-bold text-gray-800 text-sm">Losartana Potássica 50mg</p>
                  <p className="text-xs text-gray-600 mt-1">Última compra: há 28 dias</p>
                  <p className="text-xs font-bold text-red-600 mt-1">Previsão de término: Hoje!</p>
                  <button className="mt-2 w-full py-1.5 bg-white border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 transition-colors">
                    Oferecer Reposição
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-black text-xs uppercase tracking-widest text-gray-400 flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4" /> Últimos Pedidos
                </h3>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded-lg border border-transparent hover:border-gray-100 cursor-pointer transition-colors">
                    <div>
                      <p className="text-sm font-bold text-gray-700">Pedido #{1000 + i}</p>
                      <p className="text-[10px] text-gray-400">15/07/2026 - Finalizado</p>
                    </div>
                    <span className="text-sm font-bold text-emerald-600">R$ {45.50 * i}</span>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-gray-100">
                <button className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2">
                  <CreditCard className="w-4 h-4" /> Gerar Cobrança (Pix/Cartão)
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-center p-4">
              <p className="text-gray-400 text-sm">O contexto do cliente aparecerá aqui ao selecionar uma conversa.</p>
            </div>
          )}
        </div>
      </div>

      <WhatsAppConnectModal 
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        tenantId={tenantId}
      />

      <ChatTransferModal 
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        onTransfer={handleTransfer}
        tenantId={tenantId}
      />
    </div>
  );
};
