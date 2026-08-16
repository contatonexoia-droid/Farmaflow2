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
  team_id?: string | null;
  assigned_user_id?: string | null;
  status: "OPEN" | "PENDING" | "CLOSED" | "BOT";
  kanban_stage?: "NEW" | "BOT" | "WAITING" | "STORE_REDIRECT" | "HUMAN" | "CLOSED";
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

export interface PrescriptionRejectionReasonItem {
  id: string;
  store_id: string;
  title: string;
  description?: string;
  message_template: string;
  is_active: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_PRESCRIPTION_REASONS: Array<Omit<PrescriptionRejectionReasonItem, "id" | "store_id" | "created_at" | "updated_at">> = [
  {
    title: "Receita Vencida",
    description: "Prazo de validade do receituário expirado conforme normas sanitárias da ANVISA.",
    message_template: "⚠️ *Receita Médica Vencida*\n\nOlá! Analisamos a foto da sua receita médica e identificamos que o prazo de validade está expirado. De acordo com as normas da ANVISA (RDC), não é permitida a dispensação de medicamentos com receita vencida.\n\nPor favor, consulte seu médico para emissão de um novo receituário atualizado. Ficamos à disposição!",
    is_active: true,
    order_index: 1,
  },
  {
    title: "Rasurada ou Ilegível",
    description: "Foto sem nitidez, dados cortados ou caligrafia ilegível.",
    message_template: "📷 *Receita Ilegível ou com Rasuras*\n\nOlá! Recebemos a foto da sua receita, porém a caligrafia, dosagem ou identificação do medicamento não estão nitidamente legíveis para garantir uma dispensação 100% segura.\n\nVocê poderia nos enviar uma nova foto com melhor iluminação, foco e enquadramento completo do documento?",
    is_active: true,
    order_index: 2,
  },
  {
    title: "Sem Carimbo ou CRM do Médico",
    description: "Ausência de assinatura, carimbo legível ou registro CRM do médico prescritor.",
    message_template: "👨‍⚕️ *Identificação Médica Incompleta*\n\nOlá! Para validação farmacêutica da receita, é obrigatório constar de forma legível a assinatura, carimbo e número de registro no CRM do médico prescritor.\n\nA imagem enviada não possui esses dados claros. Caso tenha a via completa, por gentileza envie uma nova foto.",
    is_active: true,
    order_index: 3,
  },
  {
    title: "Via Controlada Exige Presença Física",
    description: "Medicamento controlado com retenção de receita física obrigatória (Portaria 344/98).",
    message_template: "📋 *Retenção de Receita Obrigatória*\n\nOlá! O medicamento solicitado requer a retenção da via original física da Notificação de Receita (Portaria 344/98 da ANVISA).\n\nNossa equipe pode agilizar a separação do seu pedido, porém será indispensável a entrega da receita física original ao nosso entregador ou na retirada no balcão da farmácia.",
    is_active: true,
    order_index: 4,
  },
  {
    title: "Medicamento em Falta / Dosagem Indisponível",
    description: "Apresentação ou princípio ativo temporariamente sem estoque na loja.",
    message_template: "💊 *Medicamento Temporariamente Indisponível*\n\nOlá! Agradecemos o envio da sua receita. No momento, a dosagem ou apresentação específica indicada encontra-se temporariamente esgotada em nosso estoque.\n\nPodemos verificar para você opções de medicamentos genéricos ou similares equivalentes com o mesmo princípio ativo?",
    is_active: true,
    order_index: 5,
  },
];

class ChatStore {
  private contacts: ChatContact[] = [];
  private conversations: ChatConversation[] = [];
  private messages: ChatMessage[] = [];
  private labels: ChatLabel[] = [];
  private conversation_labels: ChatConversationLabel[] = [];
  private canned_responses: CannedResponse[] = [];
  private rejection_reasons: PrescriptionRejectionReasonItem[] = [];
  private prescriptions: any[] = [];

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
        this.rejection_reasons = parsed.rejection_reasons || [];
        this.prescriptions = parsed.prescriptions || [];
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
            rejection_reasons: this.rejection_reasons,
            prescriptions: this.prescriptions,
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
        { id: "lbl_demo_rec_recusada", store_id: "default", name: "Receita Recusada", color: "#EF4444", created_at: new Date().toISOString() },
        { id: "lbl_demo_rec_aprovada", store_id: "default", name: "Receita Aprovada", color: "#10B981", created_at: new Date().toISOString() },
      ];
    }

    // Add default rejection reasons if empty
    if (this.rejection_reasons.length === 0) {
      const nowIso = new Date().toISOString();
      this.rejection_reasons = DEFAULT_PRESCRIPTION_REASONS.map((r, idx) => ({
        ...r,
        id: `rejection_reason_default_${idx + 1}`,
        store_id: "default",
        created_at: nowIso,
        updated_at: nowIso,
      }));
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
          // Normalize legacy conversations where kanban_stage is NULL or undefined
          if (!conv.kanban_stage || !["NEW", "BOT", "WAITING", "STORE_REDIRECT", "HUMAN", "CLOSED"].includes(conv.kanban_stage)) {
            if (conv.status === "CLOSED") {
              conv.kanban_stage = "CLOSED";
            } else if (conv.is_bot_active !== false && (conv.status === "BOT" || !conv.status)) {
              conv.kanban_stage = "BOT";
            } else if (conv.status === "PENDING") {
              conv.kanban_stage = "WAITING";
            } else if (conv.bot_handoff_reason === "STORE_REDIRECT") {
              conv.kanban_stage = "STORE_REDIRECT";
            } else if (conv.assigned_user_id) {
              conv.kanban_stage = "HUMAN";
            } else {
              conv.kanban_stage = "NEW";
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
      if (!conv.kanban_stage || !["NEW", "BOT", "WAITING", "STORE_REDIRECT", "HUMAN", "CLOSED"].includes(conv.kanban_stage)) {
        if (conv.status === "CLOSED") {
          conv.kanban_stage = "CLOSED";
        } else if (conv.is_bot_active !== false && (conv.status === "BOT" || !conv.status)) {
          conv.kanban_stage = "BOT";
        } else if (conv.status === "PENDING") {
          conv.kanban_stage = "WAITING";
        } else if (conv.bot_handoff_reason === "STORE_REDIRECT") {
          conv.kanban_stage = "STORE_REDIRECT";
        } else if (conv.assigned_user_id) {
          conv.kanban_stage = "HUMAN";
        } else {
          conv.kanban_stage = "NEW";
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

  public async processWhatsAppMessage(storeId: string, msg: any, instanceName?: string): Promise<{ conversation: ChatConversation; message: ChatMessage } | null> {
    if (!msg) return null;

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
        query.eq("store_id", storeId);
      }
      const { data: inst } = await query.limit(1).maybeSingle();
      if (inst) {
        instancePhoneNumber = inst.phone_number ? inst.phone_number.replace(/\D/g, "") : "";
        instanceNameFromDb = inst.instance_name || "";
      }
    } catch (e: any) {
      console.warn("Error fetching whatsapp_instance for fromMe check:", e.message);
    }

    // If pushName is "Evandro" (or matches instance name) and the remote phone is different,
    // this message is actually sent from our side (or represents the instance owner), so we must treat it as fromMe = true
    const isOwnerName = pushName.toLowerCase() === "evandro" || 
                        (instanceNameFromDb && pushName.toLowerCase().includes(instanceNameFromDb.toLowerCase()));
                        
    if (isOwnerName && phone !== instancePhoneNumber) {
      fromMe = true;
    }

    console.log('[PAYLOAD EXTRAÍDO COM SUCESSO]:', { phone, text, fromMe, instanceName });

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
        // Se for uma mensagem enviada por mim ou não tiver pushName novo útil, ou se for o nome do dono, mantenha o nome existente.
        if (fromMe || !msg.pushName || isOwnerName) {
          finalContactName = existingContact.name;
        } else {
          finalContactName = pushName;
          await supabaseAdmin.from("chat_contacts").update({
            name: finalContactName,
          }).eq("id", contactId);
        }
      } else {
        if (fromMe || isOwnerName) {
          finalContactName = phone; // Fallback se o próprio usuário iniciou a conversa
        }
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

    // Try routing message to specific inbox based on the instanceName we received
    if (!resolvedInboxId && instanceName) {
      try {
        const { data: inst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("id")
          .eq("instance_name", instanceName)
          .maybeSingle();
          
        if (inst?.id) {
          const { data: inbox } = await supabaseAdmin
            .from("inboxes")
            .select("id")
            .eq("whatsapp_instance_id", inst.id)
            .maybeSingle();
            
          if (inbox?.id) {
            resolvedInboxId = inbox.id;
            console.log(`[ChatStore] Routed conversation ${convId} to inbox ${resolvedInboxId} because of instance ${instanceName}`);
          }
        }
      } catch (routingErr: any) {
        console.warn("[ChatStore] Error routing message by instanceName:", routingErr.message);
      }
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
    try {
      const { data, error } = await supabaseAdmin
        .from("chat_conversations")
        .select("*, contact:chat_contacts(*)")
        .eq("id", conversationId)
        .maybeSingle();
      if (!error && data) {
        return data as ChatConversation;
      }
    } catch (err) {
      console.warn("[ChatStore] getConversationById fallback:", err);
    }
    const found = this.conversations.find(c => c.id === conversationId);
    return found || null;
  }

  public async updateConversationBotStatus(
    conversationId: string,
    updates: {
      is_bot_active?: boolean;
      bot_interaction_count?: number;
      bot_handoff_reason?: string;
      bot_handoff_at?: string;
      status?: "OPEN" | "PENDING" | "CLOSED" | "BOT";
      kanban_stage?: "NEW" | "BOT" | "WAITING" | "STORE_REDIRECT" | "HUMAN" | "CLOSED";
      assigned_user_id?: string | null;
      last_message_at?: string;
      last_message_content?: string;
    }
  ): Promise<void> {
    try {
      await supabaseAdmin
        .from("chat_conversations")
        .update(updates)
        .eq("id", conversationId);
    } catch (err) {
      console.warn("[ChatStore] updateConversationBotStatus error:", err);
    }
    const idx = this.conversations.findIndex(c => c.id === conversationId);
    if (idx >= 0) {
      this.conversations[idx] = {
        ...this.conversations[idx],
        ...updates
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
    }

    switch (targetStage) {
      case "NEW":
        updates.status = "OPEN";
        updates.is_bot_active = false;
        break;
      case "BOT":
        updates.status = "BOT";
        updates.is_bot_active = true;
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
        updates.status = "OPEN";
        updates.is_bot_active = false;
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

  // --- PRESCRIPTION REJECTION REASONS & EVALUATION ---
  public async getPrescriptionRejectionReasons(storeId: string): Promise<PrescriptionRejectionReasonItem[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("prescription_rejection_reasons")
        .select("*")
        .eq("store_id", storeId)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true });

      if (!error && data && data.length > 0) {
        return data as PrescriptionRejectionReasonItem[];
      }

      // If empty in database for this store, seed default reasons into DB
      if (!error && data && data.length === 0) {
        const nowIso = new Date().toISOString();
        const rowsToSeed = DEFAULT_PRESCRIPTION_REASONS.map((r, idx) => ({
          id: stringToUuid(`rejection_reason_${storeId}_${idx + 1}`),
          store_id: storeId,
          title: r.title,
          description: r.description,
          message_template: r.message_template,
          is_active: r.is_active,
          order_index: r.order_index,
          created_at: nowIso,
          updated_at: nowIso
        }));

        try {
          const { data: seededData } = await supabaseAdmin
            .from("prescription_rejection_reasons")
            .insert(rowsToSeed)
            .select();
          if (seededData && seededData.length > 0) {
            return seededData as PrescriptionRejectionReasonItem[];
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase getPrescriptionRejectionReasons fallback:", err);
    }

    // Memory fallback
    let list = this.rejection_reasons.filter(r => r.store_id === storeId || r.store_id === "default");
    if (list.length === 0) {
      const nowIso = new Date().toISOString();
      list = DEFAULT_PRESCRIPTION_REASONS.map((r, idx) => ({
        ...r,
        id: `rejection_reason_${storeId}_${idx + 1}`,
        store_id: storeId,
        created_at: nowIso,
        updated_at: nowIso,
      }));
      this.rejection_reasons.push(...list);
      this.saveToFile();
    }
    return list.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
  }

  public async savePrescriptionRejectionReason(reason: {
    id?: string;
    store_id: string;
    title: string;
    description?: string;
    message_template: string;
    is_active?: boolean;
    order_index?: number;
  }): Promise<PrescriptionRejectionReasonItem> {
    const id = reason.id || stringToUuid(`rej_reason_${Date.now()}_${Math.random()}`);
    const nowIso = new Date().toISOString();
    const item: PrescriptionRejectionReasonItem = {
      id,
      store_id: reason.store_id,
      title: reason.title,
      description: reason.description || "",
      message_template: reason.message_template,
      is_active: reason.is_active !== undefined ? reason.is_active : true,
      order_index: reason.order_index || 0,
      created_at: nowIso,
      updated_at: nowIso,
    };

    try {
      const { error } = await supabaseAdmin
        .from("prescription_rejection_reasons")
        .upsert([item]);
      if (error) {
        console.warn("[ChatStore] Supabase savePrescriptionRejectionReason error:", error.message);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase savePrescriptionRejectionReason fallback:", err);
    }

    const idx = this.rejection_reasons.findIndex(r => r.id === id);
    if (idx >= 0) {
      this.rejection_reasons[idx] = item;
    } else {
      this.rejection_reasons.push(item);
    }
    this.saveToFile();
    return item;
  }

  public async deletePrescriptionRejectionReason(id: string, storeId: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from("prescription_rejection_reasons")
        .delete()
        .eq("id", id)
        .eq("store_id", storeId);
      if (error) {
        console.warn("[ChatStore] Supabase deletePrescriptionRejectionReason error:", error.message);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase deletePrescriptionRejectionReason fallback:", err);
    }

    this.rejection_reasons = this.rejection_reasons.filter(r => !(r.id === id && (r.store_id === storeId || r.store_id === "default")));
    this.saveToFile();
    return true;
  }

  public async savePrescriptionRecord(data: {
    id?: string;
    store_id: string;
    conversation_id?: string;
    customer_id?: string;
    order_id?: string;
    file_url: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    rejection_reason_id?: string;
    rejection_reason_title?: string;
    rejection_notes?: string;
    evaluated_by?: string;
    evaluated_by_name?: string;
    evaluated_at?: string;
    notes?: string;
  }): Promise<any> {
    const id = data.id || stringToUuid(`presc_${Date.now()}_${Math.random()}`);
    const nowIso = new Date().toISOString();
    const record = {
      id,
      store_id: data.store_id,
      conversation_id: data.conversation_id || null,
      customer_id: data.customer_id || null,
      order_id: data.order_id || null,
      file_url: data.file_url || "",
      status: data.status,
      rejection_reason_id: data.rejection_reason_id || null,
      rejection_reason_title: data.rejection_reason_title || null,
      rejection_notes: data.rejection_notes || null,
      evaluated_by: data.evaluated_by || null,
      evaluated_by_name: data.evaluated_by_name || null,
      evaluated_at: data.evaluated_at || nowIso,
      notes: data.notes || null,
      created_at: nowIso,
      updated_at: nowIso
    };

    try {
      const { data: inserted, error } = await supabaseAdmin
        .from("medical_prescriptions")
        .upsert([record])
        .select()
        .maybeSingle();

      if (!error && inserted) {
        return inserted;
      }
      if (error) {
        console.warn("[ChatStore] Supabase savePrescriptionRecord error:", error.message);
      }
    } catch (err) {
      console.warn("[ChatStore] Supabase savePrescriptionRecord fallback:", err);
    }

    const idx = this.prescriptions.findIndex(p => p.id === id);
    if (idx >= 0) {
      this.prescriptions[idx] = record;
    } else {
      this.prescriptions.push(record);
    }
    this.saveToFile();
    return record;
  }

  public async getPrescriptionsByConversation(conversationId: string): Promise<any[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("medical_prescriptions")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false });
      if (!error && data) {
        return data;
      }
    } catch (err) {
      console.warn("[ChatStore] getPrescriptionsByConversation fallback:", err);
    }

    return this.prescriptions.filter(p => p.conversation_id === conversationId);
  }

  public async tagConversationWithPrescriptionStatus(
    conversationId: string,
    storeId: string,
    decision: "APPROVED" | "REJECTED"
  ): Promise<ChatLabel> {
    const tagName = decision === "APPROVED" ? "Receita Aprovada" : "Receita Recusada";
    const tagColor = decision === "APPROVED" ? "#10B981" : "#EF4444";

    // 1. Get existing labels for store
    const existingLabels = await this.getLabels(storeId);
    let targetLabel = existingLabels.find(l => l.name.trim().toLowerCase() === tagName.toLowerCase());

    if (!targetLabel) {
      targetLabel = await this.saveLabel({
        store_id: storeId,
        name: tagName,
        color: tagColor
      });
    }

    // 2. Attach label to conversation
    const currentConvLabels = await this.getConversationLabels(conversationId);
    const existingIds = currentConvLabels.map(l => l.id);
    
    // Remove the opposite tag if present to keep state clean
    const oppositeTagName = decision === "APPROVED" ? "Receita Recusada" : "Receita Aprovada";
    const filteredIds = existingIds.filter(id => {
      const lbl = existingLabels.find(l => l.id === id);
      return lbl?.name.trim().toLowerCase() !== oppositeTagName.toLowerCase();
    });

    if (!filteredIds.includes(targetLabel.id)) {
      filteredIds.push(targetLabel.id);
    }

    await this.setConversationLabels(conversationId, filteredIds);
    return targetLabel;
  }
}

export const chatStore = new ChatStore();
