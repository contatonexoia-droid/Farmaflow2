import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

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
  assigned_user_id?: string | null;
  status: "OPEN" | "PENDING" | "CLOSED" | "BOT";
  last_message_at: string;
  last_message_content: string;
  unread_count?: number;
  contact?: ChatContact;
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

class ChatStore {
  private contacts: ChatContact[] = [];
  private conversations: ChatConversation[] = [];
  private messages: ChatMessage[] = [];

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
      this.saveToFile();
    }
  }

  public async getConversations(storeId: string, inboxId?: string): Promise<ChatConversation[]> {
    try {
      let query = supabaseAdmin
        .from("chat_conversations")
        .select("*, contact:chat_contacts(*)")
        .eq("store_id", storeId)
        .order("last_message_at", { ascending: false });

      if (inboxId && inboxId !== "all") {
        query = query.eq("inbox_id", inboxId);
      }

      const { data, error } = await query;
      if (!error && data) {
        return data as any[];
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase conversations query fallback:", err);
    }

    return [];
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
    mediaUrl?: string,
    mediaType?: string
  ): Promise<{ message: ChatMessage; conversation: ChatConversation }> {
    const now = new Date().toISOString();
    const newMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      is_private: isPrivate,
      media_url: mediaUrl,
      media_type: mediaType,
      created_at: now
    };

    // Try Supabase insert
    try {
      await supabaseAdmin.from("chat_messages").insert([{
        id: newMsg.id,
        conversation_id: conversationId,
        sender_type: senderType,
        content,
        is_private: isPrivate,
        media_url: mediaUrl,
        media_type: mediaType,
        created_at: now
      }]);

      await supabaseAdmin.from("chat_conversations").update({
        last_message_at: now,
        last_message_content: content
      }).eq("id", conversationId);
    } catch (err) {
      console.warn("[ChatStore] Supabase insert message failed, using fallback:", err);
    }

    // Local fallback update
    this.messages.push(newMsg);

    let convIndex = this.conversations.findIndex(c => c.id === conversationId);
    if (convIndex < 0) {
      // Create fallback conv
      const defaultContact: ChatContact = {
        id: `contact_${Date.now()}`,
        store_id: storeId,
        name: "Contato WhatsApp",
        phone_number: "WhatsApp",
        created_at: now
      };
      const newConv: ChatConversation = {
        id: conversationId,
        store_id: storeId,
        contact_id: defaultContact.id,
        inbox_id: `inbox_default_${storeId}`,
        status: "OPEN",
        last_message_at: now,
        last_message_content: content,
        contact: defaultContact,
        created_at: now
      };
      this.contacts.push(defaultContact);
      this.conversations.push(newConv);
      convIndex = this.conversations.length - 1;
    } else {
      this.conversations[convIndex] = {
        ...this.conversations[convIndex],
        last_message_at: now,
        last_message_content: content
      };
    }

    this.saveToFile();
    return { message: newMsg, conversation: this.conversations[convIndex] };
  }

  public async processWhatsAppMessage(storeId: string, msg: any): Promise<{ conversation: ChatConversation; message: ChatMessage } | null> {
    if (!msg) return null;

    // Robust extraction for Evolution API and other providers
    const fromMe = Boolean(msg.key?.fromMe ?? msg.fromMe ?? false);
    const remoteJid = msg.key?.remoteJid || msg.remoteJid || msg.sender || msg.participant || "";
    
    if (!remoteJid) {
       console.error('[WEBHOOK EXTRACT ERROR] No remoteJid found in message:', JSON.stringify(msg, null, 2));
       return null;
    }

    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
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

    console.log('[PAYLOAD EXTRAÍDO COM SUCESSO]:', { phone, text, fromMe });

    const now = new Date().toISOString();

    // Otimização: Identificadores determinísticos baseados na PK
    const contactId = `contact_${phone}_${storeId}`;
    const convId = `conv_${phone}_${storeId}`;

    const contact: ChatContact = {
      id: contactId,
      store_id: storeId,
      name: pushName,
      phone_number: phone,
      created_at: now
    };

    // 1. Upsert contact
    try {
      const { error } = await supabaseAdmin.from("chat_contacts").upsert([contact], { onConflict: "id" });
      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao inserir contato', error.message, error);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao inserir contato', error.message, error.stack);
    }

    // 2. Fetch Conversation info to determine if exists and current unread_count
    let convInfo: any = null;
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_conversations")
        .select("id, unread_count, inbox_id")
        .eq("id", convId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        // PGRST116 is "No rows found"
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao buscar conversa', error.message, error);
      } else {
        convInfo = data;
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao buscar conversa', error.message, error.stack);
    }

    let resolvedInboxId = convInfo?.inbox_id;

    // Se a conversa não existir e não temos inbox_id, busca a primeira inbox ou cria uma padrão
    if (!convInfo && !resolvedInboxId) {
       try {
         const { data: firstInbox, error: fetchInboxError } = await supabaseAdmin
           .from("inboxes")
           .select("id")
           .eq("store_id", storeId)
           .order("created_at", { ascending: true })
           .limit(1)
           .single();
           
         if (fetchInboxError && fetchInboxError.code !== 'PGRST116') {
           console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao buscar inbox', fetchInboxError.message, fetchInboxError);
         }
           
         if (firstInbox?.id) {
           resolvedInboxId = firstInbox.id;
         } else {
           // Create a default inbox if none exists
           const defaultInboxId = `inbox_default_${storeId}`;
           const { error: insertInboxError } = await supabaseAdmin.from("inboxes").insert([{
             id: defaultInboxId,
             store_id: storeId,
             name: "Caixa de Entrada Principal"
           }]);
           
           if (insertInboxError) {
             console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao criar inbox padrão', insertInboxError.message, insertInboxError);
           } else {
             resolvedInboxId = defaultInboxId;
           }
         }
       } catch (error: any) {
         console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao gerenciar inbox', error.message, error.stack);
       }
    }

    const currentUnreadCount = convInfo?.unread_count || 0;
    const newUnreadCount = fromMe ? 0 : currentUnreadCount + 1;

    const conv: ChatConversation = {
      id: convId,
      store_id: storeId,
      contact_id: contactId,
      inbox_id: resolvedInboxId,
      status: "OPEN", // Força reabertura se enviar mensagem (ou pode manter o estado se existir)
      last_message_at: now,
      last_message_content: text,
      unread_count: newUnreadCount,
      contact: contact,
      created_at: now
    };

    // 3. Upsert Conversation otimizado
    try {
      const { error } = await supabaseAdmin.from("chat_conversations").upsert([{
        id: convId,
        store_id: storeId,
        contact_id: contactId,
        inbox_id: resolvedInboxId,
        status: "OPEN",
        last_message_at: now,
        last_message_content: text,
        unread_count: newUnreadCount
      }], { onConflict: "id" });
      
      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao inserir/atualizar conversa', error.message, error);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao inserir/atualizar conversa', error.message, error.stack);
    }

    // 4. Insert Message otimizado
    const senderType = fromMe ? "USER" : "CUSTOMER";
    const newMsg: ChatMessage = {
      id: `msg_${msg.key?.id || Date.now()}`,
      conversation_id: convId,
      sender_type: senderType,
      content: text,
      is_private: false,
      created_at: now
    };

    try {
      const { error } = await supabaseAdmin.from("chat_messages").insert([{
        id: newMsg.id,
        conversation_id: convId,
        sender_type: senderType,
        content: text,
        is_private: false,
        created_at: now
      }]);
      
      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao inserir mensagem', error.message, error);
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao inserir mensagem', error.message, error.stack);
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
}

export const chatStore = new ChatStore();
