import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const DATA_FILE = path.join(process.cwd(), "chat_data.json");

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
      if (!error && data && data.length > 0) {
        return data;
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase conversations query fallback:", err);
    }

    // Memory / Local JSON Fallback
    let list = this.conversations.filter(c => c.store_id === storeId || c.store_id === "default");
    if (inboxId && inboxId !== "all") {
      list = list.filter(c => c.inbox_id === inboxId);
    }

    // Attach contacts
    return list.map(conv => {
      const contact = this.contacts.find(ct => ct.id === conv.contact_id);
      return { ...conv, contact: contact || conv.contact };
    }).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
  }

  public async getMessages(conversationId: string): Promise<ChatMessage[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (!error && data && data.length > 0) {
        return data;
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase messages query fallback:", err);
    }

    return this.messages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
        conversation_id: conversationId,
        sender_type: senderType,
        content,
        is_private: isPrivate,
        media_url: mediaUrl,
        media_type: mediaType
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

    const fromMe = Boolean(msg.key?.fromMe);
    const remoteJid = msg.key?.remoteJid || "";
    if (!remoteJid) return null;

    const phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    const pushName = msg.pushName || phone || "Contato WhatsApp";
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 msg.message?.imageMessage?.caption || 
                 (msg.message?.imageMessage ? "[Imagem]" : "[Mensagem WhatsApp]");

    const now = new Date().toISOString();

    // 1. Find or create Contact
    let contact = this.contacts.find(c => c.phone_number === phone && c.store_id === storeId);
    if (!contact) {
      contact = {
        id: `contact_${phone}_${storeId}`,
        store_id: storeId,
        name: pushName,
        phone_number: phone,
        created_at: now
      };
      this.contacts.push(contact);

      try {
        const { error } = await supabaseAdmin.from("chat_contacts").upsert([contact]);
        if (error) {
          console.error('[WEBHOOK INSERT ERROR] Failed to upsert contact:', error);
        }
      } catch (err) {
        console.error('[WEBHOOK INSERT EXCEPTION] Failed to upsert contact:', err);
      }
    }

    // 2. Resolve inbox_id (buscar a primeira inbox da loja, se existir)
    let resolvedInboxId: string | null = null;
    try {
      const { data: firstInbox, error: inboxError } = await supabaseAdmin
        .from("inboxes")
        .select("id")
        .eq("store_id", storeId)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      
      if (firstInbox?.id) {
        resolvedInboxId = firstInbox.id;
      }
    } catch (err) {
      console.warn("[WEBHOOK INBOX RESOLVE WARNING]", err);
    }

    // 3. Find or create Conversation
    let conv = this.conversations.find(c => c.contact_id === contact!.id && c.store_id === storeId);
    if (!conv) {
      conv = {
        id: `conv_${phone}_${storeId}`,
        store_id: storeId,
        contact_id: contact.id,
        inbox_id: resolvedInboxId, // FK opcional ou válida
        assigned_user_id: null,
        status: "OPEN",
        last_message_at: now,
        last_message_content: text,
        unread_count: fromMe ? 0 : 1,
        contact: contact,
        created_at: now
      };
      this.conversations.push(conv);

      try {
        const { error } = await supabaseAdmin.from("chat_conversations").upsert([{
          id: conv.id,
          store_id: storeId,
          contact_id: contact.id,
          inbox_id: resolvedInboxId,
          status: "OPEN",
          last_message_at: now,
          last_message_content: text
        }]);
        if (error) {
          console.error('[WEBHOOK INSERT ERROR] Failed to upsert conversation:', error);
        }
      } catch (err) {
        console.error('[WEBHOOK INSERT EXCEPTION] Failed to upsert conversation:', err);
      }
    } else {
      conv.last_message_at = now;
      conv.last_message_content = text;
      if (!fromMe) {
        conv.unread_count = (conv.unread_count || 0) + 1;
      }
      
      try {
        const { error } = await supabaseAdmin.from("chat_conversations")
          .update({
            last_message_at: now,
            last_message_content: text,
            unread_count: conv.unread_count
          })
          .eq("id", conv.id);
        if (error) {
           console.error('[WEBHOOK UPDATE ERROR] Failed to update conversation:', error);
        }
      } catch (err) {
        console.error('[WEBHOOK UPDATE EXCEPTION] Failed to update conversation:', err);
      }
    }

    // 4. Create Message
    const senderType = fromMe ? "USER" : "CUSTOMER";
    const newMsg: ChatMessage = {
      id: `msg_${msg.key?.id || Date.now()}`,
      conversation_id: conv.id,
      sender_type: senderType,
      content: text,
      is_private: false,
      created_at: now
    };

    this.messages.push(newMsg);

    try {
      const { error } = await supabaseAdmin.from("chat_messages").insert([{
        id: newMsg.id,
        conversation_id: conv.id,
        sender_type: senderType,
        content: text,
        is_private: false,
        created_at: now
      }]);
      if (error) {
        console.error('[WEBHOOK INSERT ERROR] Failed to insert message:', error);
      }
    } catch (err) {
      console.error('[WEBHOOK INSERT EXCEPTION] Failed to insert message:', err);
    }

    this.saveToFile();
    return { conversation: conv, message: newMsg };
  }
}

export const chatStore = new ChatStore();
