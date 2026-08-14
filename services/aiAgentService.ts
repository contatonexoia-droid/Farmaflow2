import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { AiAgentConfig, PharmacyConfig } from "../types.js";

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
    let tenant: any = null;

    // Tenta buscar por ID direto ou por slug
    const { data: tenantData, error } = await supabaseAdmin
      .from("tenants")
      .select("*")
      .or(`id.eq.${tenantId},slug.eq.${tenantId}`)
      .maybeSingle();

    if (!error && tenantData) {
      tenant = tenantData;
    } else {
      // Fallback: busca por ID isolado
      const { data: fallbackTenant } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .eq("id", tenantId)
        .maybeSingle();
      tenant = fallbackTenant;
    }

    if (!tenant) {
      throw new Error(`Drogaria não encontrada (ID/Slug: ${tenantId}).`);
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

    // 4. Preparar Prompt do Sistema com variáveis
    const storeName = tenant.name || "Nossa Drogaria";
    let basePrompt = effectiveConfig.systemPrompt || DEFAULT_AI_AGENT_PROMPT;
    basePrompt = basePrompt
      .replace(/\{STORE_NAME\}/g, storeName)
      .replace(/\{STORE_LINK\}/g, storeLink)
      .replace(/\{NOME_FARMACIA\}/g, storeName)
      .replace(/\{LINK_LOJA\}/g, storeLink);

    // 5. Busca contextual aprofundada de produtos no banco de dados real da drogaria
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

    const fullSystemInstruction = `${basePrompt}${catalogContext}\n\nLembre-se: Link da Webloja: ${storeLink}`;

    const provider = effectiveConfig.provider || 'gemini';
    const apiKey = effectiveConfig.apiKey?.trim() || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);

    if (!apiKey) {
      const providerLabel = provider === 'gemini' ? 'Google AI Studio (Gemini)' : 'OpenAI (ChatGPT)';
      const keyUrl = provider === 'gemini' ? 'https://aistudio.google.com/app/apikey' : 'https://platform.openai.com/api-keys';
      throw new Error(`Por favor, insira sua Chave de API do ${providerLabel} nas configurações ao lado para ativar as respostas inteligentes. Obtenha sua chave em: ${keyUrl}`);
    }

    // 6. Chamada ao Provedor Escolhido
    if (provider === 'openai') {
      return await this.callOpenAi(apiKey, effectiveConfig.model || 'gpt-4o-mini', fullSystemInstruction, incomingMessage, chatHistory, storeLink);
    } else {
      // Default: Google Gemini
      return await this.callGemini(apiKey, effectiveConfig.model || 'gemini-2.5-flash', fullSystemInstruction, incomingMessage, chatHistory, storeLink);
    }
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
