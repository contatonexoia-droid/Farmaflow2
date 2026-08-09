import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

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
    const msgUuid = crypto.randomUUID();
    const newMsg: ChatMessage = {
      id: msgUuid,
      conversation_id: conversationId,
      sender_type: senderType,
      content,
      is_private: isPrivate,
      media_url: mediaUrl,
      media_type: mediaType,
      created_at: now
    };

    // Evolution API Dispatch (for USER/BOT messages, if not private)
    if ((senderType === "USER" || senderType === "BOT") && !isPrivate) {
      try {
        // 1. Get instance name
        const { data: instData } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("instance_name")
          .eq("store_id", storeId)
          .maybeSingle();

        // 2. Get customer phone
        const { data: convData } = await supabaseAdmin
          .from("chat_conversations")
          .select("contact_id")
          .eq("id", conversationId)
          .maybeSingle();
        
        let phoneToSend = null;
        if (convData?.contact_id) {
          const { data: contactData } = await supabaseAdmin
            .from("chat_contacts")
            .select("phone_number")
            .eq("id", convData.contact_id)
            .maybeSingle();
          if (contactData?.phone_number) phoneToSend = contactData.phone_number;
        }

        if (instData?.instance_name && phoneToSend) {
          const evoUrl = process.env.EVOLUTION_API_URL?.replace(/\/$/, "");
          const evoKey = process.env.EVOLUTION_API_KEY;
          
          if (evoUrl && evoKey) {
            const sendUrl = `${evoUrl}/message/sendText/${instData.instance_name}`;
            // Add suffix if missing
            const remoteJid = phoneToSend.includes("@s.whatsapp.net") ? phoneToSend : `${phoneToSend}@s.whatsapp.net`;
            
            const payload = {
              number: remoteJid,
              text: content
            };

            // Using await to ensure it dispatches reliably, but wrapping in a self-executing async block to not block DB insert
            (async () => {
              try {
                const res = await fetch(sendUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': evoKey
                  },
                  body: JSON.stringify(payload)
                });
                if (!res.ok) {
                  const errText = await res.text();
                  console.error('[EVOLUTION API ERROR] Failed to send message:', errText);
                } else {
                  console.log('[EVOLUTION API] Message sent successfully to', remoteJid);
                }
              } catch (e) {
                console.error('[EVOLUTION API ERROR] Network error:', e);
              }
            })();
          } else {
             console.error('[EVOLUTION API] Missing URL or Key in environment variables');
          }
        } else {
          console.error('[EVOLUTION API] Missing instance_name or phone_number to send message. instance:', instData?.instance_name, 'phone:', phoneToSend);
        }
      } catch (evoErr) {
        console.error('[EVOLUTION API] Exception preparing to send message:', evoErr);
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
        media_url: mediaUrl,
        media_type: mediaType,
        created_at: now
      }]);

      if (error) {
        console.error('[ERRO CRITICO NO BACKGROUND]: Erro ao inserir mensagem no addMessage', error.message, error);
      }

      const { error: convErr } = await supabaseAdmin.from("chat_conversations").update({
        last_message_at: now
      }).eq("id", conversationId);

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
    
    if (!remoteJid || remoteJid.includes("@g.us") || remoteJid === "status@broadcast") {
       if (!remoteJid) console.error('[WEBHOOK EXTRACT ERROR] No remoteJid found in message:', JSON.stringify(msg, null, 2));
       return null;
    }

    // Evolution API multi-device format often includes a colon, e.g., 5511988887777:2@s.whatsapp.net
    let phone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    if (phone.includes(":")) {
      phone = phone.split(":")[0];
    }
    // Garante que a string do telefone só contenha números (limpa hifens ou outros caracteres caso venham)
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

    console.log('[PAYLOAD EXTRAÍDO COM SUCESSO]:', { phone, text, fromMe });

    const now = new Date().toISOString();

    // Deterministic valid UUIDs for Supabase PK/FK compliance
    const contactId = stringToUuid(`contact_${phone}_${storeId}`);
    const convId = stringToUuid(`conv_${phone}_${storeId}`);
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
        if (fromMe) finalContactName = phone; // Fallback se o próprio usuário iniciou a conversa
        await supabaseAdmin.from("chat_contacts").insert([{
          id: contactId,
          store_id: storeId,
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
      store_id: storeId,
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
        if (convInfo?.inbox_id) {
          resolvedInboxId = convInfo.inbox_id;
        }
      }
    } catch (error: any) {
      console.error('[ERRO CRITICO NO BACKGROUND]: Exceção ao buscar dados da conversa', error.message, error.stack);
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
      status: "OPEN",
      last_message_at: now,
      last_message_content: text,
      unread_count: newUnreadCount,
      contact: contact,
      created_at: now
    };

    // 3. Busca ou criação da conversa (chat_conversations)
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
}

export const chatStore = new ChatStore();
