import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import { AiAgentConfig, PharmacyConfig } from "../types.js";
import { chatStore, sanitizeChatConversationPayload } from "./chatStore.js";
import { 
  botHandoffManager, 
  detectHumanHandoffIntent, 
  isWeblojaOrderMessage,
  detectCustomerChoiceIntent,
  buildHumanizedHandoffMessage,
  buildProductHandoffMessage 
} from "./botHandoffManager.js";
import { realtimeHub } from "./realtimeHub.js";
import { evolutionApiService } from "./evolutionApiService.js";
import { generateTextToSpeech, prepareTextForSpeech } from "./audioAiService.js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://nalshjhoiecxooejpiaw.supabase.co";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Y2lAqlvDUhdjSNtv80GkJA_SiOgynYy";
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export const DEFAULT_AI_AGENT_PROMPT = `Você é o Atendente Virtual Inteligente da drogaria conectada a esta sessão.
Seu objetivo é recepcionar o cliente com agilidade, tirar dúvidas sobre medicamentos e produtos, consultar preços reais e direcioná-lo estrategicamente para a compra.

1. CONSULTAS E AUTONOMIA:
   - Use obrigatoriamente a ferramenta \`consultar_dados_loja()\` para verificar o nome real da loja, horários de atendimento, endereço e o link da loja online. Nunca invente essas informações.
   - Use obrigatoriamente \`buscar_produtos(termo)\` para consultar estoque, dosagens e preços em tempo real antes de informar qualquer valor ao cliente. Nunca estime preços.

2. REGRAS DE EQUIVALÊNCIA FARMACÊUTICA:
   - 'DIPIRONA MONO' (Monoidratada) e 'DIPIRONA SODICA' são rigorosamente o mesmo medicamento (Dipirona).
   - Maxalgina, Dipimed, Novalgina e Nevraldor são nomes comerciais de Dipirona.
   - Frascos de 10ml e 20ml com 'GTS' ou 'SOL' SÃO gotas! NUNCA diga que são "(solução, mas não em gotas)".
   - Se o cliente pediu gotas e houver produtos com GTS ou SOL (10ml, 20ml) em estoque, ELE ESTÁ DISPONÍVEL! Diga imediatamente que temos em gotas e NUNCA ofereça comprimidos como alternativa se houver gotas disponíveis.
   - Se o cliente pediu 500mg e houver '500MG' ou '500 MG' em qualquer produto da lista (seja MONO ou SODICA), ELE ESTÁ DISPONÍVEL! NUNCA diga que não tem.
   - NUNCA liste produtos de 1G ou gotas se o cliente pediu expressamente 500mg em comprimidos e houver 500mg em estoque.
   - 'CPR' ou 'COMP' indica comprimidos (ex: 8CPR = 8 comprimidos, 10CPR = 10 comprimidos, 30CPR = 30 comprimidos).
   - 'GTS' indica gotas, 'XPE' indica xarope, 'SOL' indica solução oral (gotas), 'EFERV' indica efervescente.
   - Siglas finais indicam o laboratório fabricante: EMS, PRATI ou PRTD (Prati-Donaduzzi), NEOQ ou NQ (Neo Química), GERM ou GERMED (Germed), MDLY (Medley), CIMED (Cimed), EURO (Eurofarma), ACHÉ (Aché), SANOFI (Sanofi).

3. CONCISÃO E DIRETO AO PONTO (REGRAS OBRIGATÓRIAS DE RESPOSTA):
   - Respostas no WhatsApp devem ser CURTAS, humanizadas e sem enrolação.
   - NUNCA dê explicações técnicas desnecessárias como "(solução, mas não em gotas)" ou justificativas longas.
   - Quando o produto solicitado estiver disponível:
     * Diga imediatamente que temos disponível ("Temos sim!"). NUNCA diga que não tem se o item constar na lista de produtos.
     * Apresente NO MÁXIMO 2 A 3 OPÇÕES (as mais econômicas e relevantes) com laboratório/marca, apresentação/tamanho e preço, destacando a primeira com ⭐ Mais econômica.
     * Finalize com uma pergunta curta convidando à ação.
   
   ESTRUTURA DE RESPOSTA (MÁXIMO 2 A 3 OPÇÕES):
   - Se o cliente pedir dipirona em gotas e tivermos em estoque:
     Exemplo ideal de resposta curta:
     "Temos dipirona em gotas sim! 😊

     1️⃣ Germed 20ml (500mg/ml) - R$ 7,49 ⭐ Mais econômica
     2️⃣ Germed 10ml (500mg/ml) - R$ 9,14
     3️⃣ Medley 10ml (500mg/ml) - R$ 14,55

     Qual dessas você prefere levar? Posso separar para você ou enviar o link da loja!"

   - Se o cliente pedir comprimidos (ex: dipirona 500mg ou 1g):
     Exemplo ideal de resposta curta:
     "Temos dipirona disponível nas seguintes opções:

     1️⃣ EMS (10 comprimidos) - R$ 4,49 ⭐ Mais econômica
     2️⃣ Prati-Donaduzzi (10 comprimidos) - R$ 4,49
     3️⃣ Medley (10 comprimidos) - R$ 5,49

     Qual dessas opções você prefere?"

   - Se o cliente pediu uma dosagem ou formato que realmente NÃO temos em estoque:
     * Diga educadamente e de forma curta que o formato específico não está disponível no momento e ofereça a alternativa mais próxima.

4. RECONHECIMENTO DE ESCOLHA DO CLIENTE E LINK DIRETO DO PRODUTO:
   - Se o cliente responder escolhendo uma opção (ex: "vou querer a [marca]", "vou querer essa", "pode ser o número 1", "adiciona a de 4,49", "vou levar", "prefiro a ems"):
     * NUNCA repita a lista de produtos ou alternativas.
     * NÃO apresente novas opções de medicamentos.
     * Envie a confirmação personalizada com o nome do item escolhido, valor e link direto:
       "Perfeito! Já separei para você:
       💊 *{nome_produto_escolhido}* - R$ {preco} 😊

       *(Pelo link você fecha em menos de 1 minuto, escolhe a forma de pagamento e seu pedido chega mais rápido!)*

       💬 **Prefere continuar aqui pelo WhatsApp?**
       Sem problemas! Um dos nossos balconistas já vai assumir o atendimento para finalizar seu pedido.

       {link_direto_do_produto}"
     * Inclua a tag [TRANSFERIR_ATENDIMENTO] para transferir a conversa para a equipe de balcão imediatamente.

5. CANAL PREFERENCIAL (CATÁLOGO ONLINE):
   - Apresente a loja online como a forma mais prática e vantajosa para ver fotos, cupons, opções de genéricos/similares com desconto e calcular o frete automaticamente.

6. PEDIDO DIRETO PELO WHATSAPP (VONTADE DO CLIENTE):
   - Se o cliente informar que prefere fechar pelo WhatsApp ou mandar a lista de compras no chat:
     1. Não insista para que ele use o site.
     2. Apresente os preços dos produtos consultados.
     3. Avise educadamente que o balconista da farmácia vai continuar a conversa em instantes para anotar o endereço e concluir o pedido.
     4. Acione a função interna de transbordo para a equipe de balcão [TRANSFERIR_ATENDIMENTO].

7. POLÍTICA DE ENTREGA E RECEITUÁRIO:
   - A drogaria opera com foco exclusivo em tele-entrega (delivery). Não ofereça retirada em loja física.
   - Para medicamentos controlados, antibióticos ou tarja preta, avise que a receita médica (foto legível no chat ou anexo no carrinho) deve ser conferida pelo farmacêutico antes da entrega.

8. DIRETRIZES DE LINKS E FORMATAÇÃO VISUAL:
   - Formate SEMPRE a URL da loja online em uma linha isolada, com uma linha em branco antes e uma linha em branco depois (ex: '\n\nhttps://...farmaflow.online\n\n'), sem emojis ou símbolos grudados na mesma linha da URL, para que o WhatsApp gere perfeitamente o card com a logo da drogaria e a visualização completa do link (Link Preview).
   - Nunca polua o chat com múltiplos links na mesma mensagem.
   - Em buscas e listagens de preços, apresente apenas 'Nome - Preço' e inclua apenas o link geral da loja no final da mensagem em linha própria isolada.
   - Envie o link direto de um produto específico SOMENTE se o cliente solicitar a compra daquele item em particular.
   - Se o cliente optar por pedir pelo WhatsApp, não envie links de carrinho; apresente os valores e acione o balconista humano para concluir a tele-entrega.

9. POSTURA E LIMITES:
   - Mantenha respostas curtas, gentis e comerciais (1 a 3 parágrafos). Não colete dados de cartão de crédito no chat.`;

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
    if (!STOP_WORDS.has(token) && token.length >= 2) {
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

function extractDosageAndPresentation(text: string): {
  detectedDosage: string | null;
  dosageSqlVariants: string[];
  isDrops: boolean;
  isSyrup: boolean;
  isTablets: boolean;
} {
  const norm = (text || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1. Detecta dosagem explícita com unidade
  let dosageMatch = norm.match(/\b(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|ml)\b/i);
  let detectedDosage = dosageMatch ? dosageMatch[0].replace(/\s+/g, '') : null;

  // 2. Se não achou com unidade explícita, verifica números típicos de dosagem isolados
  if (!detectedDosage) {
    const numMatch = norm.match(/\b(1000|500|750|250|125|100|50|40|25|20|10|5)\b/);
    if (numMatch) {
      detectedDosage = numMatch[1] === "1000" ? "1g" : `${numMatch[1]}mg`;
    }
  }

  let dosageSqlVariants: string[] = [];
  if (detectedDosage) {
    if (detectedDosage === "500mg" || detectedDosage === "0.5g" || detectedDosage === "0,5g") {
      dosageSqlVariants = ["%500mg%", "%500 mg%"];
    } else if (detectedDosage === "1g" || detectedDosage === "1000mg" || detectedDosage === "1.000mg") {
      dosageSqlVariants = ["%1g%", "%1 g%", "%1000mg%", "%1000 mg%"];
    } else if (detectedDosage === "750mg") {
      dosageSqlVariants = ["%750mg%", "%750 mg%"];
    } else if (detectedDosage === "250mg") {
      dosageSqlVariants = ["%250mg%", "%250 mg%"];
    } else if (detectedDosage.endsWith("mg")) {
      const val = detectedDosage.replace("mg", "");
      dosageSqlVariants = [`%${val}mg%`, `%${val} mg%`];
    } else if (detectedDosage.endsWith("g")) {
      const val = detectedDosage.replace("g", "");
      dosageSqlVariants = [`%${val}g%`, `%${val} g%`];
    } else if (detectedDosage.endsWith("ml")) {
      const val = detectedDosage.replace("ml", "");
      dosageSqlVariants = [`%${val}ml%`, `%${val} ml%`];
    }
  }

  // Mapeamento amplo e robusto de formas farmacêuticas
  const isDrops = /\b(gotas?|gts?|gotinha|gotinhas|liquida|liquido|solucao|sol)\b/i.test(norm);
  const isSyrup = /\b(xaropes?|xpe)\b/i.test(norm);
  const isTablets = /\b(comprimidos?|cpr|comp|cps?|capsulas?|pilula|pilulas|drageas?)\b/i.test(norm);

  return {
    detectedDosage,
    dosageSqlVariants,
    isDrops,
    isSyrup,
    isTablets
  };
}

/**
 * Identifica se um produto é em gotas / solução oral gotejadora (10ml, 20ml, GTS, etc.)
 */
export function isProductDrops(product: any): boolean {
  if (!product) return false;
  const str = `${product.name || ''} ${product.presentation || ''}`.toLowerCase();
  
  // Se for comprimido/cápsula explícito sem menção a gotas/gts, não é gotas
  const isStrictTablet = /\b(cpr|comp|comprimido|cps|capsula|dragea|blister|cartela)\b/i.test(str) && 
    !/\b(gts|gota|gotas|gotejador)\b/i.test(str);
  if (isStrictTablet) return false;

  return (
    /\b(gts|gota|gotas|gotejador)\b/i.test(str) ||
    str.includes("gts") ||
    str.includes("gota") ||
    str.includes("sol oral") ||
    str.includes("sol 10ml") ||
    str.includes("sol 20ml") ||
    str.includes("sol 15ml") ||
    str.includes("sol 30ml") ||
    str.includes("sol 50ml") ||
    str.includes("sol 60ml") ||
    str.includes("frasco com 10ml") ||
    str.includes("frasco com 20ml") ||
    str.includes("frasco conta-gotas") ||
    str.includes("frasco gotejador")
  );
}

/**
 * Identifica se um produto é em comprimidos / cápsulas / sólidos
 */
export function isProductTablets(product: any): boolean {
  if (!product) return false;
  if (isProductDrops(product)) return false;
  const str = `${product.name || ''} ${product.presentation || ''}`.toLowerCase();
  return (
    /\b(cpr|comp|comprimido|comprimidos|cps|capsula|capsulas|dragea|drageas|blister|cartela)\b/i.test(str) ||
    str.includes("cpr") ||
    str.includes("comp")
  );
}

/**
 * Identifica se um produto é em xarope
 */
export function isProductSyrup(product: any): boolean {
  if (!product) return false;
  const str = `${product.name || ''} ${product.presentation || ''}`.toLowerCase();
  return /\b(xpe|xarope)\b/i.test(str) || str.includes("xpe") || str.includes("xarope");
}

/**
 * Formata o rótulo comercial legível e humanizado do medicamento para apresentação ao cliente
 */
export function formatMedicineLabel(product: any): string {
  if (!product) return "";
  const name = String(product.name || "").trim();
  const pres = String(product.presentation || "").trim();

  let lab = "";
  if (/- (GERM|GERMED)\b/i.test(name)) lab = "Germed";
  else if (/- (MDLY|MEDLEY)\b/i.test(name)) lab = "Medley";
  else if (/- (EMS)\b/i.test(name)) lab = "EMS";
  else if (/- (PRATI|PRTD)\b/i.test(name)) lab = "Prati-Donaduzzi";
  else if (/- (NEOQ|NQ|NEO QUIMICA)\b/i.test(name)) lab = "Neo Química";
  else if (/- (CIMED)\b/i.test(name)) lab = "Cimed";
  else if (/- (EURO|EUROFARMA)\b/i.test(name)) lab = "Eurofarma";
  else if (/- (ACHE|ACHÉ)\b/i.test(name)) lab = "Aché";
  else if (/- (SANOFI)\b/i.test(name)) lab = "Sanofi";
  else if (/MAXALGINA/i.test(name)) lab = "Maxalgina";
  else if (/DIPIMED/i.test(name)) lab = "Dipimed";
  else if (/NOVALGINA/i.test(name)) lab = "Novalgina";
  else if (/NEVRALDOR/i.test(name)) lab = "Nevraldor";

  const volMatch = name.match(/\b(\d+)\s*ML\b/i) || pres.match(/\b(\d+)\s*ml\b/i);
  const vol = volMatch ? `${volMatch[1]}ml` : "";

  const doseMatch = name.match(/\b(\d+(?:[.,]\d+)?\s*(?:mg|g))\b/i) || pres.match(/\b(\d+(?:[.,]\d+)?\s*(?:mg|g))\b/i);
  let dose = doseMatch ? doseMatch[1].toLowerCase().replace(/\s+/g, "") : "";
  if (vol && dose && !dose.includes("/ml")) {
    dose = `${dose}/ml`;
  }

  if (isProductDrops(product)) {
    const brand = lab || (name.toLowerCase().includes("dipirona") ? "Genérico" : name);
    const details = [vol, dose ? `(${dose})` : ""].filter(Boolean).join(" ");
    return details ? `${brand} ${details}` : brand;
  }

  const compMatch = name.match(/\b(\d+)\s*(?:CPR|COMP|CPS)\b/i) || pres.match(/\b(\d+)\s*comprimidos?\b/i);
  if (compMatch) {
    const brand = lab || name;
    return `${brand} (${compMatch[1]} comprimidos)`;
  }

  return name;
}

/**
 * Validação rigorosa de equivalência e compatibilidade de dosagem em memória.
 * Impede que dosagens de 1g sejam misturadas quando o cliente pediu 500mg, e vice-versa.
 */
function productMatchesDosage(product: any, detectedDosage: string | null): boolean {
  if (!detectedDosage) return false;
  const text = `${product.name || ""} ${product.presentation || ""}`.toLowerCase();

  if (detectedDosage === "500mg" || detectedDosage === "0.5g" || detectedDosage === "0,5g") {
    // Deve conter 500mg ou 0.5g, e rigorosamente NÃO ser 1g / 1000mg
    const has500 = /\b(500\s*mg|0[.,]5\s*g)\b/i.test(text);
    const has1g = /\b(1\s*g|1000\s*mg|1\.000\s*mg)\b/i.test(text);
    return has500 && !has1g;
  }

  if (detectedDosage === "1g" || detectedDosage === "1000mg" || detectedDosage === "1.000mg") {
    // Deve conter 1g ou 1000mg, e rigorosamente NÃO ser 500mg
    const has1g = /\b(1\s*g|1000\s*mg|1\.000\s*mg)\b/i.test(text);
    const has500 = /\b(500\s*mg|0[.,]5\s*g)\b/i.test(text);
    return has1g && !has500;
  }

  if (detectedDosage === "750mg") {
    return /\b(750\s*mg)\b/i.test(text);
  }

  if (detectedDosage === "250mg") {
    return /\b(250\s*mg)\b/i.test(text);
  }

  if (detectedDosage.endsWith("mg")) {
    const val = detectedDosage.replace("mg", "").trim();
    return new RegExp(`\\b${val}\\s*mg\\b`, "i").test(text);
  }

  if (detectedDosage.endsWith("g")) {
    const val = detectedDosage.replace("g", "").trim();
    return new RegExp(`\\b${val}\\s*g\\b`, "i").test(text);
  }

  if (detectedDosage.endsWith("ml")) {
    const val = detectedDosage.replace("ml", "").trim();
    return new RegExp(`\\b${val}\\s*ml\\b`, "i").test(text);
  }

  return false;
}

/**
 * Garante que qualquer link de loja/produto esteja estritamente em uma linha isolada,
 * com quebras de linha antes e depois, sem prefixos colados (como "👉 http..."),
 * permitindo que a Evolution API e o WhatsApp identifiquem a URL e gerem o Link Preview com thumbnail.
 */
export function isolateUrlsInText(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/([\t ]*(?:👉|🔗|🛒|🛍️|🌐)[\t ]*)?(https?:\/\/[^\s)]+)/gi, (match, emojiPrefix, rawUrl) => {
      let url = rawUrl.trim();
      let trailingPunct = "";
      if (/[.,;!]$/.test(url)) {
        trailingPunct = url.slice(-1);
        url = url.slice(0, -1);
      }
      const prefix = emojiPrefix && emojiPrefix.trim() ? `${emojiPrefix.trim()}\n\n` : "";
      return `\n\n${prefix}${url}\n\n${trailingPunct}`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Separa o texto explicativo da URL para permitir o envio em 2 balões separados no WhatsApp:
 * Balão 1: Texto de atendimento/orientação (sem o link)
 * Balão 2: EXCLUSIVAMENTE a URL pura (para que a Evolution API e o WhatsApp gerem o Link Preview perfeito com a logo da farmácia)
 */
export function extractUrlAndCleanText(text: string): { mainText: string; url: string | null } {
  if (!text || typeof text !== "string") return { mainText: "", url: null };

  const urlMatch = text.match(/(https?:\/\/[^\s)]+)/i);
  if (!urlMatch) {
    return { mainText: text.trim(), url: null };
  }

  let rawUrl = urlMatch[1].trim();
  if (/[.,;!]$/.test(rawUrl)) {
    rawUrl = rawUrl.slice(0, -1);
  }

  // Remove a URL e marcadores/emojis associados diretamente
  let mainText = text
    .replace(/(?:[\t ]*(?:👉|🔗|🛒|🛍️|🌐)[\t ]*)?(https?:\/\/[^\s)]+)/gi, "")
    // Remove linhas que continham apenas emojis de indicação de link
    .replace(/^\s*(?:👉|🔗|🛒|🛍️|🌐)\s*$/gm, "")
    // Limpa quebras de linha excessivas
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Limpa espaços no final de cada linha
  mainText = mainText.replace(/[\t ]+$/gm, "").trim();

  return { mainText, url: rawUrl };
}

/**
 * Garante que a URL da loja ou do produto contenha parâmetros de versão/quebra de cache (Cache Buster),
 * forçando os servidores do WhatsApp e da Evolution API a descartarem o preview antigo em cache
 * e renderizarem imediatamente a logo oficial da drogaria (og:image).
 * Exemplo: https://drogaria-esplendido.farmaflow.online?ref=wpp&v=2
 */
export function ensureStoreUrlCacheBuster(rawUrl: string, version: string | number = "2"): string {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return trimmed;
  try {
    const u = new URL(trimmed);
    if (!u.searchParams.has("ref")) {
      u.searchParams.set("ref", "wpp");
    }
    if (!u.searchParams.has("v")) {
      u.searchParams.set("v", String(version));
    }
    return u.toString();
  } catch (_) {
    const sep = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${sep}ref=wpp&v=${version}`;
  }
}

export interface ChosenProductDetails {
  isChoice: boolean;
  productName: string;
  priceFormatted: string;
  directProductUrl: string;
  productId?: string;
  matchedOption?: any;
}

/**
 * Identifica com precisão o produto escolhido pelo cliente no histórico recente
 * e gera o link direto do produto na loja online para conclusão imediata.
 */
export async function resolveCustomerChosenProduct(
  incomingMessage: string,
  history: Array<{ role: string; content: string }>,
  tenantIds: string[],
  storeLink: string
): Promise<ChosenProductDetails | null> {
  const choiceCheck = detectCustomerChoiceIntent(incomingMessage, history);
  if (!choiceCheck.isChoice) return null;

  // 1. Procurar na história a última mensagem do bot que apresentou opções ao cliente
  const lastBotMsg = history.slice().reverse().find(m => m.role === "assistant" || m.role === "model");
  const optionsText = lastBotMsg?.content || "";

  // 2. Extrair opções numeradas ou listadas (ex: "1️⃣ Germed 20ml (500mg/ml) - R$ 7,49")
  const lines = optionsText.split("\n");
  const options: Array<{ idx: number; name: string; price: string; rawLine: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(/^(?:([1-9])(?:️⃣|⃣|\.|\)|\s*[-–])\s*)(.+)/u);
    if (m) {
      const idx = parseInt(m[1], 10);
      const rest = m[2].trim();
      const priceMatch = rest.match(/R\$\s*([0-9]+[.,][0-9]{2})/i);
      const price = priceMatch ? priceMatch[1].replace(".", ",") : "";
      let cleanName = rest
        .replace(/⭐\s*Mais\s*econômica/gi, "")
        .replace(/⭐\s*Mais\s*economica/gi, "")
        .replace(/-?\s*R\$\s*[0-9]+[.,][0-9]{2}.*/i, "")
        .trim();
      options.push({ idx, name: cleanName, price, rawLine: trimmed });
    }
  }

  // 3. Identificar qual opção foi escolhida pelo cliente
  let matchedOption: { idx: number; name: string; price: string; rawLine: string } | null = null;
  const norm = incomingMessage.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Por número ou ordinal (ex: "1", "o número 2", "a primeira", "opção 3")
  const numMatch = norm.match(/\b(?:numero|opcao|n[°ºo]?|o|a)?\s*([1-9])\b/i);
  if (numMatch) {
    const idx = parseInt(numMatch[1], 10);
    matchedOption = options.find(o => o.idx === idx) || null;
  }
  if (!matchedOption && /\b(primeir[ao]|1[aªoº])\b/i.test(norm)) matchedOption = options.find(o => o.idx === 1) || null;
  if (!matchedOption && /\b(segund[ao]|2[aªoº])\b/i.test(norm)) matchedOption = options.find(o => o.idx === 2) || null;
  if (!matchedOption && /\b(terceir[ao]|3[aªoº])\b/i.test(norm)) matchedOption = options.find(o => o.idx === 3) || null;
  if (!matchedOption && /\b(quart[ao]|4[aªoº])\b/i.test(norm)) matchedOption = options.find(o => o.idx === 4) || null;

  // Por valor monetário mencionado (ex: "essa de 5,99", "o de 7,49")
  if (!matchedOption) {
    const priceMatch = norm.match(/([0-9]+[.,][0-9]{2})/);
    if (priceMatch) {
      const pStr = priceMatch[1].replace(".", ",");
      matchedOption = options.find(o => o.price === pStr) || null;
    }
  }

  // Por critério econômico ("a mais barata", "mais econômica", "em conta")
  if (!matchedOption && /\b(mais\s+barat[ao]|mais\s+economic[ao]|em\s+conta)\b/i.test(norm)) {
    matchedOption = options[0] || null;
  }

  // Por marca ou palavra-chave mencionada (ex: "vou querer a dipimed", "quero a germed", "a medley", "ems")
  if (!matchedOption && options.length > 0) {
    for (const opt of options) {
      const optNorm = opt.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const words = optNorm.split(/[\s()\-/,]+/).filter(w => w.length >= 3 && !["comprimidos", "gotas", "solucao"].includes(w));
      for (const w of words) {
        if (norm.includes(w)) {
          matchedOption = opt;
          break;
        }
      }
      if (matchedOption) break;
    }
  }

  // Se o cliente usou demonstrativo ("quero essa", "pode ser essa", "vou levar") sem especificar número
  if (!matchedOption && options.length > 0) {
    matchedOption = options[0];
  }

  // 4. Localizar o produto correspondente no banco de dados da farmácia
  let chosenName = matchedOption?.name || "";
  let chosenPrice = matchedOption?.price || "";
  let dbProduct: any = null;

  // Identificar termo de busca para localizar o produto no DB
  let searchWord = "";
  if (matchedOption) {
    const tokens = matchedOption.name.split(/[\s()\-/,]+/).filter(w => w.length >= 3);
    searchWord = tokens[0] || matchedOption.name;
  } else {
    // Tenta extrair a marca/item mencionado diretamente na mensagem (ex: "vou querer a dipimed" -> "dipimed")
    searchWord = norm
      .replace(/\b(vou\s+(querer|levar|ficar|comprar|pegar)|quero|pode\s+ser|adiciona|separa|prefiro|a|o|da|do|de|essa|esse|esta|este)\b/g, " ")
      .trim()
      .split(/\s+/)[0] || "";
  }

  const effectiveTenantIds = tenantIds.length > 0 ? tenantIds : ["nosso-catalogo"];

  if (searchWord && searchWord.length >= 2) {
    try {
      const { data: prods } = await supabaseAdmin
        .from("products")
        .select("id, name, price, stock, presentation, manufacturer, grouping_slug")
        .in("tenant_id", effectiveTenantIds)
        .or(`name.ilike.%${searchWord}%,manufacturer.ilike.%${searchWord}%`)
        .order("stock", { ascending: false })
        .limit(25);

      if (prods && prods.length > 0) {
        // Se tiver preço conhecido, buscar produto com preço exato ou mais próximo
        if (chosenPrice) {
          const pNum = parseFloat(chosenPrice.replace(",", "."));
          const matchPrice = prods.find(p => Math.abs(Number(p.price) - pNum) < 0.05);
          if (matchPrice) dbProduct = matchPrice;
        }

        // Se a opção contiver "20ml" ou "10ml", filtrar
        if (!dbProduct && chosenName) {
          const volMatch = chosenName.match(/\b(\d+ml)\b/i);
          if (volMatch) {
            const vol = volMatch[1].toLowerCase();
            const matchVol = prods.find(p => `${p.name} ${p.presentation}`.toLowerCase().includes(vol));
            if (matchVol) dbProduct = matchVol;
          }
        }

        if (!dbProduct) {
          dbProduct = prods[0];
        }
      }
    } catch (e: any) {
      console.warn("[AiAgentService] Erro ao buscar produto escolhido no banco:", e.message);
    }
  }

  // 5. Construir o Link Direto e Dados Finais do Produto
  const cleanStoreUrl = (storeLink || "https://farmaflow.online").replace(/\/+$/, "");
  let directProductUrl = "";

  if (dbProduct && (dbProduct.grouping_slug || dbProduct.slug || dbProduct.id)) {
    const slugOrId = dbProduct.slug || dbProduct.grouping_slug || dbProduct.id;
    directProductUrl = ensureStoreUrlCacheBuster(`${cleanStoreUrl}/produto/${slugOrId}`);
    if (!chosenName) {
      chosenName = formatMedicineLabel(dbProduct) || dbProduct.name;
    }
    if (!chosenPrice && dbProduct.price) {
      chosenPrice = Number(dbProduct.price).toFixed(2).replace(".", ",");
    }
  } else {
    const term = chosenName || searchWord || incomingMessage.trim();
    directProductUrl = ensureStoreUrlCacheBuster(`${cleanStoreUrl}/?busca=${encodeURIComponent(term)}`);
  }

  if (!chosenName) chosenName = "Medicamento Selecionado";
  if (!chosenPrice) chosenPrice = "Consulte na loja";

  return {
    isChoice: true,
    productName: chosenName,
    priceFormatted: chosenPrice,
    directProductUrl,
    productId: dbProduct?.id,
    matchedOption
  };
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
   * Realiza resolução ultra-robusta de tenant via whatsapp_instances, ID direto, slug ou rede.
   */
  public async verifyTenantAuthorization(tenantId: string): Promise<any> {
    if (!tenantId) {
      throw new Error("ID da drogaria não informado.");
    }

    const rawId = String(tenantId).trim();
    const sanitizedId = rawId
      .replace(/^store_/, '')
      .replace(/^inbox_/, '')
      .replace(/^tenant_/, '');
    const dashId = sanitizedId.replace(/_/g, '-');
    const underId = sanitizedId.replace(/-/g, '_');

    let tenant: any = null;

    // 1. Busca Direta por ID na tabela tenants (ex: "maxima-popular", "maxima-popular-filial-unamar")
    try {
      const { data: directById } = await supabaseAdmin
        .from("tenants")
        .select("*")
        .eq("id", rawId)
        .maybeSingle();

      if (directById) {
        tenant = directById;
      } else if (sanitizedId !== rawId) {
        const { data: directBySanitizedId } = await supabaseAdmin
          .from("tenants")
          .select("*")
          .eq("id", sanitizedId)
          .maybeSingle();
        if (directBySanitizedId) tenant = directBySanitizedId;
      } else if (dashId !== rawId) {
        const { data: directByDash } = await supabaseAdmin
          .from("tenants")
          .select("*")
          .eq("id", dashId)
          .maybeSingle();
        if (directByDash) tenant = directByDash;
      }
    } catch (idErr: any) {
      console.warn("[AiAgentService] Aviso na busca direta por ID em tenants:", idErr.message);
    }

    // 2. Busca estrita na tabela whatsapp_instances pelo instance_name ou store_id exato da instância
    if (!tenant) {
      try {
        const { data: inst } = await supabaseAdmin
          .from("whatsapp_instances")
          .select("store_id, instance_name")
          .or(`instance_name.ilike.${rawId},instance_name.ilike.${sanitizedId},instance_name.ilike.${dashId},store_id.eq.${rawId},store_id.eq.${sanitizedId},store_id.eq.${dashId}`)
          .limit(1)
          .maybeSingle();

        if (inst?.store_id) {
          const targetStoreId = String(inst.store_id).trim();
          const cleanTarget = targetStoreId.replace(/^store_/, '').replace(/^inbox_/, '');
          const cleanTargetDash = cleanTarget.replace(/_/g, '-');

          const { data: t } = await supabaseAdmin
            .from("tenants")
            .select("*")
            .or(`id.eq.${targetStoreId},id.eq.${cleanTarget},id.eq.${cleanTargetDash},slug.eq.${targetStoreId},slug.eq.${cleanTarget}`)
            .limit(1)
            .maybeSingle();

          if (t) {
            tenant = t;
          } else {
            // Se o registro não estiver na tabela tenants, cria objeto isolado com o store_id estrito da instância
            tenant = { id: targetStoreId, name: targetStoreId, slug: cleanTarget };
          }
        }
      } catch (instErr: any) {
        console.warn("[AiAgentService] Aviso ao consultar whatsapp_instances:", instErr.message);
      }
    }

    // 3. Busca por Slug ou Nome (Exato / Ilike estrito da própria unidade)
    if (!tenant) {
      try {
        const { data: matchSlugOrName } = await supabaseAdmin
          .from("tenants")
          .select("*")
          .or(`slug.ilike.${sanitizedId},slug.ilike.${rawId},slug.ilike.${dashId},name.ilike.${sanitizedId},name.ilike.${rawId}`)
          .limit(1)
          .maybeSingle();

        if (matchSlugOrName) {
          tenant = matchSlugOrName;
        }
      } catch (slugErr: any) {
        console.warn("[AiAgentService] Aviso na busca por slug/name em tenants:", slugErr.message);
      }
    }

    // 4. Se não encontrar nenhuma drogaria vinculada a este identificador/instância, NÃO RECORRE A MATRIZ OU OUTRAS UNIDADES
    if (!tenant) {
      console.error(`[AiAgentService] ❌ Nenhuma drogaria encontrada no banco de dados para a instância ou identificador "${tenantId}". Disparo cruzado prevenido com sucesso.`);
      throw new Error(`MÓDULO_NÃO_AUTORIZADO: Nenhuma drogaria encontrada no banco de dados para a instância "${tenantId}". O atendimento por IA foi suspenso para esta mensagem para evitar disparos duplicados.`);
    }

    // 4. Carregamento 100% Dinâmico das Configurações de IA da Drogaria
    let rawConfig: any = tenant.ai_agent_config || tenant.aiagentconfig;
    if (typeof rawConfig === 'string') {
      try {
        rawConfig = JSON.parse(rawConfig);
      } catch (e) {
        rawConfig = {};
      }
    }
    rawConfig = rawConfig || {};

    const resolvedProvider = rawConfig.provider || (rawConfig.openai_api_key ? 'openai' : 'gemini');
    const resolvedApiKey = (
      rawConfig.apiKey ||
      rawConfig.openai_api_key ||
      rawConfig.api_key ||
      (resolvedProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)
    )?.trim();

    tenant.ai_agent_config = {
      active: rawConfig.active ?? rawConfig.enabled ?? true,
      provider: resolvedProvider,
      model: rawConfig.model || (resolvedProvider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash'),
      apiKey: resolvedApiKey,
      openai_api_key: rawConfig.openai_api_key || (resolvedProvider === 'openai' ? resolvedApiKey : undefined),
      systemPrompt: rawConfig.systemPrompt || DEFAULT_AI_AGENT_PROMPT,
      fallbackMessage: rawConfig.fallbackMessage || "Desculpe, estou com uma instabilidade momentânea. Um de nossos atendentes humanos responderá sua mensagem em breve!",
      transitionToHumanMessage: (rawConfig.transitionToHumanMessage && !rawConfig.transitionToHumanMessage.includes("Encaminhei sua dúvida"))
        ? rawConfig.transitionToHumanMessage
        : "Perfeito! Já notifiquei nossa equipe e um dos nossos balconistas vai dar continuidade ao seu atendimento em instantes para finalizar seu pedido.",
      maxTokens: rawConfig.maxTokens || 500,
      temperature: rawConfig.temperature ?? 0.7,
      maxInteractionsPerSession: rawConfig.maxInteractionsPerSession || 4,
      antiAbuseGuardrailsEnabled: rawConfig.antiAbuseGuardrailsEnabled !== false,
      strictStoreLinkEnforcement: rawConfig.strictStoreLinkEnforcement !== false,
      storeLink: rawConfig.storeLink || tenant.welcome_message_link || (tenant.custom_domain ? `https://${tenant.custom_domain}` : tenant.slug ? `https://${tenant.slug}.farmaflow.online` : `https://${tenant.id}.farmaflow.online`),
      ...rawConfig
    };

    console.log(`[AiAgentService] Configurações de IA carregadas dinamicamente para "${tenant.name}" (@${tenant.slug || tenant.id}) - Provedor: ${resolvedProvider}, Chave ativa: ${Boolean(resolvedApiKey)}`);

    const isEnabled = tenant.is_ai_agent_enabled !== false && tenant.isaiagentenabled !== false;
    if (!isEnabled) {
      const err = new Error("MÓDULO_NÃO_AUTORIZADO: O Agente de IA está desativado para esta drogaria nas configurações do painel.");
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
        storeLink = `https://${tenant.custom_domain.replace(/^https?:\/\//, '')}`;
      } else if (tenant.slug) {
        const cleanSub = tenant.slug.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        storeLink = `https://${cleanSub}.farmaflow.online`;
      } else {
        storeLink = `https://${tenant.id}.farmaflow.online`;
      }
    }
    // Remover barra final para padronizar parâmetros e adicionar cache-buster
    storeLink = ensureStoreUrlCacheBuster(storeLink.replace(/\/+$/, ''));

    // 4. Detecção Ativa de Prompt Injection e Padrões Abusivos (Proteção de Custos e Tokens)
    const guardrailsEnabled = effectiveConfig.antiAbuseGuardrailsEnabled !== false;
    if (guardrailsEnabled) {
      const abuseCheck = detectAbuseOrPromptInjection(incomingMessage);
      if (abuseCheck.isSuspicious) {
        console.warn(`[AiAgentService] Prompt Injection ou Abuso detectado (${tenantId}):`, abuseCheck.reason);
        const transitionMsg = effectiveConfig.transitionToHumanMessage || buildHumanizedHandoffMessage(storeLink);
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
    if (basePrompt.includes("Explendido") || basePrompt.includes("Explêndido") || basePrompt.includes("Esplendido")) {
      basePrompt = DEFAULT_AI_AGENT_PROMPT;
    }
    basePrompt = basePrompt
      .replace(/\{STORE_NAME\}/g, storeName)
      .replace(/\{STORE_LINK\}/g, storeLink)
      .replace(/\{NOME_FARMACIA\}/g, storeName)
      .replace(/\{LINK_LOJA\}/g, storeLink);

    // Garantir que as diretrizes de equivalência farmacêutica e resposta de múltiplas opções estejam sempre presentes e rigorosamente atualizadas
    const EQUIVALENCE_RULES = `\n\nREGRAS DE EQUIVALÊNCIA FARMACÊUTICA:
- 'DIPIRONA MONO' (Monoidratada) e 'DIPIRONA SODICA' são rigorosamente o mesmo medicamento (Dipirona).
- Maxalgina, Dipimed, Novalgina e Nevraldor são nomes comerciais de Dipirona.
- Frascos de 10ml e 20ml com 'GTS' ou 'SOL' SÃO gotas! NUNCA diga que são "(solução, mas não em gotas)".
- Se o cliente pediu gotas e houver produtos com GTS ou SOL (10ml, 20ml) em estoque, ELE ESTÁ DISPONÍVEL! Diga imediatamente que temos em gotas e NUNCA ofereça comprimidos como alternativa se houver gotas disponíveis.
- Se o cliente pediu 500mg e houver '500MG' ou '500 MG' em qualquer produto da lista (seja MONO ou SODICA), ELE ESTÁ DISPONÍVEL! NUNCA diga que não tem.
- NUNCA liste produtos de 1G ou gotas se o cliente pediu expressamente 500mg em comprimidos e houver 500mg em estoque.
- 'CPR' ou 'COMP' indica comprimidos (ex: 8CPR = 8 comprimidos, 10CPR = 10 comprimidos, 30CPR = 30 comprimidos).
- 'GTS' indica gotas, 'XPE' indica xarope, 'SOL' indica solução oral (gotas), 'EFERV' indica efervescente.
- Siglas finais indicam o laboratório fabricante: EMS, PRATI ou PRTD (Prati-Donaduzzi), NEOQ ou NQ (Neo Química), GERM ou GERMED (Germed), MDLY (Medley), CIMED (Cimed), EURO (Eurofarma), ACHÉ (Aché), SANOFI (Sanofi).

CONCISÃO E DIRETO AO PONTO (REGRAS OBRIGATÓRIAS DE RESPOSTA):
- Respostas no WhatsApp devem ser CURTAS, humanizadas e sem enrolação.
- NUNCA dê explicações técnicas desnecessárias como "(solução, mas não em gotas)" ou justificativas longas.
- Quando o produto solicitado estiver disponível:
  * Diga imediatamente que temos disponível ("Temos sim!"). NUNCA diga que não tem se o item constar na lista de produtos.
  * Apresente NO MÁXIMO 2 A 3 OPÇÕES (as mais econômicas e relevantes) com laboratório/marca, apresentação/tamanho e preço, destacando a primeira com ⭐ Mais econômica.
  * Finalize com uma pergunta curta convidando à ação.

ESTRUTURA DE RESPOSTA (MÁXIMO 2 A 3 OPÇÕES):
- Se o cliente pedir dipirona em gotas e tivermos em estoque:
  Exemplo ideal de resposta curta:
  "Temos dipirona em gotas sim! 😊

  1️⃣ Germed 20ml (500mg/ml) - R$ 7,49 ⭐ Mais econômica
  2️⃣ Germed 10ml (500mg/ml) - R$ 9,14
  3️⃣ Medley 10ml (500mg/ml) - R$ 14,55

  Qual dessas você prefere levar? Posso separar para você ou enviar o link da loja!"

- Se o cliente pedir comprimidos (ex: dipirona 500mg ou 1g):
  Exemplo ideal de resposta curta:
  "Temos dipirona disponível nas seguintes opções:

  1️⃣ EMS (10 comprimidos) - R$ 4,49 ⭐ Mais econômica
  2️⃣ Prati-Donaduzzi (10 comprimidos) - R$ 4,49
  3️⃣ Medley (10 comprimidos) - R$ 5,49

  Qual dessas opções você prefere?"

- Se o cliente pediu uma dosagem ou formato que realmente NÃO temos em estoque:
  * Diga educadamente e de forma curta que o formato específico não está disponível no momento e ofereça a alternativa mais próxima.

RECONHECIMENTO DE ESCOLHA DO CLIENTE E TRANSLADO/CONCLUSÃO:
- Se o cliente responder escolhendo uma opção (ex: "vou querer a [marca]", "vou querer essa da ems", "pode ser o número 1", "adiciona a de 4,49", "vou levar a medley", "quero essa", "prefiro a ems"):
  * NUNCA repita a lista de produtos ou alternativas.
  * NÃO apresente novas opções de medicamentos.
  * Envie exatamente a seguinte resposta acolhedora e comercial:
    "Perfeito! Já anotei a sua preferência. 😊

    🛒 *Dica para agilizar:* Você pode concluir seu pedido agora mesmo pela nossa loja online:

    {STORE_LINK}

    *(É muito mais rápido, prático e 100% seguro!)*

    💬 **Prefere continuar por aqui?** Sem problemas! Já notifiquei nossa equipe e um dos nossos balconistas vai dar continuidade ao seu atendimento em instantes para finalizar seu pedido."
  * Inclua a tag [TRANSFERIR_ATENDIMENTO] para transferir a conversa para a equipe de balcão imediatamente.`;

    if (basePrompt.includes("REGRAS DE EQUIVALÊNCIA FARMACÊUTICA")) {
      basePrompt = basePrompt.replace(/REGRAS DE EQUIVALÊNCIA FARMACÊUTICA:[\s\S]*?(?=\n\n(?:[0-9]+\.|\bDIRETRIZ\b|\bCANAL\b|\bCATÁLOGO\b|\bPOSTURA\b|$))/i, EQUIVALENCE_RULES.trim());
    } else {
      basePrompt += EQUIVALENCE_RULES;
    }

    // 6. Busca contextual aprofundada de produtos no banco de dados real da drogaria
    let catalogContext = "";
    const choiceCheck = detectCustomerChoiceIntent(incomingMessage, chatHistory);
    let resolvedChoice: ChosenProductDetails | null = null;

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

    if (choiceCheck.isChoice) {
      resolvedChoice = await resolveCustomerChosenProduct(
        incomingMessage,
        chatHistory,
        tenantIds.length > 0 ? tenantIds : [tenant.id || tenantId],
        storeLink
      );

      const chosenMsg = resolvedChoice
        ? buildProductHandoffMessage(resolvedChoice.productName, resolvedChoice.priceFormatted, resolvedChoice.directProductUrl)
        : buildHumanizedHandoffMessage(storeLink);

      catalogContext = `\n\n[AVISO CRÍTICO DO SISTEMA - ESCOLHA DO CLIENTE DETECTADA]:
O cliente escolheu uma opção ou demonstrou intenção de compra ("${incomingMessage}").
- NUNCA repita a lista de produtos ou opções.
- NÃO apresente novas opções de medicamentos.
- Envie exatamente a seguinte resposta oficial de conclusão com link direto e transbordo:
${chosenMsg}
[TRANSFERIR_ATENDIMENTO]`;
    } else {
      const searchTerms = extractKeywordsAndIntents(incomingMessage);
      const primarySearchTerm = searchTerms[0] || incomingMessage.trim().split(/\s+/)[0] || "";

      try {
        const matchedProducts = await this.searchProductsInDb(
          tenantIds.length > 0 ? tenantIds : [tenant.id || tenantId],
          incomingMessage,
          4
        );

        if (matchedProducts && matchedProducts.length > 0) {
          const displayProducts = matchedProducts.slice(0, 3);
          catalogContext = "\n\n[CATÁLOGO EM TEMPO REAL - PRODUTOS ENCONTRADOS NO BANCO DE DADOS DA DROGARIA]:\n" +
            displayProducts.map((p, idx) => {
              const preco = (Number(p.price) || 0).toFixed(2);
              const linkProd = `${storeLink}?produto=${p.id}`;
              const statusEstoque = p.stock > 0 ? `Disponível (${p.stock} un)` : 'Temporariamente Esgotado';
              const tarja = p.requires_prescription ? 'Exige Receita Médica' : 'Venda Livre';
              const label = formatMedicineLabel(p);
              return `${idx + 1}. ${label} [Cadastro: ${p.name}] - R$ ${preco} [Estoque: ${statusEstoque} | ${tarja}] (Link: ${linkProd})`;
            }).join("\n") +
            `\n\nDIRETRIZ ESTRITA DE CONCISÃO E RESPOSTA:
- Respostas no WhatsApp devem ser CURTAS, humanizadas e sem enrolação. NUNCA dê explicações técnicas desnecessárias como '(solução, mas não em gotas)'.
- Apresente NO MÁXIMO 2 A 3 OPÇÕES mais econômicas, numeradas (1️⃣, 2️⃣, 3️⃣) com Marca/Apresentação e R$ Preço, destacando a primeira com ⭐ Mais econômica.
- Finalize com uma pergunta curta convidando à ação (ex: 'Qual dessas você prefere levar? Posso separar para você ou enviar o link da loja!').
- NUNCA envie links individuais por produto ao listar opções. Insira apenas UM ÚNICO link geral da loja no rodapé (${storeLink}).
- Se o cliente pediu gotas, frascos com 'GTS' ou 'SOL' (10ml, 20ml) como Maxalgina, Germed, Medley SÃO gotas! NUNCA ofereça comprimidos se houver gotas disponíveis.`;
        } else if (searchTerms.length > 0) {
          catalogContext = `\n\n[CATÁLOGO EM TEMPO REAL]:
Nenhum produto com esses termos exatos foi localizado em estoque no banco de dados local.
- Link de Busca na Webloja para enviar ao cliente: ${storeLink}?busca=${encodeURIComponent(primarySearchTerm)}
- REGRA CRÍTICA: NÃO invente preços (como R$ 12,99 ou qualquer outro valor). Diga que não localizou o preço no momento, convide o cliente a consultar a Webloja pelo link acima ou a conversar com o atendente de plantão.`;
        } else {
          catalogContext = `\n\n[CATÁLOGO EM TEMPO REAL]:
Nenhum produto específico identificado na mensagem. Link geral da Webloja: ${storeLink}`;
        }
      } catch (catErr) {
        console.warn("[AiAgentService] Falha ao consultar contexto de produtos:", catErr);
        catalogContext = `\n\nLink da Webloja: ${storeLink}`;
      }
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
      rawResult = await this.callOpenAi(apiKey, effectiveConfig.model || 'gpt-4o-mini', fullSystemInstruction, incomingMessage, chatHistory, storeLink, tenant);
    } else {
      // Default: Google Gemini
      rawResult = await this.callGemini(apiKey, effectiveConfig.model || 'gemini-2.5-flash', fullSystemInstruction, incomingMessage, chatHistory, storeLink, tenant);
    }

    // 9. Detecção Ativa de Pedido de Atendimento Humano, Balconista ou Escolha de Produto
    const humanCheck = detectHumanHandoffIntent(incomingMessage);
    const hasTransferTag = /\[(TRANSFERIR_ATENDIMENTO|TRANSFER_TO_HUMAN|HANDOFF_HUMAN|TRANSBORDO)\]/i.test(rawResult.reply);
    const indicatesTransferInText = /((estou|vou)\s+(transferir|passar|encaminhar)|(um\s+de\s+nossos\s+balconistas|nossa\s+equipe\s+de\s+balconistas|um\s+atendente\s+humano|nossos\s+atendentes)\s+(ir[áa]|vai|ja\s+vai)\s+(te\s+)?(atender|responder))/i.test(rawResult.reply);

    const shouldHandoff = isFinalSessionTurn || rawResult.transferredToHuman === true || humanCheck.isHumanRequested || choiceCheck.isChoice || hasTransferTag || indicatesTransferInText;
    const handoffReason = choiceCheck.isChoice
      ? "PURCHASE_INTENT"
      : (humanCheck.isHumanRequested 
          ? "HUMAN_REQUESTED" 
          : (hasTransferTag || indicatesTransferInText 
              ? "HUMAN_REQUESTED" 
              : (isFinalSessionTurn ? "MAX_INTERACTIONS_REACHED" : "HUMAN_REQUESTED")));

    // 10. Limpeza de tags internas e garantia de presença do link da Webloja
    let enforcedReply = rawResult.reply
      .replace(/\[(TRANSFERIR_ATENDIMENTO|TRANSFER_TO_HUMAN|HANDOFF_HUMAN|TRANSBORDO)\]/gi, '')
      .trim();

    // Se o cliente escolheu uma opção, garante a mensagem oficial de conclusão e transbordo acolhedor com link direto do produto
    if (choiceCheck.isChoice) {
      enforcedReply = resolvedChoice
        ? buildProductHandoffMessage(resolvedChoice.productName, resolvedChoice.priceFormatted, resolvedChoice.directProductUrl)
        : buildHumanizedHandoffMessage(storeLink);
    } else {
      // Sanitização de múltiplos links por produto em listagens (evita poluição visual)
      enforcedReply = this.sanitizeExcessiveProductLinks(enforcedReply, incomingMessage, storeLink);

      if (!enforcedReply.includes("http") && !enforcedReply.includes(".online") && !enforcedReply.includes(".com")) {
        enforcedReply = `${enforcedReply}\n\nPara conferir mais detalhes ou aproveitar as promoções, acesse nossa loja online:\n${storeLink}`;
      }
    }

    // 11. Se for o último turno da sessão por limite, anexa mensagem de transição humana caso não tenha
    const transitionMsg = effectiveConfig.transitionToHumanMessage || buildHumanizedHandoffMessage(storeLink);
    if (isFinalSessionTurn && !choiceCheck.isChoice && !enforcedReply.includes("balconista") && !enforcedReply.includes("atendente humano")) {
      enforcedReply = `${enforcedReply}\n\n${transitionMsg}`;
    }

    return {
      ...rawResult,
      reply: enforcedReply,
      interactionCount: currentInteraction,
      maxInteractions,
      transferredToHuman: shouldHandoff,
      handoffReason: shouldHandoff ? handoffReason : undefined
    };
  }

  /**
   * Sanitiza múltiplos links por produto ao listar itens, garantindo visual limpo e apenas um link geral ao final.
   */
  private sanitizeExcessiveProductLinks(reply: string, userMessage: string, storeLink: string): string {
    if (!reply || typeof reply !== 'string') return reply;

    const buyIntent = /(levar|comprar|pedir|manda o link|link d|quero ess|quero o|vou ficar com|finalizar)/i.test(userMessage);

    // Se o cliente tem intenção explícita de compra de um produto, não interfere no link direto
    if (buyIntent) {
      return reply;
    }

    // Se houver 2 ou mais links de produtos (?produto=) no corpo da mensagem, remove os links individuais repetitivos
    const productLinks = reply.match(/https?:\/\/[^\s)]+\?produto=\w+/gi) || [];
    if (productLinks.length >= 2) {
      let cleaned = reply;
      // Remove linhas ou trechos de link do produto (ex: "- Link: https://..." ou "👉 https://...produto=...")
      cleaned = cleaned.replace(/[-*•]?\s*(Link\s*(do\s*produto|direto)?:\s*)?https?:\/\/[^\s)]+\?produto=\w+/gi, '');
      cleaned = cleaned.replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\?produto=\w+\)/gi, '$1');
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

      // Garante que o rodapé contenha o link geral da loja
      if (!cleaned.includes(storeLink)) {
        cleaned = `${cleaned}\n\nPara conferir mais detalhes ou aproveitar as promoções, acesse nossa loja online:\n${storeLink}`;
      }
      return cleaned;
    }

    return reply;
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
      replyWithAudio?: boolean;
      tenantAiConfig?: any;
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

    // 1. Verificar se a mensagem contém link para separação estratégica em 2 balões:
    // Balão 1: Texto explicativo/atendimento (sem URL)
    // Balão 2: EXCLUSIVAMENTE a URL pura (para que a Evolution API e o WhatsApp gerem o Link Preview perfeito com a logo da farmácia)
    const { mainText, url } = extractUrlAndCleanText(replyText);
    const hasUrlToSplit = Boolean(url && url.startsWith("http"));
    const finalReplyText = isolateUrlsInText(replyText);
    const nowIso = new Date().toISOString();
    const nextCount = params.nextCount;

    // FLUXO DE RESPOSTA EM ÁUDIO (Áudio com Áudio):
    // Se o cliente enviou mensagem por áudio, converte a resposta em áudio (PTT)
    // e envia o Balão 2 em TEXTO com as opções resumidas, valores e link para compra rápida.
    if (params.replyWithAudio) {
      console.log(`[AiAgentService] 🎙️ Fluxo de Resposta em ÁUDIO (PTT) ativado para ${cleanPhone} via "${targetInstanceName}"`);
      
      let speechAudio: { audioBase64: string; mimeType: string } | null = null;
      try {
        speechAudio = await generateTextToSpeech({
          text: replyText,
          apiKey: params.tenantAiConfig?.apiKey,
          openaiApiKey: params.tenantAiConfig?.openai_api_key,
          geminiApiKey: params.tenantAiConfig?.gemini_api_key,
          provider: params.tenantAiConfig?.provider,
          voice: "alloy"
        });
      } catch (ttsErr: any) {
        console.warn("[AiAgentService] Aviso ao sintetizar áudio TTS:", ttsErr.message);
      }

      if (speechAudio?.audioBase64) {
        // Envia presença "recording" para o cliente ver "Gravando áudio..."
        evolutionApiService.sendPresence(targetInstanceName, cleanPhone, "recording", 2500).catch(() => {});

        // DISPARO DO BALÃO 1 EM ÁUDIO (PTT nativo de voz)
        console.log(`[AiAgentService] Disparando Balão 1 em ÁUDIO (PTT) para ${cleanPhone} via "${targetInstanceName}"...`);
        const audioSendResult = await evolutionApiService.sendWhatsAppAudio(
          targetInstanceName,
          cleanPhone,
          speechAudio.audioBase64,
          { ptt: true, delay: 1000 }
        );

        if (audioSendResult.success) {
          const spokenPreview = prepareTextForSpeech(replyText);
          const { message: audioMsg } = await chatStore.addMessage(
            realTenantId,
            conversationId,
            "BOT",
            `🎤 [Áudio]: "${spokenPreview}"`,
            false,
            speechAudio.audioBase64,
            "audio",
            targetInstanceName,
            true
          );

          realtimeHub.broadcastToStore(realTenantId, "chat_message", {
            conversationId,
            message: audioMsg
          });

          // Delay de 1200ms para ordenação visual no WhatsApp
          await new Promise(resolve => setTimeout(resolve, 1200));

          // DISPARO DO BALÃO 2 EM TEXTO: Opções resumidas, valores e link para compra rápida na loja virtual
          if (hasUrlToSplit && mainText && mainText.trim().length > 0) {
            console.log(`[AiAgentService] Disparando Balão 2 em TEXTO (Opções) para ${cleanPhone}...`);
            await evolutionApiService.sendTextMessage(
              targetInstanceName,
              cleanPhone,
              mainText,
              { delay: 1000, linkPreview: false }
            );

            const { message: textMsg } = await chatStore.addMessage(
              realTenantId,
              conversationId,
              "BOT",
              mainText,
              false,
              undefined,
              undefined,
              targetInstanceName,
              true
            );

            realtimeHub.broadcastToStore(realTenantId, "chat_message", {
              conversationId,
              message: textMsg
            });

            await new Promise(resolve => setTimeout(resolve, 1200));

            // Balão da URL pura com cache-buster (ativa Link Preview com logo oficial)
            const freshUrl = ensureStoreUrlCacheBuster(url);
            console.log(`[AiAgentService] Disparando Balão com Link da Loja para ${cleanPhone}: ${freshUrl}`);
            await evolutionApiService.sendTextMessage(
              targetInstanceName,
              cleanPhone,
              freshUrl,
              { delay: 1500, linkPreview: true }
            );

            const { message: urlMsg } = await chatStore.addMessage(
              realTenantId,
              conversationId,
              "BOT",
              freshUrl,
              false,
              undefined,
              undefined,
              targetInstanceName,
              true
            );

            realtimeHub.broadcastToStore(realTenantId, "chat_message", {
              conversationId,
              message: urlMsg
            });
          } else {
            const hasUrl = /(https?:\/\/[^\s]+)/i.test(finalReplyText);
            const payloadText = hasUrl ? ensureStoreUrlCacheBuster(finalReplyText) : finalReplyText;
            console.log(`[AiAgentService] Disparando Balão 2 em TEXTO para ${cleanPhone}...`);
            await evolutionApiService.sendTextMessage(
              targetInstanceName,
              cleanPhone,
              payloadText,
              { delay: 1200, linkPreview: hasUrl }
            );

            const { message: textMsg } = await chatStore.addMessage(
              realTenantId,
              conversationId,
              "BOT",
              payloadText,
              false,
              undefined,
              undefined,
              targetInstanceName,
              true
            );

            realtimeHub.broadcastToStore(realTenantId, "chat_message", {
              conversationId,
              message: textMsg
            });
          }

          // Atualiza estado e contador da conversa
          const audioUpdatePayload: any = {
            bot_interaction_count: nextCount,
            last_interaction_at: nowIso,
            last_message_at: nowIso,
            last_message_content: `🎤 [Áudio]: "${spokenPreview}"`,
            updated_at: nowIso,
            ...(params.isHandoff ? {
              is_bot_active: false,
              is_human_controlled: true,
              kanban_stage: "novos_triagem",
              bot_handoff_reason: params.handoffReason || "CUSTOMER_REQUEST"
            } : {
              is_bot_active: true,
              is_human_controlled: false,
              kanban_stage: "ia_atendendo"
            })
          };

          const sanitized = sanitizeChatConversationPayload(audioUpdatePayload);
          try {
            await supabaseAdmin
              .from("chat_conversations")
              .update(sanitized)
              .eq("id", conversationId);
          } catch (dbErr: any) {
            console.warn("[AiAgentService] Erro ao atualizar conversa:", dbErr.message);
          }
          await chatStore.updateConversationBotStatus(conversationId, audioUpdatePayload);

          console.log(`[AiAgentService] ✅ Resposta Áudio + Balão Texto entregue com sucesso para ${cleanPhone}`);
          return { success: true };
        } else {
          console.warn(`[AiAgentService] Falha no envio do áudio (${audioSendResult.error}). Fazendo fallback para texto...`);
        }
      }
    }

    if (hasUrlToSplit && mainText && mainText.trim().length > 0) {
      console.log(`[AiAgentService] 💬 Fluxo de 2 balões ativado para ${cleanPhone} (Handoff: ${params.isHandoff ? params.handoffReason : 'NÃO'})`);
      
      // DISPARO DO BALÃO 1: Texto Principal (sem o link)
      console.log(`[AiAgentService] Disparando Balão 1 (Texto Principal) para ${cleanPhone} via "${targetInstanceName}"...`);
      const sendResult1 = await evolutionApiService.sendTextMessage(
        targetInstanceName,
        cleanPhone,
        mainText,
        {
          delay: 1000,
          linkPreview: false
        }
      );

      if (!sendResult1.success) {
        console.error(`[AiAgentService] ❌ Falha no envio do Balão 1 para o WhatsApp do cliente (${cleanPhone}):`, sendResult1.error);
        return { success: false, error: sendResult1.error || "WHATSAPP_DELIVERY_FAILED" };
      }

      // Registra Balão 1 na tabela de mensagens e no chatStore
      const { message: msg1 } = await chatStore.addMessage(
        realTenantId,
        conversationId,
        "BOT",
        mainText,
        false,
        undefined,
        undefined,
        targetInstanceName,
        true
      );

      realtimeHub.broadcastToStore(realTenantId, "chat_message", {
        conversationId,
        message: msg1
      });

      // Delay de 1200ms para ordenação visual no WhatsApp
      await new Promise(resolve => setTimeout(resolve, 1200));

      // DISPARO DO BALÃO 2: EXCLUSIVAMENTE a URL pura com cache-buster (ativa o Link Preview perfeito com a logo oficial da drogaria)
      const freshUrl = ensureStoreUrlCacheBuster(url);
      console.log(`[AiAgentService] Disparando Balão 2 (URL Pura com Link Preview e Cache-Buster) para ${cleanPhone} via "${targetInstanceName}": ${freshUrl}`);
      const sendResult2 = await evolutionApiService.sendTextMessage(
        targetInstanceName,
        cleanPhone,
        freshUrl,
        {
          delay: 1500,
          linkPreview: true
        }
      );

      if (!sendResult2.success) {
        console.warn(`[AiAgentService] ⚠️ Aviso: Balão 2 (URL) falhou no WhatsApp, mas Balão 1 já foi entregue:`, sendResult2.error);
      } else {
        // Registra Balão 2 na tabela de mensagens e no chatStore
        const { message: msg2 } = await chatStore.addMessage(
          realTenantId,
          conversationId,
          "BOT",
          freshUrl,
          false,
          undefined,
          undefined,
          targetInstanceName,
          true
        );

        realtimeHub.broadcastToStore(realTenantId, "chat_message", {
          conversationId,
          message: msg2
        });
      }
    } else {
      // Disparo único (mensagem pura ou URL única)
      const hasUrl = /(https?:\/\/[^\s]+)/i.test(finalReplyText);
      const payloadText = hasUrl ? ensureStoreUrlCacheBuster(finalReplyText) : finalReplyText;
      console.log(`[AiAgentService] Disparando resposta única do BOT para ${cleanPhone} via instância "${targetInstanceName}" (Handoff: ${params.isHandoff ? params.handoffReason : 'NÃO'})...`);
      const sendResult = await evolutionApiService.sendTextMessage(
        targetInstanceName,
        cleanPhone,
        payloadText,
        {
          delay: 1200,
          linkPreview: hasUrl
        }
      );

      if (!sendResult.success) {
        console.error(`[AiAgentService] ❌ Falha no envio para o WhatsApp do cliente (${cleanPhone}):`, sendResult.error);
        return { success: false, error: sendResult.error || "WHATSAPP_DELIVERY_FAILED" };
      }

      // Registra a resposta única
      const { message: singleMsg } = await chatStore.addMessage(
        realTenantId,
        conversationId,
        "BOT",
        payloadText,
        false,
        undefined,
        undefined,
        targetInstanceName,
        true
      );

      realtimeHub.broadcastToStore(realTenantId, "chat_message", {
        conversationId,
        message: singleMsg
      });
    }

    console.log(`[AiAgentService] ✅ Mensagem(ns) entregue(s) com sucesso ao WhatsApp de ${cleanPhone}. Atualizando estado da conversa.`);

    // 4. Incremento do Contador de Interações e Atualização Atômica de Estado
    const lastContentRecorded = url || mainText || finalReplyText;
    if (params.isHandoff) {
      const handoffReason = params.handoffReason || "HUMAN_REQUESTED";
      const handoffPayload: any = {
        bot_interaction_count: nextCount,
        is_bot_active: false,
        is_human_controlled: true,
        kanban_stage: "em_atendimento",
        status: "human_takeover",
        bot_handoff_reason: handoffReason,
        bot_handoff_at: nowIso,
        last_message_at: nowIso,
        last_message_content: lastContentRecorded,
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
        handoffReason,
        params.transitionMsg
      );

      await chatStore.updateConversationBotStatus(conversationId, handoffPayload);

      realtimeHub.broadcastToStore(realTenantId, "conversation_bot_toggled", {
        conversationId,
        is_bot_active: false,
        is_human_controlled: true,
        status: "human_takeover",
        kanban_stage: "em_atendimento",
        bot_interaction_count: nextCount
      });

      realtimeHub.broadcastToStore(realTenantId, "conversation_status_changed", {
        conversationId,
        status: "human_takeover",
        is_bot_active: false,
        is_human_controlled: true,
        bot_interaction_count: nextCount,
        bot_handoff_reason: handoffReason,
        bot_handoff_at: nowIso,
        kanban_stage: "em_atendimento"
      });

      realtimeHub.broadcastToStore(realTenantId, "conversation_stage_changed", {
        conversationId,
        stage: "HUMAN",
        status: "human_takeover",
        is_bot_active: false,
        is_human_controlled: true,
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
        last_message_content: lastContentRecorded,
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
      replyWithAudio?: boolean;
    }
  ): Promise<{
    handled: boolean;
    replyText?: string;
    transferredToHuman: boolean;
    reason?: string;
  }> {
    try {
      // Normalização da mensagem recebida: se for transcrição de áudio, limpa o prefixo visual
      let cleanIncoming = (incomingMessage || "").trim();
      let shouldReplyWithAudio = Boolean(options?.replyWithAudio);
      if (cleanIncoming.startsWith("🎤") || cleanIncoming.toLowerCase().includes("[áudio]")) {
        shouldReplyWithAudio = true;
        cleanIncoming = cleanIncoming
          .replace(/^🎤\s*\[Áudio\]:?\s*"?/i, "")
          .replace(/"?\s*$/, "")
          .replace(/^\[Áudio\]:?\s*/i, "")
          .trim();
      }
      if (cleanIncoming.length > 0) {
        incomingMessage = cleanIncoming;
      }

      // 1. Obter tenant e validar se o módulo de IA está autorizado (resolvendo o UUID real)
      const tenant = await this.verifyTenantAuthorization(storeId);
      const realTenantId = tenant.id || storeId;
      const dbConfig: AiAgentConfig = tenant.ai_agent_config || tenant.aiagentconfig || {};

      if (dbConfig.active === false || dbConfig.enabled === false) {
        console.log(`[AiAgentService] IA desativada nas configurações da drogaria "${tenant.name}"`);
        return { handled: false, transferredToHuman: false, reason: "AGENT_PAUSED" };
      }

      // 1.1. Se a mensagem for um resumo de pedido da Webloja, não responder via IA e transferir para separação operacional
      const orderCheck = isWeblojaOrderMessage(incomingMessage);
      if (orderCheck.isOrder) {
        console.log(`[AiAgentService] 🛒 Mensagem é um resumo de pedido da Loja Online (Pedido: ${orderCheck.orderId || 'N/A'}). Bloqueando IA e transferindo para separação operacional.`);
        return { handled: true, transferredToHuman: true, reason: "WEBLOJA_ORDER_RECEIVED" };
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

      // 3. Montar link da Loja Online
      let storeLink = dbConfig.storeLink || tenant.welcome_message_link || tenant.welcomemessagelink;
      if (!storeLink) {
        storeLink = tenant.custom_domain ? `https://${tenant.custom_domain}` : `https://${tenant.slug || tenant.id}.farmaflow.online`;
      }
      storeLink = storeLink.replace(/\/+$/, '');

      const currentCount = conv?.bot_interaction_count || 0;
      const maxInteractions = Number(dbConfig.maxInteractionsPerSession) || 4;
      const rawTransitionMsg = dbConfig.transitionToHumanMessage || "";
      const transitionMsg = (rawTransitionMsg && !rawTransitionMsg.includes("Encaminhei sua dúvida"))
        ? rawTransitionMsg.replace(/\{store_url\}|\{STORE_URL\}|\{storeLink\}|\{STORE_LINK\}/g, storeLink)
        : buildHumanizedHandoffMessage(storeLink);

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
      let history = options?.chatHistory || [];
      if (!history || history.length === 0) {
        try {
          const rawMsgs = await chatStore.getMessages(conversationId);
          if (rawMsgs && rawMsgs.length > 0) {
            history = rawMsgs.slice(-15).map((m: any) => ({
              role: (m.sender_type === "CUSTOMER" || m.sender === "CUSTOMER" || m.senderType === "CUSTOMER") ? "user" : "assistant",
              content: m.content || ""
            }));
          }
        } catch (_) {}
      }

      const nextCount = currentCount + 1;
      const isFinalTurn = nextCount >= maxInteractions;

      // 8.1. Detecção Especial de Escolha de Produto / Intenção de Compra pelo Cliente
      const choiceCheck = detectCustomerChoiceIntent(incomingMessage, history);
      if (choiceCheck.isChoice) {
        console.log(`[AiAgentService] 🎯 Escolha do cliente detectada ("${incomingMessage}") na conversa ${conversationId}. Identificando produto selecionado para gerar link direto.`);
        const tenantIds = Array.from(
          new Set(
            [
              realTenantId,
              tenant.id,
              tenant.slug,
              tenant.network_id,
              tenant.networkid
            ].filter(Boolean)
          )
        );

        const resolvedChoice = await resolveCustomerChosenProduct(
          incomingMessage,
          history,
          tenantIds.length > 0 ? tenantIds : [realTenantId],
          storeLink
        );

        const humanizedReply = resolvedChoice
          ? buildProductHandoffMessage(resolvedChoice.productName, resolvedChoice.priceFormatted, resolvedChoice.directProductUrl)
          : buildHumanizedHandoffMessage(storeLink);

        const dispatchResult = await this.dispatchBotReplyAndRecord(
          realTenantId,
          conversationId,
          targetInstanceName,
          cleanPhone,
          humanizedReply,
          {
            isHandoff: true,
            handoffReason: "PURCHASE_INTENT",
            transitionMsg: humanizedReply,
            currentCount,
            nextCount,
            replyWithAudio: shouldReplyWithAudio,
            tenantAiConfig: dbConfig
          }
        );

        if (!dispatchResult.success) {
          return { handled: false, transferredToHuman: true, reason: dispatchResult.error };
        }

        return {
          handled: true,
          replyText: humanizedReply,
          transferredToHuman: true,
          reason: "PURCHASE_INTENT"
        };
      }

      // 9. Gerar resposta com a LLM
      const aiResult = await this.generateReply(
        realTenantId,
        incomingMessage,
        history,
        dbConfig
      );

      let finalReply = aiResult.reply;

      // 10. Se for a última interação da sessão ou se a IA transferiu para humano, realizar transbordo definitivo
      if (isFinalTurn || aiResult.transferredToHuman) {
        const resolvedReason = aiResult.handoffReason || (isFinalTurn ? "MAX_INTERACTIONS_REACHED" : "HUMAN_REQUESTED");

        if (isFinalTurn && !finalReply.includes("balconista") && !finalReply.includes("atendente humano")) {
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
            handoffReason: resolvedReason,
            transitionMsg,
            currentCount,
            nextCount,
            replyWithAudio: shouldReplyWithAudio,
            tenantAiConfig: dbConfig
          }
        );

        if (!dispatchResult.success) {
          return { handled: false, transferredToHuman: true, reason: dispatchResult.error };
        }

        return {
          handled: true,
          replyText: finalReply,
          transferredToHuman: true,
          reason: resolvedReason
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
          nextCount,
          replyWithAudio: shouldReplyWithAudio,
          tenantAiConfig: dbConfig
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

  /**
   * Busca inteligente de produtos no Supabase com suporte a:
   * - Decomposição em princípio ativo e dosagem (ex: "dipirona 500mg" -> "dipirona" + ["500mg", "500 mg", "500%mg%"])
   * - Filtro PRIORITÁRIO estrito pela dosagem especificada pelo cliente
   * - Só inclui outras dosagens (como 1g) se NÃO existir NENHUM produto com a dosagem solicitada em estoque
   * - Filtro estrito de estoque ativo (> 0)
   * - Ordenação pelo MENOR PREÇO (custo-benefício)
   * - Retorno de 4 a 6 opções
   */
  public async searchProductsInDb(
    tenantIds: string[],
    searchTerm: string,
    limit: number = 6
  ): Promise<any[]> {
    if (!searchTerm || !searchTerm.trim() || tenantIds.length === 0) {
      return [];
    }

    const { detectedDosage, isDrops, isSyrup, isTablets } =
      extractDosageAndPresentation(searchTerm);

    const normalized = searchTerm
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .trim();

    const STOP_SEARCH_WORDS = new Set([
      "de", "do", "da", "dos", "das", "em", "para", "com", "sem", "por", "favor",
      "tem", "têm", "ter", "qual", "quais", "preco", "precos", "valor", "valores",
      "quanto", "custa", "opcao", "opcoes", "remedio", "remedios", "medicamento",
      "medicamentos", "generico", "genericos", "similar", "similares", "caixa",
      "cartela", "comprimido", "comprimidos", "cpr", "comp", "cp", "un", "unidades",
      "gotas", "gota", "gotinha", "gotinhas", "liquida", "liquido", "solucao", "sol", "gts",
      "xarope", "xaropes", "xpe", "pilula", "pilulas", "cps", "capsula", "capsulas",
      "ola", "oi", "bom", "dia", "boa", "tarde", "noite", "voces", "vc", "vcs"
    ]);

    const tokens = normalized.split(/\s+/).filter(t => t.length >= 2);
    const mainTerms = tokens.filter(t => 
      !STOP_SEARCH_WORDS.has(t) && 
      t !== "1" && t !== "g" && t !== "mg" && t !== "ml" && 
      t !== "500" && t !== "1000" && t !== "750" && t !== "250" &&
      t !== "500mg" && t !== "1g" && t !== "1000mg" && t !== "750mg"
    );

    let formSqlFilter: string | null = null;
    if (isDrops) {
      formSqlFilter = "name.ilike.%gts%,name.ilike.%gota%,name.ilike.%sol oral%,name.ilike.%sol%,presentation.ilike.%gts%,presentation.ilike.%gota%,presentation.ilike.%sol%";
    } else if (isTablets) {
      formSqlFilter = "name.ilike.%cpr%,name.ilike.%comp%,name.ilike.%cps%,presentation.ilike.%comprimido%,presentation.ilike.%cpr%";
    } else if (isSyrup) {
      formSqlFilter = "name.ilike.%xpe%,name.ilike.%xarope%,presentation.ilike.%xarope%";
    }

    const buildTermOrClause = (term: string) => {
      if (term === "dipirona") {
        return "name.ilike.%dipirona%,active_principle.ilike.%dipirona%,name.ilike.%maxalgina%,name.ilike.%novalgina%";
      }
      return `name.ilike.%${term}%,active_principle.ilike.%${term}%`;
    };

    // =========================================================================
    // PRIORIDADE 1: SE O CLIENTE ESPECIFICOU DOSAGEM (ex: "500mg" ou "1g")
    // =========================================================================
    if (detectedDosage && mainTerms.length > 0) {
      let qExact = supabaseAdmin
        .from("products")
        .select("id, name, price, stock, presentation, category, active_principle, requires_prescription")
        .in("tenant_id", tenantIds)
        .gt("stock", 0)
        .order("price", { ascending: true });

      for (const term of mainTerms) {
        qExact = qExact.or(buildTermOrClause(term));
      }

      if (formSqlFilter) {
        qExact = qExact.or(formSqlFilter);
      }

      // Aplica filtro SQL de dosagem diretamente
      if (detectedDosage === "500mg" || detectedDosage === "0.5g" || detectedDosage === "0,5g") {
        qExact = qExact.ilike("name", "%500%mg%");
      } else if (detectedDosage === "1g" || detectedDosage === "1000mg") {
        qExact = qExact.or("name.ilike.%1%g%,name.ilike.%1000%mg%");
      } else if (detectedDosage === "750mg") {
        qExact = qExact.ilike("name", "%750%mg%");
      } else if (detectedDosage.endsWith("mg")) {
        const num = detectedDosage.replace("mg", "");
        qExact = qExact.ilike("name", `%${num}%mg%`);
      } else if (detectedDosage.endsWith("g")) {
        const num = detectedDosage.replace("g", "");
        qExact = qExact.ilike("name", `%${num}%g%`);
      }

      const { data: exactProducts } = await qExact.limit(limit * 3);
      const matchingDosage = (exactProducts || []).filter(p => productMatchesDosage(p, detectedDosage));

      if (matchingDosage.length > 0) {
        if (isDrops) {
          const dropsOnly = matchingDosage.filter(isProductDrops);
          if (dropsOnly.length > 0) {
            const seen = new Set<string>();
            const unique = dropsOnly.filter(p => {
              const lbl = formatMedicineLabel(p).toLowerCase();
              if (seen.has(lbl)) return false;
              seen.add(lbl);
              return true;
            });
            return unique.slice(0, limit);
          }
          // Se pediu gotas expressamente e não achou nesta dosagem, não retorne comprimidos! Continue para busca geral
        } else if (isTablets) {
          const tabletsOnly = matchingDosage.filter(isProductTablets);
          if (tabletsOnly.length > 0) {
            return tabletsOnly.slice(0, limit);
          }
        } else if (isSyrup) {
          const syrupOnly = matchingDosage.filter(isProductSyrup);
          if (syrupOnly.length > 0) {
            return syrupOnly.slice(0, limit);
          }
        } else {
          // Cliente não pediu gotas ou xarope: prioriza comprimidos/sólidos
          const nonDrops = matchingDosage.filter(p => !isProductDrops(p) && !isProductSyrup(p));
          return (nonDrops.length > 0 ? nonDrops : matchingDosage).slice(0, limit);
        }
      }
    }

    // =========================================================================
    // PRIORIDADE 2: BUSCA GERAL POR PRINCÍPIO ATIVO (SE NÃO ENCONTROU A DOSAGEM OU NÃO ESPECIFICOU)
    // =========================================================================
    if (mainTerms.length > 0) {
      let qGeneral = supabaseAdmin
        .from("products")
        .select("id, name, price, stock, presentation, category, active_principle, requires_prescription")
        .in("tenant_id", tenantIds)
        .gt("stock", 0)
        .order("price", { ascending: true });

      for (const term of mainTerms) {
        qGeneral = qGeneral.or(buildTermOrClause(term));
      }

      if (formSqlFilter) {
        qGeneral = qGeneral.or(formSqlFilter);
      }

      const { data: dGeneral } = await qGeneral.limit(limit * 4);
      let candidates = dGeneral || [];

      // Se aplicou formSqlFilter e veio vazio, tenta uma busca sem o filtro SQL para avaliar em memória
      if (candidates.length === 0 && formSqlFilter) {
        let qBroad = supabaseAdmin
          .from("products")
          .select("id, name, price, stock, presentation, category, active_principle, requires_prescription")
          .in("tenant_id", tenantIds)
          .gt("stock", 0)
          .order("price", { ascending: true });
        for (const term of mainTerms) {
          qBroad = qBroad.or(buildTermOrClause(term));
        }
        const { data: dBroad } = await qBroad.limit(limit * 4);
        candidates = dBroad || [];
      }

      // 1. Se o cliente pediu GOTAS
      if (isDrops) {
        const drops = candidates.filter(isProductDrops);
        if (drops.length > 0) {
          const seen = new Set<string>();
          const uniqueDrops = drops.filter(p => {
            const lbl = formatMedicineLabel(p).toLowerCase();
            if (seen.has(lbl)) return false;
            seen.add(lbl);
            return true;
          });
          return uniqueDrops.slice(0, limit);
        }
        // REGRA CRÍTICA: Se o cliente pediu gotas e não há gotas em estoque,
        // NUNCA retorne comprimidos! Retorne array vazio para a IA informar adequadamente
        return [];
      }

      // 2. Se o cliente pediu COMPRIMIDOS
      if (isTablets) {
        const tablets = candidates.filter(isProductTablets);
        if (tablets.length > 0) {
          const seen = new Set<string>();
          const uniqueTablets = tablets.filter(p => {
            const lbl = formatMedicineLabel(p).toLowerCase();
            if (seen.has(lbl)) return false;
            seen.add(lbl);
            return true;
          });
          return uniqueTablets.slice(0, limit);
        }
        return [];
      }

      // 3. Se o cliente pediu XAROPE
      if (isSyrup) {
        const syrups = candidates.filter(isProductSyrup);
        if (syrups.length > 0) {
          return syrups.slice(0, limit);
        }
        return [];
      }

      // 4. Se não especificou forma líquida ou gotas: prioriza comprimidos/sólidos
      const nonDrops = candidates.filter(p => !isProductDrops(p) && !isProductSyrup(p));
      const chosen = nonDrops.length > 0 ? nonDrops : candidates;
      const seen = new Set<string>();
      const unique = chosen.filter(p => {
        const lbl = formatMedicineLabel(p).toLowerCase();
        if (seen.has(lbl)) return false;
        seen.add(lbl);
        return true;
      });
      return unique.slice(0, limit);
    }

    // =========================================================================
    // PRIORIDADE 3: FALLBACK POR TOKENS LIVRES
    // =========================================================================
    const rawTokens = normalized.split(/\s+/).filter(t => t.length >= 3 && !STOP_SEARCH_WORDS.has(t));
    if (rawTokens.length > 0) {
      const tokenOr = rawTokens.slice(0, 3).map(t => buildTermOrClause(t)).join(",");
      let qFallback = supabaseAdmin
        .from("products")
        .select("id, name, price, stock, presentation, category, active_principle, requires_prescription")
        .in("tenant_id", tenantIds)
        .gt("stock", 0)
        .or(tokenOr)
        .order("price", { ascending: true });

      if (formSqlFilter) {
        qFallback = qFallback.or(formSqlFilter);
      }

      const { data: dFallback } = await qFallback.limit(limit * 3);
      const candidates = dFallback || [];

      if (isDrops) {
        const drops = candidates.filter(isProductDrops);
        return drops.slice(0, limit);
      }
      if (isTablets) {
        const tablets = candidates.filter(isProductTablets);
        return tablets.slice(0, limit);
      }
      if (isSyrup) {
        const syrups = candidates.filter(isProductSyrup);
        return syrups.slice(0, limit);
      }

      return candidates.slice(0, limit);
    }

    return [];
  }

  private async executeToolCall(
    name: string,
    args: any,
    tenant?: any,
    storeLink?: string,
    userMessage?: string
  ): Promise<any> {
    if (name === "consultar_dados_loja") {
      const tenantId = tenant?.id;
      let freshTenant = tenant || {};
      if (tenantId) {
        try {
          const { data: dbTenant } = await supabaseAdmin
            .from("tenants")
            .select("*")
            .eq("id", tenantId)
            .maybeSingle();
          if (dbTenant) {
            freshTenant = { ...freshTenant, ...dbTenant };
          }
        } catch (e: any) {
          console.warn("[consultar_dados_loja] Erro ao consultar tenant no Supabase:", e.message);
        }
      }

      const regData = freshTenant.smart_banners?._regulatoryData || {};
      const street = freshTenant.street || "";
      const number = freshTenant.address_number || freshTenant.numero || "";
      const comp = freshTenant.complement || freshTenant.complemento || "";
      const neighborhood = freshTenant.neighborhood || freshTenant.bairro || "";
      const city = freshTenant.city || freshTenant.cidade || "";
      const state = freshTenant.state || freshTenant.uf || "";
      const cep = freshTenant.cep || "";

      let endereco = freshTenant.full_address || freshTenant.fullAddress || "";
      if (!endereco && (street || city)) {
        const streetComp = `${street}${number ? ', ' + number : ''}${comp ? ' (' + comp + ')' : ''}`.trim();
        const cityState = `${city}${city && state ? ' - ' + state : (state || '')}`.trim();
        endereco = [streetComp, neighborhood, cityState, cep ? `CEP: ${cep}` : ''].filter(Boolean).join(" - ");
      }

      let officialLink = freshTenant.welcome_message_link;
      if (!officialLink) {
        if (freshTenant.custom_domain) {
          officialLink = `https://${freshTenant.custom_domain.replace(/^https?:\/\//, '')}`;
        } else if (freshTenant.slug) {
          const cleanSub = freshTenant.slug.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
          officialLink = `https://${cleanSub}.farmaflow.online`;
        } else {
          officialLink = `https://${freshTenant.slug || freshTenant.id || 'loja'}.farmaflow.online`;
        }
      }
      officialLink = ensureStoreUrlCacheBuster(officialLink);

      return {
        nome_oficial: freshTenant.name || freshTenant.nome_loja || "Nossa Drogaria",
        razao_social: freshTenant.razao_social || regData.razao_social || freshTenant.name || "",
        cnpj: freshTenant.cnpj || regData.cnpj || "Cadastrado no sistema",
        link_loja_online: officialLink || storeLink || "https://farmaflow.online",
        horarios_atendimento: freshTenant.horario_funcionamento || regData.horario_funcionamento || "Segunda a Sábado das 07:00h às 22:00h",
        politica_entrega: "Tele-entrega rápida (delivery) no mesmo dia. Não realizamos retirada física na loja.",
        endereco: endereco || "Consulte em nossa loja online",
        whatsapp: freshTenant.whatsapp || freshTenant.telefone_contato || regData.telefone_contato || "",
        telefone_contato: freshTenant.telefone_contato || regData.telefone_contato || freshTenant.whatsapp || "",
        farmaceutico_responsavel: freshTenant.farmaceutico_responsavel || regData.farmaceutico_responsavel || "Consulte em loja",
        crf: freshTenant.crf || regData.crf || "Consulte em loja"
      };
    }

    if (name === "buscar_produtos") {
      let termo = String(args?.termo || args?.query || "").trim();
      if (!termo) {
        return { total: 0, produtos: [], mensagem: "Nenhum termo informado para busca." };
      }

      // Se o usuário especificou dosagem ou forma na mensagem (ex: 500mg, gotas, comprimidos, xarope) e o termo da IA omitiu, adiciona
      if (userMessage) {
        const userDosage = extractDosageAndPresentation(userMessage);
        const termDosage = extractDosageAndPresentation(termo);
        if (userDosage.detectedDosage && !termDosage.detectedDosage) {
          termo = `${termo} ${userDosage.detectedDosage}`;
        }
        if (userDosage.isDrops && !termDosage.isDrops) {
          termo = `${termo} gotas`;
        } else if (userDosage.isTablets && !termDosage.isTablets) {
          termo = `${termo} comprimidos`;
        } else if (userDosage.isSyrup && !termDosage.isSyrup) {
          termo = `${termo} xarope`;
        }
      }

      const tenantIds = Array.from(
        new Set(
          [
            tenant?.id,
            tenant?.slug,
            tenant?.network_id,
            tenant?.networkid
          ].filter(Boolean)
        )
      );

      try {
        const prods = await this.searchProductsInDb(
          tenantIds.length > 0 ? tenantIds : [tenant?.id || ''],
          termo,
          4
        );

        const effectiveStoreLink = storeLink || (tenant?.custom_domain ? `https://${tenant.custom_domain}` : `https://${tenant?.slug || tenant?.id || 'loja'}.farmaflow.online`);

        const items = (prods || []).map((p: any) => ({
          id: p.id,
          nome: p.name,
          nome_formatado: formatMedicineLabel(p),
          apresentacao: p.presentation || "",
          preco: Number(p.price) || 0,
          preco_formatado: `R$ ${(Number(p.price) || 0).toFixed(2)}`,
          estoque: Number(p.stock) || 0,
          disponivel: (Number(p.stock) || 0) > 0,
          principio_ativo: p.active_principle || "",
          exige_receita: Boolean(p.requires_prescription),
          link_produto: `${effectiveStoreLink}?produto=${p.id}`
        }));

        return {
          total: items.length,
          termo_buscado: termo,
          produtos: items,
          link_loja_geral: effectiveStoreLink,
          regras_obrigatorias_atendimento: [
            "1. 'DIPIRONA MONO' (Monoidratada) e 'DIPIRONA SODICA' são rigorosamente o mesmo medicamento (Dipirona).",
            "2. Maxalgina, Dipimed, Novalgina e Nevraldor são nomes comerciais de Dipirona. Frascos de 10ml e 20ml com 'GTS' ou 'SOL' SÃO gotas! NUNCA diga que são '(solução, mas não em gotas)'.",
            "3. Se o cliente pediu gotas e houver produtos com GTS ou SOL (10ml, 20ml) na lista, ELE ESTÁ DISPONÍVEL! Diga imediatamente que temos em gotas e NUNCA ofereça comprimidos.",
            "4. CONCISÃO E DIRETO AO PONTO: Responda de forma CURTA e humanizada no WhatsApp (apresente no MÁXIMO 2 a 3 opções numeradas com 1️⃣, 2️⃣, 3️⃣, destacando a primeira com ⭐ Mais econômica e faça uma pergunta objetiva no final)."
          ]
        };
      } catch (e: any) {
        console.warn("[buscar_produtos] Erro ao consultar produtos:", e.message);
        return {
          total: 0,
          termo_buscado: termo,
          produtos: [],
          mensagem: "Erro ao consultar estoque no momento."
        };
      }
    }

    return { error: `Ferramenta não encontrada: ${name}` };
  }

  private async callGemini(
    apiKey: string,
    modelName: string,
    systemInstruction: string,
    incomingMessage: string,
    chatHistory: AiChatMessage[],
    storeLink: string,
    tenant?: any
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

      const tools: any[] = [];
      if (tenant) {
        tools.push({
          functionDeclarations: [
            {
              name: "consultar_dados_loja",
              description: "Retorna o nome oficial, link da loja online, horários de atendimento/delivery, endereço e WhatsApp da drogaria atual.",
              parameters: {
                type: Type.OBJECT,
                properties: {}
              }
            },
            {
              name: "buscar_produtos",
              description: "Consulta estoque, dosagens e preços em tempo real no banco de dados da drogaria.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  termo: {
                    type: Type.STRING,
                    description: "Nome do produto, medicamento ou princípio ativo a ser consultado."
                  }
                },
                required: ["termo"]
              }
            }
          ]
        });
      }

      const geminiConfig: any = {
        systemInstruction,
        temperature: 0.4,
        maxOutputTokens: 1000
      };
      if (tools.length > 0) {
        geminiConfig.tools = tools;
      }

      let response = await ai.models.generateContent({
        model: targetModel,
        contents,
        config: geminiConfig
      });

      // Loop de execução autônoma de ferramentas
      let rounds = 0;
      while (response.functionCalls && response.functionCalls.length > 0 && rounds < 3) {
        rounds++;
        const functionCalls = response.functionCalls;
        const candidateContent = response.candidates?.[0]?.content;
        if (candidateContent) {
          contents.push(candidateContent);
        } else {
          contents.push({
            role: 'model',
            parts: functionCalls.map(c => ({ functionCall: c }))
          });
        }

        const responseParts: any[] = [];
        for (const call of functionCalls) {
          const toolResult = await this.executeToolCall(call.name, call.args, tenant, storeLink, incomingMessage);
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: { result: toolResult }
            }
          });
        }

        contents.push({
          role: 'user',
          parts: responseParts
        });

        response = await ai.models.generateContent({
          model: targetModel,
          contents,
          config: geminiConfig
        });
      }

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
    storeLink: string,
    tenant?: any
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

      const openAiTools = tenant ? [
        {
          "type": "function",
          "function": {
            "name": "consultar_dados_loja",
            "description": "Retorna o nome oficial, link da loja online, horários de atendimento/delivery, endereço e WhatsApp da drogaria atual.",
            "parameters": { "type": "object", "properties": {} }
          }
        },
        {
          "type": "function",
          "function": {
            "name": "buscar_produtos",
            "description": "Consulta estoque, dosagens e preços em tempo real no banco de dados da drogaria.",
            "parameters": {
              "type": "object",
              "properties": {
                "termo": {
                  "type": "string",
                  "description": "Nome do produto, medicamento ou princípio ativo a ser consultado."
                }
              },
              "required": ["termo"]
            }
          }
        }
      ] : undefined;

      const requestBody: any = {
        model: targetModel,
        messages,
        temperature: 0.4,
        max_tokens: 1000
      };
      if (openAiTools) {
        requestBody.tools = openAiTools;
      }

      let res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
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

      let data = await res.json();
      let assistantMsg = data.choices?.[0]?.message;

      // Loop de execução autônoma de ferramentas OpenAI
      let rounds = 0;
      while (assistantMsg?.tool_calls && assistantMsg.tool_calls.length > 0 && rounds < 3) {
        rounds++;
        messages.push(assistantMsg);

        for (const toolCall of assistantMsg.tool_calls) {
          let callArgs: any = {};
          try {
            callArgs = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
          } catch (_) {}

          const toolResult = await this.executeToolCall(toolCall.function?.name, callArgs, tenant, storeLink, incomingMessage);

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }

        requestBody.messages = messages;

        res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!res.ok) break;

        data = await res.json();
        assistantMsg = data.choices?.[0]?.message;
      }

      const rawReply = assistantMsg?.content || "Desculpe, não foi possível obter resposta.";
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
