import { createClient } from "@supabase/supabase-js";
import { realtimeHub } from "./realtimeHub.js";
import { chatStore, sanitizeChatConversationPayload } from "./chatStore.js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export type BotState = "BOT_WELCOME" | "BOT_TRIAGE" | "HUMAN_UNASSIGNED" | "HUMAN_ASSIGNED";

export interface HandoffResult {
  newState: BotState;
  assignedOperatorId?: string;
  message?: string;
  isBotActive: boolean;
  handoffReason?: string;
}

/**
 * Normaliza o texto para detecção resiliente de intenções (sem acentos, minúsculo, sem pontuação excessiva)
 */
export function normalizeTextForIntent(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^\w\s]/gi, ' ') // remove pontuações
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detector de alta sensibilidade para pedidos de Atendimento Humano, Balconista, Farmacêutico ou Atendente
 */
export function detectHumanHandoffIntent(message: string): { isHumanRequested: boolean; reason?: string } {
  if (!message || typeof message !== 'string') return { isHumanRequested: false };
  const raw = message.trim();
  const normalized = normalizeTextForIntent(raw);

  if (!normalized) return { isHumanRequested: false };

  // 1. Mensagens diretas e termos exatos
  const directWords = [
    "atendente", "balconista", "humano", "humana", "pessoa", "farmaceutico", "farmaceutica",
    "atendente humano", "pessoa real", "balcao", "atendente por favor", "balconista por favor",
    "falar com atendente", "falar com balconista", "falar com humano", "falar com pessoa",
    "falar com farmaceutico", "chamar atendente", "chamar balconista", "chamar humano",
    "chamar farmaceutico", "quero atendente", "quero balconista", "quero humano", "quero pessoa",
    "preciso de atendente", "preciso de balconista", "preciso de humano", "passa pro atendente",
    "passa para o atendente", "passa pro balconista", "passa para o balconista",
    "transferir para atendente", "transferir para balconista", "transferir para humano",
    "me transfere", "me passa", "0", "falar com atendente humano", "quero falar com atendente",
    "quero falar com o balconista", "quero falar com um atendente", "quero falar com balconista",
    "atendimento humano", "suporte humano", "falar com atendente", "falar com atendentes",
    "falar com balconistas", "atendentes", "balconistas", "gente", "pessoa de verdade"
  ];

  if (directWords.includes(normalized)) {
    return { isHumanRequested: true, reason: "DIRECT_KEYWORD" };
  }

  // 2. Expressões Regulares de Intenção de Transferência / Balconista / Atendente Humano
  const handoffPatterns = [
    // Verbos de ação + atendente/balconista/humano/farmacêutico
    /\b(falar|conversar|dialogar|passar|passa|transfere|transferir|chamar|chama|conectar|mandar|encaminhar|colocar|atender|atende)\s+(com\s+|pro\s+|pra\s+|para\s+)?(um|uma|o|a|os|as\s+)?(atendente|balconista|farmaceutico|farmaceutica|humano|humana|pessoa|operador|operadora|vendedor|vendedora|balcao|equipe|alguem|gente)\b/i,
    
    // Quero / Preciso / Gostaria de + atendente/balconista/humano
    /\b(quero|queria|preciso|precisava|gostaria\s+de|desejo|favor)\s+(falar\s+com\s+|conversar\s+com\s+|atendimento\s+com\s+|ser\s+atendido\s+por\s+)?(um|uma|o|a|os|as\s+)?(atendente|balconista|farmaceutico|farmaceutica|humano|humana|pessoa|operador|operadora|vendedor|vendedora|balcao|alguem)\b/i,
    
    // Pergunta de disponibilidade de humano / atendente
    /\b(tem|teria|existe|possui)\s+(algum|alguma|um|uma\s+)?(atendente|balconista|humano|pessoa|farmaceutico|alguem)\s+(ai|online|disponivel|pra\s+falar|atendendo)?\b/i,
    
    // Rejeição ao bot / robô
    /\b(nao\s+quero|chega\s+de|sai|odeio|para\s+de)\s+(robo|bot|ia|inteligencia\s+artificial|maquina|sistema\s+automatico)\b/i,
    /\b(quero\s+falar\s+com\s+gente|falar\s+com\s+gente\s+de\s+verdade|pessoa\s+de\s+carne\s+e\s+osso)\b/i,

    // Atendimento humano explícito
    /\b(atendimento\s+humano|suporte\s+humano|contato\s+humano|atendente\s+humano|balconista\s+humano)\b/i,
    /\b(me\s+passa|me\s+transfere|me\s+atende|me\s+ajuda\s+alguem|tem\s+alguem\s+ai)\b/i,

    // Remédios de controle especial e receitas
    /\b(remedio\s+controlado|medicamento\s+controlado|tarja\s+preta|receita\s+controlada|notificacao\s+de\s+receita)\b/i
  ];

  for (const pattern of handoffPatterns) {
    if (pattern.test(normalized)) {
      return { isHumanRequested: true, reason: "REGEX_PATTERN_MATCH" };
    }
  }

  return { isHumanRequested: false };
}

/**
 * Reconhecimento refinado de escolha de produto e intenção de compra do cliente
 * (ex: "vou querer a da prati", "vou querer essa da ems de 4,49", "pode ser o número 1", "quero essa", etc.)
 */
export function detectCustomerChoiceIntent(
  message: string,
  history: Array<{ role: string; content: string }> = []
): { isChoice: boolean; details?: string } {
  if (!message || typeof message !== "string") return { isChoice: false };
  const raw = message.trim();
  const norm = normalizeTextForIntent(raw);
  if (!norm) return { isChoice: false };

  // 1. Padrões diretos de escolha e intenção de compra
  const directChoicePatterns = [
    /\b(vou\s+(querer|levar|ficar|pegar|comprar))\b/i,
    /\b(quero\s+(essa|esse|esta|este|a\s+de|o\s+de|a\s+da|o\s+da|a\s+do|o\s+do|a\s+primeir|o\s+primeir|a\s+segund|o\s+segund|a\s+terceir|o\s+terceir|opcao|a\s+mais|o\s+mais))\b/i,
    /\b(pode\s+ser\s+(essa|esse|esta|este|a|o|um|uma|opcao|numero|n[°ºo]?))\b/i,
    /\b(adiciona|adicionar|separa|separar|separe|manda|mandar|coloca|colocar)\b.*(essa|esse|esta|este|pra\s+mim|pedido|carrinho|a\s+de|o\s+de|da|do)/i,
    /\b(prefiro\s+(a|o|essa|esse|esta|este|a\s+mais|o\s+mais))\b/i,
    /\b(vou\s+comprar|vou\s+fechar|quero\s+fechar|fechar\s+(esse|essa|pedido))\b/i,
    /\b(gostei\s+d[ao]|fica\s+com\s+ess[ae])\b/i
  ];

  for (const pat of directChoicePatterns) {
    if (pat.test(norm)) {
      return { isChoice: true, details: "DIRECT_CHOICE_PATTERN" };
    }
  }

  // 2. Frases curtas e objetivas indicando escolha de item específico
  if (norm.length <= 40) {
    if (/\b(quero|vou\s+querer|pode\s+ser|vou\s+levar)\b/i.test(norm)) {
      return { isChoice: true, details: "SHORT_INTENT_KEYWORD" };
    }
    if (/\b(essa\s+mesm[ao]|ess[ae]\s+d[ae]|ess[ae]\s+de\s+\d+|o\s+de\s+\d+|a\s+de\s+\d+)\b/i.test(norm)) {
      return { isChoice: true, details: "SPECIFIC_ITEM_REFERENCE" };
    }
  }

  // 3. Análise do histórico recente: se o bot ofereceu opções no turno imediatamente anterior
  const lastBotMsg = history.slice().reverse().find(m => m.role === "assistant" || m.role === "model");
  const lastBotText = normalizeTextForIntent(lastBotMsg?.content || "");
  const botOfferedOptions = lastBotText.includes("opc") || 
                            lastBotText.includes("1") || 
                            lastBotText.includes("qual dessas") || 
                            lastBotText.includes("mais economica") ||
                            lastBotText.includes("disponivel nas seguintes") ||
                            lastBotText.includes("qual voce prefere");

  if (botOfferedOptions) {
    // Escolha por número simples ou ordinal isolado
    if (/^(1|2|3|4|5|1\.|2\.|3\.|4\.|5\.|opc[aã]o\s*[1-5]|o\s*[1-5]|a\s*[1-5]|numero\s*[1-5]|n[°ºo]?\s*[1-5])$/i.test(norm)) {
      return { isChoice: true, details: "NUMBER_SELECTION_FROM_OPTIONS" };
    }
    if (/^(primeir[ao]|segund[ao]|terceir[ao]|quart[ao]|a\s+primeir[ao]|a\s+segund[ao]|o\s+primeir[ao]|o\s+segund[ao])$/i.test(norm)) {
      return { isChoice: true, details: "ORDINAL_SELECTION_FROM_OPTIONS" };
    }
    if (/\b(mais\s+barat[ao]|mais\s+economic[ao]|em\s+conta)\b/i.test(norm)) {
      return { isChoice: true, details: "ECONOMIC_CHOICE_FROM_OPTIONS" };
    }
    // Menção isolada à marca após opções oferecidas (ex: "da prati", "a medley", "ems")
    if (/\b(prati|ems|medley|neo\s*quimica|neoq|germed|germ|cimed|eurofarma|ache|sanofi)\b/i.test(norm)) {
      return { isChoice: true, details: "LABORATORY_CHOICE_FROM_OPTIONS" };
    }
    if (/\b(essa|esse|esta|este)\b/i.test(norm)) {
      return { isChoice: true, details: "DEMONSTRATIVE_CHOICE_FROM_OPTIONS" };
    }
  }

  return { isChoice: false };
}

/**
 * Mensagem de confirmação personalizada com o link direto do produto escolhido
 */
export function buildProductHandoffMessage(
  productName: string,
  priceFormatted: string,
  directProductUrl: string
): string {
  const cleanUrl = String(directProductUrl || "").trim();
  return `Perfeito! Já separei para você:
💊 *${productName}* - R$ ${priceFormatted} 😊

🛒 **Link direto para concluir seu pedido:**
👉 

${cleanUrl}

*(Pelo link você fecha em menos de 1 minuto, escolhe a forma de pagamento e seu pedido chega mais rápido!)*

💬 **Prefere continuar aqui pelo WhatsApp?**
Sem problemas! Um dos nossos balconistas já vai assumir o atendimento para finalizar seu pedido.`;
}

/**
 * Mensagem de conclusão acolhedora e comercial com incentivo à Webloja e transbordo ao balconista
 */
export function buildHumanizedHandoffMessage(
  storeUrl: string,
  productInfo?: { name: string; price: string; link: string }
): string {
  if (productInfo && productInfo.name && productInfo.link) {
    return buildProductHandoffMessage(productInfo.name, productInfo.price, productInfo.link);
  }
  const cleanUrl = (storeUrl || "https://farmaflow.online").replace(/\/+$/, "");
  return `Perfeito! Já anotei a sua preferência. 😊

🛒 *Dica para agilizar:* Você pode concluir seu pedido agora mesmo pela nossa loja online:

${cleanUrl}

*(É muito mais rápido, prático e 100% seguro!)*

💬 *Prefere continuar por aqui?* Sem problemas! Já notifiquei nossa equipe e um dos nossos balconistas vai dar continuidade ao seu atendimento em instantes para finalizar seu pedido.`;
}

/**
 * Detector de mensagens de resumo de pedido originadas da Webloja / Loja Online FarmaFlow
 */
export function isWeblojaOrderMessage(text: string): {
  isOrder: boolean;
  orderId?: string;
  customerName?: string;
  total?: string;
} {
  if (!text || typeof text !== 'string') return { isOrder: false };
  const raw = text.trim();
  if (raw.length < 15) return { isOrder: false };

  const normalized = normalizeTextForIntent(raw);

  // 1. Extração de ID de Pedido (ex: PEDIDO #123456 ou PEDIDO #a1b2c3)
  const orderIdMatch = raw.match(/PEDIDO\s*#?([A-Za-z0-9\-_]+)/i) || raw.match(/Pedido\s*(?:nº|n°|num|numero|#)?\s*([A-Za-z0-9\-_]+)/i);
  const orderId = orderIdMatch ? orderIdMatch[1] : undefined;

  // 2. Extração de Nome do Cliente se presente
  const customerMatch = raw.match(/\*?Nome:\*?\s*([^\n\r]+)/i) || raw.match(/Cliente:\s*([^\n\r]+)/i);
  const customerName = customerMatch ? customerMatch[1].trim() : undefined;

  // 3. Extração de Total se presente
  const totalMatch = raw.match(/TOTAL:\s*(?:R\$\s*)?([0-9.,]+)/i) || raw.match(/Valor Total:\s*(?:R\$\s*)?([0-9.,]+)/i);
  const total = totalMatch ? totalMatch[1].trim() : undefined;

  // 4. Indicadores estruturados de pedido da Webloja
  const hasOrderHeader = 
    /(\*?🆕?\s*PEDIDO\s*#|\*?NOVO PEDIDO|\*?RESUMO DO PEDIDO|\*?PEDIDO DA LOJA|\*?PEDIDO WEBLOJA|\*?CONFIRMACAO DE PEDIDO|\*?PEDIDO ONLINE)/i.test(raw) ||
    /(pedido\s*#|novo\s*pedido|resumo\s*do\s*pedido|pedido\s*da\s*loja|pedido\s*webloja|pedido\s*online)/i.test(normalized);

  const hasProductsOrItems = 
    /(\*?🛒?\s*PRODUTOS|\*?ITENS DO PEDIDO|\*?ITENS:|\bprodutos\b|\bitens\b)/i.test(raw) ||
    /(produtos|itens do pedido|itens)/i.test(normalized);

  const hasTotalOrPayment = 
    /(\*?💰?\s*TOTAL|\*?💳?\s*PAGAMENTO|\*?VALOR TOTAL|TAXA DE ENTREGA|\btotal:\s*r\$|\bpagamento:\b)/i.test(raw) ||
    /(total r|valor total|pagamento|taxa de entrega)/i.test(normalized);

  const hasCustomerOrDelivery = 
    /(\*?👤?\s*DADOS DO CLIENTE|\*?📍?\s*(ENTREGA|RETIRADA NA LOJA)|\bendereco:|\bretirada no balcao)/i.test(raw) ||
    /(dados do cliente|retirada na loja|entrega|endereco de retirada)/i.test(normalized);

  // A. Padrão direto com cabeçalho explícito de pedido + itens/total/cliente
  if (hasOrderHeader && (hasTotalOrPayment || hasProductsOrItems || hasCustomerOrDelivery)) {
    return { isOrder: true, orderId, customerName, total };
  }

  // B. Padrão completo de carrinho finalizado (Produtos + Total + Entrega/Pagamento)
  if (hasProductsOrItems && hasTotalOrPayment && hasCustomerOrDelivery) {
    return { isOrder: true, orderId, customerName, total };
  }

  // C. Pontuação por múltiplos marcadores de pedido
  let orderScore = 0;
  if (/\b(pedido|resumo)\b/i.test(normalized)) orderScore += 1;
  if (/\b(produtos|itens|quantidade|unidades|\d+x)\b/i.test(normalized)) orderScore += 1;
  if (/\b(total|subtotal|valor total|r\$)\b/i.test(normalized)) orderScore += 1;
  if (/\b(pagamento|cartao|dinheiro|pix|troco|credito|debito)\b/i.test(normalized)) orderScore += 1;
  if (/\b(entrega|retirada|taxa de entrega|frete|endereco|bairro)\b/i.test(normalized)) orderScore += 1;

  if (orderScore >= 4) {
    return { isOrder: true, orderId, customerName, total };
  }

  return { isOrder: false };
}

export class BotHandoffManager {
  private static instance: BotHandoffManager;

  private constructor() {}

  public static getInstance(): BotHandoffManager {
    if (!BotHandoffManager.instance) {
      BotHandoffManager.instance = new BotHandoffManager();
    }
    return BotHandoffManager.instance;
  }

  /**
   * Avalia a mensagem recebida no robô. Se detectar termo sensível ou pedido de atendente, aciona o transbordo humano e Round-Robin.
   */
  public async processMessageState(
    conversationId: string,
    storeId: string,
    content: string,
    currentStatus: string
  ): Promise<HandoffResult> {
    const handoffCheck = detectHumanHandoffIntent(content);

    if (handoffCheck.isHumanRequested) {
      console.log(`[BotHandoffManager] Handoff triggered for conversation ${conversationId} (reason: ${handoffCheck.reason}, content: "${content}")`);
      return await this.triggerHandoff(
        conversationId,
        storeId,
        "HUMAN_REQUESTED",
        "Com certeza! Já estou transferindo o seu atendimento para a nossa equipe de balconistas. Um momento que um atendente humano já vai te responder por aqui! 👨‍⚕️"
      );
    }

    return { newState: "BOT_TRIAGE", isBotActive: true };
  }

  /**
   * Executa a transição da conversa do Bot para a Fila de Atendimento Humano
   */
  public async triggerHandoff(
    conversationId: string,
    storeId: string,
    reason: string = "MANUAL_OR_BOT_COMPLETED",
    customMessage?: string
  ): Promise<HandoffResult> {
    const nowIso = new Date().toISOString();
    const assignedOperator = await this.allocateNextOnlineOperator(storeId);

    const defaultTransitionMsg = customMessage || "Encaminhei sua solicitação para a nossa equipe. Um de nossos atendentes humanos já vai te atender por aqui!";

    if (assignedOperator) {
      // Atribuído diretamente a um operador ativo
      const handoffData: any = {
        assigned_user_id: assignedOperator.id,
        status: "human_takeover",
        kanban_stage: "em_atendimento",
        is_human_controlled: true,
        is_bot_active: false,
        bot_handoff_reason: reason,
        bot_handoff_at: nowIso,
        updated_at: nowIso
      };

      try {
        const sanitized = sanitizeChatConversationPayload(handoffData);
        await supabaseAdmin
          .from("chat_conversations")
          .update(sanitized)
          .eq("id", conversationId);
      } catch (e: any) {
        console.warn("[BotHandoffManager] Erro ao atualizar status no supabase:", e.message);
      }

      await chatStore.updateConversationBotStatus(conversationId, handoffData);

      realtimeHub.broadcastToStore(storeId, "conversation_status_changed", {
        conversationId,
        status: "human_takeover",
        kanban_stage: "em_atendimento",
        is_human_controlled: true,
        is_bot_active: false,
        assigned_user_id: assignedOperator.id,
        bot_handoff_reason: reason
      });

      return {
        newState: "HUMAN_ASSIGNED",
        assignedOperatorId: assignedOperator.id,
        message: defaultTransitionMsg,
        isBotActive: false,
        handoffReason: reason
      };
    } else {
      // Nenhum operador disponível no momento: marcar como pendente/unassigned na fila
      const handoffData: any = {
        assigned_user_id: null,
        status: "human_takeover",
        kanban_stage: "em_atendimento",
        is_human_controlled: true,
        is_bot_active: false,
        bot_handoff_reason: reason,
        bot_handoff_at: nowIso,
        updated_at: nowIso
      };

      try {
        const sanitized = sanitizeChatConversationPayload(handoffData);
        await supabaseAdmin
          .from("chat_conversations")
          .update(sanitized)
          .eq("id", conversationId);
      } catch (e: any) {
        console.warn("[BotHandoffManager] Erro ao atualizar status pendente no supabase:", e.message);
      }

      await chatStore.updateConversationBotStatus(conversationId, handoffData);

      realtimeHub.broadcastToStore(storeId, "conversation_status_changed", {
        conversationId,
        status: "human_takeover",
        kanban_stage: "em_atendimento",
        is_human_controlled: true,
        is_bot_active: false,
        assigned_user_id: null,
        bot_handoff_reason: reason
      });

      return {
        newState: "HUMAN_UNASSIGNED",
        message: defaultTransitionMsg,
        isBotActive: false,
        handoffReason: reason
      };
    }
  }

  /**
   * Permite que o atendente humano silencie a IA ou reative o robô na conversa
   */
  public async toggleBotActive(
    conversationId: string,
    storeId: string,
    isBotActive: boolean
  ): Promise<boolean> {
    const nowIso = new Date().toISOString();
    try {
      const updateData: any = {
        is_bot_active: isBotActive,
        is_human_controlled: !isBotActive,
        kanban_stage: isBotActive ? "ia_atendendo" : "em_atendimento",
        updated_at: nowIso
      };
      if (isBotActive) {
        // Ao reativar o bot ("Devolver para IA"), limpa atendente e reseta contador
        updateData.assigned_user_id = null;
        updateData.assigned_to = null;
        updateData.bot_interaction_count = 0;
        updateData.bot_handoff_reason = null;
        updateData.bot_handoff_at = null;
        updateData.status = "bot";
      } else {
        updateData.bot_handoff_reason = "OPERATOR_TAKEOVER";
        updateData.bot_handoff_at = nowIso;
        updateData.status = "human_takeover";
      }

      // 1. Atualização no banco de dados Supabase/PostgreSQL com payload higienizado
      const dbPayload = sanitizeChatConversationPayload(updateData);
      const { error: dbErr } = await supabaseAdmin
        .from("chat_conversations")
        .update(dbPayload)
        .eq("id", conversationId);

      if (dbErr) {
        console.error("[BotHandoffManager] Erro ao persistir toggleBotActive no PostgreSQL:", dbErr.message, dbErr);
      }

      // 2. Atualização atômica na memória do ChatStore
      await chatStore.updateConversationBotStatus(conversationId, updateData);

      // 3. Notificação via realtimeHub para todos os clientes conectados
      realtimeHub.broadcastToStore(storeId, "conversation_bot_toggled", {
        conversationId,
        is_bot_active: isBotActive,
        is_human_controlled: !isBotActive,
        assigned_user_id: isBotActive ? null : undefined,
        status: updateData.status,
        kanban_stage: isBotActive ? "ia_atendendo" : "em_atendimento",
        bot_interaction_count: isBotActive ? 0 : undefined
      });

      realtimeHub.broadcastToStore(storeId, "conversation_status_changed", {
        conversationId,
        is_bot_active: isBotActive,
        is_human_controlled: !isBotActive,
        assigned_user_id: isBotActive ? null : undefined,
        status: updateData.status,
        kanban_stage: isBotActive ? "ia_atendendo" : "em_atendimento"
      });

      realtimeHub.broadcastToStore(storeId, "conversation_stage_changed", {
        conversationId,
        stage: isBotActive ? "BOT" : "HUMAN",
        status: updateData.status,
        is_bot_active: isBotActive,
        assigned_user_id: isBotActive ? null : undefined,
        updated_at: nowIso
      });

      return true;
    } catch (err: any) {
      console.error("[BotHandoffManager] Erro ao alternar estado do bot:", err.message);
      return false;
    }
  }

  /**
   * Atribuição sequencial Round-Robin para operadores/farmacêuticos online da loja
   */
  private async allocateNextOnlineOperator(storeId: string) {
    try {
      // 1. Try tenant_users first as primary table
      const { data: tenantUsers } = await supabaseAdmin
        .from("tenant_users")
        .select("id, supabase_user_id, name, email, role, is_active")
        .eq("tenant_id", storeId)
        .eq("is_active", true);

      if (tenantUsers && tenantUsers.length > 0) {
        const nextUser = tenantUsers[0];
        return {
          id: nextUser.id,
          full_name: nextUser.name,
          email: nextUser.email,
          role: nextUser.role
        };
      }

      // 2. Fallback to profiles table
      const { data: profiles, error } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, role, is_online, last_assigned_at")
        .eq("store_id", storeId)
        .eq("is_online", true)
        .order("last_assigned_at", { ascending: true, nullsFirst: true });

      if (error || !profiles || profiles.length === 0) {
        const { data: allProfiles } = await supabaseAdmin
          .from("profiles")
          .select("id, full_name, email, role, last_assigned_at")
          .eq("store_id", storeId)
          .order("last_assigned_at", { ascending: true, nullsFirst: true });

        if (!allProfiles || allProfiles.length === 0) return null;

        const nextOperator = allProfiles[0];
        try {
          await supabaseAdmin
            .from("profiles")
            .update({ last_assigned_at: new Date().toISOString() })
            .eq("id", nextOperator.id);
        } catch (_) {}

        return nextOperator;
      }

      const selectedOperator = profiles[0];
      try {
        await supabaseAdmin
          .from("profiles")
          .update({ last_assigned_at: new Date().toISOString() })
          .eq("id", selectedOperator.id);
      } catch (_) {}

      return selectedOperator;
    } catch (err) {
      console.warn("[BotHandoffManager] Erro no Round-Robin:", err);
      return null;
    }
  }
}

export const botHandoffManager = BotHandoffManager.getInstance();
