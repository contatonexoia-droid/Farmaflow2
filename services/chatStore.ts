import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { inboxStore } from "./inboxStore.js";
import { evolutionApiService } from "./evolutionApiService.js";
import { isWeblojaOrderMessage, isBotSentOrEcho, registerBotSentMessage, botSentMessageIds } from "./botHandoffManager.js";
import { realtimeHub } from "./realtimeHub.js";

function stringToUuid(str: string): string {
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-${(parseInt(hash.substring(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.substring(18, 20)}-${hash.substring(20, 32)}`;
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const isServerless = Boolean(process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_FILE = isServerless
  ? path.join("/tmp", "chat_data.json")
  : path.join(typeof __dirname !== "undefined" ? __dirname : process.cwd(), "chat_data.json");

export interface ChatContact {
  id: string;
  store_id: string;
  name: string;
  phone_number: string;
  avatar_url?: string;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  store_id: string;
  contact_id: string;
  inbox_id?: string | null;
  team_id?: string | null;
  assigned_user_id?: string | null;
  assigned_to?: string | null;
  is_human_controlled?: boolean;
  status: "OPEN" | "PENDING" | "finalizado" | "BOT" | string;
  kanban_stage?: "novos_triagem" | "ia_atendendo" | "aguardando_pagamento" | "em_atendimento" | "finalizado" | string;
  stage?: string;
  last_message_at: string;
  last_message_content: string;
  unread_count?: number;
  is_bot_active?: boolean;
  bot_interaction_count?: number;
  bot_handoff_reason?: string;
  bot_handoff_at?: string;
  contact?: ChatContact;
  labels?: ChatLabel[];
  created_at: string;
  updated_at?: string;
}

export interface ChatMessageReaction {
  emoji: string;
  sender?: "CUSTOMER" | "USER" | "SYSTEM" | string;
  fromMe?: boolean;
  created_at?: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_type: "CUSTOMER" | "USER" | "BOT" | "SYSTEM";
  sender_id?: string | null;
  content: string;
  is_private: boolean;
  media_url?: string;
  media_type?: string;
  mediaUrl?: string;
  mediaType?: string;
  type?: string;
  reaction?: string | null;
  reactions?: ChatMessageReaction[];
  remote_id?: string | null;
  message_ack?: string;
  created_at: string;
}

export interface ChatLabel {
  id: string;
  store_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ChatConversationLabel {
  conversation_id: string;
  label_id: string;
}

export interface CannedResponse {
  id: string;
  store_id: string;
  shortcut: string;
  text: string;
  created_at: string;
}

export const VALID_CHAT_MESSAGE_COLUMNS = new Set([
  "id",
  "conversation_id",
  "sender_type",
  "sender_id",
  "content",
  "media_url",
  "media_type",
  "is_private",
  "message_ack",
  "reaction",
  "reactions",
  "remote_id",
  "created_at"
]);

export function sanitizeChatMessagePayload(data: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (VALID_CHAT_MESSAGE_COLUMNS.has(key) && value !== undefined) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export const VALID_CHAT_CONVERSATION_COLUMNS = new Set([
  "id",
  "store_id",
  "contact_id",
  "assigned_user_id",
  "inbox_id",
  "status",
  "unread_count",
  "last_message_at",
  "created_at",
  "updated_at",
  "last_message_content",
  "last_welcome_sent_at",
  "kanban_stage",
  "stage",
  "is_bot_active",
  "is_human_controlled",
  "bot_interaction_count",
  "bot_handoff_reason",
  "bot_handoff_at"
]);

export function sanitizeChatConversationPayload(data: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (VALID_CHAT_CONVERSATION_COLUMNS.has(key) && value !== undefined) {
      sanitized[key] = value;
    }
  }

  // Se assigned_to foi passado mas assigned_user_id não, mapeia para a coluna correta do banco
  if (data.assigned_to !== undefined && sanitized.assigned_user_id === undefined) {
    sanitized.assigned_user_id = data.assigned_to;
  }

  return sanitized;
}

export function resolveConversationKanbanStage(conv: any): string {
  const raw = conv.kanban_stage || conv.stage;
  if (raw) {
    const s = String(raw).toLowerCase().trim();
    if (s === "novos_triagem" || s === "triagem" || s === "novos" || s === "novos_clientes" || s === "new" || s === "open") {
      return "novos_triagem";
    }
    if (s === "ia_atendendo" || s === "bot" || s === "ia" || s === "bot_atendendo") {
      return "ia_atendendo";
    }
    if (s === "em_atendimento" || s === "atendimento_humano" || s === "humano" || s === "human" || s === "human_takeover" || s === "balcao") {
      return "em_atendimento";
    }
    if (s === "aguardando_pagamento" || s === "pagamento" || s === "enviado_webloja" || s === "aguardando_resposta" || s === "store_redirect" || s === "waiting" || s === "pending") {
      return "aguardando_pagamento";
    }
    if (s === "saiu_entrega" || s === "delivery" || s === "em_separacao" || s === "separacao" || s === "rota" || s === "em_rota" || s === "enviado" || s === "saiu_para_entrega") {
      return "saiu_entrega";
    }
    if (s === "finalizado" || s === "concluido" || s === "concluida" || s === "finalizada" || s === "closed" || s === "encerrado" || s === "encerrada") {
      return "finalizado";
    }
    return s;
  }

  if (conv.status === "CLOSED" || conv.status === "finalizado" || conv.status === "concluido" || conv.status === "encerrado") {
    return "finalizado";
  }
  if (conv.status === "PENDING" || conv.status === "WAITING" || conv.status === "aguardando_pagamento" || conv.bot_handoff_reason === "STORE_REDIRECT") {
    return "aguardando_pagamento";
  }
  if (conv.status === "saiu_entrega" || conv.status === "delivery" || conv.status === "em_separacao") {
    return "saiu_entrega";
  }

  if (conv.is_bot_active === true || conv.status === "bot" || conv.status === "BOT" || conv.status === "ia_atendendo") {
    return "ia_atendendo";
  }

  const isHumanControlled = 
    conv.is_human_controlled === true ||
    Boolean(conv.assigned_user_id) ||
    Boolean(conv.assigned_to) ||
    conv.status === "human_takeover" ||
    conv.status === "HUMAN" ||
    conv.status === "em_atendimento";

  if (isHumanControlled) {
    return "em_atendimento";
  }

  return "novos_triagem";
}

class ChatStore {
  private contacts: ChatContact[] = [];
  private conversations: ChatConversation[] = [];
  private messages: ChatMessage[] = [];
  private labels: ChatLabel[] = [];
  private conversation_labels: ChatConversationLabel[] = [];
  private canned_responses: CannedResponse[] = [];

  constructor() {
    this.loadFromFile();
    this.ensureDefaultData();
  }

  private loadFromFile() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        this.contacts = parsed.contacts || [];
        this.conversations = parsed.conversations || [];
        this.messages = parsed.messages || [];
        this.labels = parsed.labels || [];
        this.conversation_labels = parsed.conversation_labels || [];
        this.canned_responses = parsed.canned_responses || [];
      }
    } catch (err) {
      console.warn("[ChatStore] Could not load local chat_data.json:", err);
    }
  }

  private saveToFile() {
    try {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          {
            contacts: this.contacts,
            conversations: this.conversations,
            messages: this.messages,
            labels: this.labels,
            conversation_labels: this.conversation_labels,
            canned_responses: this.canned_responses,
          },
          null,
          2
        ),
        "utf-8"
      );
    } catch (err) {
      console.warn("[ChatStore] Could not save local chat_data.json:", err);
    }
  }

  private ensureDefaultData() {
    // Add default labels if empty
    if (this.labels.length === 0) {
      this.labels = [
        { id: "lbl_demo_1", store_id: "default", name: "Dúvida", color: "#3B82F6", created_at: new Date().toISOString() },
        { id: "lbl_demo_2", store_id: "default", name: "Orçamento", color: "#F59E0B", created_at: new Date().toISOString() },
        { id: "lbl_demo_3", store_id: "default", name: "Urgente", color: "#EF4444", created_at: new Date().toISOString() },
        { id: "lbl_demo_4", store_id: "default", name: "Finalizado", color: "#10B981", created_at: new Date().toISOString() },
      ];
    }

    // Add default canned responses if empty
    if (this.canned_responses.length === 0) {
      this.canned_responses = [
        {
          id: "canned_demo_1",
          store_id: "default",
          shortcut: "pix",
          text: "Olá! Segue nossa chave PIX para pagamento: CNPJ 12.345.678/0001-90 (FarmaFlow S.A.). Por favor, envie o comprovante por aqui.",
          created_at: new Date().toISOString()
        },
        {
          id: "canned_demo_2",
          store_id: "default",
          shortcut: "entrega",
          text: "Olá! Nossas entregas saem em três períodos: manhã (9h às 11h), tarde (14h às 16h) e noite (18h às 20h). O prazo médio de entrega na sua região é de até 2 horas.",
          created_at: new Date().toISOString()
        },
        {
          id: "canned_demo_3",
          store_id: "default",
          shortcut: "cadastro",
          text: "Para realizar o seu cadastro e agilizar o seu atendimento, por favor envie: Nome Completo, CPF, Endereço de Entrega com CEP e Convênio (se houver).",
          created_at: new Date().toISOString()
        }
      ];
    }

    if (this.conversations.length === 0) {
      const defaultContact: ChatContact = {
        id: "contact_demo_1",
        store_id: "default",
        name: "Cliente Demonstração",
        phone_number: "5511999998888",
        created_at: new Date().toISOString()
      };
      const defaultConv: ChatConversation = {
        id: "conv_demo_1",
        store_id: "default",
        contact_id: defaultContact.id,
        inbox_id: "inbox_default_default",
        assigned_user_id: null,
        status: "OPEN",
        last_message_at: new Date().toISOString(),
        last_message_content: "Olá, gostaria de consultar a disponibilidade de medicamentos.",
        unread_count: 1,
        contact: defaultContact,
        created_at: new Date().toISOString()
      };
      const defaultMsg1: ChatMessage = {
        id: "msg_demo_1",
        conversation_id: defaultConv.id,
        sender_type: "CUSTOMER",
        content: "Olá, gostaria de consultar a disponibilidade de medicamentos.",
        is_private: false,
        created_at: new Date(Date.now() - 3600000).toISOString()
      };
      const defaultMsg2: ChatMessage = {
        id: "msg_demo_2",
        conversation_id: defaultConv.id,
        sender_type: "BOT",
        content: "Olá! Sou o assistente da farmácia. Em que posso ajudar hoje?",
        is_private: false,
        created_at: new Date(Date.now() - 3500000).toISOString()
      };

      this.contacts.push(defaultContact);
      this.conversations.push(defaultConv);
      this.messages.push(defaultMsg1, defaultMsg2);
      
      // Associate demo label with demo conversation
      this.conversation_labels.push({
        conversation_id: "conv_demo_1",
        label_id: "lbl_demo_2" // Orçamento
      });
    }
    this.saveToFile();
  }

  public async getConversations(storeId: string, inboxId?: string, allowedInboxIds?: string[]): Promise<ChatConversation[]> {
    try {
      let query = supabaseAdmin
        .from("chat_conversations")
        .select("*, contact:chat_contacts(*)")
        .eq("store_id", storeId)
        .order("last_message_at", { ascending: false });

      if (inboxId && inboxId !== "all") {
        query = query.eq("inbox_id", inboxId);
      }

      if (allowedInboxIds !== undefined) {
        if (allowedInboxIds.length > 0) {
          query = query.in("inbox_id", allowedInboxIds);
        } else {
          return [];
        }
      }

      const { data, error } = await query;
      if (!error && data) {
        const conversations = data as any[];
        for (const conv of conversations) {
          const resolvedStage = resolveConversationKanbanStage(conv);
          conv.kanban_stage = resolvedStage;
          conv.stage = resolvedStage;

          if (resolvedStage === "ia_atendendo") {
            // Preservação estrita do estágio de IA: mantém bot ativo
            conv.is_human_controlled = false;
            conv.is_bot_active = true;
            conv.assigned_user_id = null;
            conv.assigned_to = null;
            if (!conv.status || conv.status === "OPEN" || conv.status === "human_takeover") {
              conv.status = "bot";
            }
          } else {
            const isHumanControlled = 
              conv.is_human_controlled === true ||
              Boolean(conv.assigned_user_id) ||
              Boolean(conv.assigned_to) ||
              conv.status === "human_takeover" ||
              conv.status === "em_atendimento" ||
              resolvedStage === "em_atendimento";

            if (isHumanControlled) {
              conv.is_human_controlled = true;
              conv.is_bot_active = false;
              if (conv.status === "bot" || conv.status === "BOT" || !conv.status) {
                conv.status = "human_takeover";
              }
            } else if (resolvedStage === "finalizado") {
              conv.is_bot_active = false;
              conv.status = "CLOSED";
            } else if (resolvedStage === "aguardando_pagamento") {
              if (!conv.status) conv.status = "PENDING";
            } else if (resolvedStage === "saiu_entrega") {
              conv.is_bot_active = false;
              if (!conv.status) conv.status = "OPEN";
            } else if (resolvedStage === "novos_triagem") {
              conv.is_bot_active = false;
              conv.is_human_controlled = false;
              if (!conv.status) conv.status = "OPEN";
            }
          }

          conv.labels = await this.getConversationLabels(conv.id);
        }
        return conversations;
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase conversations query fallback:", err);
    }

    // Memory Fallback
    const filtered = this.conversations.filter(c => {
      const matchStore = c.store_id === storeId;
      if (!matchStore) return false;
      if (inboxId && inboxId !== "all" && c.inbox_id !== inboxId) return false;
      if (allowedInboxIds !== undefined && c.inbox_id && !allowedInboxIds.includes(c.inbox_id)) return false;
      return true;
    });

    for (const conv of filtered) {
      // populate contact from this.contacts if missing
      if (!conv.contact && conv.contact_id) {
        conv.contact = this.contacts.find(c => c.id === conv.contact_id);
      }
      const resolvedStage = resolveConversationKanbanStage(conv);
      conv.kanban_stage = resolvedStage;
      conv.stage = resolvedStage;

      if (resolvedStage === "ia_atendendo") {
        conv.is_human_controlled = false;
        conv.is_bot_active = true;
        conv.assigned_user_id = null;
        conv.assigned_to = null;
        if (!conv.status || conv.status === "OPEN" || conv.status === "human_takeover") {
          conv.status = "bot";
        }
      } else {
        const isHumanControlled = 
          conv.is_human_controlled === true ||
          Boolean(conv.assigned_user_id) ||
          Boolean(conv.assigned_to) ||
          conv.status === "human_takeover" ||
          conv.status === "em_atendimento" ||
          resolvedStage === "em_atendimento";

        if (isHumanControlled) {
          conv.is_human_controlled = true;
          conv.is_bot_active = false;
          if (conv.status === "bot" || conv.status === "BOT" || !conv.status) {
            conv.status = "human_takeover";
          }
        } else if (resolvedStage === "finalizado") {
          conv.is_bot_active = false;
          conv.status = "CLOSED";
        } else if (resolvedStage === "aguardando_pagamento") {
          if (!conv.status) conv.status = "PENDING";
        } else if (resolvedStage === "saiu_entrega") {
          conv.is_bot_active = false;
          if (!conv.status) conv.status = "OPEN";
        } else if (resolvedStage === "novos_triagem") {
          conv.is_bot_active = false;
          conv.is_human_controlled = false;
          if (!conv.status) conv.status = "OPEN";
        }
      }

      conv.labels = await this.getConversationLabels(conv.id);
    }
    return filtered;
  }

  public async getMessages(conversationId: string): Promise<ChatMessage[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (!error && data) {
        return data.map((row: any) => {
          const mediaUrl = row.media_url || row.mediaUrl;
          const mediaType = row.media_type || row.mediaType || row.type || (mediaUrl ? (mediaUrl.startsWith("data:audio") || /\.(ogg|oga|opus|mp3|wav|m4a)/i.test(mediaUrl) ? "audio" : "image") : "text");
          let parsedReactions = row.reactions;
          if (typeof parsedReactions === "string") {
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
            reactions: parsedReactions,
            remote_id: row.remote_id || null,
            media_url: mediaUrl,
            mediaUrl: mediaUrl,
            media_type: mediaType,
            mediaType: mediaType,
            type: mediaType
          };
        });
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase messages query fallback:", err);
    }

    // Memory Fallback
    const localMsgs = this.messages.filter(m => m.conversation_id === conversationId);
    return [...localMsgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  public async addMessage(
    storeId: string,
    conversationId: string,
    senderType: "CUSTOMER" | "USER" | "BOT" | "SYSTEM",
    content: string,
    isPrivate = false,
    mediaUrlOrInstanceName?: string,
    mediaType?: string,
    explicitInstanceName?: string,
    skipWhatsAppDispatch = false
  ): Promise<{ message: ChatMessage; conversation: ChatConversation }> {
    const now = new Date().toISOString();
    const msgUuid = crypto.randomUUID();

    let actualMediaUrl: string | undefined = undefined;
    let actualInstanceName: string | undefined = explicitInstanceName;

    if (mediaUrlOrInstanceName) {
      if (
        mediaUrlOrInstanceName.startsWith("http://") ||
        mediaUrlOrInstanceName.startsWith("https://") ||
        mediaUrlOrInstanceName.startsWith("data:") ||
        mediaUrlOrInstanceName.startsWith("/storage") ||
        mediaUrlOrInstanceName.startsWith("blob:")
      ) {
        actualMediaUrl = mediaUrlOrInstanceName;
      } else if (!actualInstanceName) {
        actualInstanceName = mediaUrlOrInstanceName;
      }
    }

    const resolvedType = mediaType || (actualMediaUrl ? (actualMediaUrl.startsWith("data:audio") || /\.(ogg|oga|opus|mp3|wav|m4a)/i.test(actualMediaUrl) ? "audio" : "image") : "text");

    const newMsg: ChatMessage = {
      id: msgUuid,
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      is_private: isPrivate,
      media_url: actualMediaUrl,
      media_type: resolvedType,
      mediaUrl: actualMediaUrl,
      mediaType: resolvedType,
      type: resolvedType,
      created_at: now
    };

    if (senderType === "BOT") {
      registerBotSentMessage(msgUuid, conversationId);
    }

    // Evolution API Dispatch (for USER/BOT messages, if not private and not already dispatched)
    if ((senderType === "USER" || senderType === "BOT") && !isPrivate && !skipWhatsAppDispatch) {
      try {
        let phoneToSend: string | null = null;
        try {
          const { data: convData } = await supabaseAdmin
            .from("chat_conversations")
            .select("contact_id")
            .eq("id", conversationId)
            .maybeSingle();

          if (convData?.contact_id) {
            const { data: contactData } = await supabaseAdmin
              .from("chat_contacts")
              .select("phone_number")
              .eq("id", convData.contact_id)
              .maybeSingle();
            if (contactData?.phone_number) phoneToSend = contactData.phone_number;
          }
        } catch (_) {}

        if (!phoneToSend) {
          const match = conversationId.match(/_(\d{10,15})_/);
          if (match) phoneToSend = match[1];
        }

        const targetInstance = await evolutionApiService.resolveInstanceName(storeId, actualInstanceName);

        if (targetInstance && phoneToSend) {
          evolutionApiService.sendTextMessage(targetInstance, phoneToSend, content, {
            delay: 1000,
            linkPreview: true
          }).catch(err => {
            console.error(`[ChatStore] [ERRO EVOLUTION] Falha assíncrona ao despachar para WhatsApp:`, err.message || err);
          });
        } else {
          console.warn("[ChatStore] [AVISO EVOLUTION] Instância ou telefone não localizados para envio:", {
            targetInstance,
            phoneToSend,
            conversationId
          });
        }
      } catch (evoErr: any) {
        console.error("[ChatStore] [ERRO EVOLUTION] Exceção preparando envio para WhatsApp:", evoErr.message || evoErr);
      }
    }

    // Try Supabase insert
    try {
      const { error } = await supabaseAdmin.from("chat_messages").insert([{
        id: msgUuid,
        conversation_id: conversationId,
        sender_type: senderType,
        content,
        is_private: isPrivate,
        media_url: actualMediaUrl,
        media_type: mediaType,
        created_at: now
      }]);

      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao inserir mensagem no addMessage', error.message, error);
      }

      const convUpdates: any = {
        last_message_at: now,
        last_message_content: content
      };

      // Se um operador humano enviou mensagem manual externa, assumir controle da conversa atomicamente
      if (senderType === "USER" && !isPrivate) {
        convUpdates.is_human_controlled = true;
        convUpdates.is_bot_active = false;
        convUpdates.status = "human_takeover";
        convUpdates.kanban_stage = "em_atendimento";
        convUpdates.bot_handoff_reason = "HUMAN_OPERATOR_MESSAGE";
        convUpdates.bot_handoff_at = now;
      }

      const sanitizedConvUpdates = sanitizeChatConversationPayload(convUpdates);
      const { error: convErr } = await supabaseAdmin.from("chat_conversations").update(sanitizedConvUpdates).eq("id", conversationId);

      if (convErr) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao atualizar conversa no addMessage', convErr.message, convErr);
      }
    } catch (err: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao adicionar mensagem', err.message, err.stack);
    }

    // Local fallback update
    this.messages.push(newMsg);

    let convIndex = this.conversations.findIndex(c => c.id === conversationId);
    if (convIndex < 0) {
      const defaultContactId = stringToUuid(`contact_${Date.now()}_${storeId}`);
      const defaultInboxId = stringToUuid(`inbox_default_${storeId}`);
      const defaultContact: ChatContact = {
        id: defaultContactId,
        store_id: storeId,
        name: "Contato WhatsApp",
        phone_number: "WhatsApp",
        created_at: now
      };
      const newConv: ChatConversation = {
        id: conversationId,
        store_id: storeId,
        contact_id: defaultContact.id,
        inbox_id: defaultInboxId,
        status: senderType === "USER" && !isPrivate ? "human_takeover" : "OPEN",
        is_human_controlled: senderType === "USER" && !isPrivate ? true : false,
        is_bot_active: senderType === "USER" && !isPrivate ? false : true,
        kanban_stage: senderType === "USER" && !isPrivate ? "em_atendimento" : "novos_triagem",
        last_message_at: now,
        last_message_content: content,
        contact: defaultContact,
        created_at: now
      };
      this.contacts.push(defaultContact);
      this.conversations.push(newConv);
      convIndex = this.conversations.length - 1;
    } else {
      const prevConv = this.conversations[convIndex];
      const isHuman = (senderType === "USER" && !isPrivate) ? true : prevConv.is_human_controlled;
      this.conversations[convIndex] = {
        ...prevConv,
        last_message_at: now,
        last_message_content: content,
        ...(senderType === "USER" && !isPrivate ? {
          is_human_controlled: true,
          is_bot_active: false,
          status: "human_takeover",
          kanban_stage: "em_atendimento",
          bot_handoff_reason: "HUMAN_OPERATOR_MESSAGE",
          bot_handoff_at: now
        } : {})
      };
    }

    this.saveToFile();
    return { message: newMsg, conversation: this.conversations[convIndex] };
  }

  public async processWhatsAppMessage(storeId: string, msg: any, instanceName?: string): Promise<{ conversation: ChatConversation; message: ChatMessage } | null> {
    if (!msg) return null;

    const cleanStoreId = typeof storeId === 'string' ? storeId.trim().replace(/^store_/, '') : (storeId || 'default');

    // Robust extraction for Evolution API and other providers
    let fromMe = Boolean(msg.key?.fromMe ?? msg.fromMe ?? false);
    const remoteJid = msg.key?.remoteJid || msg.remoteJid || msg.sender || msg.participant || "";
    
    if (!remoteJid || remoteJid.includes("@g.us") || remoteJid === "status@broadcast") {
       if (!remoteJid) console.error('[WEBHOOK EXTRACT ERROR] No remoteJid found in message:', JSON.stringify(msg, null, 2));
       return null;
    }

    // Evolution API multi-device format often includes a colon, e.g., 5511988887777:2@s.whatsapp.net
    let phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    if (phone.includes(":")) {
      phone = phone.split(":")[0];
    }
    // Garante que a string do telefone só contenha números
    phone = phone.replace(/\D/g, "");

    const pushName = msg.pushName || msg.verifiedName || phone || "Contato WhatsApp";
    
    // Extração estruturada de Mídia e Texto (Evolution API v2)
    const rawMsg = msg.message || msg.data?.message || msg.data || {};

    // 0. Detecção imediata de Mensagem de Reação (WhatsApp Reaction Message)
    const isReactionMessage = Boolean(
      rawMsg.reactionMessage || 
      msg.messageType === "reactionMessage" || 
      msg.type === "reaction" || 
      msg.reaction || 
      rawMsg.reaction
    );
    if (isReactionMessage) {
      console.log(`[ChatStore] Mensagem identificada como ReactionMessage. Delegando para processMessageReaction...`);
      const reactionResult = await this.processMessageReaction(cleanStoreId, msg, instanceName);
      if (reactionResult?.message && reactionResult.conversationId) {
        const conv = this.conversations.find(c => c.id === reactionResult.conversationId) || {
          id: reactionResult.conversationId,
          store_id: cleanStoreId,
          contact_id: "",
          status: "OPEN",
          last_message_at: new Date().toISOString(),
          last_message_content: `[Reação: ${reactionResult.message.reaction || ''}]`,
          created_at: new Date().toISOString()
        };
        return { conversation: conv as ChatConversation, message: reactionResult.message };
      }
      return null;
    }

    let extractedMediaType = "text";
    let extractedMediaUrl: string | undefined = undefined;
    let text = "";

    // Helper para verificar se a URL é consumível diretamente pelo navegador sem headers/criptografia
    const isValidDirectMedia = (urlStr?: string) => {
      if (!urlStr || typeof urlStr !== 'string') return false;
      if (urlStr.startsWith('data:image/') || urlStr.startsWith('data:audio/') || urlStr.startsWith('data:video/') || urlStr.startsWith('data:application/')) return true;
      // URLs externas públicas acessíveis diretamente (ex: Supabase Storage, S3, Cloudinary)
      if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
        const isInternalWhatsApp = urlStr.includes('whatsapp.net') || urlStr.includes('whatsapp.com') || urlStr.includes('localhost') || urlStr.includes('127.0.0.1');
        return !isInternalWhatsApp;
      }
      return false;
    };

    if (rawMsg.imageMessage || msg.messageType === "imageMessage" || msg.type === "image") {
      extractedMediaType = "image";
      const img = rawMsg.imageMessage || {};
      text = img.caption || msg.caption || msg.text || msg.body || "[Imagem]";
      
      const rawMedia = img.base64 || msg.base64 || img.url || img.mediaUrl || msg.mediaUrl || msg.url || "";
      if (rawMedia && typeof rawMedia === "string") {
        if (rawMedia.startsWith("data:image/")) {
          extractedMediaUrl = rawMedia;
        } else if (!rawMedia.startsWith("http") && rawMedia.length > 50) {
          const mime = img.mimetype || "image/jpeg";
          extractedMediaUrl = `data:${mime};base64,${rawMedia.replace(/\s/g, '')}`;
        } else if (isValidDirectMedia(rawMedia)) {
          extractedMediaUrl = rawMedia;
        }
      }
    } else if (rawMsg.audioMessage || msg.messageType === "audioMessage" || msg.type === "audio") {
      extractedMediaType = "audio";
      const aud = rawMsg.audioMessage || {};
      text = "[Áudio]";
      
      const rawMedia = aud.base64 || msg.base64 || aud.url || aud.mediaUrl || msg.mediaUrl || msg.url || "";
      if (rawMedia && typeof rawMedia === "string") {
        if (rawMedia.startsWith("data:audio/")) {
          extractedMediaUrl = rawMedia;
        } else if (!rawMedia.startsWith("http") && rawMedia.length > 50) {
          const mime = aud.mimetype || "audio/ogg; codecs=opus";
          extractedMediaUrl = `data:${mime};base64,${rawMedia.replace(/\s/g, '')}`;
        } else if (isValidDirectMedia(rawMedia)) {
          extractedMediaUrl = rawMedia;
        }
      }
    } else if (rawMsg.videoMessage || msg.messageType === "videoMessage" || msg.type === "video") {
      extractedMediaType = "video";
      const vid = rawMsg.videoMessage || {};
      text = vid.caption || "[Vídeo]";
      const rawMedia = vid.base64 || msg.base64 || vid.url || vid.mediaUrl || msg.mediaUrl || "";
      if (rawMedia && typeof rawMedia === "string") {
        if (rawMedia.startsWith("data:video/")) {
          extractedMediaUrl = rawMedia;
        } else if (!rawMedia.startsWith("http") && rawMedia.length > 50) {
          const mime = vid.mimetype || "video/mp4";
          extractedMediaUrl = `data:${mime};base64,${rawMedia.replace(/\s/g, '')}`;
        } else if (isValidDirectMedia(rawMedia)) {
          extractedMediaUrl = rawMedia;
        }
      }
    } else if (rawMsg.documentMessage || msg.messageType === "documentMessage" || msg.type === "document") {
      extractedMediaType = "document";
      const doc = rawMsg.documentMessage || {};
      text = doc.fileName || doc.title || "[Documento]";
      const rawMedia = doc.base64 || msg.base64 || doc.url || doc.mediaUrl || msg.mediaUrl || "";
      if (rawMedia && typeof rawMedia === "string") {
        if (rawMedia.startsWith("data:application/")) {
          extractedMediaUrl = rawMedia;
        } else if (!rawMedia.startsWith("http") && rawMedia.length > 50) {
          const mime = doc.mimetype || "application/pdf";
          extractedMediaUrl = `data:${mime};base64,${rawMedia.replace(/\s/g, '')}`;
        } else if (isValidDirectMedia(rawMedia)) {
          extractedMediaUrl = rawMedia;
        }
      }
    } else if (rawMsg.stickerMessage || msg.messageType === "stickerMessage" || msg.type === "sticker") {
      extractedMediaType = "sticker";
      const stk = rawMsg.stickerMessage || {};
      text = "[Figurinha]";
      const rawMedia = stk.base64 || msg.base64 || stk.url || stk.mediaUrl || msg.mediaUrl || "";
      if (rawMedia && typeof rawMedia === "string") {
        if (rawMedia.startsWith("data:image/")) {
          extractedMediaUrl = rawMedia;
        } else if (!rawMedia.startsWith("http") && rawMedia.length > 50) {
          const mime = stk.mimetype || "image/webp";
          extractedMediaUrl = `data:${mime};base64,${rawMedia.replace(/\s/g, '')}`;
        } else if (isValidDirectMedia(rawMedia)) {
          extractedMediaUrl = rawMedia;
        }
      }
    } else {
      extractedMediaType = "text";
      text = rawMsg.conversation || 
             rawMsg.extendedTextMessage?.text || 
             msg.text || 
             msg.body || 
             "[Mensagem WhatsApp]";
    }

    // Robust self-message / owner-message check to avoid contact name pollution
    let instancePhoneNumber = "";
    let instanceNameFromDb = "";
    try {
      // Find instance to get its phone number and check if message was sent by the owner/instance
      const query = supabaseAdmin.from("whatsapp_instances").select("phone_number, instance_name");
      if (instanceName) {
        query.eq("instance_name", instanceName);
      } else {
        query.or(`store_id.eq.${cleanStoreId},store_id.eq.${storeId}`);
      }
      const { data: inst } = await query.limit(1).maybeSingle();
      if (inst) {
        instancePhoneNumber = inst.phone_number ? inst.phone_number.replace(/\D/g, "") : "";
        instanceNameFromDb = inst.instance_name || "";
      }
    } catch (e: any) {
      console.warn("Error fetching whatsapp_instance for fromMe check:", e.message);
    }

    // Apenas considera fromMe se o WhatsApp marcou key.fromMe = true ou se o telefone emissor for o próprio número da instância
    if (instancePhoneNumber && phone && phone === instancePhoneNumber) {
      fromMe = true;
    }

    console.log('[PAYLOAD EXTRAÍDO COM SUCESSO]:', { phone, pushName, text: typeof text === 'string' ? text.slice(0, 60) : '', fromMe, instanceName });

    const now = new Date().toISOString();

    // Deterministic valid UUIDs for Supabase PK/FK compliance
    const contactId = stringToUuid(`contact_${phone}_${cleanStoreId}`);
    const convId = stringToUuid(`conv_${phone}_${cleanStoreId}`);
    const rawMsgKey = msg.key?.id || `${Date.now()}`;
    const msgId = /^[0-9a-f-]{36}$/i.test(rawMsgKey) ? rawMsgKey : stringToUuid(`msg_${rawMsgKey}_${convId}`);

    // 1. Busca ou criação do contato (chat_contacts)
    let finalContactName = pushName;
    try {
      const { data: existingContact } = await supabaseAdmin
        .from("chat_contacts")
        .select("name")
        .eq("id", contactId)
        .maybeSingle();

      if (existingContact) {
        // Se for uma mensagem enviada por mim ou não tiver pushName novo útil, mantenha o nome existente.
        if (fromMe || !msg.pushName) {
          finalContactName = existingContact.name;
        } else {
          finalContactName = pushName;
          await supabaseAdmin.from("chat_contacts").update({
            name: finalContactName,
          }).eq("id", contactId);
        }
      } else {
        if (fromMe) {
          finalContactName = phone; // Fallback se o próprio usuário iniciou a conversa
        }
        await supabaseAdmin.from("chat_contacts").insert([{
          id: contactId,
          store_id: cleanStoreId,
          phone_number: phone,
          name: finalContactName,
          created_at: now
        }]);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao buscar ou criar contato (chat_contacts)', error.message, error.stack);
    }
    
    const contact: ChatContact = {
      id: contactId,
      store_id: cleanStoreId,
      name: finalContactName,
      phone_number: phone,
      created_at: now
    };

    // 2. Obtenção do inbox_id e estado atual da conversa
    let resolvedInboxId: string | null = null;
    let convInfo: any = null;

    try {
      const { data, error } = await supabaseAdmin
        .from("chat_conversations")
        .select("*, contact:chat_contacts(*)")
        .eq("id", convId)
        .maybeSingle();
      
      if (error && error.code !== 'PGRST116') {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao consultar conversa existente', error.message, error);
      } else {
        convInfo = data;
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao buscar dados da conversa', error.message, error.stack);
    }

    // 1. Determina a caixa de entrada (inbox_id) baseada prioritariamente na instância do WhatsApp que recebeu a mensagem
    if (instanceName) {
      try {
        const { data: inst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id, instance_name")
          .eq("instance_name", instanceName)
          .maybeSingle();
          
        if (inst) {
          const { data: inbox } = await supabaseAdmin
            .from("inboxes")
            .select("id")
            .or(`whatsapp_instance_id.eq.${inst.id},whatsapp_instance_id.eq.${inst.instance_name}`)
            .maybeSingle();
            
          if (inbox?.id) {
            resolvedInboxId = inbox.id;
            console.log(`[ChatStore] Mensagem recebida na instância ${instanceName} vinculada à caixa ${resolvedInboxId}`);
          }
        }

        if (!resolvedInboxId) {
          // Fallback em memória/arquivo para inboxes
          const inboxes = await inboxStore.getInboxes(storeId);
          const matched = inboxes.find(i => 
            i.whatsapp_instance_id === instanceName || 
            (inst?.id && i.whatsapp_instance_id === inst.id) ||
            i.id.toLowerCase().includes(instanceName.replace(/^inbox_/, '').toLowerCase())
          );
          if (matched) {
            resolvedInboxId = matched.id;
          }
        }
      } catch (routingErr: any) {
        console.warn("[ChatStore] Erro ao rotear mensagem por instanceName:", routingErr.message);
      }
    }

    if (!resolvedInboxId && convInfo?.inbox_id) {
      resolvedInboxId = convInfo.inbox_id;
    }

    if (!resolvedInboxId) {
       try {
         const { data: firstInbox, error: fetchInboxError } = await supabaseAdmin
           .from("inboxes")
           .select("id")
           .eq("store_id", storeId)
           .order("created_at", { ascending: true })
           .limit(1)
           .maybeSingle();
           
         if (fetchInboxError && fetchInboxError.code !== 'PGRST116') {
           console.error('[ERRO CRITICO NO BACKGROUND]: Erro na obtenção do inbox_id da loja', fetchInboxError.message, fetchInboxError);
         }
           
         if (firstInbox?.id) {
           resolvedInboxId = firstInbox.id;
         } else {
           // Cria caixa de entrada padrão se nenhuma existir
           const defaultInboxId = stringToUuid(`inbox_default_${storeId}`);
           const { error: insertInboxError } = await supabaseAdmin.from("inboxes").upsert([{
             id: defaultInboxId,
             store_id: storeId,
             name: "Caixa de Entrada Principal"
           }], { onConflict: "id" });
           
           if (insertInboxError) {
             console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao criar caixa de entrada padrão (inbox_id)', insertInboxError.message, insertInboxError);
           } else {
             resolvedInboxId = defaultInboxId;
           }
         }
       } catch (error: any) {
         console.error('[ERRO CRITICO NO BACKGROUND]: Exceção na obtenção do inbox_id', error.message, error.stack);
       }
    }

    const currentUnreadCount = convInfo?.unread_count || 0;
    const newUnreadCount = fromMe ? 0 : currentUnreadCount + 1;

    // 0. BLINDAGEM ANTI-ECO: Verifica se a mensagem atual que chegou com fromMe já foi enviada pelo BOT/Sistema
    // ou se é eco de webhook da Evolution API para balões de resposta, links e saudações
    let isBotEcho = false;
    if (fromMe) {
      const isRegisteredId = (rawMsgKey && botSentMessageIds.has(rawMsgKey)) || 
                             (msg.key?.id && botSentMessageIds.has(msg.key.id));
      if (isRegisteredId || isBotSentOrEcho(rawMsgKey, text, convId, phone) || isBotSentOrEcho(msg.key?.id, text, convId, phone)) {
        isBotEcho = true;
      } else {
        try {
          const { data: existingBotMsg } = await supabaseAdmin
            .from("chat_messages")
            .select("id, sender_type")
            .or(`id.eq.${msgId},remote_id.eq.${rawMsgKey}`)
            .eq("conversation_id", convId)
            .maybeSingle();

          if (existingBotMsg && (existingBotMsg.sender_type === "BOT" || existingBotMsg.sender_type === "SYSTEM")) {
            isBotEcho = true;
          }
        } catch (_) {}
      }

      if (isBotEcho) {
        console.log(`[ChatStore] 🤖 [BLINDAGEM ANTI-ECO] Mensagem fromMe identificada como eco de resposta do BOT (não é atendente humano): "${typeof text === 'string' ? text.slice(0, 50) : ''}"`);
      }
    }

    // 1. PRESERVAÇÃO E REABERTURA DE ESTÁGIO:
    // Verifica se a conversa anterior existia e estava finalizada/fechada.
    const isPreviouslyClosed = Boolean(convInfo && (
      convInfo.status === 'CLOSED' || 
      convInfo.status === 'closed' || 
      convInfo.status === 'finalizado' || 
      convInfo.status === 'finalizada' || 
      convInfo.status === 'RESOLVED' || 
      convInfo.status === 'resolved' ||
      convInfo.kanban_stage === 'finalizado' || 
      convInfo.kanban_stage === 'finalizada' || 
      convInfo.kanban_stage === 'fechado' || 
      convInfo.kanban_stage === 'resolvido' ||
      convInfo.stage === 'finalizado' ||
      convInfo.stage === 'finalizada'
    ));

    // Se a última mensagem foi há mais de 2 horas ou saudação nova, consideramos uma nova sessão de atendimento da IA
    const lastMsgTime = convInfo?.last_message_at ? new Date(convInfo.last_message_at).getTime() : 0;
    const isNewSessionAfterInactivity = !fromMe && lastMsgTime > 0 && (Date.now() - lastMsgTime > 2 * 60 * 60 * 1000);

    let finalStage = convInfo ? (convInfo.kanban_stage || convInfo.stage || resolveConversationKanbanStage(convInfo)) : (fromMe ? (isBotEcho ? "ia_atendendo" : "em_atendimento") : "ia_atendendo");
    let isBotActive = convInfo ? (convInfo.is_bot_active ?? (finalStage === "ia_atendendo")) : (!fromMe || isBotEcho);
    let isHuman = convInfo ? (convInfo.is_human_controlled ?? (finalStage === "em_atendimento" || Boolean(convInfo.assigned_user_id))) : (fromMe && !isBotEcho);
    let finalStatus = convInfo ? (convInfo.status || (isBotActive ? "bot" : (isHuman ? "human_takeover" : "OPEN"))) : (fromMe && !isBotEcho ? "human_takeover" : "bot");

    if (fromMe && isBotEcho) {
      isHuman = false;
      isBotActive = true;
      finalStage = "ia_atendendo";
      finalStatus = "bot";
    }

    // 2. DETECÇÃO AUTOMÁTICA DE PEDIDO DA WEBLOJA / LOJA ONLINE
    const orderCheck = !fromMe ? isWeblojaOrderMessage(text) : { isOrder: false };
    let isWeblojaOrder = Boolean(orderCheck.isOrder);

    if (isWeblojaOrder) {
      console.log(`[ChatStore] 🛒 [PEDIDO WEBLOJA DETECTADO] Mensagem recebida de ${remoteJid} é um pedido finalizado da Loja Online FarmaFlow (Pedido: ${orderCheck.orderId || 'N/A'}). Movendo automaticamente para "saiu_entrega" (Em Separação / Delivery) e desativando a IA.`);
      finalStage = "saiu_entrega";
      finalStatus = "em_separacao";
      isBotActive = false;
      isHuman = true;
    }

    // Reabertura Automática de Conversas Finalizadas quando o cliente envia nova mensagem (se não for pedido da webloja)
    let wasReopened = false;
    if (!fromMe && isPreviouslyClosed && !isWeblojaOrder) {
      console.log(`[ChatStore] 🔄 [REABERTURA AUTOMÁTICA] Conversa ${convId} estava finalizada. Reabrindo ticket para "novos_triagem" no Kanban.`);
      wasReopened = true;
      finalStage = "novos_triagem";
      finalStatus = "OPEN";
      isBotActive = true;
      isHuman = false;
    }

    if (fromMe && isBotEcho) {
      // Se for eco do próprio BOT, NUNCA pausar nem mudar para humano!
      isHuman = false;
      isBotActive = true;
      finalStage = convInfo?.kanban_stage || convInfo?.stage || "ia_atendendo";
      finalStatus = convInfo?.status || "bot";
    } else if (fromMe && !isBotEcho && (!convInfo || convInfo.is_bot_active === false || Boolean(convInfo.assigned_user_id))) {
      // Mensagem enviada manualmente por operador humano no WhatsApp
      isHuman = true;
      isBotActive = false;
      finalStage = "em_atendimento";
      finalStatus = "human_takeover";
    }

    if (isNewSessionAfterInactivity && !isWeblojaOrder && !fromMe) {
      console.log(`[ChatStore] ⏰ Nova sessão iniciada após inatividade (> 12h) na conversa ${convId}. Mantendo IA ativa e reiniciando contador.`);
      isHuman = false;
      isBotActive = true;
      finalStage = "ia_atendendo";
      finalStatus = "bot";
    }

    const conv: ChatConversation = {
      id: convId,
      store_id: storeId,
      contact_id: contactId,
      inbox_id: resolvedInboxId || convInfo?.inbox_id || null,
      status: finalStatus,
      is_human_controlled: isHuman,
      is_bot_active: isBotActive,
      kanban_stage: finalStage,
      stage: finalStage,
      bot_interaction_count: (wasReopened || isWeblojaOrder || isNewSessionAfterInactivity) ? 0 : (convInfo?.bot_interaction_count || 0),
      bot_handoff_reason: isWeblojaOrder ? "WEBLOJA_ORDER_RECEIVED" : ((fromMe && !isBotEcho && isHuman) ? "HUMAN_OPERATOR_MESSAGE" : (wasReopened ? null : (convInfo?.bot_handoff_reason || null))),
      bot_handoff_at: (isWeblojaOrder || (fromMe && !isBotEcho && isHuman)) ? now : (wasReopened ? null : (convInfo?.bot_handoff_at || null)),
      assigned_user_id: wasReopened ? null : (isHuman ? (convInfo?.assigned_user_id || null) : (convInfo?.assigned_user_id || null)),
      last_message_at: now,
      last_message_content: text,
      unread_count: newUnreadCount,
      contact: contact,
      created_at: convInfo?.created_at || now,
      updated_at: now
    };
    (conv as any)._was_reopened = wasReopened;
    (conv as any)._is_webloja_order = isWeblojaOrder;
    (conv as any)._order_id = orderCheck.orderId;

    // 3. Atualização ou criação da conversa (chat_conversations)
    try {
      if (convInfo) {
        // CONVERSA EXISTENTE: Atualiza estritamente os metadados da última mensagem recebida.
        const convUpdateData: any = {
          last_message_at: now,
          last_message_content: text,
          unread_count: newUnreadCount,
          updated_at: now
        };

        if (resolvedInboxId && !convInfo.inbox_id) {
          convUpdateData.inbox_id = resolvedInboxId;
        }

        // Se for pedido da webloja, move imediatamente para "saiu_entrega" (Em Separação / Delivery) e desliga a IA
        if (isWeblojaOrder) {
          convUpdateData.kanban_stage = "saiu_entrega";
          convUpdateData.stage = "saiu_entrega";
          convUpdateData.status = "em_separacao";
          convUpdateData.is_bot_active = false;
          convUpdateData.is_human_controlled = true;
          convUpdateData.bot_handoff_reason = "WEBLOJA_ORDER_RECEIVED";
          convUpdateData.bot_handoff_at = now;
        } else if (wasReopened) {
          // Se a conversa estava finalizada e recebeu mensagem comum do cliente, reabre para "novos_triagem"
          convUpdateData.kanban_stage = "novos_triagem";
          convUpdateData.stage = "novos_triagem";
          convUpdateData.status = "OPEN";
          convUpdateData.is_bot_active = true;
          convUpdateData.is_human_controlled = false;
          convUpdateData.assigned_user_id = null;
          convUpdateData.bot_handoff_reason = null;
          convUpdateData.bot_interaction_count = 0;
        } else if (isNewSessionAfterInactivity) {
          convUpdateData.kanban_stage = "ia_atendendo";
          convUpdateData.stage = "ia_atendendo";
          convUpdateData.status = "bot";
          convUpdateData.is_bot_active = true;
          convUpdateData.is_human_controlled = false;
          convUpdateData.assigned_user_id = null;
          convUpdateData.bot_handoff_reason = null;
          convUpdateData.bot_interaction_count = 0;
        } else if (fromMe && isBotEcho) {
          // BLINDAGEM ANTI-ECO: Mensagem disparada pelo próprio BOT FarmaFlow.
          // Garante que NUNCA pause a IA nem mude o status para humano por causa de disparo do robô
          convUpdateData.is_bot_active = true;
          convUpdateData.is_human_controlled = false;
          convUpdateData.status = "bot";
          convUpdateData.kanban_stage = "ia_atendendo";
          convUpdateData.stage = "ia_atendendo";
        } else if (fromMe && !isBotEcho && convInfo.is_human_controlled === true) {
          // Apenas transborda para humano se for mensagem manual confirmada de operador (não eco de bot) em conversa já sob controle humano
          convUpdateData.is_human_controlled = true;
          convUpdateData.is_bot_active = false;
          convUpdateData.status = "human_takeover";
          convUpdateData.kanban_stage = "em_atendimento";
          convUpdateData.bot_handoff_reason = "HUMAN_OPERATOR_MESSAGE";
          convUpdateData.bot_handoff_at = now;
        }

        const sanitizedUpdate = sanitizeChatConversationPayload(convUpdateData);
        const { error } = await supabaseAdmin
          .from("chat_conversations")
          .update(sanitizedUpdate)
          .eq("id", convId);

        if (error) {
          console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao atualizar conversa existente (chat_conversations)', error.message, error);
        }
      } else {
        // CONVERSA NOVA (Primeiro Contato): Cria o registro inicial
        const convInsertData: any = {
          id: convId,
          store_id: storeId,
          contact_id: contactId,
          inbox_id: resolvedInboxId,
          last_message_at: now,
          last_message_content: text,
          unread_count: newUnreadCount,
          updated_at: now,
          created_at: now,
          is_bot_active: isWeblojaOrder ? false : (fromMe ? isBotEcho : true),
          is_human_controlled: isWeblojaOrder ? true : (fromMe ? !isBotEcho : false),
          status: isWeblojaOrder ? "em_separacao" : (fromMe && !isBotEcho ? "human_takeover" : "bot"),
          kanban_stage: isWeblojaOrder ? "saiu_entrega" : (fromMe && !isBotEcho ? "em_atendimento" : "ia_atendendo"),
          stage: isWeblojaOrder ? "saiu_entrega" : (fromMe && !isBotEcho ? "em_atendimento" : "ia_atendendo"),
          bot_interaction_count: 0,
          bot_handoff_reason: isWeblojaOrder ? "WEBLOJA_ORDER_RECEIVED" : (fromMe && !isBotEcho ? "HUMAN_OPERATOR_MESSAGE" : null),
          bot_handoff_at: (isWeblojaOrder || (fromMe && !isBotEcho)) ? now : null
        };

        const sanitizedInsert = sanitizeChatConversationPayload(convInsertData);
        const { error } = await supabaseAdmin
          .from("chat_conversations")
          .insert([sanitizedInsert]);

        if (error) {
          console.error('[ERRO CRITICO NO BACKGROUND]: Erro na criação da nova conversa (chat_conversations)', error.message, error);
        }
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção na busca ou criação da conversa (chat_conversations)', error.message, error.stack);
    }

    // 4. Inserção da mensagem (chat_messages)
    const senderType = fromMe ? (isBotEcho ? "BOT" : "USER") : "CUSTOMER";

    // Se for mídia (imagem, áudio, vídeo, documento, figurinha) e não tiver uma Data URI válida ou URL pública consumível
    const hasValidDirectMedia = isValidDirectMedia(extractedMediaUrl);
    if ((extractedMediaType === "image" || extractedMediaType === "audio" || extractedMediaType === "video" || extractedMediaType === "document" || extractedMediaType === "sticker") && !hasValidDirectMedia) {
      const targetInst = instanceName || instanceNameFromDb;
      if (targetInst) {
        try {
          console.log(`[ChatStore] ⏳ Baixando mídia (${extractedMediaType}) em Base64 via Evolution API (instância: ${targetInst})...`);
          const fetchedMedia = await evolutionApiService.getBase64FromMediaMessage(targetInst, msg);
          if (fetchedMedia) {
            extractedMediaUrl = fetchedMedia;
            console.log(`[ChatStore] ✅ Mídia (${extractedMediaType}) convertida com sucesso para Data URI (tamanho: ${extractedMediaUrl.length} chars)!`);
          } else {
            console.warn(`[ChatStore] ⚠️ Evolution API não retornou base64 para mídia (${extractedMediaType}).`);
          }
        } catch (mediaErr: any) {
          console.warn("[ChatStore] Aviso ao buscar mídia na Evolution API:", mediaErr.message);
        }
      }
    }

    const newMsg: ChatMessage = {
      id: msgId,
      conversation_id: convId,
      sender_type: senderType,
      content: text,
      media_url: extractedMediaUrl,
      media_type: extractedMediaType,
      mediaUrl: extractedMediaUrl,
      mediaType: extractedMediaType,
      type: extractedMediaType,
      remote_id: rawMsgKey,
      reaction: null,
      reactions: [],
      is_private: false,
      created_at: now
    };

    if (!isBotEcho) {
      try {
        const msgInsertData = sanitizeChatMessagePayload({
          id: msgId,
          conversation_id: convId,
          sender_type: senderType,
          content: text,
          media_url: extractedMediaUrl || null,
          media_type: extractedMediaType || "text",
          remote_id: rawMsgKey,
          reaction: null,
          reactions: [],
          is_private: false,
          created_at: now
        });

        const { error } = await supabaseAdmin.from("chat_messages").insert([msgInsertData]);
        
        if (error) {
          console.warn('[ChatStore] Aviso na inserção com sanitizeChatMessagePayload (tentando fallback direto):', error.message);
          await supabaseAdmin.from("chat_messages").insert([{
            id: msgId,
            conversation_id: convId,
            sender_type: senderType,
            content: text,
            media_url: extractedMediaUrl || null,
            media_type: extractedMediaType || "text",
            is_private: false,
            created_at: now
          }]);
        }
      } catch (error: any) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Exceção na inserção da mensagem (chat_messages)', error.message, error.stack);
      }
    }
    
    // Atualiza cache em memória local apenas para fallback / dev
    if (!this.contacts.find(c => c.id === contactId)) this.contacts.push(contact);
    
    const existingConvIdx = this.conversations.findIndex(c => c.id === convId);
    if (existingConvIdx >= 0) {
      this.conversations[existingConvIdx] = conv;
    } else {
      this.conversations.push(conv);
    }
    this.messages.push(newMsg);

    return { conversation: conv, message: newMsg };
  }

  /**
   * Processa evento ou payload de reação (messages.reaction ou reactionMessage)
   */
  public async processMessageReaction(
    storeId: string,
    rawPayload: any,
    instanceName?: string
  ): Promise<{ message: ChatMessage | null; conversationId: string | null } | null> {
    if (!rawPayload) return null;

    const cleanStoreId = typeof storeId === 'string' ? storeId.trim().replace(/^store_/, '') : (storeId || 'default');

    // Extração flexível para suportar múltiplos formatos da Evolution API v1, v2 e Baileys
    const reactionObj = rawPayload.reaction || 
                        rawPayload.message?.reactionMessage || 
                        rawPayload.reactionMessage || 
                        rawPayload.data?.reaction || 
                        rawPayload.data?.message?.reactionMessage || 
                        rawPayload;

    const targetKey = reactionObj?.key || rawPayload.key || {};
    const targetMsgKeyId = targetKey.id || reactionObj?.id || rawPayload.id || rawPayload.messageId || rawPayload.targetMessageId;
    const remoteJid = targetKey.remoteJid || reactionObj?.remoteJid || rawPayload.remoteJid || rawPayload.sender || "";
    
    // Emoji enviado (ou string vazia se a reação foi removida no WhatsApp)
    const emojiRaw = reactionObj?.text !== undefined 
      ? reactionObj.text 
      : (reactionObj?.emoji !== undefined 
        ? reactionObj.emoji 
        : (rawPayload.emoji !== undefined ? rawPayload.emoji : (rawPayload.text !== undefined ? rawPayload.text : "")));
    const emoji = typeof emojiRaw === "string" ? emojiRaw.trim() : "";

    const fromMe = Boolean(targetKey.fromMe ?? reactionObj?.fromMe ?? rawPayload.fromMe ?? false);
    const timestamp = reactionObj?.senderTimestampMs || rawPayload.senderTimestampMs || Date.now();

    if (!targetMsgKeyId) {
      console.warn("[ChatStore] [REACTION] targetMsgKeyId não localizado no payload de reação:", JSON.stringify(rawPayload));
      return null;
    }

    let phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    if (phone.includes(":")) {
      phone = phone.split(":")[0];
    }
    phone = phone.replace(/\D/g, "");

    const convId = phone ? stringToUuid(`conv_${phone}_${cleanStoreId}`) : null;
    const deterministicMsgUuid = convId ? stringToUuid(`msg_${targetMsgKeyId}_${convId}`) : null;

    console.log(`[ChatStore] [REACTION] Alvo: msgId="${targetMsgKeyId}" (uuid: ${deterministicMsgUuid}), convId="${convId}", phone="${phone}", emoji="${emoji}", fromMe=${fromMe}`);

    // 1. Busca a mensagem correspondente no Supabase
    let matchedDbMessage: any = null;
    try {
      // 1.1 Tenta buscar pelo remote_id, id determinístico ou id direto
      const queryOr = [
        `id.eq.${targetMsgKeyId}`,
        ...(deterministicMsgUuid ? [`id.eq.${deterministicMsgUuid}`] : []),
        `remote_id.eq.${targetMsgKeyId}`
      ].join(',');

      let query = supabaseAdmin.from("chat_messages").select("*").or(queryOr);
      if (convId) {
        query = query.eq("conversation_id", convId);
      }

      const { data: dbMatches, error: dbErr } = await query.limit(1).maybeSingle();
      if (!dbErr && dbMatches) {
        matchedDbMessage = dbMatches;
      } else {
        // 1.2 Se não filtrou por convId ou não achou com convId, busca globalmente pelo targetMsgKeyId
        const { data: globalMatch } = await supabaseAdmin
          .from("chat_messages")
          .select("*")
          .or(`id.eq.${targetMsgKeyId},remote_id.eq.${targetMsgKeyId}${deterministicMsgUuid ? `,id.eq.${deterministicMsgUuid}` : ''}`)
          .limit(1)
          .maybeSingle();

        if (globalMatch) {
          matchedDbMessage = globalMatch;
        }
      }
    } catch (e: any) {
      console.warn("[ChatStore] Erro ao consultar mensagem no Supabase para reação:", e.message);
    }

    // 1.3 Se não encontrou no Supabase, tenta buscar na memória local
    let matchedMemoryMsg = this.messages.find(m => 
      m.id === targetMsgKeyId || 
      (deterministicMsgUuid && m.id === deterministicMsgUuid) || 
      m.remote_id === targetMsgKeyId
    );

    const targetMessageId = matchedDbMessage?.id || matchedMemoryMsg?.id || deterministicMsgUuid || targetMsgKeyId;
    const resolvedConvId = matchedDbMessage?.conversation_id || matchedMemoryMsg?.conversation_id || convId;

    if (!resolvedConvId) {
      console.warn("[ChatStore] [REACTION] Impossível determinar conversation_id para a reação.");
      return null;
    }

    // 2. Calcula a nova lista de reações
    let existingReactions: ChatMessageReaction[] = [];
    if (matchedDbMessage?.reactions) {
      if (Array.isArray(matchedDbMessage.reactions)) {
        existingReactions = [...matchedDbMessage.reactions];
      } else if (typeof matchedDbMessage.reactions === "string") {
        try {
          existingReactions = JSON.parse(matchedDbMessage.reactions);
        } catch (_) {}
      }
    } else if (matchedMemoryMsg?.reactions && Array.isArray(matchedMemoryMsg.reactions)) {
      existingReactions = [...matchedMemoryMsg.reactions];
    } else if (matchedDbMessage?.reaction) {
      existingReactions = [{ emoji: matchedDbMessage.reaction, fromMe: false, sender: "CUSTOMER", created_at: new Date().toISOString() }];
    } else if (matchedMemoryMsg?.reaction) {
      existingReactions = [{ emoji: matchedMemoryMsg.reaction, fromMe: false, sender: "CUSTOMER", created_at: new Date().toISOString() }];
    }

    const senderIdentifier = fromMe ? "USER" : (phone || "CUSTOMER");

    if (!emoji) {
      // Reação removida
      existingReactions = existingReactions.filter(r => r.fromMe !== fromMe && r.sender !== senderIdentifier);
    } else {
      // Reação adicionada ou atualizada
      existingReactions = existingReactions.filter(r => r.fromMe !== fromMe && r.sender !== senderIdentifier);
      existingReactions.push({
        emoji,
        sender: senderIdentifier,
        fromMe,
        created_at: new Date(timestamp).toISOString()
      });
    }

    const finalReaction = existingReactions.length > 0 ? existingReactions[existingReactions.length - 1].emoji : null;

    console.log(`[ChatStore] [REACTION] Reação atualizada: "${finalReaction}" | Total reações: ${existingReactions.length} | Alvo: ${targetMessageId}`);

    // 3. Atualiza no Supabase
    if (matchedDbMessage?.id || targetMessageId) {
      try {
        const { error: updateErr } = await supabaseAdmin
          .from("chat_messages")
          .update({
            reaction: finalReaction,
            reactions: existingReactions
          })
          .eq("id", targetMessageId);

        if (updateErr) {
          console.warn("[ChatStore] Aviso ao atualizar reações no Supabase (tentando apenas coluna reaction):", updateErr.message);
          await supabaseAdmin
            .from("chat_messages")
            .update({ reaction: finalReaction })
            .eq("id", targetMessageId);
        }
      } catch (err: any) {
        console.warn("[ChatStore] Exceção ao gravar reação no Supabase:", err.message);
      }
    }

    // 4. Atualiza no cache em memória
    if (matchedMemoryMsg) {
      matchedMemoryMsg.reaction = finalReaction;
      matchedMemoryMsg.reactions = existingReactions;
    } else if (matchedDbMessage) {
      const memoryObj: ChatMessage = {
        ...matchedDbMessage,
        reaction: finalReaction,
        reactions: existingReactions
      };
      this.messages.push(memoryObj);
    }
    this.saveToFile();

    const updatedChatMessage: ChatMessage = {
      ...(matchedDbMessage || matchedMemoryMsg || {
        id: targetMessageId,
        conversation_id: resolvedConvId,
        sender_type: fromMe ? "USER" : "CUSTOMER",
        content: "",
        is_private: false,
        created_at: new Date().toISOString()
      }),
      reaction: finalReaction,
      reactions: existingReactions,
      remote_id: targetMsgKeyId
    };

    // 5. Broadcast instantâneo via RealtimeHub
    realtimeHub.broadcastToStore(cleanStoreId, "message_reaction", {
      conversationId: resolvedConvId,
      messageId: targetMessageId,
      remote_id: targetMsgKeyId,
      reaction: finalReaction,
      reactions: existingReactions,
      emoji: emoji || null,
      fromMe
    });

    realtimeHub.broadcastToStore(cleanStoreId, "chat_message_updated", {
      conversationId: resolvedConvId,
      message: updatedChatMessage
    });

    return {
      message: updatedChatMessage,
      conversationId: resolvedConvId
    };
  }

  /**
   * Adiciona ou atualiza reação enviada manualmente por um operador via Web UI
   */
  public async addOrUpdateReaction(
    storeId: string,
    conversationId: string,
    messageId: string,
    emoji: string,
    fromMe = true,
    explicitInstanceName?: string
  ): Promise<{ success: boolean; message: ChatMessage | null; error?: string }> {
    const cleanStoreId = typeof storeId === 'string' ? storeId.trim().replace(/^store_/, '') : (storeId || 'default');

    try {
      // 1. Busca a mensagem
      let msgToReact: any = null;
      try {
        const { data } = await supabaseAdmin
          .from("chat_messages")
          .select("*")
          .eq("id", messageId)
          .maybeSingle();
        if (data) msgToReact = data;
      } catch (_) {}

      if (!msgToReact) {
        msgToReact = this.messages.find(m => m.id === messageId);
      }

      if (!msgToReact) {
        return { success: false, message: null, error: "Mensagem não encontrada" };
      }

      // 2. Despacha para o WhatsApp via Evolution API se tiver remote_id ou se pudermos resolver
      const remoteMsgId = msgToReact.remote_id || msgToReact.id;
      let phoneToSend: string | null = null;
      try {
        const { data: convData } = await supabaseAdmin
          .from("chat_conversations")
          .select("contact_id")
          .eq("id", conversationId)
          .maybeSingle();

        if (convData?.contact_id) {
          const { data: contactData } = await supabaseAdmin
            .from("chat_contacts")
            .select("phone_number")
            .eq("id", convData.contact_id)
            .maybeSingle();
          if (contactData?.phone_number) phoneToSend = contactData.phone_number;
        }
      } catch (_) {}

      if (!phoneToSend) {
        const match = conversationId.match(/_(\d{10,15})_/);
        if (match) phoneToSend = match[1];
      }

      const targetInstance = await evolutionApiService.resolveInstanceName(cleanStoreId, explicitInstanceName);
      if (targetInstance && phoneToSend && remoteMsgId) {
        const cleanJid = `${phoneToSend.replace(/\D/g, '')}@s.whatsapp.net`;
        evolutionApiService.sendReaction(targetInstance, {
          remoteJid: cleanJid,
          id: remoteMsgId,
          fromMe: msgToReact.sender_type === "USER" || msgToReact.sender_type === "BOT"
        }, emoji).catch(err => {
          console.warn("[ChatStore] Falha assíncrona ao despachar reação para Evolution API:", err.message || err);
        });
      }

      // 3. Atualiza localmente no banco e memória
      let existingReactions: ChatMessageReaction[] = [];
      if (msgToReact.reactions) {
        if (Array.isArray(msgToReact.reactions)) {
          existingReactions = [...msgToReact.reactions];
        } else if (typeof msgToReact.reactions === "string") {
          try {
            existingReactions = JSON.parse(msgToReact.reactions);
          } catch (_) {}
        }
      } else if (msgToReact.reaction) {
        existingReactions = [{ emoji: msgToReact.reaction, fromMe: false, sender: "CUSTOMER", created_at: new Date().toISOString() }];
      }

      const senderIdentifier = fromMe ? "USER" : (phoneToSend || "CUSTOMER");

      if (!emoji) {
        existingReactions = existingReactions.filter(r => r.fromMe !== fromMe);
      } else {
        existingReactions = existingReactions.filter(r => r.fromMe !== fromMe);
        existingReactions.push({
          emoji,
          sender: senderIdentifier,
          fromMe,
          created_at: new Date().toISOString()
        });
      }

      const finalReaction = existingReactions.length > 0 ? existingReactions[existingReactions.length - 1].emoji : null;

      try {
        const { error: updateErr } = await supabaseAdmin
          .from("chat_messages")
          .update({
            reaction: finalReaction,
            reactions: existingReactions
          })
          .eq("id", messageId);

        if (updateErr) {
          await supabaseAdmin
            .from("chat_messages")
            .update({ reaction: finalReaction })
            .eq("id", messageId);
        }
      } catch (err: any) {
        console.warn("[ChatStore] Exceção ao atualizar reação:", err.message);
      }

      const memMsg = this.messages.find(m => m.id === messageId);
      if (memMsg) {
        memMsg.reaction = finalReaction;
        memMsg.reactions = existingReactions;
      }
      this.saveToFile();

      const updatedMsg: ChatMessage = {
        ...msgToReact,
        reaction: finalReaction,
        reactions: existingReactions
      };

      // Broadcast
      realtimeHub.broadcastToStore(cleanStoreId, "message_reaction", {
        conversationId,
        messageId,
        remote_id: remoteMsgId,
        reaction: finalReaction,
        reactions: existingReactions,
        emoji: emoji || null,
        fromMe
      });

      realtimeHub.broadcastToStore(cleanStoreId, "chat_message_updated", {
        conversationId,
        message: updatedMsg
      });

      return { success: true, message: updatedMsg };
    } catch (err: any) {
      console.error("[ChatStore] Erro em addOrUpdateReaction:", err);
      return { success: false, message: null, error: err.message };
    }
  }

  // --- LABELS SYSTEM ---
  public async getLabels(storeId: string): Promise<ChatLabel[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_labels")
        .select("*")
        .eq("store_id", storeId)
        .order("name", { ascending: true });
      if (!error && data) {
        return data as ChatLabel[];
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase labels query fallback:", err);
    }
    return this.labels.filter(l => l.store_id === storeId || l.store_id === "default");
  }

  public async saveLabel(label: { id?: string; store_id: string; name: string; color: string }): Promise<ChatLabel> {
    const id = label.id || crypto.randomUUID();
    const newLabel: ChatLabel = {
      id,
      store_id: label.store_id,
      name: label.name,
      color: label.color,
      created_at: new Date().toISOString()
    };

    try {
      const { error } = await supabaseAdmin
        .from("chat_labels")
        .upsert([newLabel]);
      if (error) {
        console.warn("[ChatStore] Supabase saveLabel error:", error.message);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase saveLabel fallback:", err);
    }

    const idx = this.labels.findIndex(l => l.id === id);
    if (idx >= 0) {
      this.labels[idx] = newLabel;
    } else {
      this.labels.push(newLabel);
    }
    this.saveToFile();
    return newLabel;
  }

  public async deleteLabel(id: string, storeId: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from("chat_labels")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);
      if (error) {
        console.warn("[ChatStore] Supabase deleteLabel error:", error.message);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase deleteLabel fallback:", err);
    }

    this.labels = this.labels.filter(l => !(l.id === id && l.store_id === storeId));
    this.conversation_labels = this.conversation_labels.filter(cl => cl.label_id !== id);
    this.saveToFile();
    return true;
  }

  public async getConversationLabels(conversationId: string): Promise<ChatLabel[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_conversation_labels")
        .select("label_id")
        .eq("conversation_id", conversationId);
      
      if (!error && data) {
        const labelIds = data.map((r: any) => r.label_id);
        const { data: labelsData, error: labelsError } = await supabaseAdmin
          .from("chat_labels")
          .select("*")
          .in("id", labelIds);
        if (!labelsError && labelsData) {
          return labelsData as ChatLabel[];
        }
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase conversation labels fallback:", err);
    }

    const labelIds = this.conversation_labels
      .filter(cl => cl.conversation_id === conversationId)
      .map(cl => cl.label_id);
    return this.labels.filter(l => labelIds.includes(l.id));
  }

  public async setConversationLabels(conversationId: string, labelIds: string[]): Promise<boolean> {
    try {
      await supabaseAdmin
        .from("chat_conversation_labels")
        .delete()
        .eq("conversation_id", conversationId);
      
      if (labelIds.length > 0) {
        const rows = labelIds.map(labelId => ({
          conversation_id: conversationId,
          label_id: labelId
        }));
        await supabaseAdmin
          .from("chat_conversation_labels")
          .insert(rows);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase setConversationLabels fallback:", err);
    }

    this.conversation_labels = this.conversation_labels.filter(cl => cl.conversation_id !== conversationId);
    labelIds.forEach(labelId => {
      this.conversation_labels.push({
        conversation_id: conversationId,
        label_id: labelId
      });
    });
    this.saveToFile();
    return true;
  }

  // --- CANNED RESPONSES SYSTEM ---
  public async getCannedResponses(storeId: string): Promise<CannedResponse[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("canned_responses")
        .select("*")
        .eq("store_id", storeId)
        .order("shortcut", { ascending: true });
      if (!error && data) {
        return data as CannedResponse[];
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase canned responses fallback:", err);
    }
    return this.canned_responses.filter(cr => cr.store_id === storeId || cr.store_id === "default");
  }

  public async saveCannedResponse(response: { id?: string; store_id: string; shortcut: string; text: string }): Promise<CannedResponse> {
    const id = response.id || crypto.randomUUID();
    const newResponse: CannedResponse = {
      id,
      store_id: response.store_id,
      shortcut: response.shortcut.replace(/^\//, ""),
      text: response.text,
      created_at: new Date().toISOString()
    };

    try {
      const { error } = await supabaseAdmin
        .from("canned_responses")
        .upsert([newResponse]);
      if (error) {
        console.warn("[ChatStore] Supabase saveCannedResponse error:", error.message);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase saveCannedResponse fallback:", err);
    }

    const idx = this.canned_responses.findIndex(cr => cr.id === id);
    if (idx >= 0) {
      this.canned_responses[idx] = newResponse;
    } else {
      this.canned_responses.push(newResponse);
    }
    this.saveToFile();
    return newResponse;
  }

  public async deleteCannedResponse(id: string, storeId: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from("canned_responses")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);
      if (error) {
        console.warn("[ChatStore] Supabase deleteCannedResponse error:", error.message);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase deleteCannedResponse fallback:", err);
    }

    this.canned_responses = this.canned_responses.filter(cr => !(cr.id === id && cr.store_id === storeId));
    this.saveToFile();
    return true;
  }

  public async getConversationById(conversationId: string): Promise<ChatConversation | null> {
    let conv: any = null;
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_conversations")
        .select("*, contact:chat_contacts(*)")
        .eq("id", conversationId)
        .maybeSingle();
      if (!error && data) {
        conv = data;
      }
    } catch (err) {
      console.warn("[ChatStore] getConversationById fallback:", err);
    }
    if (!conv) {
      conv = this.conversations.find(c => c.id === conversationId) || null;
    }
    if (conv) {
      const resolvedStage = resolveConversationKanbanStage(conv);
      conv.kanban_stage = resolvedStage;
      conv.stage = resolvedStage;

      if (resolvedStage === "ia_atendendo") {
        conv.is_human_controlled = false;
        conv.is_bot_active = true;
        conv.assigned_user_id = null;
        conv.assigned_to = null;
        if (!conv.status || conv.status === "OPEN" || conv.status === "human_takeover") {
          conv.status = "bot";
        }
      } else {
        const isHuman = 
          conv.is_human_controlled === true ||
          Boolean(conv.assigned_user_id) ||
          Boolean(conv.assigned_to) ||
          conv.status === "human_takeover" ||
          conv.status === "em_atendimento" ||
          resolvedStage === "em_atendimento";

        if (isHuman) {
          conv.is_human_controlled = true;
          conv.is_bot_active = false;
          if (conv.status === "bot" || conv.status === "BOT" || !conv.status) {
            conv.status = "human_takeover";
          }
        } else if (resolvedStage === "finalizado") {
          conv.is_bot_active = false;
          conv.status = "CLOSED";
        } else if (resolvedStage === "aguardando_pagamento") {
          if (!conv.status) conv.status = "PENDING";
        } else if (resolvedStage === "saiu_entrega") {
          conv.is_bot_active = false;
          if (!conv.status) conv.status = "OPEN";
        } else if (resolvedStage === "novos_triagem") {
          conv.is_bot_active = false;
          conv.is_human_controlled = false;
          if (!conv.status) conv.status = "OPEN";
        }
      }
    }
    return conv as ChatConversation | null;
  }

  public async updateConversationBotStatus(
    conversationId: string,
    updates: {
      is_bot_active?: boolean;
      is_human_controlled?: boolean;
      bot_interaction_count?: number;
      bot_handoff_reason?: string | null;
      bot_handoff_at?: string | null;
      status?: "OPEN" | "PENDING" | "finalizado" | "BOT" | "human_takeover" | "bot" | "em_atendimento";
      kanban_stage?: "novos_triagem" | "ia_atendendo" | "aguardando_pagamento" | "em_atendimento" | "finalizado";
      assigned_user_id?: string | null;
      assigned_to?: string | null;
      last_message_at?: string;
      last_message_content?: string;
    }
  ): Promise<void> {
    const finalUpdates: any = { ...updates, updated_at: new Date().toISOString() };

    if (updates.is_bot_active === true) {
      finalUpdates.is_bot_active = true;
      finalUpdates.is_human_controlled = false;
      finalUpdates.assigned_user_id = null;
      finalUpdates.assigned_to = null;
      finalUpdates.status = "bot";
      finalUpdates.kanban_stage = "ia_atendendo";
      finalUpdates.bot_interaction_count = updates.bot_interaction_count !== undefined ? updates.bot_interaction_count : 0;
      finalUpdates.bot_handoff_reason = updates.bot_handoff_reason !== undefined ? updates.bot_handoff_reason : null;
      finalUpdates.bot_handoff_at = updates.bot_handoff_at !== undefined ? updates.bot_handoff_at : null;
    } else if (updates.is_bot_active === false || updates.is_human_controlled === true) {
      finalUpdates.is_bot_active = false;
      finalUpdates.is_human_controlled = true;
      finalUpdates.status = "human_takeover";
      finalUpdates.kanban_stage = updates.kanban_stage || "em_atendimento";
      finalUpdates.bot_handoff_reason = updates.bot_handoff_reason || "OPERATOR_TAKEOVER";
      finalUpdates.bot_handoff_at = updates.bot_handoff_at || new Date().toISOString();
      if (updates.bot_interaction_count !== undefined) {
        finalUpdates.bot_interaction_count = updates.bot_interaction_count;
      }
    }

    try {
      const sanitizedPayload = sanitizeChatConversationPayload(finalUpdates);
      const { error } = await supabaseAdmin
        .from("chat_conversations")
        .update(sanitizedPayload)
        .eq("id", conversationId);
      if (error) {
        console.error("[ChatStore] updateConversationBotStatus Supabase error:", error.message, error);
      }
    } catch (err: any) {
      console.warn("[ChatStore] updateConversationBotStatus error:", err);
    }
    const idx = this.conversations.findIndex(c => c.id === conversationId);
    if (idx >= 0) {
      this.conversations[idx] = {
        ...this.conversations[idx],
        ...finalUpdates
      };
      this.saveToFile();
    }
  }

  public async updateConversationStage(
    conversationId: string,
    storeId: string,
    targetStage: string,
    assignedUserId?: string | null,
    isManual?: boolean
  ): Promise<ChatConversation | null> {
    const nowIso = new Date().toISOString();
    
    // Normalização estrita do estágio para o novo padrão de delivery
    let normalizedStage = "novos_triagem";
    const s = String(targetStage || "").toLowerCase().trim();
    if (s === "novos_triagem" || s === "triagem" || s === "novos" || s === "novos_clientes" || s === "new" || s === "open") {
      normalizedStage = "novos_triagem";
    } else if (s === "ia_atendendo" || s === "bot" || s === "ia") {
      normalizedStage = "ia_atendendo";
    } else if (s === "em_atendimento" || s === "atendimento_humano" || s === "humano" || s === "human" || s === "human_takeover" || s === "balcao") {
      normalizedStage = "em_atendimento";
    } else if (s === "aguardando_pagamento" || s === "pagamento" || s === "enviado_webloja" || s === "aguardando_resposta" || s === "store_redirect" || s === "waiting" || s === "pending") {
      normalizedStage = "aguardando_pagamento";
    } else if (s === "saiu_entrega" || s === "delivery" || s === "em_separacao" || s === "separacao" || s === "rota") {
      normalizedStage = "saiu_entrega";
    } else if (s === "finalizado" || s === "concluido" || s === "concluida" || s === "closed") {
      normalizedStage = "finalizado";
    }

    const updates: any = {
      kanban_stage: normalizedStage,
      stage: normalizedStage,
      updated_at: nowIso
    };

    if (assignedUserId !== undefined) {
      updates.assigned_user_id = assignedUserId;
      updates.assigned_to = assignedUserId;
    }

    switch (normalizedStage) {
      case "novos_triagem":
        updates.status = "OPEN";
        updates.is_bot_active = false;
        updates.is_human_controlled = false;
        updates.assigned_user_id = null;
        updates.assigned_to = null;
        updates.bot_interaction_count = 0;
        updates.bot_handoff_reason = null;
        updates.bot_handoff_at = null;
        break;
      case "ia_atendendo":
        updates.status = "bot";
        updates.is_bot_active = true;
        updates.is_human_controlled = false;
        updates.assigned_user_id = null;
        updates.assigned_to = null;
        updates.bot_interaction_count = 0;
        updates.bot_handoff_reason = null;
        updates.bot_handoff_at = null;
        break;
      case "em_atendimento":
        updates.status = "human_takeover";
        updates.is_bot_active = false;
        updates.is_human_controlled = true;
        updates.bot_handoff_reason = "OPERATOR_ASSIGNED_OR_HANDOFF";
        updates.bot_handoff_at = nowIso;
        break;
      case "aguardando_pagamento":
        updates.status = "PENDING";
        break;
      case "saiu_entrega":
        updates.status = "OPEN";
        updates.is_bot_active = false;
        break;
      case "finalizado":
        updates.status = "CLOSED";
        updates.is_bot_active = false;
        break;
    }

    try {
      const sanitizedUpdates = sanitizeChatConversationPayload(updates);
      const { error } = await supabaseAdmin
        .from("chat_conversations")
        .update(sanitizedUpdates)
        .eq("id", conversationId);
      if (error) {
        console.error("[ChatStore] updateConversationStage Supabase error:", error.message, error);
      }
    } catch (err: any) {
      console.warn("[ChatStore] updateConversationStage Supabase fallback:", err.message);
    }

    const idx = this.conversations.findIndex(c => c.id === conversationId);
    if (idx >= 0) {
      this.conversations[idx] = {
        ...this.conversations[idx],
        ...updates
      };
      this.saveToFile();
      return this.conversations[idx];
    }

    return await this.getConversationById(conversationId);
  }

  public async transferConversation(
    conversationId: string,
    storeId: string,
    options: {
      inboxId?: string | null;
      userId?: string | null;
      fromUserId?: string | null;
      reason?: string | null;
    }
  ): Promise<{ success: boolean; conversation: ChatConversation | null; message?: ChatMessage | null }> {
    const nowIso = new Date().toISOString();
    const updates: any = {
      updated_at: nowIso
    };

    let logMessageText = "";

    if (options.inboxId) {
      updates.inbox_id = options.inboxId;
      if (!options.userId) {
        updates.assigned_user_id = null;
        updates.assigned_to = null;
        updates.status = "OPEN";
        updates.is_human_controlled = false;
        updates.is_bot_active = false;
        updates.kanban_stage = "novos_triagem";
        updates.stage = "novos_triagem";
      }
    }

    if (options.userId) {
      updates.assigned_user_id = options.userId;
      updates.assigned_to = options.userId;
      updates.is_human_controlled = true;
      updates.is_bot_active = false;
      updates.status = "human_takeover";
      updates.kanban_stage = "em_atendimento";
      updates.stage = "em_atendimento";
      updates.bot_handoff_reason = "OPERATOR_TRANSFER";
      updates.bot_handoff_at = nowIso;
    }

    let targetName = "";
    if (options.inboxId) {
      try {
        const { data: ib } = await supabaseAdmin.from("inboxes").select("name").eq("id", options.inboxId).maybeSingle();
        if (ib?.name) targetName = `departamento "${ib.name}"`;
      } catch (_) {}
    }
    if (options.userId) {
      try {
        const { data: tu } = await supabaseAdmin.from("tenant_users").select("name, email").eq("id", options.userId).maybeSingle();
        const userName = tu?.name || tu?.email || options.userId;
        targetName = targetName ? `${targetName} e atendente ${userName}` : `atendente ${userName}`;
      } catch (_) {}
    }

    logMessageText = `Conversa transferida com sucesso para ${targetName || "novo destino"}.`;

    try {
      const sanitizedUpdates = sanitizeChatConversationPayload(updates);
      const { error } = await supabaseAdmin
        .from("chat_conversations")
        .update(sanitizedUpdates)
        .eq("id", conversationId);
      if (error) {
        console.error("[ChatStore] transferConversation Supabase error:", error.message, error);
      }
    } catch (err: any) {
      console.warn("[ChatStore] transferConversation Supabase fallback:", err.message);
    }

    let sysMsg: ChatMessage | null = null;
    try {
      const { message } = await this.addMessage(
        storeId,
        conversationId,
        "SYSTEM",
        logMessageText,
        true
      );
      sysMsg = message;
    } catch (msgErr: any) {
      console.warn("[ChatStore] Error creating transfer log message:", msgErr.message);
    }

    const idx = this.conversations.findIndex(c => c.id === conversationId);
    let updatedConv: ChatConversation | null = null;
    if (idx >= 0) {
      this.conversations[idx] = {
        ...this.conversations[idx],
        ...updates
      };
      this.saveToFile();
      updatedConv = this.conversations[idx];
    } else {
      updatedConv = await this.getConversationById(conversationId);
    }

    return {
      success: true,
      conversation: updatedConv,
      message: sysMsg
    };
  }
}

export const chatStore = new ChatStore();
