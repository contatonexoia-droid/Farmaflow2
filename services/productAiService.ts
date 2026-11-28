import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { OFFICIAL_DEPARTMENTS, classifyProductTaxonomy } from "../lib/departments.js";
import {
  ALL_ENRICHABLE_FIELDS,
  EnrichableFieldKey,
  isEnrichableFieldEmpty,
  isMedicationProduct,
} from "../utils/productCompleteness.js";

const DEFAULT_ENRICH_MODEL = "gemini-2.5-flash";
const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
const MAX_BATCH_SIZE = 5;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let cachedSupabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  if (!url || !key) return null;
  cachedSupabaseAdmin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedSupabaseAdmin;
}

export type AiConfidenceLevel = "high" | "medium" | "low";

export interface ProductAiEnrichInput {
  id?: string;
  name: string;
  barcode?: string;
  manufacturer?: string;
  category?: string;
  department?: string;
  presentation?: string;
  activePrinciple?: string;
  drugType?: string;
  requires_prescription?: boolean;
}

export interface ProductAiEnrichResult {
  description: string;
  suggestedCode: string;
  activePrinciple: string;
  drugType: string;
  department: string;
  category: string;
  manufacturer: string;
  presentation: string;
  indications: string;
  usage: string;
  sideEffects: string;
  contraindications: string;
  requiresPrescription: boolean;
  confidence: AiConfidenceLevel;
  confidenceReason: string;
  anvisaMatched?: boolean;
  cacheReused?: boolean;
}

export interface ProductAiBatchInput {
  id?: string;
  name: string;
  missingFields?: string[];
  barcode?: string;
  manufacturer?: string;
  category?: string;
  department?: string;
  presentation?: string;
  activePrinciple?: string;
  drugType?: string;
  description?: string;
  indications?: string;
  usage?: string;
  requires_prescription?: boolean;
  isAiEnriched?: boolean;
}

export interface CatalogBatchEnrichOptions {
  tenantId?: string;
  targetFields?: EnrichableFieldKey[];
  overwriteExisting?: boolean;
  persist?: boolean;
}

export interface CatalogBatchItemOutcome {
  id: string;
  name: string;
  barcode?: string;
  status: "updated" | "reused_cache" | "skipped_low_confidence" | "error";
  confidence: AiConfidenceLevel;
  confidenceReason: string;
  anvisaMatched: boolean;
  updatedFields: string[];
  patch: Record<string, any>;
  error?: string;
}

export interface AnvisaMatchInfo {
  found: boolean;
  activePrinciple?: string;
  presentation?: string;
  therapeuticClass?: string;
  manufacturer?: string;
  drugType?: string;
  productName?: string;
}

interface EanLookupResult {
  cleanEan: string;
  anvisa: AnvisaMatchInfo;
  cachedPeer: Record<string, any> | null;
}

function createProductAiError(message: string, statusCode: number): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function getServerGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw createProductAiError(
      "Chave GEMINI_API_KEY não configurada no servidor. Configure a variável de ambiente no painel do servidor.",
      503
    );
  }

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 2,
  delay = 1000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const status = error?.status || error?.code;
    const message = error?.message || (typeof error === "object" ? JSON.stringify(error) : String(error));

    if (status === 429 || message.includes("429") || message.includes("RESOURCE_EXHAUSTED")) {
      if (message.includes("limit: 0") || message.toLowerCase().includes("quota")) {
        throw createProductAiError(
          "A cota da IA para enriquecimento de produtos foi atingida temporariamente. Tente novamente em alguns instantes.",
          429
        );
      }
      if (retries > 0) {
        await wait(delay);
        return retryWithBackoff(fn, retries - 1, delay * factor, factor);
      }
      throw createProductAiError(
        "Muitas solicitações simultâneas à IA. Aguarde alguns segundos e tente novamente.",
        429
      );
    }

    if (status === 403 || message.includes("403") || message.includes("PERMISSION_DENIED") || message.includes("API_KEY_SERVICE_BLOCKED")) {
      throw createProductAiError(
        "A chave de API do servidor não possui permissão para utilizar este modelo de IA.",
        403
      );
    }

    if (status === 401 || message.includes("401") || message.includes("API_KEY_INVALID") || message.includes("API key not valid")) {
      throw createProductAiError(
        "A chave GEMINI_API_KEY configurada no servidor é inválida.",
        502
      );
    }

    if (retries > 0) {
      await wait(delay);
      return retryWithBackoff(fn, retries - 1, delay * factor, factor);
    }
    throw error;
  }
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  return cleaned;
}

function sanitizeTextHint(val: unknown, maxLen = 240): string {
  if (typeof val !== "string") return "";
  return val.replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLen);
}

function mapGeminiException(err: any, fallbackMessage: string): Error & { statusCode: number } {
  if (err?.statusCode) return err;
  const msg = String(err?.message || "");
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.toLowerCase().includes("quota")) {
    return createProductAiError(
      "A cota da IA foi atingida temporariamente. Tente novamente em alguns instantes.",
      429
    );
  }
  if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
    return createProductAiError(
      "A chave de API do servidor não tem permissão para usar este modelo de IA.",
      403
    );
  }
  if (msg.includes("401") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid")) {
    return createProductAiError(
      "A chave GEMINI_API_KEY configurada no servidor é inválida.",
      502
    );
  }
  return createProductAiError(fallbackMessage, 500);
}

function normalizeEanDigits(barcode?: string | null): string {
  const digits = String(barcode || "").replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 14) return digits;
  return "";
}

function normalizeCompareText(str?: string | null): string {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Camada 2: Verifica se `matched_product_name` retornado pela IA corresponde realmente ao nome original enviado.
 */
function isMatchedProductNameValid(originalName: string, matchedName?: string | null): boolean {
  const origNorm = normalizeCompareText(originalName);
  const matchNorm = normalizeCompareText(matchedName);
  if (!origNorm || !matchNorm) return false;
  if (origNorm === matchNorm) return true;
  if (origNorm.includes(matchNorm) || matchNorm.includes(origNorm)) {
    const minLen = Math.min(origNorm.length, matchNorm.length);
    const maxLen = Math.max(origNorm.length, matchNorm.length);
    if (minLen / maxLen >= 0.65) return true;
  }
  const origTokens = new Set(origNorm.split(" ").filter((t) => t.length >= 2));
  const matchTokens = new Set(matchNorm.split(" ").filter((t) => t.length >= 2));
  if (origTokens.size === 0 || matchTokens.size === 0) return origNorm === matchNorm;
  let intersection = 0;
  origTokens.forEach((t) => {
    if (matchTokens.has(t)) intersection++;
  });
  const recall = intersection / origTokens.size;
  const precision = intersection / matchTokens.size;
  return recall >= 0.75 && precision >= 0.65;
}

/**
 * Camada 3: Detecta nomes excessivamente genéricos/ambíguos onde chutar é proibido.
 */
function isAmbiguousOrGenericSkuName(name: string, cleanEan: string, anvisaMatched: boolean): string | null {
  if (anvisaMatched) return null;
  const norm = normalizeCompareText(name);
  if (!norm || norm.length < 3) {
    return "Nome do produto curto ou vazio para identificação segura.";
  }
  const genericPatterns = [
    /^item\s*(diversos?|generico|avulso|promocao|promo)?$/,
    /^produto\s*(diversos?|generico|avulso|promocao|promo|teste|padrao|sem nome)?$/,
    /^(diversos|variados|mercadoria|promocao|oferta|brinde|sacola|taxa|servico)$/,
    /^(cod|codigo|sku|ref)\s*\d+$/,
    /^\d+$/,
  ];
  if (genericPatterns.some((rx) => rx.test(norm)) && !cleanEan) {
    return "Nome genérico ou código interno sem descrição identificável.";
  }
  if (genericPatterns.some((rx) => rx.test(norm))) {
    return "Nome genérico/ambíguo sem referência suficiente para enriquecimento automático seguro.";
  }
  return null;
}

/**
 * Camada 4: Extrai quantidades numéricas com unidade do nome e verifica coerência com a apresentação gerada.
 */
interface UnitQuantityToken {
  group: "dose" | "volume" | "pack";
  value: number;
  unit: string;
}

function extractQuantityTokens(text: string): UnitQuantityToken[] {
  const clean = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/,/g, ".");
  const results: UnitQuantityToken[] = [];
  const regex = /\b(\d+(?:\.\d+)?)\s*(mg|mcg|ug|ui|ml|l|lt|litro|litros|g|gr|kg|cap|caps|capsula|capsulas|cpr|comp|comprimido|comprimidos|drg|dragea|drageas|amp|ampola|ampolas|env|envelope|envelopes|sache|saches|flaconete|flaconetes|un|unid|unidade|unidades)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(clean)) !== null) {
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(value) || value <= 0) continue;
    let group: "dose" | "volume" | "pack" = "pack";
    if (["mg", "mcg", "ug", "ui"].includes(unit)) {
      group = "dose";
    } else if (["ml", "l", "lt", "litro", "litros"].includes(unit)) {
      group = "volume";
    } else if (["g", "gr", "kg"].includes(unit)) {
      // Gramas podem ser dosagem (1g) ou peso/volume de cosmético (200g)
      group = value <= 5 && unit === "g" ? "dose" : "volume";
    }
    results.push({ group, value, unit });
  }
  return results;
}

function validatePresentationCoherence(
  productName: string,
  generatedPresentation: string
): { valid: boolean; reason?: string } {
  const pres = String(generatedPresentation || "").trim();
  if (!pres) return { valid: true };
  const nameTokens = extractQuantityTokens(productName);
  if (nameTokens.length === 0) return { valid: true };
  const presTokens = extractQuantityTokens(pres);
  if (presTokens.length === 0) return { valid: true };

  // Verifica por grupo ('dose', 'volume', 'pack'): se a apresentação informou número do mesmo grupo,
  // pelo menos um valor precisa bater (convertendo L<->ml e g<->mg se aplicável)
  const toBaseValue = (t: UnitQuantityToken): number => {
    if (t.unit === "g" && t.group === "dose") return t.value * 1000; // 1g = 1000mg
    if (t.unit === "kg") return t.value * 1000; // kg -> g
    if (["l", "lt", "litro", "litros"].includes(t.unit)) return t.value * 1000; // L -> ml
    return t.value;
  };

  for (const group of ["dose", "volume", "pack"] as const) {
    const nGroup = nameTokens.filter((t) => t.group === group);
    const pGroup = presTokens.filter((t) => t.group === group);
    if (nGroup.length > 0 && pGroup.length > 0) {
      const hasMatch = nGroup.some((nt) =>
        pGroup.some((pt) => Math.abs(toBaseValue(nt) - toBaseValue(pt)) < 0.01)
      );
      if (!hasMatch) {
        return {
          valid: false,
          reason: `Apresentação gerada ("${pres}") diverge da medida explícita no nome do produto ("${productName}").`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Camada 4: Padroniza Princípio Ativo (DCB em PT-BR, sem dosagens ou marcas misturadas)
 * para maximizar acertos do motor de indicações e "Mesma Fórmula".
 */
const LOWERCASE_CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e", "em", "com"]);
function toCleanDcbTitleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      if (idx > 0 && LOWERCASE_CONNECTORS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function standardizeActivePrinciple(
  rawValue: string | undefined | null,
  isMed: boolean,
  productName: string
): string {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (
    ["n/a", "na", "nenhum", "não se aplica", "nao se aplica", "outros", "cosmetico", "cosmético", "higiene", "-"].includes(
      lower
    )
  ) {
    return "";
  }

  // Para Não-Medicamentos (Cosméticos, Higiene, Perfumaria, Correlatos):
  // não inventa princípio ativo medicamentoso; mantém apenas se ativo cosmético/nutricional explícito constar no nome
  if (!isMed) {
    const normName = normalizeCompareText(productName);
    const firstPart = normalizeCompareText(trimmed.split(/[+,/]/)[0]);
    if (!firstPart || firstPart.length < 3 || !normName.includes(firstPart)) {
      return "";
    }
  }

  // Remove dosagens e embalagens eventualmente misturadas (ex: "500mg", "200 mg/ml", "30 cpr")
  const parts = trimmed
    .split(/\s*(?:\+|\/|;|\be\b)\s*/i)
    .map((part) =>
      part
        .replace(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|ml|ui|%|cpr|comp|caps|capsulas)\b/gi, "")
        .replace(/[()[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((p) => p.length >= 2)
    .map(toCleanDcbTitleCase);

  const uniqueParts: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = normalizeCompareText(part);
    if (key && !seen.has(key)) {
      seen.add(key);
      uniqueParts.push(part);
    }
  }
  return uniqueParts.join(" + ");
}

function ensureMedicationSafetyGuidance(
  usage: string,
  isMed: boolean,
  requiresPrescription: boolean
): string {
  const clean = String(usage || "").trim();
  if (!clean) return "";
  if (!isMed) return clean;
  const lower = clean.toLowerCase();
  if (
    lower.includes("médic") ||
    lower.includes("medic") ||
    lower.includes("farmacêutic") ||
    lower.includes("farmaceutic") ||
    lower.includes("bula") ||
    lower.includes("prescrição") ||
    lower.includes("prescricao")
  ) {
    return clean;
  }
  const suffix = requiresPrescription
    ? " Uso sob prescrição e acompanhamento médico ou orientação do farmacêutico."
    : " Siga sempre as orientações da bula, prescrição médica ou do farmacêutico.";
  return `${clean.replace(/\.$/, "")}.${suffix}`;
}

function detectControlledKeywords(text: string): boolean {
  const norm = normalizeCompareText(text);
  return (
    norm.includes("tarja preta") ||
    norm.includes("tarja vermelha") ||
    norm.includes("controle especial") ||
    norm.includes("receita retida") ||
    norm.includes("retencao de receita") ||
    norm.includes("psicotropico") ||
    norm.includes("antimicrobiano") ||
    norm.includes("antibiotico") ||
    /\b(amoxicilina|azitromicina|cefalexina|ciprofloxacino|levofloxacino|clonazepam|rivotril|alprazolam|frontal|diazepam|bromazepam|zolpidem|stilnox|escitalopram|sertralina|fluoxetina|venlafaxina|desvenlafaxina|pregabalina|ritalina|metilfenidato|venvance|lisdexanfetamina|sibutramina|isotretinoina|roacutan)\b/.test(
      norm
    )
  );
}

/**
 * Camada 1: Cruzamento prévio por EAN em `anvisa_medicamentos` (se existir) e em `products` já validados.
 */
export async function lookupEanReferenceBatch(
  barcodes: string[],
  excludeTenantId?: string
): Promise<Map<string, EanLookupResult>> {
  const resultMap = new Map<string, EanLookupResult>();
  const cleanEans = Array.from(
    new Set(barcodes.map((b) => normalizeEanDigits(b)).filter(Boolean))
  );
  if (cleanEans.length === 0) return resultMap;

  for (const ean of cleanEans) {
    resultMap.set(ean, {
      cleanEan: ean,
      anvisa: { found: false },
      cachedPeer: null,
    });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return resultMap;

  // 1a. Lookup em `anvisa_medicamentos` (resiliente caso a tabela não exista ou tenha nomes de coluna variados)
  try {
    const { data: anvisaRows, error } = await supabaseAdmin
      .from("anvisa_medicamentos")
      .select("*")
      .or(
        cleanEans
          .flatMap((ean) => [`ean_1.eq.${ean}`, `ean_2.eq.${ean}`, `ean_3.eq.${ean}`])
          .join(",")
      )
      .limit(50);

    let matchedRows: any[] = [];
    if (!error && Array.isArray(anvisaRows)) {
      matchedRows = anvisaRows;
    } else if (error) {
      // Fallback para schema alternativo (`ean` ou `barcode`)
      const { data: altRows } = await supabaseAdmin
        .from("anvisa_medicamentos")
        .select("*")
        .in("ean", cleanEans)
        .limit(50);
      if (Array.isArray(altRows)) matchedRows = altRows;
    }

    for (const row of matchedRows) {
      const candidateEans = [
        row.ean_1,
        row.ean_2,
        row.ean_3,
        row.ean,
        row.barcode,
      ]
        .map((v) => normalizeEanDigits(v))
        .filter(Boolean);

      for (const ean of candidateEans) {
        const entry = resultMap.get(ean);
        if (entry && !entry.anvisa.found) {
          entry.anvisa = {
            found: true,
            activePrinciple: sanitizeTextHint(
              row.principio_ativo || row.substancia || row.active_principle || "",
              160
            ),
            presentation: sanitizeTextHint(row.apresentacao || row.presentation || "", 180),
            therapeuticClass: sanitizeTextHint(
              row.classe_terapeutica || row.therapeutic_class || "",
              140
            ),
            manufacturer: sanitizeTextHint(
              row.laboratorio || row.detentor_registro || row.manufacturer || "",
              120
            ),
            drugType: sanitizeTextHint(row.tipo_produto || row.tarja || row.drug_type || "", 60),
            productName: sanitizeTextHint(row.produto || row.nome_comercial || row.name || "", 180),
          };
        }
      }
    }
  } catch (_) {
    // Tabela anvisa_medicamentos opcional; segue normalmente sem interromper
  }

  // 1b. Lookup em produtos já enriquecidos e validados por EAN na base de dados (reuso 0 tokens)
  try {
    const { data: peerRows } = await supabaseAdmin
      .from("products")
      .select(
        "id, tenant_id, name, barcode, active_principle, drug_type, manufacturer, presentation, category, description, indications, usage, requires_prescription, is_ai_enriched"
      )
      .in("barcode", cleanEans)
      .eq("is_ai_enriched", true)
      .limit(100);

    if (Array.isArray(peerRows)) {
      for (const peer of peerRows) {
        const ean = normalizeEanDigits(peer.barcode);
        if (!ean) continue;
        const entry = resultMap.get(ean);
        if (!entry) continue;

        // Prioriza peer mais completo (especialmente com description + indications + usage + presentation)
        const completenessScore = (row: any) =>
          (row.description && String(row.description).trim().length >= 10 ? 2 : 0) +
          (row.presentation && String(row.presentation).trim().length >= 2 ? 1 : 0) +
          (row.indications && String(row.indications).trim().length >= 5 ? 1 : 0) +
          (row.usage && String(row.usage).trim().length >= 5 ? 1 : 0) +
          (row.active_principle && String(row.active_principle).trim().length >= 2 ? 1 : 0) +
          (excludeTenantId && row.tenant_id !== excludeTenantId ? 0.5 : 0);

        if (
          completenessScore(peer) >= 4 &&
          (!entry.cachedPeer || completenessScore(peer) > completenessScore(entry.cachedPeer))
        ) {
          entry.cachedPeer = peer;
        }
      }
    }
  } catch (err: any) {
    console.warn("[ProductAiService] Aviso ao consultar cache de EAN em products:", err?.message || err);
  }

  return resultMap;
}

/**
 * Enriquecimento individual (botão de IA no modal Editar Produto) — 100% Backend com Camadas 1–5.
 */
export async function enrichProductWithAi(input: ProductAiEnrichInput): Promise<ProductAiEnrichResult> {
  const cleanName = sanitizeTextHint(input.name, 240);
  if (!cleanName || cleanName.length < 2) {
    throw createProductAiError("Informe o nome do produto para gerar os dados com IA.", 400);
  }

  const cleanBarcode = normalizeEanDigits(input.barcode) || sanitizeTextHint(input.barcode, 40);
  const cleanManufacturer = sanitizeTextHint(input.manufacturer, 120);
  const cleanCategory = sanitizeTextHint(input.category, 120);
  const cleanPresentation = sanitizeTextHint(input.presentation, 140);
  const cleanActivePrinciple = sanitizeTextHint(input.activePrinciple, 140);

  // Camada 1: Cruzamento EAN (ANVISA / Cache Validado)
  let eanRef: EanLookupResult | undefined;
  if (cleanBarcode) {
    const lookupMap = await lookupEanReferenceBatch([cleanBarcode]);
    eanRef = lookupMap.get(normalizeEanDigits(cleanBarcode));
  }
  const anvisaMatched = Boolean(eanRef?.anvisa?.found);

  // Camada 3: Bloqueio preventivo se o nome for totalmente genérico/ambíguo sem referência ANVISA
  const ambiguousReason = isAmbiguousOrGenericSkuName(cleanName, normalizeEanDigits(cleanBarcode), anvisaMatched);
  if (ambiguousReason) {
    return {
      description: "",
      suggestedCode: "",
      activePrinciple: cleanActivePrinciple,
      drugType: input.drugType || "Outros",
      department: classifyProductTaxonomy({ name: cleanName, rawCategory: cleanCategory }).department,
      category: classifyProductTaxonomy({ name: cleanName, rawCategory: cleanCategory }).subcategory,
      manufacturer: cleanManufacturer,
      presentation: cleanPresentation,
      indications: "",
      usage: "",
      sideEffects: "",
      contraindications: "",
      requiresPrescription: Boolean(input.requires_prescription),
      confidence: "low",
      confidenceReason: ambiguousReason,
      anvisaMatched: false,
      cacheReused: false,
    };
  }

  const hints: string[] = [`Nome do Produto: "${cleanName}"`];
  if (cleanBarcode) hints.push(`Código de Barras (EAN): "${cleanBarcode}"`);
  if (cleanManufacturer) hints.push(`Fabricante informado: "${cleanManufacturer}"`);
  if (cleanCategory) hints.push(`Categoria atual: "${cleanCategory}"`);
  if (cleanPresentation) hints.push(`Apresentação informada: "${cleanPresentation}"`);
  if (cleanActivePrinciple) hints.push(`Princípio ativo informado: "${cleanActivePrinciple}"`);
  if (eanRef?.anvisa?.found) {
    hints.push(`DADOS OFICIAIS ANVISA (Prioridade Máxima): ${JSON.stringify(eanRef.anvisa)}`);
  }

  const ai = getServerGeminiClient();

  try {
    const response = await retryWithBackoff<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: DEFAULT_ENRICH_MODEL,
        contents: `Você é um Farmacêutico Especialista em Catálogo Farmacêutico e Conversão de E-commerce (FarmaFlow).
Analise o produto abaixo com rigor técnico máximo em PT-BR:
${hints.join("\n")}

REGRAS CRÍTICAS ANTI-ERRO E QUALIDADE:
1. PROIBIDO CHUTAR OU ADIVINHAR: Se o nome estiver excessivamente truncado ou ambíguo e não permitir identificar exatamente o produto, retorne confidence="low", explique em confidence_reason e deixe campos incertos vazios.
2. confidence: Avalie honestamente como "high" (identificação exata e segura), "medium" (produto identificável nos textos descritivos, porém sem certeza absoluta do ativo) ou "low" (ambíguo/irreconhecível).
3. Separação Medicamento vs Não-Medicamento:
   - Se for Medicamento (Referência, Genérico, Similar, Fitoterápico): activePrinciple DEVE ser padronizado em DCB em português (ex: "Dipirona Monoidratada + Orfenadrina + Cafeína"), SEM dosagem e SEM marca comercial.
   - Se NÃO for Medicamento (Cosmético, Higiene, Perfumaria, Correlato, Conveniência): retorne activePrinciple="" (vazio), a menos que um ativo cosmético esteja explícito no nome.
4. Coerência numérica: presentation DEVE respeitar exatamente dosagens, volumes e quantidades presentes no nome (ex: "200MG", "14 CAP", "250ML").
5. description: Escreva 2 a 4 frases claras, persuasivas e naturais para ajudar o cliente a comprar na loja online, sem promessas milagrosas proibidas pela ANVISA.
6. indications e usage (Modo de Uso): Para medicamentos, seja fiel à bula geral (via de administração e orientação básica), incluindo sempre orientação para seguir prescrição médica/farmacêutica; nunca invente posologias específicas arriscadas.
7. drugType: EXATAMENTE um de ['Referência', 'Genérico', 'Similar', 'Fitoterápico', 'Cosmético', 'Higiene', 'Suplemento', 'Correlato', 'Outros'].
8. department e category: Enquadre em um dos 7 Departamentos Oficiais e sua Subcategoria Oficial correspondente:
   - Medicamentos: ['Dor e Febre', 'Gripe e Resfriado', 'Alergias', 'Saúde Digestiva', 'Saúde Respiratória', 'Diabetes', 'Pressão e Coração', 'Saúde da Mulher', 'Saúde do Homem', 'Outros Medicamentos']
   - Saúde e Bem-Estar: ['Vitaminas e Minerais', 'Suplementos', 'Imunidade', 'Saúde Digestiva', 'Energia e Disposição', 'Sono e Relaxamento', 'Controle de Peso', 'Esporte e Performance', 'Saúde da Mulher', 'Saúde do Homem']
   - Dermocosméticos e Beleza: ['Cuidados com o Rosto', 'Cuidados com o Corpo', 'Proteção Solar', 'Cabelos', 'Maquiagem', 'Perfumes', 'Cuidados com as Unhas', 'Beleza Masculina']
   - Higiene e Cuidados Pessoais: ['Higiene Bucal', 'Banho e Corpo', 'Desodorantes', 'Higiene Íntima', 'Cuidados Masculinos', 'Absorventes e Cuidados Femininos', 'Lenços e Algodão']
   - Mamãe e Bebê: ['Fraldas', 'Higiene do Bebê', 'Alimentação Infantil', 'Amamentação', 'Cuidados com a Mamãe']
   - Saúde, Ortopedia e Primeiros Socorros: ['Primeiros Socorros', 'Aparelhos de Saúde', 'Ortopédicos', 'Cuidados para Idosos', 'Outros Acessórios de Saúde']
   - Conveniência: ['Alimentos e Bebidas', 'Snacks', 'Produtos para o Dia a Dia', 'Acessórios', 'Utilidades']
Retorne apenas JSON válido.`,
        config: {
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
              confidence_reason: { type: Type.STRING },
              is_medication: { type: Type.BOOLEAN },
              description: { type: Type.STRING },
              suggestedCode: { type: Type.STRING },
              activePrinciple: { type: Type.STRING },
              drugType: {
                type: Type.STRING,
                enum: [
                  "Referência",
                  "Genérico",
                  "Similar",
                  "Fitoterápico",
                  "Cosmético",
                  "Higiene",
                  "Suplemento",
                  "Correlato",
                  "Outros",
                ],
              },
              department: { type: Type.STRING, enum: [...OFFICIAL_DEPARTMENTS] },
              category: { type: Type.STRING },
              manufacturer: { type: Type.STRING },
              presentation: { type: Type.STRING },
              indications: { type: Type.STRING },
              usage: { type: Type.STRING },
              sideEffects: { type: Type.STRING },
              contraindications: { type: Type.STRING },
              requiresPrescription: { type: Type.BOOLEAN },
            },
            required: [
              "confidence",
              "confidence_reason",
              "is_medication",
              "description",
              "department",
              "category",
              "drugType",
              "indications",
              "usage",
            ],
          },
        },
      })
    );

    if (!response.text) {
      throw createProductAiError("A IA retornou uma resposta vazia. Tente novamente.", 502);
    }

    const jsonStr = cleanJsonResponse(response.text);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      const fixes = ['"}', "}", '"]}', "]}"];
      for (const fix of fixes) {
        try {
          parsed = JSON.parse(jsonStr + fix);
          break;
        } catch (_) {}
      }
      if (!parsed) throw parseError;
    }

    const rawConfidence: AiConfidenceLevel =
      parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high"
        ? parsed.confidence
        : "medium";
    const confidenceReason = String(parsed.confidence_reason || "").trim() || "Identificação validada pela IA.";

    if (rawConfidence === "low") {
      throw createProductAiError(
        `Confiança baixa para gerar automaticamente: ${confidenceReason}`,
        422
      );
    }

    const classified = classifyProductTaxonomy({
      name: cleanName,
      activePrinciple: parsed.activePrinciple || cleanActivePrinciple,
      description: parsed.description,
      rawCategory: parsed.category || cleanCategory,
      drugType: parsed.drugType,
      indications: parsed.indications,
      manufacturer: parsed.manufacturer || cleanManufacturer,
    });

    const isMed =
      Boolean(parsed.is_medication) ||
      isMedicationProduct({
        name: cleanName,
        department: classified.department,
        drugType: parsed.drugType,
        requires_prescription: Boolean(input.requires_prescription || parsed.requiresPrescription),
      });

    // Camada 4: Coerência de apresentação e princípio ativo
    let validatedPresentation =
      typeof parsed.presentation === "string" && parsed.presentation.trim()
        ? parsed.presentation.trim()
        : cleanPresentation;
    const presCheck = validatePresentationCoherence(cleanName, validatedPresentation);
    if (!presCheck.valid) {
      validatedPresentation = cleanPresentation;
    }

    const rawActiveSource =
      rawConfidence === "high"
        ? parsed.activePrinciple || eanRef?.anvisa?.activePrinciple || cleanActivePrinciple
        : eanRef?.anvisa?.activePrinciple || cleanActivePrinciple;
    const standardizedActive = standardizeActivePrinciple(rawActiveSource, isMed, cleanName);

    const requiresPrescription =
      Boolean(input.requires_prescription) ||
      (isMed &&
        rawConfidence === "high" &&
        (Boolean(parsed.requiresPrescription) ||
          detectControlledKeywords(
            `${cleanName} ${eanRef?.anvisa?.drugType || ""} ${parsed.drugType || ""} ${parsed.contraindications || ""}`
          )));

    const safeUsage = ensureMedicationSafetyGuidance(
      typeof parsed.usage === "string" ? parsed.usage.trim() : "",
      isMed,
      requiresPrescription
    );

    return {
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
      suggestedCode: typeof parsed.suggestedCode === "string" ? parsed.suggestedCode.trim() : "",
      activePrinciple: standardizedActive || cleanActivePrinciple,
      drugType: typeof parsed.drugType === "string" && parsed.drugType.trim() ? parsed.drugType.trim() : "Outros",
      department: classified.department,
      category: classified.subcategory,
      manufacturer:
        typeof parsed.manufacturer === "string" && parsed.manufacturer.trim()
          ? parsed.manufacturer.trim()
          : cleanManufacturer,
      presentation: validatedPresentation,
      indications: typeof parsed.indications === "string" ? parsed.indications.trim() : "",
      usage: safeUsage,
      sideEffects: typeof parsed.sideEffects === "string" ? parsed.sideEffects.trim() : "",
      contraindications: typeof parsed.contraindications === "string" ? parsed.contraindications.trim() : "",
      requiresPrescription,
      confidence: rawConfidence,
      confidenceReason,
      anvisaMatched,
      cacheReused: false,
    };
  } catch (err: any) {
    console.error("[ProductAiService enrichProductWithAi Error]:", err?.message || err);
    throw mapGeminiException(err, "Não foi possível gerar os detalhes do produto com a IA no momento.");
  }
}

/**
 * Monta patch respeitando `targetFields` e `overwriteExisting` para salvar no Supabase sem sobrescrever dados válidos.
 */
function buildValidatedPatch(
  origProduct: Record<string, any>,
  candidateFields: Record<string, any>,
  targetFields: EnrichableFieldKey[],
  overwriteExisting: boolean,
  confidence: AiConfidenceLevel,
  anvisaMatched: boolean
): { patch: Record<string, any>; dbUpdate: Record<string, any>; updatedFieldNames: string[] } {
  const patch: Record<string, any> = {};
  const dbUpdate: Record<string, any> = {};
  const updatedFieldNames: string[] = [];

  const canFill = (field: EnrichableFieldKey, currentVal: any, incomingVal: any): boolean => {
    if (!targetFields.includes(field)) return false;
    const incomingStr = String(incomingVal ?? "").trim();
    if (!incomingStr) return false;
    if (overwriteExisting) return true;
    return isEnrichableFieldEmpty({ [field]: currentVal }, field);
  };

  if (canFill("description", origProduct.description, candidateFields.description)) {
    const v = String(candidateFields.description).trim();
    patch.description = v;
    dbUpdate.description = v;
    updatedFieldNames.push("description");
  }

  // Em confiança "medium", nunca chuta Princípio Ativo (só preenche se ANVISA confirmou ou veio de cache validado)
  const allowActivePrinciple = confidence === "high" || anvisaMatched || Boolean(candidateFields.cacheReused);
  if (
    allowActivePrinciple &&
    canFill(
      "activePrinciple",
      origProduct.active_principle ?? origProduct.activePrinciple,
      candidateFields.activePrinciple
    )
  ) {
    const v = String(candidateFields.activePrinciple).trim();
    patch.activePrinciple = v;
    dbUpdate.active_principle = v;
    updatedFieldNames.push("activePrinciple");
  }

  if (canFill("presentation", origProduct.presentation, candidateFields.presentation)) {
    const v = String(candidateFields.presentation).trim();
    patch.presentation = v;
    dbUpdate.presentation = v;
    updatedFieldNames.push("presentation");
  }

  if (canFill("indications", origProduct.indications, candidateFields.indications)) {
    const v = String(candidateFields.indications).trim();
    patch.indications = v;
    dbUpdate.indications = v;
    updatedFieldNames.push("indications");
  }

  if (canFill("usage", origProduct.usage, candidateFields.usage)) {
    const v = String(candidateFields.usage).trim();
    patch.usage = v;
    dbUpdate.usage = v;
    updatedFieldNames.push("usage");
  }

  // Tipo legal (preenche se vazio ou se overwriteExisting=true e veio válido)
  const origDrugType = String(origProduct.drug_type ?? origProduct.drugType ?? "").trim();
  const candDrugType = String(candidateFields.drugType || "").trim();
  if (candDrugType && (overwriteExisting || !origDrugType || origDrugType.toLowerCase() === "outros")) {
    patch.drugType = candDrugType;
    dbUpdate.drug_type = candDrugType;
    updatedFieldNames.push("drugType");
  }

  // Categoria & Fabricante (apenas quando vazios ou genéricos, preservando dados manuais)
  const origCat = String(origProduct.category || "").trim();
  const candCat = String(candidateFields.category || "").trim();
  if (
    candCat &&
    (overwriteExisting || !origCat || ["geral", "outros", "outros medicamentos"].includes(origCat.toLowerCase()))
  ) {
    patch.category = candCat;
    dbUpdate.category = candCat;
    updatedFieldNames.push("category");
  }

  const origMfg = String(origProduct.manufacturer || "").trim();
  const candMfg = String(candidateFields.manufacturer || "").trim();
  if (candMfg && (overwriteExisting || !origMfg || origMfg.toLowerCase() === "outros")) {
    patch.manufacturer = candMfg;
    dbUpdate.manufacturer = candMfg;
    updatedFieldNames.push("manufacturer");
  }

  // requires_prescription: NUNCA sobrescreve `true` já definido manualmente para `false`
  const alreadyRequiresPrescription = Boolean(origProduct.requires_prescription);
  if (!alreadyRequiresPrescription && candidateFields.requiresPrescription === true && confidence === "high") {
    patch.requires_prescription = true;
    dbUpdate.requires_prescription = true;
    updatedFieldNames.push("requires_prescription");
  }

  if (updatedFieldNames.length > 0 || !origProduct.is_ai_enriched) {
    patch.isAiEnriched = true;
    dbUpdate.is_ai_enriched = true;
  }

  return { patch, dbUpdate, updatedFieldNames };
}

/**
 * Processa um mini-lote de até 5 produtos com todas as 5 Camadas Anti-Erro.
 * Se `options.persist === true` e `options.tenantId` informado, persiste imediatamente no Supabase.
 */
async function processMiniBatchInternal(
  miniBatch: ProductAiBatchInput[],
  options: CatalogBatchEnrichOptions = {}
): Promise<{ items: Record<string, any>[]; outcomes: CatalogBatchItemOutcome[] }> {
  const targetFields: EnrichableFieldKey[] =
    Array.isArray(options.targetFields) && options.targetFields.length > 0
      ? (options.targetFields.filter((f): f is EnrichableFieldKey =>
          ALL_ENRICHABLE_FIELDS.includes(f as EnrichableFieldKey)
        ))
      : [...ALL_ENRICHABLE_FIELDS];
  const overwriteExisting = Boolean(options.overwriteExisting);
  const shouldPersist = Boolean(options.persist && options.tenantId);
  const tenantId = options.tenantId ? String(options.tenantId).trim() : "";

  const normalizedInputs = miniBatch.slice(0, MAX_BATCH_SIZE).map((item, idx) => {
    const id = sanitizeTextHint(item?.id || `idx_${idx}`, 120);
    return {
      ...item,
      id,
      name: sanitizeTextHint(item?.name, 220),
      barcode: sanitizeTextHint(item?.barcode, 40),
      manufacturer: sanitizeTextHint(item?.manufacturer, 120),
      category: sanitizeTextHint(item?.category, 120),
      department: sanitizeTextHint(item?.department, 120),
      presentation: sanitizeTextHint(item?.presentation, 140),
      activePrinciple: sanitizeTextHint(item?.activePrinciple, 140),
      drugType: sanitizeTextHint(item?.drugType, 60),
    };
  });

  // Busca dados autoritativos no banco quando persistindo (Camada 4: preservação estrita)
  const supabaseAdmin = getSupabaseAdmin();
  const dbRowsById = new Map<string, any>();
  if (shouldPersist && supabaseAdmin && tenantId) {
    const realIds = normalizedInputs.map((i) => i.id).filter((id) => !id.startsWith("idx_"));
    if (realIds.length > 0) {
      const { data: rows } = await supabaseAdmin
        .from("products")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("id", realIds);
      if (Array.isArray(rows)) {
        rows.forEach((r) => dbRowsById.set(String(r.id), r));
      }
    }
  }

  // Camada 1: Cruzamento EAN em anvisa_medicamentos + cache validado na rede
  const eanLookupMap = await lookupEanReferenceBatch(
    normalizedInputs.map((p) => p.barcode || ""),
    tenantId || undefined
  );

  const outcomeById = new Map<string, CatalogBatchItemOutcome>();
  const legacyItemById = new Map<string, Record<string, any>>();
  const pendingForAi: Array<{
    input: (typeof normalizedInputs)[number];
    authRow: Record<string, any>;
    eanInfo?: EanLookupResult;
  }> = [];

  for (const inp of normalizedInputs) {
    const authRow = dbRowsById.get(inp.id) || inp;
    const cleanEan = normalizeEanDigits(inp.barcode || authRow.barcode);
    const eanInfo = cleanEan ? eanLookupMap.get(cleanEan) : undefined;
    const anvisaMatched = Boolean(eanInfo?.anvisa?.found);

    // Verifica Reuso 0 tokens por EAN já validado no banco
    if (eanInfo?.cachedPeer) {
      const peer = eanInfo.cachedPeer;
      const isMed = isMedicationProduct({
        name: inp.name,
        department: inp.department,
        category: authRow.category,
        drugType: peer.drug_type || authRow.drug_type,
        requires_prescription: Boolean(authRow.requires_prescription || peer.requires_prescription),
      });

      const presCoherence = validatePresentationCoherence(inp.name, peer.presentation || "");
      const candidateFields = {
        description: String(peer.description || "").trim(),
        activePrinciple: standardizeActivePrinciple(peer.active_principle, isMed, inp.name),
        presentation: presCoherence.valid ? String(peer.presentation || "").trim() : "",
        indications: String(peer.indications || "").trim(),
        usage: ensureMedicationSafetyGuidance(
          String(peer.usage || "").trim(),
          isMed,
          Boolean(authRow.requires_prescription || peer.requires_prescription)
        ),
        drugType: String(peer.drug_type || "").trim(),
        category: String(peer.category || "").trim(),
        manufacturer: String(peer.manufacturer || "").trim(),
        requiresPrescription: Boolean(peer.requires_prescription),
        cacheReused: true,
      };

      const classified = classifyProductTaxonomy({
        name: inp.name,
        activePrinciple: candidateFields.activePrinciple,
        description: candidateFields.description,
        rawCategory: candidateFields.category || authRow.category,
        drugType: candidateFields.drugType,
        indications: candidateFields.indications,
        manufacturer: candidateFields.manufacturer || authRow.manufacturer,
      });
      candidateFields.category = classified.subcategory;

      const { patch, dbUpdate, updatedFieldNames } = buildValidatedPatch(
        authRow,
        candidateFields,
        targetFields,
        overwriteExisting,
        "high",
        anvisaMatched
      );

      // Só reaproveita cache 0 tokens se ele realmente supre todos os campos alvo faltantes!
      const stillMissingAfterPeer = targetFields.filter((f) => {
        if (f === "activePrinciple" && !isMed) return false;
        const resultingVal = patch[f] ?? authRow[f === "activePrinciple" ? "active_principle" : f];
        return isEnrichableFieldEmpty({ [f]: resultingVal }, f);
      });

      if (stillMissingAfterPeer.length === 0) {
        if (shouldPersist && supabaseAdmin && Object.keys(dbUpdate).length > 0 && !inp.id.startsWith("idx_")) {
          const { error: upErr } = await supabaseAdmin
            .from("products")
            .update(dbUpdate)
            .eq("id", inp.id)
            .eq("tenant_id", tenantId);
          if (upErr) {
            outcomeById.set(inp.id, {
              id: inp.id,
              name: inp.name,
              barcode: cleanEan || inp.barcode,
              status: "error",
              confidence: "high",
              confidenceReason: "Falha ao gravar atualização reaproveitada por EAN.",
              anvisaMatched,
              updatedFields: [],
              patch: {},
              error: upErr.message,
            });
            legacyItemById.set(inp.id, {});
            continue;
          }
        }

        outcomeById.set(inp.id, {
          id: inp.id,
          name: inp.name,
          barcode: cleanEan || inp.barcode,
          status: "reused_cache",
          confidence: "high",
          confidenceReason: "Reaproveitado de produto validado com o mesmo EAN (0 tokens gastos).",
          anvisaMatched,
          updatedFields: updatedFieldNames,
          patch,
        });
        legacyItemById.set(inp.id, {
          ...patch,
          department: classified.department,
          category: patch.category || classified.subcategory,
          confidence: "high",
          confidenceReason: "Reaproveitado por EAN validado",
        });
        continue;
      }
    }

    // Camada 3: Bloqueia nomes genéricos/ambíguos antes de chamar a IA
    const ambiguousReason = isAmbiguousOrGenericSkuName(inp.name, cleanEan, anvisaMatched);
    if (ambiguousReason) {
      outcomeById.set(inp.id, {
        id: inp.id,
        name: inp.name,
        barcode: cleanEan || inp.barcode,
        status: "skipped_low_confidence",
        confidence: "low",
        confidenceReason: ambiguousReason,
        anvisaMatched,
        updatedFields: [],
        patch: {},
      });
      legacyItemById.set(inp.id, {});
      continue;
    }

    pendingForAi.push({ input: inp, authRow, eanInfo });
  }

  // Chama Gemini apenas para os itens restantes (máx 5 por requisição)
  if (pendingForAi.length > 0) {
    const aiPayload = pendingForAi.map(({ input, authRow, eanInfo }) => ({
      id: input.id,
      barcode: normalizeEanDigits(input.barcode || authRow.barcode) || input.barcode || "",
      name: input.name,
      manufacturer: input.manufacturer || authRow.manufacturer || "",
      department: input.department || "",
      category: input.category || authRow.category || "",
      drugType: input.drugType || authRow.drug_type || "",
      presentation: input.presentation || authRow.presentation || "",
      activePrinciple: input.activePrinciple || authRow.active_principle || "",
      ...(eanInfo?.anvisa?.found ? { anvisa_official_data: eanInfo.anvisa } : {}),
    }));

    const ai = getServerGeminiClient();

    const response = await retryWithBackoff<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: DEFAULT_ENRICH_MODEL,
        contents: `Você é um Farmacêutico Sênior Especialista em Catálogo Farmacêutico e Conversão de Vendas Online (FarmaFlow).
Processe rigorosamente os ${aiPayload.length} itens abaixo e retorne um array JSON com exatamente os mesmos IDs recebidos:
${JSON.stringify(aiPayload)}

REGRAS OBRIGATÓRIAS DAS 5 CAMADAS DE SEGURANÇA:
1. IDENTIFICAÇÃO ESTRITA POR ID E NOME:
   - Cada objeto retornado DEVE conter exatamente o campo "id" recebido e "matched_product_name" ecoando exatamente o campo "name" original correspondente. Nunca troque ou misture itens.
2. REGRA "MELHOR VAZIO DO QUE ERRADO" (PROIBIDO CHUTAR):
   - Avalie a certeza da identificação como "high", "medium" ou "low" em "confidence" e justifique em "confidence_reason".
   - Se o nome for genérico/truncado (ex: "ITEM DIVERSOS", código interno sem marca/ativo) ou houver ambiguidade real entre SKUs diferentes, retorne confidence="low" e deixe os campos descritivos vazios.
3. USO DE FONTE ANVISA:
   - Quando "anvisa_official_data" estiver presente, utilize-o como referência oficial obrigatória para princípio ativo, apresentação e tipo.
4. SEPARAÇÃO MEDICAMENTO vs NÃO-MEDICAMENTO:
   - is_medication=true para medicamentos (Referência, Genérico, Similar, Fitoterápico): activePrinciple DEVE seguir DCB oficial em PT-BR sem marca e sem dosagem (ex: "Progesterona", "Dipirona Monoidratada + Orfenadrina + Cafeína").
   - is_medication=false para Cosméticos, Higiene, Perfumaria, Mamãe e Bebê, Correlatos e Conveniência: retorne activePrinciple="" (vazio) se não houver ativo cosmético explícito no nome, focando em apresentação, descrição comercial vendedora, indicações e modo de uso.
5. COERÊNCIA DE DOSAGEM/VOLUME NA APRESENTAÇÃO:
   - Se o nome traz dosagem, peso, volume ou quantidade (ex: "200MG", "14 CAP", "250 ML"), "presentation" NÃO pode contradizer esses valores.
6. DESCRIÇÃO COMERCIAL, INDICAÇÕES, MODO DE USO E SEGURANÇA SANITÁRIA:
   - description: 2 a 4 frases objetivas, claras e persuasivas em português do Brasil para conversão na loja online, sem promessas milagrosas.
   - indications: para que serve / benefícios principais.
   - usage: Modo de Uso claro e responsável. Em medicamentos, mantenha orientação geral fiel à bula e inclua sempre recomendação de seguir prescrição médica ou orientação do farmacêutico (nunca invente posologias arriscadas).
   - requiresPrescription: true apenas para tarjados/controlados/antimicrobianos sob receita.
7. TAXONOMIA OFICIAL:
   - drugType: EXATAMENTE um de ['Referência', 'Genérico', 'Similar', 'Fitoterápico', 'Cosmético', 'Higiene', 'Suplemento', 'Correlato', 'Outros'].
   - department e category: use EXCLUSIVAMENTE os 7 Departamentos Oficiais e suas Subcategorias Oficiais:
     * Medicamentos: ['Dor e Febre', 'Gripe e Resfriado', 'Alergias', 'Saúde Digestiva', 'Saúde Respiratória', 'Diabetes', 'Pressão e Coração', 'Saúde da Mulher', 'Saúde do Homem', 'Outros Medicamentos']
     * Saúde e Bem-Estar: ['Vitaminas e Minerais', 'Suplementos', 'Imunidade', 'Saúde Digestiva', 'Energia e Disposição', 'Sono e Relaxamento', 'Controle de Peso', 'Esporte e Performance', 'Saúde da Mulher', 'Saúde do Homem']
     * Dermocosméticos e Beleza: ['Cuidados com o Rosto', 'Cuidados com o Corpo', 'Proteção Solar', 'Cabelos', 'Maquiagem', 'Perfumes', 'Cuidados com as Unhas', 'Beleza Masculina']
     * Higiene e Cuidados Pessoais: ['Higiene Bucal', 'Banho e Corpo', 'Desodorantes', 'Higiene Íntima', 'Cuidados Masculinos', 'Absorventes e Cuidados Femininos', 'Lenços e Algodão']
     * Mamãe e Bebê: ['Fraldas', 'Higiene do Bebê', 'Alimentação Infantil', 'Amamentação', 'Cuidados com a Mamãe']
     * Saúde, Ortopedia e Primeiros Socorros: ['Primeiros Socorros', 'Aparelhos de Saúde', 'Ortopédicos', 'Cuidados para Idosos', 'Outros Acessórios de Saúde']
     * Conveniência: ['Alimentos e Bebidas', 'Snacks', 'Produtos para o Dia a Dia', 'Acessórios', 'Utilidades']`,
        config: {
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                matched_product_name: { type: Type.STRING },
                confidence: { type: Type.STRING, enum: ["high", "medium", "low"] },
                confidence_reason: { type: Type.STRING },
                is_medication: { type: Type.BOOLEAN },
                description: { type: Type.STRING },
                activePrinciple: { type: Type.STRING },
                drugType: {
                  type: Type.STRING,
                  enum: [
                    "Referência",
                    "Genérico",
                    "Similar",
                    "Fitoterápico",
                    "Cosmético",
                    "Higiene",
                    "Suplemento",
                    "Correlato",
                    "Outros",
                  ],
                },
                department: { type: Type.STRING, enum: [...OFFICIAL_DEPARTMENTS] },
                category: { type: Type.STRING },
                manufacturer: { type: Type.STRING },
                presentation: { type: Type.STRING },
                indications: { type: Type.STRING },
                usage: { type: Type.STRING },
                requiresPrescription: { type: Type.BOOLEAN },
              },
              required: [
                "id",
                "matched_product_name",
                "confidence",
                "confidence_reason",
                "is_medication",
              ],
            },
          },
        },
      })
    );

    if (!response.text) {
      throw createProductAiError("A IA retornou uma resposta vazia.", 502);
    }

    const jsonStr = cleanJsonResponse(response.text);
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseError) {
      const fixes = ['"]}', "]}", "]", '"}', "}", '"]', '"} ]', '"}]'];
      for (const fix of fixes) {
        try {
          const repaired = JSON.parse(jsonStr + fix);
          if (Array.isArray(repaired)) {
            parsed = repaired;
            break;
          }
        } catch (_) {}
      }
      if (!parsed || parsed.length === 0) {
        try {
          const lastBraceIndex = jsonStr.lastIndexOf("}");
          if (lastBraceIndex > 0) {
            const repaired = JSON.parse(jsonStr.substring(0, lastBraceIndex + 1) + "]");
            if (Array.isArray(repaired)) parsed = repaired;
          }
        } catch (_) {}
      }
      if (!parsed || parsed.length === 0) throw parseError;
    }

    // Camada 2: Indexa resposta ESTRITAMENTE por `id` (nunca por posição do array!)
    const aiById = new Map<string, any>();
    for (const row of parsed) {
      if (row && row.id !== undefined && row.id !== null) {
        aiById.set(String(row.id).trim(), row);
      }
    }

    for (const { input, authRow, eanInfo } of pendingForAi) {
      const anvisaMatched = Boolean(eanInfo?.anvisa?.found);
      const cleanEan = normalizeEanDigits(input.barcode || authRow.barcode);
      const aiItem = aiById.get(input.id);

      if (!aiItem) {
        outcomeById.set(input.id, {
          id: input.id,
          name: input.name,
          barcode: cleanEan || input.barcode,
          status: "skipped_low_confidence",
          confidence: "low",
          confidenceReason: "ID do produto não retornado pela IA (bloqueado para evitar troca entre SKUs).",
          anvisaMatched,
          updatedFields: [],
          patch: {},
        });
        legacyItemById.set(input.id, {});
        continue;
      }

      if (!isMatchedProductNameValid(input.name, aiItem.matched_product_name)) {
        outcomeById.set(input.id, {
          id: input.id,
          name: input.name,
          barcode: cleanEan || input.barcode,
          status: "skipped_low_confidence",
          confidence: "low",
          confidenceReason: `Nome ecoado divergiu do SKU original ("${aiItem.matched_product_name || ""}"). Bloqueado por segurança.`,
          anvisaMatched,
          updatedFields: [],
          patch: {},
        });
        legacyItemById.set(input.id, {});
        continue;
      }

      let confidence: AiConfidenceLevel =
        aiItem.confidence === "high" || aiItem.confidence === "medium" || aiItem.confidence === "low"
          ? aiItem.confidence
          : "low";
      let confidenceReason =
        String(aiItem.confidence_reason || "").trim() || "Avaliação de confiança não informada.";

      // Camada 3: Itens "low" são estritamente bloqueados de gravação
      if (confidence === "low") {
        outcomeById.set(input.id, {
          id: input.id,
          name: input.name,
          barcode: cleanEan || input.barcode,
          status: "skipped_low_confidence",
          confidence: "low",
          confidenceReason,
          anvisaMatched,
          updatedFields: [],
          patch: {},
        });
        legacyItemById.set(input.id, {});
        continue;
      }

      const classified = classifyProductTaxonomy({
        name: input.name || "",
        activePrinciple: aiItem.activePrinciple || eanInfo?.anvisa?.activePrinciple,
        description: aiItem.description,
        rawCategory: aiItem.category || authRow.category,
        drugType: aiItem.drugType,
        indications: aiItem.indications,
        manufacturer: aiItem.manufacturer || authRow.manufacturer,
      });

      const isMed =
        Boolean(aiItem.is_medication) ||
        isMedicationProduct({
          name: input.name,
          department: classified.department,
          drugType: aiItem.drugType,
          requires_prescription: Boolean(authRow.requires_prescription || aiItem.requiresPrescription),
        });

      // Camada 4a: Coerência numérica da apresentação
      let validatedPresentation = String(aiItem.presentation || "").trim();
      const presCheck = validatePresentationCoherence(input.name, validatedPresentation);
      if (!presCheck.valid) {
        // Contradição numérica grave (ex: 200MG -> 100mg): limpa apresentação e marca aviso
        validatedPresentation = "";
        confidenceReason = `${confidenceReason} | ${presCheck.reason}`;
      }

      // Camada 4b: Princípio Ativo padronizado apenas em high / ANVISA, e nunca inventado para cosméticos
      const rawActiveSource =
        confidence === "high"
          ? aiItem.activePrinciple || eanInfo?.anvisa?.activePrinciple
          : eanInfo?.anvisa?.activePrinciple || "";
      const standardizedActive = standardizeActivePrinciple(rawActiveSource, isMed, input.name);

      const requiresPrescription =
        Boolean(authRow.requires_prescription) ||
        (isMed &&
          confidence === "high" &&
          (Boolean(aiItem.requiresPrescription) ||
            detectControlledKeywords(`${input.name} ${eanInfo?.anvisa?.drugType || ""} ${aiItem.drugType || ""}`)));

      const safeUsage = ensureMedicationSafetyGuidance(
        String(aiItem.usage || "").trim(),
        isMed,
        requiresPrescription
      );

      const candidateFields = {
        description: String(aiItem.description || "").trim(),
        activePrinciple: standardizedActive,
        presentation: validatedPresentation,
        indications: String(aiItem.indications || "").trim(),
        usage: safeUsage,
        drugType: String(aiItem.drugType || "").trim(),
        category: classified.subcategory,
        manufacturer: String(aiItem.manufacturer || eanInfo?.anvisa?.manufacturer || "").trim(),
        requiresPrescription,
        cacheReused: false,
      };

      const { patch, dbUpdate, updatedFieldNames } = buildValidatedPatch(
        authRow,
        candidateFields,
        targetFields,
        overwriteExisting,
        confidence,
        anvisaMatched
      );

      if (shouldPersist && supabaseAdmin && Object.keys(dbUpdate).length > 0 && !input.id.startsWith("idx_")) {
        const { error: upErr } = await supabaseAdmin
          .from("products")
          .update(dbUpdate)
          .eq("id", input.id)
          .eq("tenant_id", tenantId);

        if (upErr) {
          outcomeById.set(input.id, {
            id: input.id,
            name: input.name,
            barcode: cleanEan || input.barcode,
            status: "error",
            confidence,
            confidenceReason,
            anvisaMatched,
            updatedFields: [],
            patch: {},
            error: upErr.message,
          });
          legacyItemById.set(input.id, {});
          continue;
        }
      }

      outcomeById.set(input.id, {
        id: input.id,
        name: input.name,
        barcode: cleanEan || input.barcode,
        status: "updated",
        confidence,
        confidenceReason,
        anvisaMatched,
        updatedFields: updatedFieldNames,
        patch,
      });

      legacyItemById.set(input.id, {
        ...patch,
        department: classified.department,
        category: patch.category || classified.subcategory,
        confidence,
        confidenceReason,
      });
    }
  }

  const orderedOutcomes = normalizedInputs.map(
    (inp) =>
      outcomeById.get(inp.id) || {
        id: inp.id,
        name: inp.name,
        barcode: inp.barcode,
        status: "error" as const,
        confidence: "low" as const,
        confidenceReason: "Item não processado.",
        anvisaMatched: false,
        updatedFields: [],
        patch: {},
      }
  );

  const orderedItems = normalizedInputs.map((inp) => legacyItemById.get(inp.id) || {});
  return { items: orderedItems, outcomes: orderedOutcomes };
}

/**
 * Processa um lote com segurança em mini-lotes de até 5 itens por chamada ao Gemini.
 */
export async function enrichProductsBatchDetailedWithAi(
  productsToEnrich: ProductAiBatchInput[],
  options: CatalogBatchEnrichOptions = {}
): Promise<{ items: Record<string, any>[]; outcomes: CatalogBatchItemOutcome[] }> {
  if (!Array.isArray(productsToEnrich) || productsToEnrich.length === 0) {
    return { items: [], outcomes: [] };
  }

  const allItems: Record<string, any>[] = [];
  const allOutcomes: CatalogBatchItemOutcome[] = [];

  try {
    const capped = productsToEnrich.slice(0, 25);
    for (let i = 0; i < capped.length; i += MAX_BATCH_SIZE) {
      const slice = capped.slice(i, i + MAX_BATCH_SIZE);
      const { items, outcomes } = await processMiniBatchInternal(slice, options);
      allItems.push(...items);
      allOutcomes.push(...outcomes);
    }
    return { items: allItems, outcomes: allOutcomes };
  } catch (err: any) {
    console.error("[ProductAiService enrichProductsBatchDetailedWithAi Error]:", err?.message || err);
    throw mapGeminiException(err, "Não foi possível enriquecer o lote de produtos com a IA.");
  }
}

export async function enrichProductsBatchWithAi(
  productsToEnrich: ProductAiBatchInput[],
  options: CatalogBatchEnrichOptions = {}
): Promise<Record<string, any>[]> {
  const { items } = await enrichProductsBatchDetailedWithAi(productsToEnrich, options);
  return items;
}

export async function generateProductImageWithAi(productName: string): Promise<{ image: string }> {
  const cleanName = sanitizeTextHint(productName, 240);
  if (!cleanName || cleanName.length < 2) {
    throw createProductAiError("Informe o nome do produto para gerar a imagem com IA.", 400);
  }

  const ai = getServerGeminiClient();

  try {
    const response = await retryWithBackoff<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: DEFAULT_IMAGE_MODEL,
        contents: {
          parts: [
            {
              text: `Professional commercial product photography of a pharmaceutical box for "${cleanName}", isolated on clean white background, studio lighting, high resolution, realistic style.`,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1",
          },
        },
      })
    );

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          return { image: `data:${mimeType};base64,${part.inlineData.data}` };
        }
      }
    }

    throw createProductAiError("Nenhuma imagem foi gerada para este produto.", 502);
  } catch (err: any) {
    console.error("[ProductAiService generateProductImageWithAi Error]:", err?.message || err);
    throw mapGeminiException(err, "Não foi possível gerar a imagem do produto com a IA no momento.");
  }
}
