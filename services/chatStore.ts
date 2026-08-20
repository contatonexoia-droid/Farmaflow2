import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { inboxStore } from "./inboxStore.js";
import { evolutionApiService } from "./evolutionApiService.js";

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
  status: "OPEN" | "PENDING" | "CLOSED" | "BOT" | string;
  kanban_stage?: "NEW" | "BOT" | "WAITING" | "STORE_REDIRECT" | "HUMAN" | "CLOSED" | string;
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
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_type: "CUSTOMER" | "USER" | "BOT" | "SYSTEM";
  content: string;
  is_private: boolean;
  media_url?: string;
  media_type?: string;
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
          // Reconciliação retroativa e estrita entre status, flags humanas e estágios do Kanban
          const isHumanControlled = 
            conv.is_human_controlled === true ||
            Boolean(conv.assigned_user_id) ||
            Boolean(conv.assigned_to) ||
            conv.is_bot_active === false ||
            conv.status === "human_takeover" ||
            conv.status === "HUMAN";

          if (isHumanControlled) {
            conv.is_human_controlled = true;
            conv.is_bot_active = false;
            if (conv.status === "bot" || conv.status === "BOT" || !conv.status) {
              conv.status = "human_takeover";
            }
            if (conv.status === "CLOSED" || conv.kanban_stage === "CLOSED") {
              conv.kanban_stage = "CLOSED";
            } else if (conv.kanban_stage === "WAITING" || conv.status === "PENDING") {
              conv.kanban_stage = "WAITING";
            } else if (conv.kanban_stage === "STORE_REDIRECT" || conv.bot_handoff_reason === "STORE_REDIRECT") {
              conv.kanban_stage = "STORE_REDIRECT";
            } else {
              conv.kanban_stage = "HUMAN";
            }
          } else {
            // Estado IA Atendendo
            conv.is_human_controlled = false;
            conv.is_bot_active = true;
            conv.assigned_user_id = null;
            conv.assigned_to = null;
            if (conv.status === "CLOSED" || conv.kanban_stage === "CLOSED") {
              conv.kanban_stage = "CLOSED";
            } else if (conv.kanban_stage === "WAITING" || conv.status === "PENDING") {
              conv.kanban_stage = "WAITING";
            } else if (conv.kanban_stage === "STORE_REDIRECT" || conv.bot_handoff_reason === "STORE_REDIRECT") {
              conv.kanban_stage = "STORE_REDIRECT";
            } else if (conv.kanban_stage === "NEW") {
              conv.kanban_stage = "NEW";
            } else {
              conv.kanban_stage = "BOT";
              conv.status = "bot";
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
      const isHumanControlled = 
        conv.is_human_controlled === true ||
        Boolean(conv.assigned_user_id) ||
        Boolean(conv.assigned_to) ||
        conv.is_bot_active === false ||
        conv.status === "human_takeover" ||
        conv.status === "HUMAN";

      if (isHumanControlled) {
        conv.is_human_controlled = true;
        conv.is_bot_active = false;
        if (conv.status === "bot" || conv.status === "BOT" || !conv.status) {
          conv.status = "human_takeover";
        }
        if (conv.status === "CLOSED" || conv.kanban_stage === "CLOSED") {
          conv.kanban_stage = "CLOSED";
        } else if (conv.kanban_stage === "WAITING" || conv.status === "PENDING") {
          conv.kanban_stage = "WAITING";
        } else if (conv.kanban_stage === "STORE_REDIRECT" || conv.bot_handoff_reason === "STORE_REDIRECT") {
          conv.kanban_stage = "STORE_REDIRECT";
        } else {
          conv.kanban_stage = "HUMAN";
        }
      } else {
        conv.is_human_controlled = false;
        conv.is_bot_active = true;
        conv.assigned_user_id = null;
        conv.assigned_to = null;
        if (conv.status === "CLOSED" || conv.kanban_stage === "CLOSED") {
          conv.kanban_stage = "CLOSED";
        } else if (conv.kanban_stage === "WAITING" || conv.status === "PENDING") {
          conv.kanban_stage = "WAITING";
        } else if (conv.kanban_stage === "STORE_REDIRECT" || conv.bot_handoff_reason === "STORE_REDIRECT") {
          conv.kanban_stage = "STORE_REDIRECT";
        } else if (conv.kanban_stage === "NEW") {
          conv.kanban_stage = "NEW";
        } else {
          conv.kanban_stage = "BOT";
          conv.status = "bot";
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
        return data;
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase messages query fallback:", err);
    }

    return [];
  }

  public async addMessage(
    storeId: string,
    conversationId: string,
    senderType: "CUSTOMER" | "USER" | "BOT" | "SYSTEM",
    content: string,
    isPrivate = false,
    mediaUrlOrInstanceName?: string,
    mediaType?: string,
    explicitInstanceName?: string
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

    const newMsg: ChatMessage = {
      id: msgUuid,
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      is_private: isPrivate,
      media_url: actualMediaUrl,
      media_type: mediaType,
      created_at: now
    };

    // Evolution API Dispatch (for USER/BOT messages, if not private)
    if ((senderType === "USER" || senderType === "BOT") && !isPrivate) {
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
        convUpdates.kanban_stage = "HUMAN";
        convUpdates.bot_handoff_reason = "HUMAN_OPERATOR_MESSAGE";
        convUpdates.bot_handoff_at = now;
      }

      const { error: convErr } = await supabaseAdmin.from("chat_conversations").update(convUpdates).eq("id", conversationId);

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
        kanban_stage: senderType === "USER" && !isPrivate ? "HUMAN" : "NEW",
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
          kanban_stage: "HUMAN",
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
    
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || 
                 msg.message?.videoMessage?.caption || 
                 msg.text || 
                 msg.body || 
                 (msg.message?.imageMessage ? "[Imagem]" : 
                 (msg.message?.videoMessage ? "[Vídeo]" : 
                 (msg.message?.audioMessage ? "[Áudio]" : 
                 (msg.message?.documentMessage ? "[Documento]" : 
                 (msg.message?.stickerMessage ? "[Figurinha]" : "[Mensagem WhatsApp]")))));

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

    // 2. Obtenção do inbox_id
    let resolvedInboxId: string | null = null;
    let convInfo: any = null;

    try {
      const { data, error } = await supabaseAdmin
        .from("chat_conversations")
        .select("id, unread_count, inbox_id")
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

    const conv: ChatConversation = {
      id: convId,
      store_id: storeId,
      contact_id: contactId,
      inbox_id: resolvedInboxId,
      status: fromMe ? "human_takeover" : (convInfo?.status || "OPEN"),
      is_human_controlled: fromMe ? true : (convInfo?.is_human_controlled || false),
      is_bot_active: fromMe ? false : (convInfo?.is_bot_active !== false),
      kanban_stage: fromMe ? "HUMAN" : (convInfo?.kanban_stage || "NEW"),
      last_message_at: now,
      last_message_content: text,
      unread_count: newUnreadCount,
      contact: contact,
      created_at: now
    };

    // 3. Busca ou criação da conversa (chat_conversations)
    try {
      const convUpsertData: any = {
        id: convId,
        store_id: storeId,
        contact_id: contactId,
        inbox_id: resolvedInboxId,
        last_message_at: now,
        last_message_content: text,
        unread_count: newUnreadCount
      };

      if (fromMe) {
        convUpsertData.is_human_controlled = true;
        convUpsertData.is_bot_active = false;
        convUpsertData.status = "human_takeover";
        convUpsertData.kanban_stage = "HUMAN";
        convUpsertData.bot_handoff_reason = "HUMAN_OPERATOR_MESSAGE";
        convUpsertData.bot_handoff_at = now;
      }

      const { error } = await supabaseAdmin.from("chat_conversations").upsert([convUpsertData], { onConflict: "id" });
      
      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro na busca ou criação da conversa (chat_conversations)', error.message, error);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção na busca ou criação da conversa (chat_conversations)', error.message, error.stack);
    }

    // 4. Inserção da mensagem (chat_messages)
    const senderType = fromMe ? "USER" : "CUSTOMER";
    const newMsg: ChatMessage = {
      id: msgId,
      conversation_id: convId,
      sender_type: senderType,
      content: text,
      is_private: false,
      created_at: now
    };

    try {
      const { error } = await supabaseAdmin.from("chat_messages").insert([{
        id: msgId,
        conversation_id: convId,
        sender_type: senderType,
        content: text,
        is_private: false,
        created_at: now
      }]);
      
      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro na inserção da mensagem (chat_messages)', error.message, error);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção na inserção da mensagem (chat_messages)', error.message, error.stack);
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
      const isHuman = 
        conv.is_human_controlled === true ||
        Boolean(conv.assigned_user_id) ||
        Boolean(conv.assigned_to) ||
        conv.is_bot_active === false ||
        conv.status === "human_takeover" ||
        conv.status === "HUMAN";

      if (isHuman) {
        conv.is_human_controlled = true;
        conv.is_bot_active = false;
        if (conv.status === "bot" || conv.status === "BOT" || !conv.status) {
          conv.status = "human_takeover";
        }
        if (conv.status === "CLOSED" || conv.kanban_stage === "CLOSED") {
          conv.kanban_stage = "CLOSED";
        } else if (conv.kanban_stage === "WAITING" || conv.status === "PENDING") {
          conv.kanban_stage = "WAITING";
        } else if (conv.kanban_stage === "STORE_REDIRECT" || conv.bot_handoff_reason === "STORE_REDIRECT") {
          conv.kanban_stage = "STORE_REDIRECT";
        } else {
          conv.kanban_stage = "HUMAN";
        }
      } else {
        conv.is_human_controlled = false;
        conv.is_bot_active = true;
        conv.assigned_user_id = null;
        conv.assigned_to = null;
        if (conv.status === "CLOSED" || conv.kanban_stage === "CLOSED") {
          conv.kanban_stage = "CLOSED";
        } else if (conv.kanban_stage === "WAITING" || conv.status === "PENDING") {
          conv.kanban_stage = "WAITING";
        } else if (conv.kanban_stage === "STORE_REDIRECT" || conv.bot_handoff_reason === "STORE_REDIRECT") {
          conv.kanban_stage = "STORE_REDIRECT";
        } else if (conv.kanban_stage === "NEW") {
          conv.kanban_stage = "NEW";
        } else {
          conv.kanban_stage = "BOT";
          conv.status = "bot";
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
      status?: "OPEN" | "PENDING" | "CLOSED" | "BOT" | "human_takeover" | "bot" | "HUMAN";
      kanban_stage?: "NEW" | "BOT" | "WAITING" | "STORE_REDIRECT" | "HUMAN" | "CLOSED";
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
      finalUpdates.kanban_stage = "BOT";
      finalUpdates.bot_interaction_count = 0;
      finalUpdates.bot_handoff_reason = null;
      finalUpdates.bot_handoff_at = null;
    } else if (updates.is_bot_active === false || updates.is_human_controlled === true) {
      finalUpdates.is_bot_active = false;
      finalUpdates.is_human_controlled = true;
      finalUpdates.status = "human_takeover";
      finalUpdates.kanban_stage = updates.kanban_stage || "HUMAN";
      finalUpdates.bot_handoff_reason = updates.bot_handoff_reason || "OPERATOR_TAKEOVER";
      finalUpdates.bot_handoff_at = updates.bot_handoff_at || new Date().toISOString();
    }

    try {
      await supabaseAdmin
        .from("chat_conversations")
        .update(finalUpdates)
        .eq("id", conversationId);
    } catch (err) {
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
    targetStage: "NEW" | "BOT" | "WAITING" | "STORE_REDIRECT" | "HUMAN" | "CLOSED",
    assignedUserId?: string | null
  ): Promise<ChatConversation | null> {
    const nowIso = new Date().toISOString();
    const updates: any = {
      kanban_stage: targetStage,
      updated_at: nowIso
    };

    if (assignedUserId !== undefined) {
      updates.assigned_user_id = assignedUserId;
      updates.assigned_to = assignedUserId;
    }

    switch (targetStage) {
      case "NEW":
        updates.status = "OPEN";
        updates.is_bot_active = false;
        updates.is_human_controlled = false;
        break;
      case "BOT":
        updates.status = "bot";
        updates.is_bot_active = true;
        updates.is_human_controlled = false;
        updates.assigned_user_id = null;
        updates.assigned_to = null;
        updates.bot_interaction_count = 0;
        updates.bot_handoff_reason = null;
        updates.bot_handoff_at = null;
        break;
      case "WAITING":
        updates.status = "PENDING";
        break;
      case "STORE_REDIRECT":
        updates.status = "OPEN";
        updates.bot_handoff_reason = "STORE_REDIRECT";
        break;
      case "HUMAN":
        updates.status = "human_takeover";
        updates.is_bot_active = false;
        updates.is_human_controlled = true;
        updates.bot_handoff_reason = "OPERATOR_ASSIGNED_OR_HANDOFF";
        updates.bot_handoff_at = nowIso;
        break;
      case "CLOSED":
        updates.status = "CLOSED";
        updates.is_bot_active = false;
        break;
    }

    try {
      await supabaseAdmin
        .from("chat_conversations")
        .update(updates)
        .eq("id", conversationId);
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
}

export const chatStore = new ChatStore();
