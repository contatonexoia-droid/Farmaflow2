import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { AiAgentConfig, PharmacyConfig } from "../types.js";
import { chatStore, sanitizeChatConversationPayload } from "./chatStore.js";
import { botHandoffManager } from "./botHandoffManager.js";
import { realtimeHub } from "./realtimeHub.js";
import { evolutionApiService } from "./evolutionApiService.js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export const DEFAULT_AI_AGENT_PROMPT = `Você é o Atendente Virtual Inteligente da drogaria {STORE_NAME}.
Sua missão é atender clientes pelo WhatsApp e canais digitais com máxima cortesia, rapidez, empatia e precisão.

DIRETRIZES DE ATENDIMENTO E FORMATAÇÃO:
1. Responda dúvidas sobre medicamentos, cosméticos, suplementos e produtos de higiene de forma simples, objetiva e acolhedora.
2. NUNCA faça diagnósticos médicos ou recomende automedicação de risco. Para sintomas graves, oriente sempre a procurar atendimento médico.
3. Para medicamentos sob controle especial (tarja preta/antibióticos), informe que a venda exige apresentação e retenção de receita médica na loja física ou envio no pedido.
4. REGRAS INVIOLÁVEIS DE PREÇO E ESTOQUE:
   - Você NUNCA deve inventar preços, supor valores de mercado ou usar preços genéricos da internet.
   - Use APENAS e EXCLUSIVAMENTE os preços e produtos reais informados na seção [CATÁLOGO EM TEMPO REAL].
   - Se um produto estiver listado no catálogo: informe o nome exato, a apresentação e o preço cadastrado, e forneça o link direto de compra ({STORE_LINK}?produto=ID) ou o link de busca ({STORE_LINK}?busca=termo).
   - Se o produto solicitado NÃO estiver listado no catálogo: informe educadamente que não localizou o preço/item exato no momento e forneça o link de busca na Webloja ({STORE_LINK}?busca=termo) para o cliente pesquisar ou convide-o a falar com a equipe de balcão. JAMAIS cite um valor aleatório.
5. FORMATO DE LINKS:
   - Envie os links da loja sempre em TEXTO PURO (exemplo: Acesse na nossa Webloja: {STORE_LINK}?produto=123).
   - NUNCA use formatação markdown de links repetidos como [link](link).
6. Seja conciso (1 a 3 parágrafos curtos), educado e use quebras de linha confortáveis para leitura rápida no celular.`;

export interface AiChatMessage {
  role: 'user' | 'model' | 'assistant' | 'system';
  content: string;
}

export interface AiAgentExecutionResult {
  reply: string;
  provider: string;
  model: string;
  transferredToHuman?: boolean;
  storeLinkUsed: string;
  interactionCount?: number;
  maxInteractions?: number;
  handoffReason?: string;
  isBotActive?: boolean;
}

const STOP_WORDS = new Set([
  "ola", "olá", "oi", "bom", "boa", "dia", "tarde", "noite", "voce", "voces", "vc",
  "tem", "temos", "quanto", "custa", "qual", "preco", "preço", "valor", "remedio",
  "remédio", "remedios", "remédios", "medicamento", "medicamentos", "comprar", "estoque",
  "disponivel", "disponível", "gostaria", "preciso", "saber", "se", "por", "favor",
  "na", "no", "nas", "nos", "loja", "farmacia", "drogaria", "vende", "acham", "procurando",
  "onde", "acho", "queria", "consigo", "encontrar", "para", "com", "de", "da", "do",
  "das", "dos", "um", "uma", "uns", "umas", "em", "sobre", "que", "temos"
]);

// Expressões e padrões para detecção de Prompt Injection e Abuso
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /ignore\s+(as\s+)?regras\s+(anteriores|do\s+sistema)/i,
  /desconsidere\s+(todas\s+as\s+)?(instru[çc][õo]es|regras)/i,
  /esque[çc]a\s+(tudo|todas\s+as\s+instru[çc][õo]es|o\s+prompt)/i,
  /novas\s+regras\s*:/i,
  /system\s+prompt/i,
  /prompt\s+do\s+sistema/i,
  /mostre\s+(suas|o\s+seu)\s+(prompt|instru[çc][õo]es|diretrizes)/i,
  /quais\s+(s[ãa]o\s+as\s+)?suas\s+instru[çc][õo]es/i,
  /revele\s+(seu|o)\s+prompt/i,
  /repeat\s+(everything|the\s+words)\s+above/i,
  /repita\s+o\s+texto\s+acima/i,
  /dan\s+mode/i,
  /developer\s+mode\s+enabled/i,
  /voc[êe]\s+agora\s+[ée]\s+(um\s+)?(hacker|assistente\s+sem\s+filtros|outro)/i,
  /finja\s+que\s+n[ãa]o\s+[ée]\s+uma\s+farm[áa]cia/i,
  /jailbreak/i,
  /<script[\s\S]*?>/i,
  /union\s+select/i,
  /drop\s+table/i
];

export function detectAbuseOrPromptInjection(message: string): { isSuspicious: boolean; reason?: string } {
  if (!message || typeof message !== 'string') {
    return { isSuspicious: false };
  }

  const clean = message.trim();

  // 1. Mensagens com mais de 1500 caracteres (tentativa de buffer overflow ou exaustão de contexto)
  if (clean.length > 1500) {
    return {
      isSuspicious: true,
      reason: "Mensagem excessivamente longa (limite de proteção contra consumo abusivo de tokens)."
    };
  }

  // 2. Repetição excessiva de caracteres (spam)
  if (/(.)\1{35,}/i.test(clean)) {
    return {
      isSuspicious: true,
      reason: "Sequência repetitiva de caracteres detectada (anti-spam)."
    };
  }

  // 3. Padrões conhecidos de Prompt Injection / Jailbreak
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        isSuspicious: true,
        reason: "Comando não autorizado ou tentativa de bypass de diretrizes detectada."
      };
    }
  }

  return { isSuspicious: false };
}

const CLINICAL_INTENTS: Record<string, string[]> = {
  "cabeca": ["paracetamol", "dipirona", "neosaldina", "dorflex", "ibuprofeno", "aspirina"],
  "enxaqueca": ["neosaldina", "paracetamol", "dipirona", "ibuprofeno", "enxak"],
  "febre": ["dipirona", "paracetamol", "ibuprofeno", "novalgina", "tylenol"],
  "gripe": ["coristina", "cimegripe", "benegrip", "resfenol", "paracetamol", "vitamina c"],
  "resfriado": ["coristina", "cimegripe", "benegrip", "descongestionante", "paracetamol"],
  "muscular": ["dorflex", "torsilax", "mioflex", "ibuprofeno", "tandrilax", "flanax"],
  "coluna": ["dorflex", "torsilax", "flanax", "ibuprofeno"],
  "torcicolo": ["dorflex", "torsilax", "mioflex"],
  "estomago": ["omeprazol", "pantoprazol", "eno", "estomazil", "epocler", "sonrisal"],
  "azia": ["eno", "estomazil", "omeprazol", "antiacido", "epocler", "pantoprazol"],
  "alergia": ["loratadina", "desloratadina", "allegra", "polaramine", "histamin"],
  "pressao": ["losartana", "atenolol", "enalapril", "anlodipino", "hidroclorotiazida"],
  "diabetes": ["metformina", "glibenclamida", "glicemia"]
};

function extractKeywordsAndIntents(message: string): string[] {
  const clean = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ");

  const rawTokens = clean.split(/\s+/).filter(t => t.length >= 2);
  const keywords: string[] = [];

  for (const token of rawTokens) {
    if (!STOP_WORDS.has(token) && token.length >= 3) {
      keywords.push(token);
    }
  }

  // Verificar intenções clínicas para sugerir substâncias
  for (const [intentKey, suggestions] of Object.entries(CLINICAL_INTENTS)) {
    if (clean.includes(intentKey)) {
      for (const s of suggestions) {
        if (!keywords.includes(s)) {
          keywords.push(s);
        }
      }
    }
  }

  return Array.from(new Set(keywords));
}

export class AiAgentService {
  private static instance: AiAgentService;

  private constructor() {}

  public static getInstance(): AiAgentService {
    if (!AiAgentService.instance) {
      AiAgentService.instance = new AiAgentService();
    }
    return AiAgentService.instance;
  }

  /**
   * Valida se a farmácia tem autorização no Super Admin para usar o módulo de IA.
   */
  public async verifyTenantAuthorization(tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new Error("ID da drogaria não informado.");
    }

    // Sanitização segura: remove prefixos como 'store_', 'inbox_', 'tenant_'
    const rawId = String(tenantId).trim();
    const sanitizedId = rawId
      .replace(/^store_/, '')
      .replace(/^inbox_/, '')
      .replace(/^tenant_/, '');

    let tenant: any = null;
    const isUuid = /^[0-9a-f-]{36}$/i.test(sanitizedId) || /^[0-9a-f-]{36}$/i.test(rawId);

    // 1. Se for UUID, busca diretamente por ID
    if (isUuid) {
      const targetUuid = /^[0-9a-f-]{36}$/i.test(sanitizedId) ? sanitizedId : rawId;
      const { data, error } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .eq("id", targetUuid)
        .maybeSingle();
      if (!error && data) {
        tenant = data;
      }
    }

    // 2. Busca tolerante por múltiplas variações de slug (ex: 'nosso-catalogo', 'nossocatalogo', 'nosso_catalogo')
    if (!tenant) {
      const slugVariants = Array.from(new Set([
        sanitizedId,
        rawId,
        sanitizedId.replace(/-/g, ''),
        sanitizedId.replace(/_/g, '-'),
        sanitizedId.replace(/-/g, '_'),
        rawId.replace(/-/g, ''),
        rawId.replace(/_/g, '-')
      ].filter(Boolean)));

      for (const s of slugVariants) {
        const { data, error } = await supabaseAdmin
          .from("tenants")
          .select("*")
          .eq("slug", s)
          .maybeSingle();
        if (!error && data) {
          tenant = data;
          break;
        }
      }
    }

    // 3. Fallback por instância do WhatsApp na tabela whatsapp_instances
    if (!tenant) {
      try {
        const { data: inst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("store_id")
          .or(`instance_name.eq.${rawId},instance_name.eq.${sanitizedId},instance_name.eq.store_${sanitizedId},instance_name.eq.store_${sanitizedId.replace(/-/g, '')}`)
          .limit(1)
          .maybeSingle();

        if (inst?.store_id) {
          const instStoreIsUuid = /^[0-9a-f-]{36}$/i.test(inst.store_id);
          const { data: t } = instStoreIsUuid
            ? await supabaseAdmin.from("tenants").select("*").eq("id", inst.store_id).maybeSingle()
            : await supabaseAdmin.from("tenants").select("*").eq("slug", inst.store_id.replace(/^store_/, '')).maybeSingle();
          if (t) tenant = t;
        }
      } catch (instErr: any) {
        console.warn("[AiAgentService] Aviso ao buscar por whatsapp_instances:", instErr.message);
      }
    }

    // 4. Fallback tolerante para a primeira drogaria cadastrada/ativa caso o tenant não tenha sido localizado
    if (!tenant) {
      try {
        const { data: firstTenant } = await supabaseAdmin
          .from("tenants")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstTenant) {
          console.warn(`[AiAgentService] [WARN] Tenant não mapeado para "${tenantId}". Usando drogaria fallback: "${firstTenant.name}" (@${firstTenant.slug}, ID: ${firstTenant.id})`);
          tenant = firstTenant;
        }
      } catch (fbErr: any) {
        console.warn("[AiAgentService] Aviso ao buscar drogaria fallback:", fbErr.message);
      }
    }

    if (!tenant) {
      throw new Error(`Drogaria não encontrada (ID/Slug: ${tenantId}).`);
    }

    // 5. Carregar configurações avançadas do agente (agent_settings) vinculadas ao UUID ou slug do tenant
    try {
      const orConditions = [
        `tenant_id.eq.${tenant.id}`,
        `store_id.eq.${tenant.id}`,
        tenant.slug ? `slug.eq.${tenant.slug}` : '',
        tenant.slug ? `tenant_id.eq.${tenant.slug}` : '',
        tenant.slug ? `store_id.eq.${tenant.slug}` : ''
      ].filter(Boolean).join(",");

      let { data: agentSetting } = await supabaseAdmin
        .from("agent_settings")
        .select("*")
        .or(orConditions)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Fallback: se não encontrar por ID/slug, tenta o primeiro registro de agent_settings
      if (!agentSetting) {
        const { data: fallbackSettings } = await supabaseAdmin
          .from("agent_settings")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (fallbackSettings) {
          agentSetting = fallbackSettings;
        }
      }

      if (agentSetting) {
        const resolvedApiKey = (
          agentSetting.openai_api_key ||
          agentSetting.api_key ||
          agentSetting.apikey ||
          agentSetting.gemini_api_key ||
          agentSetting.apiKey ||
          agentSetting.key
        )?.trim();

        const resolvedProvider = agentSetting.provider || (agentSetting.openai_api_key ? 'openai' : 'gemini');

        tenant.ai_agent_config = {
          ...(tenant.ai_agent_config || tenant.aiagentconfig || {}),
          ...agentSetting,
          apiKey: resolvedApiKey || tenant.ai_agent_config?.apiKey || tenant.ai_agent_config?.openai_api_key,
          openai_api_key: agentSetting.openai_api_key || agentSetting.api_key || resolvedApiKey,
          provider: resolvedProvider,
          active: agentSetting.active ?? agentSetting.enabled ?? tenant.ai_agent_config?.active ?? true
        };

        console.log(`[AiAgentService] Configurações de IA carregadas com sucesso para "${tenant.name}" (@${tenant.slug || tenant.id}) - Provedor: ${resolvedProvider}, Chave configurada: ${Boolean(resolvedApiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)}`);
      }
    } catch (agentErr: any) {
      console.warn("[AiAgentService] Aviso ao carregar agent_settings:", agentErr.message);
    }

    // Validação e log crítico caso a chave da OpenAI não esteja configurada
    const currentProvider = tenant.ai_agent_config?.provider || 'openai';
    const currentKey = (
      tenant.ai_agent_config?.apiKey ||
      tenant.ai_agent_config?.openai_api_key ||
      tenant.ai_agent_config?.api_key ||
      (currentProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)
    )?.trim();

    if ((currentProvider === 'openai' || !currentKey) && !currentKey) {
      console.error(`[AiAgentService] [ERRO] Chave de API da OpenAI não configurada para o tenant ${tenant.name || tenant.slug || tenant.id}.`);
    }

    const isEnabled = tenant.is_ai_agent_enabled === true || tenant.isaiagentenabled === true;
    if (!isEnabled) {
      const err = new Error("MÓDULO_NÃO_AUTORIZADO: O Agente de IA não está liberado no plano desta drogaria. Entre em contato com o Super Admin.");
      (err as any).statusCode = 403;
      throw err;
    }

    return tenant;
  }

  /**
   * Processa uma mensagem do usuário com o Agente de IA
   */
  public async generateReply(
    tenantId: string,
    incomingMessage: string,
    chatHistory: AiChatMessage[] = [],
    configOverride?: Partial<AiAgentConfig>
  ): Promise<AiAgentExecutionResult> {
    // 1. Validação estrita de autorização do tenant no Super Admin
    const tenant = await this.verifyTenantAuthorization(tenantId);

    // 2. Obter configurações do agente
    const dbConfig: AiAgentConfig = tenant.ai_agent_config || tenant.aiagentconfig || {
      active: false,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      systemPrompt: DEFAULT_AI_AGENT_PROMPT
    };

    const effectiveConfig: AiAgentConfig = {
      ...dbConfig,
      ...(configOverride || {})
    };

    // Se estiver em modo de execução normal (sem override forçando teste) e o agente estiver desativado
    if (!configOverride && !effectiveConfig.active) {
      throw new Error("O Agente de IA está pausado nas configurações da drogaria.");
    }

    // 3. Montar link da Loja Online
    let storeLink = effectiveConfig.storeLink || tenant.welcome_message_link || tenant.welcomemessagelink;
    if (!storeLink) {
      if (tenant.custom_domain) {
        storeLink = `https://${tenant.custom_domain}`;
      } else if (tenant.slug) {
        storeLink = `https://${tenant.slug}.farmaflow.online`;
      } else {
        storeLink = `https://${tenant.id}.farmaflow.online`;
      }
    }
    // Remover barra final para padronizar parâmetros
    storeLink = storeLink.replace(/\/+$/, '');

    // 4. Detecção Ativa de Prompt Injection e Padrões Abusivos (Proteção de Custos e Tokens)
    const guardrailsEnabled = effectiveConfig.antiAbuseGuardrailsEnabled !== false;
    if (guardrailsEnabled) {
      const abuseCheck = detectAbuseOrPromptInjection(incomingMessage);
      if (abuseCheck.isSuspicious) {
        console.warn(`[AiAgentService] Prompt Injection ou Abuso detectado (${tenantId}):`, abuseCheck.reason);
        const transitionMsg = effectiveConfig.transitionToHumanMessage || "Encaminhei sua dúvida e o link da nossa loja. Um dos nossos balconistas humanos já vai te atender por aqui!";
        const safeReply = `Olá! Para garantir sua segurança e o melhor suporte sobre nossos produtos e medicamentos, você pode consultar nosso catálogo completo e valores em nossa Webloja:\n👉 ${storeLink}\n\n${transitionMsg}`;
        return {
          reply: safeReply,
          provider: 'guardrails',
          model: 'rule-based-safety',
          storeLinkUsed: storeLink,
          transferredToHuman: true,
          handoffReason: 'SECURITY_INJECTION_DETECTED'
        };
      }
    }

    // 5. Preparar Prompt do Sistema com variáveis
    const storeName = tenant.name || "Nossa Drogaria";
    let basePrompt = effectiveConfig.systemPrompt || DEFAULT_AI_AGENT_PROMPT;
    basePrompt = basePrompt
      .replace(/\{STORE_NAME\}/g, storeName)
      .replace(/\{STORE_LINK\}/g, storeLink)
      .replace(/\{NOME_FARMACIA\}/g, storeName)
      .replace(/\{LINK_LOJA\}/g, storeLink);

    // 6. Busca contextual aprofundada de produtos no banco de dados real da drogaria
    let catalogContext = "";
    const searchTerms = extractKeywordsAndIntents(incomingMessage);
    const primarySearchTerm = searchTerms[0] || incomingMessage.trim().split(/\s+/)[0] || "";

    const tenantIds = Array.from(
      new Set(
        [
          tenantId,
          tenant.id,
          tenant.slug,
          tenant.network_id,
          tenant.networkid
        ].filter(Boolean)
      )
    );

    try {
      let matchedProducts: any[] = [];

      if (searchTerms.length > 0) {
        // Estratégia 1: Busca direta termo a termo no nome do produto
        for (const term of searchTerms.slice(0, 3)) {
          if (matchedProducts.length >= 6) break;

          const { data: byName, error: errName } = await supabaseAdmin
            .from("products")
            .select("id, name, price, stock, presentation, category, active_principle, requires_prescription")
            .in("tenant_id", tenantIds)
            .ilike("name", `%${term}%`)
            .limit(6);

          if (!errName && byName && byName.length > 0) {
            for (const p of byName) {
              if (!matchedProducts.some(mp => String(mp.id) === String(p.id))) {
                matchedProducts.push(p);
              }
            }
          }

          // Se ainda não encontrou ou tem poucos, busca por princípio ativo
          if (matchedProducts.length < 6) {
            const { data: byPrinciple, error: errPrinciple } = await supabaseAdmin
              .from("products")
              .select("id, name, price, stock, presentation, category, active_principle, requires_prescription")
              .in("tenant_id", tenantIds)
              .ilike("active_principle", `%${term}%`)
              .limit(6);

            if (!errPrinciple && byPrinciple && byPrinciple.length > 0) {
              for (const p of byPrinciple) {
                if (!matchedProducts.some(mp => String(mp.id) === String(p.id))) {
                  matchedProducts.push(p);
                }
              }
            }
          }
        }

        // Estratégia 2: Busca por orConditions combinando os termos (sem coluna slug)
        if (matchedProducts.length === 0) {
          const orFilter = searchTerms.slice(0, 3).map(t => 
            `name.ilike.%${t}%,active_principle.ilike.%${t}%`
          ).join(",");

          const { data: orResults, error: orError } = await supabaseAdmin
            .from("products")
            .select("id, name, price, stock, presentation, category, active_principle, requires_prescription")
            .in("tenant_id", tenantIds)
            .or(orFilter)
            .limit(6);

          if (!orError && orResults && orResults.length > 0) {
            matchedProducts = orResults;
          }
        }

        // Estratégia 3: Tentar RPC de busca postgres se existir
        if (matchedProducts.length === 0) {
          for (const tid of tenantIds) {
            try {
              const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("search_products_v2", {
                p_tenant_id: tid,
                p_search_term: primarySearchTerm,
                p_category: "Todos",
                p_limit: 6,
                p_offset: 0
              });
              if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
                matchedProducts = rpcData;
                break;
              }
            } catch {}
          }
        }

        if (matchedProducts && matchedProducts.length > 0) {
          catalogContext = "\n\n[CATÁLOGO EM TEMPO REAL - PRODUTOS ENCONTRADOS NO BANCO DE DADOS DA DROGARIA]:\n" +
            matchedProducts.map((p, idx) => {
              const preco = (Number(p.price) || 0).toFixed(2);
              const linkProd = `${storeLink}?produto=${p.id}`;
              const linkBusca = `${storeLink}?busca=${encodeURIComponent(p.name.split(' ')[0] || primarySearchTerm)}`;
              const statusEstoque = p.stock > 0 ? `Disponível (${p.stock} unidades)` : 'Temporariamente Esgotado';
              const tarja = p.requires_prescription ? 'Exige Apresentação de Receita Médica' : 'Venda Livre';
              return `${idx + 1}. PRODUTO: ${p.name} ${p.presentation ? `(${p.presentation})` : ''}
   - Preço no Sistema: R$ ${preco}
   - Estoque: ${statusEstoque}
   - Classificação: ${tarja}
   - Link Direto do Produto: ${linkProd}
   - Link da Busca: ${linkBusca}`;
            }).join("\n\n") +
            `\n\nATENÇÃO OBRIGATÓRIA: Utilize os preços e nomes EXATOS listados acima. Ao recomendar o produto, informe o link direto dele ou o link de busca em texto puro.`;
        } else {
          catalogContext = `\n\n[CATÁLOGO EM TEMPO REAL]:
Nenhum produto com esses termos exatos foi localizado no banco de dados local.
- Link de Busca na Webloja para enviar ao cliente: ${storeLink}?busca=${encodeURIComponent(primarySearchTerm)}
- REGRA CRÍTICA: NÃO invente preços (como R$ 12,99 ou qualquer outro valor). Diga que não localizou o preço no momento, convide o cliente a consultar a Webloja pelo link acima ou a conversar com o atendente de plantão.`;
        }
      } else {
        catalogContext = `\n\n[CATÁLOGO EM TEMPO REAL]:
Nenhum produto específico identificado na mensagem. Link geral da Webloja: ${storeLink}`;
      }
    } catch (catErr) {
      console.warn("[AiAgentService] Falha ao consultar contexto de produtos:", catErr);
      catalogContext = `\n\nLink da Webloja: ${storeLink}`;
    }

    // 7. Trava de Interações: Se for a última interação da sessão antes do transbordo
    const maxInteractions = Number(effectiveConfig.maxInteractionsPerSession) || 4;
    const currentInteraction = (chatHistory.filter(m => m.role === 'user').length) + 1;
    const isFinalSessionTurn = currentInteraction >= maxInteractions;

    let finalTurnDirective = "";
    if (isFinalSessionTurn) {
      finalTurnDirective = `\n\n[DIRETRIZ CRÍTICA DE ÚLTIMA INTERAÇÃO DA SESSÃO]:
Esta é a última resposta permitida nesta sessão antes do transbordo para o atendente humano.
1. Responda a dúvida do cliente de forma conclusiva, amigável e direta.
2. OBRIGATÓRIAMENTE recomende a compra na Webloja através do link: ${storeLink}
3. Informe que um balconista humano da farmácia dará continuidade ao atendimento logo em seguida caso ele precise de algo a mais.`;
    }

    const fullSystemInstruction = `${basePrompt}${catalogContext}${finalTurnDirective}\n\nLembre-se: Link da Webloja: ${storeLink}`;

    const provider = effectiveConfig.provider || 'gemini';
    const apiKey = (
      effectiveConfig.apiKey?.trim() ||
      effectiveConfig.openai_api_key?.trim() ||
      (effectiveConfig as any).api_key?.trim() ||
      (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)
    )?.trim();

    if (!apiKey) {
      if (provider === 'openai') {
        console.error(`[AiAgentService] [ERRO] Chave de API da OpenAI não configurada para o tenant ${tenant.name || tenant.slug || tenant.id}.`);
      }
      const providerLabel = provider === 'gemini' ? 'Google AI Studio (Gemini)' : 'OpenAI (ChatGPT)';
      const keyUrl = provider === 'gemini' ? 'https://aistudio.google.com/app/apikey' : 'https://platform.openai.com/api-keys';
      throw new Error(`Por favor, insira sua Chave de API do ${providerLabel} nas configurações ao lado para ativar as respostas inteligentes. Obtenha sua chave em: ${keyUrl}`);
    }

    // 8. Chamada ao Provedor Escolhido
    let rawResult: AiAgentExecutionResult;
    if (provider === 'openai') {
      rawResult = await this.callOpenAi(apiKey, effectiveConfig.model || 'gpt-4o-mini', fullSystemInstruction, incomingMessage, chatHistory, storeLink);
    } else {
      // Default: Google Gemini
      rawResult = await this.callGemini(apiKey, effectiveConfig.model || 'gemini-2.5-flash', fullSystemInstruction, incomingMessage, chatHistory, storeLink);
    }

    // 9. Garantia de Presença do Link da Webloja (Strict Enforcement)
    let enforcedReply = rawResult.reply;
    if (!enforcedReply.includes("http") && !enforcedReply.includes(".online") && !enforcedReply.includes(".com")) {
      enforcedReply = `${enforcedReply}\n\n🛍️ *Consulte nosso catálogo e compre online:* ${storeLink}`;
    }

    // 10. Se for o último turno da sessão, anexa mensagem de transição humana
    const transitionMsg = effectiveConfig.transitionToHumanMessage || "Encaminhei sua dúvida e o link da nossa loja. Um dos nossos balconistas humanos já vai te atender por aqui!";
    if (isFinalSessionTurn) {
      if (!enforcedReply.includes("balconista") && !enforcedReply.includes("atendente humano")) {
        enforcedReply = `${enforcedReply}\n\n${transitionMsg}`;
      }
      return {
        ...rawResult,
        reply: enforcedReply,
        transferredToHuman: true,
        interactionCount: currentInteraction,
        maxInteractions,
        handoffReason: 'MAX_INTERACTIONS_REACHED'
      };
    }

    return {
      ...rawResult,
      reply: enforcedReply,
      interactionCount: currentInteraction,
      maxInteractions,
      transferredToHuman: false
    };
  }

  /**
   * Dispara a mensagem do BOT para o WhatsApp, aguarda a confirmação de entrega da API,
   * grava na tabela chat_messages e atualiza o contador e estado da conversa de forma estrita.
   */
  private async dispatchBotReplyAndRecord(
    realTenantId: string,
    conversationId: string,
    targetInstanceName: string,
    cleanPhone: string | null,
    replyText: string,
    params: {
      isHandoff: boolean;
      handoffReason?: string;
      transitionMsg?: string;
      currentCount: number;
      nextCount: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    // 1. Validação Estrita de Envio: Garantir que a conversa NÃO esteja sob controle humano
    const currentConv = await chatStore.getConversationById(conversationId);
    if (currentConv) {
      const isStageIa = currentConv.kanban_stage === "ia_atendendo" || currentConv.stage === "ia_atendendo";
      const hasAssignedOperator = Boolean(currentConv.assigned_user_id) || Boolean((currentConv as any).assigned_to);
      const isHuman = !isStageIa && (
        currentConv.is_human_controlled === true ||
        currentConv.is_bot_active === false ||
        hasAssignedOperator
      );

      if (isHuman || hasAssignedOperator) {
        console.log(`[AiAgentService] Envio abortado para conversa ${conversationId}: conversa assumida por operador humano.`);
        return { success: false, error: "HUMAN_OPERATOR_ACTIVE" };
      }
    }

    if (!cleanPhone || !targetInstanceName) {
      const err = `Impossível entregar mensagem no WhatsApp: telefone ("${cleanPhone}") ou instância ("${targetInstanceName}") ausente.`;
      console.error(`[AiAgentService] ❌ ${err}`);
      return { success: false, error: err };
    }

    // 2. Disparo na API externa da Evolution API (WhatsApp) com confirmação síncrona
    console.log(`[AiAgentService] Disparando resposta do BOT para ${cleanPhone} via instância "${targetInstanceName}"...`);
    const sendResult = await evolutionApiService.sendTextMessage(
      targetInstanceName,
      cleanPhone,
      replyText,
      {
        delay: 1000,
        linkPreview: true
      }
    );

    if (!sendResult.success) {
      console.error(`[AiAgentService] ❌ Falha no envio para o WhatsApp do cliente (${cleanPhone}):`, sendResult.error);
      return { success: false, error: sendResult.error || "WHATSAPP_DELIVERY_FAILED" };
    }

    console.log(`[AiAgentService] ✅ Mensagem entregue com sucesso ao WhatsApp de ${cleanPhone}. Gravando no banco de dados e incrementando contador.`);

    // 3. Registra a resposta da IA na tabela messages / chat_messages do Supabase APENAS após confirmação
    const { message: recordedMsg } = await chatStore.addMessage(
      realTenantId,
      conversationId,
      "BOT",
      replyText,
      false,
      undefined,
      undefined,
      targetInstanceName,
      true // skipWhatsAppDispatch: true (já entregue via Evolution API)
    );

    const nowIso = new Date().toISOString();
    const nextCount = params.nextCount;

    // 4. Incremento do Contador de Interações e Atualização Atômica de Estado
    if (params.isHandoff) {
      const handoffPayload: any = {
        bot_interaction_count: nextCount,
        is_bot_active: false,
        is_human_controlled: true,
        kanban_stage: "em_atendimento",
        status: "human_takeover",
        bot_handoff_reason: params.handoffReason || "MAX_INTERACTIONS_REACHED",
        bot_handoff_at: nowIso,
        last_message_at: nowIso,
        last_message_content: replyText,
        updated_at: nowIso
      };

      const sanitized = sanitizeChatConversationPayload(handoffPayload);
      try {
        await supabaseAdmin
          .from("chat_conversations")
          .update(sanitized)
          .eq("id", conversationId);
      } catch (dbErr: any) {
        console.error("[AiAgentService] Erro ao atualizar chat_conversations no Supabase:", dbErr.message);
      }

      await botHandoffManager.triggerHandoff(
        conversationId,
        realTenantId,
        params.handoffReason || "MAX_INTERACTIONS_REACHED",
        params.transitionMsg
      );

      await chatStore.updateConversationBotStatus(conversationId, handoffPayload);

      realtimeHub.broadcastToStore(realTenantId, "conversation_status_changed", {
        conversationId,
        status: "human_takeover",
        is_bot_active: false,
        is_human_controlled: true,
        bot_interaction_count: nextCount,
        bot_handoff_reason: params.handoffReason || "MAX_INTERACTIONS_REACHED",
        bot_handoff_at: nowIso,
        kanban_stage: "em_atendimento"
      });

      realtimeHub.broadcastToStore(realTenantId, "conversation_stage_changed", {
        conversationId,
        stage: "HUMAN",
        status: "human_takeover",
        is_bot_active: false,
        updated_at: nowIso
      });
    } else {
      const botActivePayload: any = {
        bot_interaction_count: nextCount,
        is_bot_active: true,
        is_human_controlled: false,
        assigned_user_id: null,
        assigned_to: null,
        kanban_stage: "ia_atendendo",
        status: "bot",
        bot_handoff_reason: null,
        bot_handoff_at: null,
        last_message_at: nowIso,
        last_message_content: replyText,
        updated_at: nowIso
      };

      const sanitized = sanitizeChatConversationPayload(botActivePayload);
      try {
        await supabaseAdmin
          .from("chat_conversations")
          .update(sanitized)
          .eq("id", conversationId);
      } catch (dbErr: any) {
        console.error("[AiAgentService] Erro ao atualizar chat_conversations no Supabase:", dbErr.message);
      }

      await chatStore.updateConversationBotStatus(conversationId, botActivePayload);

      realtimeHub.broadcastToStore(realTenantId, "conversation_status_changed", {
        conversationId,
        status: "bot",
        is_bot_active: true,
        is_human_controlled: false,
        bot_interaction_count: nextCount,
        kanban_stage: "ia_atendendo"
      });
    }

    // 5. Broadcast da mensagem gravada para o chat em tempo real
    realtimeHub.broadcastToStore(realTenantId, "chat_message", {
      conversationId,
      message: recordedMsg
    });

    return { success: true };
  }

  /**
   * Processamento completo de turno de conversa do WhatsApp / Chat Central
   * Gerencia contagem de interações, travas anti-abuso, transbordo para humano e disparos
   */
  public async processConversationTurn(
    storeId: string,
    conversationId: string,
    incomingMessage: string,
    options?: {
      instanceName?: string;
      phoneNumber?: string;
      chatHistory?: AiChatMessage[];
    }
  ): Promise<{
    handled: boolean;
    replyText?: string;
    transferredToHuman: boolean;
    reason?: string;
  }> {
    try {
      // 1. Obter tenant e validar se o módulo de IA está autorizado (resolvendo o UUID real)
      const tenant = await this.verifyTenantAuthorization(storeId);
      const realTenantId = tenant.id || storeId;
      const dbConfig: AiAgentConfig = tenant.ai_agent_config || tenant.aiagentconfig || {};

      if (dbConfig.active === false || dbConfig.enabled === false) {
        console.log(`[AiAgentService] IA desativada nas configurações da drogaria "${tenant.name}"`);
        return { handled: false, transferredToHuman: false, reason: "AGENT_PAUSED" };
      }

      // 2. Obter conversa atual para inspecionar estado do bot
      const conv = await chatStore.getConversationById(conversationId);
      if (conv) {
        const isStageIa = conv.kanban_stage === "ia_atendendo" || conv.stage === "ia_atendendo";
        const hasAssignedOperator = Boolean(conv.assigned_user_id) || Boolean((conv as any).assigned_to);

        const isHumanControlled = 
          !isStageIa && (
            conv.is_human_controlled === true ||
            conv.is_bot_active === false ||
            hasAssignedOperator
          );

        if (isHumanControlled || hasAssignedOperator) {
          console.log(`[AiAgentService] IA pausada para a conversa ${conversationId}: Atendimento humano ativo (is_human_controlled: ${conv.is_human_controlled}, is_bot_active: ${conv.is_bot_active}, assigned_user_id: ${conv.assigned_user_id}).`);
          return { handled: false, transferredToHuman: true, reason: "ALREADY_HUMAN_ASSIGNED" };
        }
      }

      // Resolver nome da instância e telefone do cliente
      const targetInstanceName = await evolutionApiService.resolveInstanceName(realTenantId, options?.instanceName);
      console.log(`[AiAgentService] Processando turno da conversa ${conversationId} via instância WhatsApp "${targetInstanceName}"`);

      let phoneToSend: string | null = options?.phoneNumber || null;
      if (!phoneToSend && conv?.contact?.phone_number) {
        phoneToSend = conv.contact.phone_number;
      }
      if (!phoneToSend && conv?.contact_id) {
        try {
          const { data: contactData } = await supabaseAdmin
            .from("chat_contacts")
            .select("phone_number")
            .eq("id", conv.contact_id)
            .maybeSingle();
          if (contactData?.phone_number) phoneToSend = contactData.phone_number;
        } catch (_) {}
      }
      if (!phoneToSend) {
        const match = conversationId.match(/_(\d{10,15})_/);
        if (match) phoneToSend = match[1];
      }
      const cleanPhone = phoneToSend ? String(phoneToSend).replace(/\D/g, "") : null;

      const currentCount = conv?.bot_interaction_count || 0;
      const maxInteractions = Number(dbConfig.maxInteractionsPerSession) || 4;
      const transitionMsg = dbConfig.transitionToHumanMessage || "Encaminhei sua dúvida e o link da nossa loja. Um dos nossos balconistas humanos já vai te atender por aqui!";

      // 3. Montar link da Loja Online
      let storeLink = dbConfig.storeLink || tenant.welcome_message_link || tenant.welcomemessagelink;
      if (!storeLink) {
        storeLink = tenant.custom_domain ? `https://${tenant.custom_domain}` : `https://${tenant.slug || tenant.id}.farmaflow.online`;
      }
      storeLink = storeLink.replace(/\/+$/, '');

      // 4. Tratamento especial para anexos e documentos (PDFs, receitas médicas, fotos)
      const isDocumentAttachment = incomingMessage.includes("[Documento]") || incomingMessage === "[Documento]";
      const isMediaAttachment = incomingMessage === "[Imagem]" || incomingMessage === "[Áudio]" || incomingMessage === "[Vídeo]" || incomingMessage === "[Figurinha]";

      if (isDocumentAttachment || isMediaAttachment) {
        console.log(`[AiAgentService] Anexo detectado (${incomingMessage}) para conversa ${conversationId}. Registrando e acionando transbordo para conferência humana.`);
        const attachmentType = isDocumentAttachment ? "documento/receita" : "arquivo";
        const replyText = `Olá! Recebemos o seu ${attachmentType} com sucesso. 📄\n\nJá encaminhei para a nossa equipe de atendimento para conferência e orçamento. Um de nossos balconistas humanos irá responder em instantes!\n\n🛍️ *Nossa Loja Online:* ${storeLink}`;

        const dispatchResult = await this.dispatchBotReplyAndRecord(
          realTenantId,
          conversationId,
          targetInstanceName,
          cleanPhone,
          replyText,
          {
            isHandoff: true,
            handoffReason: isDocumentAttachment ? "DOCUMENT_RECEIVED" : "MEDIA_RECEIVED",
            transitionMsg,
            currentCount,
            nextCount: currentCount + 1
          }
        );

        if (!dispatchResult.success) {
          return { handled: false, transferredToHuman: true, reason: dispatchResult.error };
        }

        return {
          handled: true,
          replyText,
          transferredToHuman: true,
          reason: isDocumentAttachment ? "DOCUMENT_RECEIVED" : "MEDIA_RECEIVED"
        };
      }

      // 5. Verificar Termos Sensíveis de Transbordo Imediato (ex: receita, falar com humano)
      const handoffCheck = await botHandoffManager.processMessageState(
        conversationId,
        realTenantId,
        incomingMessage,
        conv?.status || "BOT"
      );

      if (handoffCheck.isBotActive === false) {
        const transMessage = `${handoffCheck.message || transitionMsg}\n\n🛍️ *Nossa Webloja:* ${storeLink}`;
        
        const dispatchResult = await this.dispatchBotReplyAndRecord(
          realTenantId,
          conversationId,
          targetInstanceName,
          cleanPhone,
          transMessage,
          {
            isHandoff: true,
            handoffReason: handoffCheck.handoffReason || "KEYWORD_TRIGGER",
            transitionMsg,
            currentCount,
            nextCount: currentCount + 1
          }
        );

        if (!dispatchResult.success) {
          return { handled: false, transferredToHuman: true, reason: dispatchResult.error };
        }

        return {
          handled: true,
          replyText: transMessage,
          transferredToHuman: true,
          reason: handoffCheck.handoffReason || "KEYWORD_TRIGGER"
        };
      }

      // 6. Verificar Proteção Ativa Anti-Abuso / Prompt Injection
      if (dbConfig.antiAbuseGuardrailsEnabled !== false) {
        const abuseCheck = detectAbuseOrPromptInjection(incomingMessage);
        if (abuseCheck.isSuspicious) {
          console.warn(`[AiAgentService] Abuso/Injection bloqueado para conversa ${conversationId}:`, abuseCheck.reason);
          const safeReply = `Olá! Para garantir a sua segurança e o melhor suporte sobre nossos produtos e medicamentos, você pode consultar nosso catálogo completo e valores em nossa Loja Online:\n👉 ${storeLink}\n\n${transitionMsg}`;

          const dispatchResult = await this.dispatchBotReplyAndRecord(
            realTenantId,
            conversationId,
            targetInstanceName,
            cleanPhone,
            safeReply,
            {
              isHandoff: true,
              handoffReason: "SECURITY_INJECTION_DETECTED",
              transitionMsg,
              currentCount,
              nextCount: currentCount + 1
            }
          );

          if (!dispatchResult.success) {
            return { handled: false, transferredToHuman: true, reason: dispatchResult.error };
          }

          return {
            handled: true,
            replyText: safeReply,
            transferredToHuman: true,
            reason: "SECURITY_INJECTION_DETECTED"
          };
        }
      }

      // 7. Se já tiver atingido o limite de mensagens da sessão
      if (currentCount >= maxInteractions) {
        console.log(`[AiAgentService] Limite de interações atingido (${currentCount}/${maxInteractions}) para conversa ${conversationId}. Silenciando IA.`);
        await botHandoffManager.triggerHandoff(conversationId, realTenantId, "MAX_INTERACTIONS_REACHED", transitionMsg);
        return {
          handled: false,
          transferredToHuman: true,
          reason: "MAX_INTERACTIONS_REACHED"
        };
      }

      // 8. Carregar histórico recente da conversa para contexto
      const history = options?.chatHistory || [];
      const nextCount = currentCount + 1;
      const isFinalTurn = nextCount >= maxInteractions;

      // 9. Gerar resposta com a LLM
      const aiResult = await this.generateReply(
        realTenantId,
        incomingMessage,
        history,
        dbConfig
      );

      let finalReply = aiResult.reply;

      // 10. Se for a última interação da sessão, realizar transbordo definitivo para humano
      if (isFinalTurn || aiResult.transferredToHuman) {
        if (!finalReply.includes("balconista") && !finalReply.includes("atendente humano")) {
          finalReply = `${finalReply}\n\n${transitionMsg}`;
        }

        const dispatchResult = await this.dispatchBotReplyAndRecord(
          realTenantId,
          conversationId,
          targetInstanceName,
          cleanPhone,
          finalReply,
          {
            isHandoff: true,
            handoffReason: "MAX_INTERACTIONS_REACHED",
            transitionMsg,
            currentCount,
            nextCount
          }
        );

        if (!dispatchResult.success) {
          return { handled: false, transferredToHuman: true, reason: dispatchResult.error };
        }

        return {
          handled: true,
          replyText: finalReply,
          transferredToHuman: true,
          reason: "MAX_INTERACTIONS_REACHED"
        };
      }

      // 11. Interação normal do bot: Enviar mensagem pelo WhatsApp, confirmar entrega, gravar e incrementar contador
      const dispatchResult = await this.dispatchBotReplyAndRecord(
        realTenantId,
        conversationId,
        targetInstanceName,
        cleanPhone,
        finalReply,
        {
          isHandoff: false,
          currentCount,
          nextCount
        }
      );

      if (!dispatchResult.success) {
        return {
          handled: false,
          transferredToHuman: false,
          reason: dispatchResult.error
        };
      }

      return {
        handled: true,
        replyText: finalReply,
        transferredToHuman: false
      };
    } catch (err: any) {
      console.error("[AiAgentService] Erro no processConversationTurn:", err.message);
      return {
        handled: false,
        transferredToHuman: false,
        reason: err.message
      };
    }
  }

  /**
   * Assistente de IA para Atendentes (Copilot interno de redação no chat)
   */
  public async generateCopilotAssistance(
    tenantId: string,
    action: 'fix' | 'empathy' | 'summarize' | 'expand' | 'custom',
    text: string,
    customInstruction?: string
  ): Promise<{ suggestedText: string; action: string }> {
    if (!text && action !== 'expand') {
      throw new Error("Texto base é obrigatório para processamento da IA.");
    }

    // 1. Validar autorização do tenant no Super Admin usando resolução robusta
    const tenant = await this.verifyTenantAuthorization(tenantId);

    const isCopilotAllowed = 
      tenant.is_ai_copilot_enabled === true || 
      tenant.is_ai_agent_enabled === true ||
      tenant.isaiagentenabled === true;

    if (!isCopilotAllowed) {
      const err = new Error("MÓDULO_NÃO_AUTORIZADO: O Assistente de IA para Atendentes não está liberado no plano desta drogaria. Solicite liberação no Super Admin.");
      (err as any).statusCode = 403;
      throw err;
    }

    const pharmacyName = tenant.name || "Nossa Farmácia";
    let effectiveConfig: AiAgentConfig = {
      enabled: true,
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.5-flash'
    };

    if (tenant.ai_agent_config) {
      try {
        effectiveConfig = typeof tenant.ai_agent_config === 'string'
          ? JSON.parse(tenant.ai_agent_config)
          : tenant.ai_agent_config;
      } catch (e) {}
    }

    const provider = effectiveConfig.provider || 'gemini';
    const apiKey = effectiveConfig.apiKey?.trim() || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);

    if (!apiKey) {
      throw new Error("Chave de API de IA não configurada no servidor ou na drogaria.");
    }

    // Definir prompt com base na ação
    let taskInstruction = "";
    switch (action) {
      case 'fix':
        taskInstruction = "Sua tarefa é CORRIGIR a ortografia, pontuação, acentuação e concordância gramatical da mensagem abaixo. Mantenha o sentido, o tom original e os termos técnicos farmacêuticos ou nomes comerciais de medicamentos intactos. Retorne APENAS o texto corrigido, sem explicações ou introduções.";
        break;
      case 'empathy':
        taskInstruction = `Sua tarefa é REESCREVER a mensagem para torná-la altamente acolhedora, empática, profissional e humanizada, adequada para o atendimento de balcão da farmácia "${pharmacyName}". Transmita cuidado genuíno com a saúde e bem-estar do cliente, com linguagem clara e calorosa. Retorne APENAS o texto aprimorado, sem explicações.`;
        break;
      case 'summarize':
        taskInstruction = "Sua tarefa é RESUMIR e tornar a mensagem o mais DIRETA, clara e concisa possível para leitura rápida no WhatsApp, mantendo todas as informações essenciais (preços, orientações, prazos). Retorne APENAS o texto resumido.";
        break;
      case 'expand':
        taskInstruction = `Sua tarefa é CRIAR uma mensagem de WhatsApp completa, profissional, educada e pronta para envio pelo atendente da farmácia "${pharmacyName}", a partir das anotações/tópicos soltos fornecidos. Seja atencioso, claro e bem estruturado com quebras de linha confortáveis. Retorne APENAS a mensagem pronta para envio.`;
        break;
      case 'custom':
        taskInstruction = `Sua tarefa é reescrever ou ajustar a mensagem de atendimento da farmácia "${pharmacyName}" seguindo estritamente esta instrução: "${customInstruction || 'Aprimorar a mensagem'}". Retorne APENAS o texto final pronto para envio.`;
        break;
    }

    const systemPrompt = `Você é o Copilot Especialista em Comunicação Farmacêutica da farmácia "${pharmacyName}".
Você auxilia atendentes humanos a redigirem mensagens perfeitas para clientes no WhatsApp.
REGRAS OBRIGATÓRIAS:
- Retorne SEMPRE E APENAS o texto final pronto para ser colado no WhatsApp.
- NUNCA inclua frases de introdução como "Aqui está a mensagem:", "Sugestão:", aspas extras ou comentários.
- Preserve números de telefone, links, valores em R$ e nomes de produtos/medicamentos informados.
${taskInstruction}`;

    const incomingMessage = text || (customInstruction || "Olá");
    let resultText = "";

    if (provider === 'openai') {
      const res = await this.callOpenAi(apiKey, effectiveConfig.model || 'gpt-4o-mini', systemPrompt, incomingMessage, [], '');
      resultText = res.reply;
    } else {
      const res = await this.callGemini(apiKey, effectiveConfig.model || 'gemini-2.5-flash', systemPrompt, incomingMessage, [], '');
      resultText = res.reply;
    }

    return {
      suggestedText: resultText.replace(/^["']|["']$/g, '').trim(),
      action
    };
  }

  private async callGemini(
    apiKey: string,
    modelName: string,
    systemInstruction: string,
    incomingMessage: string,
    chatHistory: AiChatMessage[],
    storeLink: string
  ): Promise<AiAgentExecutionResult> {
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Normalizar histórico para formato Gemini
      const contents: any[] = [];

      // Adicionar mensagens anteriores
      for (const msg of chatHistory.slice(-10)) {
        const role = (msg.role === 'user') ? 'user' : 'model';
        contents.push({
          role,
          parts: [{ text: msg.content }]
        });
      }

      // Adicionar mensagem atual do usuário
      contents.push({
        role: 'user',
        parts: [{ text: incomingMessage }]
      });

      const targetModel = modelName || 'gemini-2.5-flash';

      const response = await ai.models.generateContent({
        model: targetModel,
        contents,
        config: {
          systemInstruction,
          temperature: 0.4,
          maxOutputTokens: 1000
        }
      });

      const rawReply = response.text || "Desculpe, não consegui processar a resposta no momento. Por favor, tente novamente.";
      // Limpa links com sintaxe markdown duplicada [url](url) para texto limpo e direto no WhatsApp
      const cleanedReply = rawReply
        .replace(/\[(https?:\/\/[^\s\]]+)\]\(\1\)/gi, '$1')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1 ($2)');

      return {
        reply: cleanedReply.trim(),
        provider: 'gemini',
        model: targetModel,
        storeLinkUsed: storeLink
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error("[AiAgentService] Gemini Error:", errMsg);

      if (errMsg.includes("API_KEY_SERVICE_BLOCKED") || errMsg.includes("blocked") || errMsg.includes("PERMISSION_DENIED")) {
        throw new Error("A Chave de API informada está com o serviço de IA bloqueado ou possui restrições de API no Google Cloud. Crie uma chave nova e irrestrita no Google AI Studio (https://aistudio.google.com/app/apikey).");
      }

      if (errMsg.includes("API key not valid") || errMsg.includes("API_KEY_INVALID") || errMsg.includes("401")) {
        throw new Error("A Chave de API do Google Gemini é inválida. Verifique se copiou a chave completa sem espaços.");
      }

      if (errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("429") || errMsg.includes("quota")) {
        throw new Error("Limite de requisições ou cota do Google Gemini atingida temporariamente. Aguarde 1 minuto ou utilize outra chave de API.");
      }

      if (errMsg.includes("models/") || errMsg.includes("not found") || errMsg.includes("404")) {
        throw new Error(`O modelo de IA selecionado (${modelName}) não está disponível para esta chave. Tente selecionar 'Gemini 2.5 Flash'.`);
      }

      throw new Error(`Erro no Google Gemini: ${errMsg.slice(0, 180)}`);
    }
  }

  private async callOpenAi(
    apiKey: string,
    modelName: string,
    systemInstruction: string,
    incomingMessage: string,
    chatHistory: AiChatMessage[],
    storeLink: string
  ): Promise<AiAgentExecutionResult> {
    try {
      const messages: any[] = [
        { role: 'system', content: systemInstruction }
      ];

      for (const msg of chatHistory.slice(-10)) {
        const role = (msg.role === 'user') ? 'user' : 'assistant';
        messages.push({ role, content: msg.content });
      }

      messages.push({ role: 'user', content: incomingMessage });

      const targetModel = modelName || 'gpt-4o-mini';

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages,
          temperature: 0.4,
          max_tokens: 1000
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        let errorMsg = `Erro na API OpenAI (${res.status})`;
        try {
          const errJson = JSON.parse(errText);
          if (errJson.error?.message) {
            errorMsg = errJson.error.message;
          }
        } catch (e) {
          errorMsg = errText;
        }

        if (res.status === 401 || errorMsg.includes("Incorrect API key")) {
          throw new Error("Chave de API da OpenAI inválida ou não autorizada. Verifique sua chave no painel da OpenAI.");
        }
        if (res.status === 429 || errorMsg.includes("quota")) {
          throw new Error("Limite de saldo/créditos ou cota da OpenAI atingido. Verifique o faturamento da sua conta OpenAI.");
        }

        throw new Error(`Erro na OpenAI: ${errorMsg}`);
      }

      const data = await res.json();
      const rawReply = data.choices?.[0]?.message?.content || "Desculpe, não foi possível obter resposta.";
      const cleanedReply = rawReply
        .replace(/\[(https?:\/\/[^\s\]]+)\]\(\1\)/gi, '$1')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1 ($2)');

      return {
        reply: cleanedReply.trim(),
        provider: 'openai',
        model: targetModel,
        storeLinkUsed: storeLink
      };
    } catch (err: any) {
      console.error("[AiAgentService] OpenAI Error:", err.message);
      throw err;
    }
  }
}

export const aiAgentService = AiAgentService.getInstance();
