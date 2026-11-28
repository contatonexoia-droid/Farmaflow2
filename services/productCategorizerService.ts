import { Type, GenerateContentResponse } from "@google/genai";
import { DepartmentConfig } from "../types.js";
import {
  OFFICIAL_DEPARTMENTS,
  OFFICIAL_TAXONOMY,
  getDepartmentForCategory,
  normalizeTaxonomyText,
} from "../lib/departments.js";
import { classifyProductCategory, normalizeForCategoryClassifier } from "./categoryClassifier.js";
import {
  AiConfidenceLevel,
  AnvisaMatchInfo,
  cleanJsonResponse,
  createProductAiError,
  doesAnvisaTarjaRequirePrescription,
  formatAnvisaSubstanceToDcb,
  getServerGeminiClient,
  getSupabaseAdmin,
  isMatchedProductNameValid,
  lookupEanReferenceBatch,
  mapAnvisaTipoProdutoToDrugType,
  mapGeminiException,
  normalizeCompareText,
  normalizeEanDigits,
  retryWithBackoff,
  sanitizeTextHint,
} from "./productAiService.js";

const DEFAULT_CATEGORIZE_MODEL = "gemini-4-hydrogen";
const MAX_CATEGORIZE_BATCH_SIZE = 20;

export interface ProductCategorizeInput {
  id: string;
  name: string;
  barcode?: string;
  manufacturer?: string;
  category?: string;
  department?: string;
  activePrinciple?: string;
  drugType?: string;
  description?: string;
  requires_prescription?: boolean;
}

export interface CategorizeBatchOptions {
  tenantId: string;
  departments?: DepartmentConfig[];
  persist?: boolean;
}

export interface CategorizeItemOutcome {
  id: string;
  name: string;
  barcode?: string;
  status: "updated" | "unchanged" | "skipped_low_confidence" | "error";
  oldDepartment: string;
  oldCategory: string;
  newDepartment: string;
  newCategory: string;
  confidence: AiConfidenceLevel;
  reason: string;
  anvisaMatched: boolean;
  updatedFields: string[];
  patch: Record<string, any>;
  error?: string;
}

interface EffectiveDeptTree {
  name: string;
  categories: string[];
}

const PERFUMERY_HYGIENE_LOCK_REGEX =
  /\b(?:SAB|SABONETE|SHAMPOO|SHAMP|CONDICIONADOR|DESOD|DESODORANTE|AEROSSOL|ANTITRANSPIRANTE|PO FACIAL|BATOM|ESMALTE|TINTURA|FRALDA|FRALDAS|LENCO UMED|LENCO UMEDECIDO|LENCOS UMEDECIDOS|TOALHA UMEDECIDA|PROTETOR SOLAR|FILTRO SOLAR|HIDRATANTE|CREME DENTAL|ESCOVA|ABSORVENTE|PRESERVATIVO|PERFUME|COLONIA|DEO COLONIA|SPRAY FIXADOR|GEL CAPILAR|CREME DE PENTEAR|CREME PARA PENTEAR|MASCARA CAPILAR|MAQUIAGEM|CORRETIVO|RIMEL|DELINEADOR|BARBEADOR|POS BARBA|ALGODAO|COTONETE|HASTE FLEX|HASTES FLEXIVEIS|AGUA MICELAR|BODY SPLASH)\b/;

const NASAL_OR_INHALER_EXCEPTION_REGEX =
  /\b(?:NASAL|INALATORIO|OTOLOGICO|OFTALMICO|AEROLIN|SALBUTAMOL|BECLOMETASONA|BUDESONIDA|FLUTICASONA|CLENIL|SERETIDE|SYMBICORT|ATROVENT|BEROTEC)\b/;

const MEDICATION_DRUG_TYPES_NORM = new Set([
  "referencia",
  "generico",
  "similar",
  "fitoterapico",
  "biologico",
  "especifico",
  "controlado",
]);

const NON_MED_DRUG_TYPES_NORM = new Set([
  "cosmetico",
  "higiene",
  "perfumaria",
  "correlato",
  "alimento",
]);

function isMedicationDepartmentName(deptName: string): boolean {
  return normalizeTaxonomyText(deptName).includes("medicamento");
}

function isPerfumeryOrHygieneDepartmentName(deptName: string): boolean {
  const norm = normalizeTaxonomyText(deptName);
  return (
    norm.includes("perfumaria") ||
    norm.includes("higiene") ||
    norm.includes("dermocosmetico") ||
    norm.includes("beleza") ||
    norm.includes("cabelo") ||
    norm.includes("banho") ||
    norm.includes("mamae e bebe")
  );
}

function isGenericOrAmbiguousCategoryName(catName: string): boolean {
  const norm = normalizeTaxonomyText(catName);
  return (
    !norm ||
    norm === "geral" ||
    norm === "outros" ||
    norm === "outros medicamentos" ||
    norm === "sem categoria" ||
    norm === "snacks" ||
    norm === "produtos para o dia a dia"
  );
}

function buildDefaultDepartmentTree(): EffectiveDeptTree[] {
  return OFFICIAL_DEPARTMENTS.map((deptName) => ({
    name: deptName,
    categories: [...(OFFICIAL_TAXONOMY[deptName] || [])],
  }));
}

async function resolveEffectiveDepartments(
  tenantId: string,
  clientDepartments?: DepartmentConfig[]
): Promise<{ tree: EffectiveDeptTree[]; configs: DepartmentConfig[] }> {
  let rawConfigs: DepartmentConfig[] = [];

  const supabaseAdmin = getSupabaseAdmin();
  if (supabaseAdmin && tenantId) {
    try {
      const { data: tenantRow } = await supabaseAdmin
        .from("tenants")
        .select("departments")
        .eq("id", tenantId)
        .maybeSingle();

      if (Array.isArray(tenantRow?.departments) && tenantRow.departments.length > 0) {
        rawConfigs = tenantRow.departments;
      }
    } catch (_) {}
  }

  if (rawConfigs.length === 0 && Array.isArray(clientDepartments) && clientDepartments.length > 0) {
    rawConfigs = clientDepartments;
  }

  if (rawConfigs.length === 0) {
    const defaultTree = buildDefaultDepartmentTree();
    const defaultConfigs: DepartmentConfig[] = defaultTree.map((d, idx) => ({
      id: `default_${idx}`,
      name: d.name,
      iconName: "Package",
      priority: idx,
      categories: d.categories,
    }));
    return { tree: defaultTree, configs: defaultConfigs };
  }

  const tree: EffectiveDeptTree[] = [];
  const cleanConfigs: DepartmentConfig[] = [];

  for (let i = 0; i < rawConfigs.length; i++) {
    const d = rawConfigs[i];
    const deptName = sanitizeTextHint(d?.name, 80);
    if (!deptName) continue;
    const cats: string[] = Array.isArray(d?.categories)
      ? Array.from(
          new Set<string>(
            d.categories
              .map((c) => sanitizeTextHint(c, 80))
              .filter(Boolean)
          )
        )
      : [];
    if (cats.length === 0) continue;

    tree.push({ name: deptName, categories: cats });
    cleanConfigs.push({
      id: String(d?.id || `dept_${i}`),
      name: deptName,
      iconName: String(d?.iconName || "Package"),
      priority: typeof d?.priority === "number" ? d.priority : i,
      categories: cats,
    });
  }

  if (tree.length === 0) {
    const defaultTree = buildDefaultDepartmentTree();
    const defaultConfigs: DepartmentConfig[] = defaultTree.map((d, idx) => ({
      id: `default_${idx}`,
      name: d.name,
      iconName: "Package",
      priority: idx,
      categories: d.categories,
    }));
    return { tree: defaultTree, configs: defaultConfigs };
  }

  return { tree, configs: cleanConfigs };
}

function findMatchingCategoryInList(
  candidates: string[],
  availableCategories: string[]
): string {
  for (const cand of candidates) {
    const candNorm = normalizeTaxonomyText(cand);
    const exact = availableCategories.find((c) => normalizeTaxonomyText(c) === candNorm);
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const candNorm = normalizeTaxonomyText(cand);
    const partial = availableCategories.find((c) => {
      const cNorm = normalizeTaxonomyText(c);
      return cNorm.includes(candNorm) || candNorm.includes(cNorm);
    });
    if (partial) return partial;
  }
  return "";
}

/**
 * Guia prioritário via Código ATC da CMED (`classe_terapeutica`) para sugerir a subcategoria
 * mais exata dentro do departamento de Medicamentos da loja.
 */
function suggestMedicationSubcategoryFromAtc(
  therapeuticClass: string | undefined,
  activePrinciple: string | undefined,
  productName: string,
  medCategories: string[]
): { suggestedSubcategory: string; atcCode: string } {
  if (medCategories.length === 0) {
    return { suggestedSubcategory: "Outros Medicamentos", atcCode: "" };
  }

  const rawClass = String(therapeuticClass || "").trim().toUpperCase();
  const atcMatch = /^([A-Z]\d{0,2}[A-Z]{0,2})/.exec(rawClass);
  const atcCode = atcMatch ? atcMatch[1] : "";
  const classNorm = normalizeCompareText(rawClass);

  const pick = (candidates: string[]) => findMatchingCategoryInList(candidates, medCategories);

  // Prefixos ATC oficiais da CMED
  if (atcCode.startsWith("A10") || classNorm.includes("diabetes") || classNorm.includes("antidiabet")) {
    const c = pick(["Diabetes"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("A11") || atcCode.startsWith("A12") || classNorm.includes("vitamina") || classNorm.includes("suplemento mineral")) {
    const c = pick(["Vitaminas e Minerais", "Vitaminas e Suplementos", "Outros Medicamentos"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (
    atcCode.startsWith("A02") ||
    atcCode.startsWith("A2") ||
    atcCode.startsWith("A03") ||
    atcCode.startsWith("A3") ||
    atcCode.startsWith("A04") ||
    atcCode.startsWith("A05") ||
    atcCode.startsWith("A06") ||
    atcCode.startsWith("A6") ||
    atcCode.startsWith("A07") ||
    atcCode.startsWith("A7") ||
    atcCode.startsWith("A09")
  ) {
    const c = pick(["Saúde Digestiva", "Estômago e Digestivo", "Digestivo"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("C") || classNorm.includes("cardio") || classNorm.includes("hipertens")) {
    const c = pick(["Pressão e Coração", "Coração e Pressão", "Cardiovascular"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("R03") || classNorm.includes("asma") || classNorm.includes("broncodilat")) {
    const c = pick(["Saúde Respiratória", "Respiratório"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("R06") || classNorm.includes("anti histamin") || classNorm.includes("antialerg")) {
    const c = pick(["Alergias"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("R") || classNorm.includes("tosse") || classNorm.includes("resfriado") || classNorm.includes("nasal")) {
    const c = pick(["Gripe e Resfriado", "Saúde Respiratória"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("N02") || atcCode.startsWith("N2") || classNorm.includes("analges")) {
    const c = pick(["Dor e Febre"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("M01") || atcCode.startsWith("M02") || atcCode.startsWith("M03") || atcCode.startsWith("M")) {
    const c = pick(["Dor e Febre", "Dores Musculares", "Anti-inflamatórios", "Outros Medicamentos"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("G04B") || atcCode.startsWith("G04C") || classNorm.includes("urolog")) {
    const c = pick(["Saúde do Homem", "Outros Medicamentos"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("G") || classNorm.includes("ginecolog") || classNorm.includes("anticoncep") || classNorm.includes("hormonio sexual")) {
    const c = pick(["Saúde da Mulher", "Outros Medicamentos"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("J") || classNorm.includes("antibiotic") || classNorm.includes("antiviral") || classNorm.includes("antifungic")) {
    const c = pick(["Antibióticos", "Outros Medicamentos"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }
  if (atcCode.startsWith("D") || classNorm.includes("dermatolog")) {
    const c = pick(["Dermatológico", "Alergias", "Outros Medicamentos"]);
    if (c) return { suggestedSubcategory: c, atcCode };
  }

  // Fallback pela regra determinística dentro de Medicamentos
  const det = classifyProductCategory(productName, "", "", activePrinciple || "", "", "Referência");
  if (det.department === "Medicamentos") {
    const matched = pick([det.subcategory]);
    if (matched) return { suggestedSubcategory: matched, atcCode };
  }

  const fallbackOther = pick(["Outros Medicamentos"]);
  return {
    suggestedSubcategory: fallbackOther || medCategories[0],
    atcCode,
  };
}

function findUnambiguousSubcategoryInDepartment(
  deptTree: EffectiveDeptTree,
  preferredCategory: string,
  configs: DepartmentConfig[],
  isMedicationAllowed: boolean
): string | null {
  const prefNorm = normalizeTaxonomyText(preferredCategory);
  const exactInDept = deptTree.categories.find((c) => normalizeTaxonomyText(c) === prefNorm);

  if (exactInDept) {
    if (!isMedicationAllowed && normalizeTaxonomyText(exactInDept) === "outros medicamentos") {
      return null;
    }
    const resolved = getDepartmentForCategory(exactInDept, configs);
    if (normalizeTaxonomyText(resolved) === normalizeTaxonomyText(deptTree.name)) {
      return exactInDept;
    }
  }

  // Caso haja colisão de nome (ex: "Saúde Digestiva" existe em "Medicamentos" e em "Saúde e Bem-Estar"),
  // procura na mesma aba uma subcategoria equivalente que resolva de forma inequívoca para `deptTree.name`.
  const nonAmbiguousInDept = deptTree.categories.filter((c) => {
    if (!isMedicationAllowed && normalizeTaxonomyText(c) === "outros medicamentos") {
      return false;
    }
    const resolved = getDepartmentForCategory(c, configs);
    return normalizeTaxonomyText(resolved) === normalizeTaxonomyText(deptTree.name);
  });

  if (nonAmbiguousInDept.length === 0) return null;

  const prefWords = new Set(prefNorm.split(" ").filter((w) => w.length >= 3));
  let best = nonAmbiguousInDept[0];
  let bestScore = -1;

  for (const candidate of nonAmbiguousInDept) {
    const cNorm = normalizeTaxonomyText(candidate);
    let score = 0;
    for (const w of prefWords) {
      if (cNorm.includes(w)) score += 2;
    }
    if (
      !isMedicationAllowed &&
      (cNorm.includes("vitaminas") || cNorm.includes("higiene e beleza") || cNorm.includes("banho"))
    ) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function buildMedicationDepartmentFallback(
  tree: EffectiveDeptTree[],
  configs: DepartmentConfig[],
  anvisa: AnvisaMatchInfo,
  prod: ProductCategorizeInput
): { department: string; category: string } | null {
  const medDept = tree.find((d) => isMedicationDepartmentName(d.name));
  if (!medDept) return null;

  const { suggestedSubcategory } = suggestMedicationSubcategoryFromAtc(
    anvisa.therapeuticClass,
    anvisa.activePrinciple || prod.activePrinciple,
    prod.name,
    medDept.categories
  );

  const safeCat =
    findUnambiguousSubcategoryInDepartment(medDept, suggestedSubcategory, configs, true) ||
    medDept.categories.find((c) => normalizeTaxonomyText(c) === "outros medicamentos") ||
    medDept.categories[0];

  if (!safeCat) return null;
  return { department: medDept.name, category: safeCat };
}

function buildNonMedicationFallback(
  tree: EffectiveDeptTree[],
  configs: DepartmentConfig[],
  prod: ProductCategorizeInput
): { department: string; category: string } | null {
  const det = classifyProductCategory(
    prod.name || "",
    prod.manufacturer || "",
    "",
    "",
    prod.description || "",
    prod.drugType || ""
  );

  if (!isMedicationDepartmentName(det.department)) {
    const dept = tree.find(
      (d) => normalizeTaxonomyText(d.name) === normalizeTaxonomyText(det.department)
    );
    if (dept) {
      const safeCat = findUnambiguousSubcategoryInDepartment(dept, det.subcategory, configs, false);
      if (safeCat) {
        return { department: dept.name, category: safeCat };
      }
    }
  }

  return null;
}

export async function categorizeProductsBatchWithAi(
  products: ProductCategorizeInput[],
  options: CategorizeBatchOptions
): Promise<{ outcomes: CategorizeItemOutcome[]; resolvedWithoutAi: number }> {
  if (!Array.isArray(products) || products.length === 0) {
    return { outcomes: [], resolvedWithoutAi: 0 };
  }
  if (products.length > MAX_CATEGORIZE_BATCH_SIZE) {
    throw createProductAiError(
      `Envie no máximo ${MAX_CATEGORIZE_BATCH_SIZE} produtos por mini-lote de categorização.`,
      400
    );
  }

  const tenantId = sanitizeTextHint(options?.tenantId, 120);
  if (!tenantId) {
    throw createProductAiError("O 'tenantId' da loja é obrigatório para organizar categorias.", 400);
  }

  const shouldPersist = options?.persist !== false;
  const { tree: effectiveTree, configs: effectiveConfigs } = await resolveEffectiveDepartments(
    tenantId,
    options.departments
  );

  const allowedDeptNames = effectiveTree.map((d) => d.name);

  // Camada 1: Lookup prévio na base oficial ANVISA / CMED (ean, ean2, ean3)
  const barcodes = products.map((p) => p.barcode || "").filter(Boolean);
  const eanLookupMap = await lookupEanReferenceBatch(barcodes, tenantId);

  interface PreparedCategorizeContext {
    prod: ProductCategorizeInput;
    cleanEan: string;
    oldCategory: string;
    oldDepartment: string;
    anvisa: AnvisaMatchInfo;
    mustBeMedication: boolean;
    forbiddenInMedication: boolean;
    atcHint: { suggestedSubcategory: string; atcCode: string } | null;
  }

  const medDeptObj = effectiveTree.find((d) => isMedicationDepartmentName(d.name));
  const medCategoriesList = medDeptObj ? medDeptObj.categories : [];

  const contexts: PreparedCategorizeContext[] = products.map((prod) => {
    const cleanEan = normalizeEanDigits(prod.barcode);
    const eanInfo = cleanEan ? eanLookupMap.get(cleanEan) : undefined;
    const anvisa: AnvisaMatchInfo = eanInfo?.anvisa?.found ? eanInfo.anvisa : { found: false };

    const oldCategory = sanitizeTextHint(prod.category, 100) || "Sem Categoria";
    const oldDepartment =
      sanitizeTextHint(prod.department, 100) ||
      (prod.category ? getDepartmentForCategory(prod.category, effectiveConfigs) : "Sem Departamento");

    const nameNorm = normalizeForCategoryClassifier(prod.name || "");
    const drugTypeNorm = normalizeTaxonomyText(prod.drugType || "");
    const isMedDrugType = MEDICATION_DRUG_TYPES_NORM.has(drugTypeNorm);
    const isCosmeticDrugType = NON_MED_DRUG_TYPES_NORM.has(drugTypeNorm);
    const hasActivePrinciple = Boolean(sanitizeTextHint(prod.activePrinciple, 160));

    const mustBeMedication = Boolean(
      anvisa.found ||
        prod.requires_prescription === true ||
        (hasActivePrinciple && isMedDrugType)
    );

    const hasPerfumeryTerms =
      PERFUMERY_HYGIENE_LOCK_REGEX.test(nameNorm.wordText) &&
      !NASAL_OR_INHALER_EXCEPTION_REGEX.test(nameNorm.wordText);

    const forbiddenInMedication = Boolean(
      !anvisa.found &&
        !mustBeMedication &&
        (isCosmeticDrugType || hasPerfumeryTerms)
    );

    const atcHint = anvisa.found
      ? suggestMedicationSubcategoryFromAtc(
          anvisa.therapeuticClass,
          anvisa.activePrinciple || prod.activePrinciple,
          prod.name,
          medCategoriesList
        )
      : null;

    return {
      prod,
      cleanEan,
      oldCategory,
      oldDepartment,
      anvisa,
      mustBeMedication,
      forbiddenInMedication,
      atcHint,
    };
  });

  // Camada 3: Chamada estruturada ao Gemini em mini-lotes de até 10 itens
  const ai = getServerGeminiClient();

  const departmentTreeSummary = effectiveTree.map((d) => ({
    department: d.name,
    categories: d.categories,
  }));

  const payloadForPrompt = contexts.map((ctx) => ({
    id: ctx.prod.id,
    name: sanitizeTextHint(ctx.prod.name, 160),
    barcode: ctx.cleanEan || "",
    manufacturer: sanitizeTextHint(ctx.prod.manufacturer, 80),
    current_department: ctx.oldDepartment,
    current_category: ctx.oldCategory,
    active_principle: sanitizeTextHint(ctx.prod.activePrinciple, 120),
    drug_type: sanitizeTextHint(ctx.prod.drugType, 60),
    requires_prescription: Boolean(ctx.prod.requires_prescription),
    anvisa_cmed: ctx.anvisa.found
      ? {
          matched: true,
          nome_comercial: ctx.anvisa.productName || "",
          principio_ativo: ctx.anvisa.activePrinciple || "",
          classe_terapeutica: ctx.anvisa.therapeuticClass || "",
          tipo_produto: ctx.anvisa.drugType || "",
          tarja: ctx.anvisa.tarja || "",
          suggested_atc_category: ctx.atcHint?.suggestedSubcategory || "",
        }
      : { matched: false },
    anti_mix_rule: ctx.mustBeMedication
      ? "LOCKED_TO_MEDICATION_DEPARTMENT"
      : ctx.forbiddenInMedication
      ? "FORBIDDEN_IN_MEDICATION_DEPARTMENT"
      : "STANDARD",
  }));

  const prompt = `Você é um Farmacêutico Auditor sênior especialista em taxonomia de farmácias e drogarias brasileiras (CMED/ANVISA + Varejo Farma).
Classifique os produtos abaixo utilizando EXCLUSIVAMENTE os departamentos e subcategorias permitidos pela loja.

ÁRVORE OFICIAL DA LOJA (use os nomes EXATOS de department e category):
${JSON.stringify(departmentTreeSummary, null, 2)}

REGRAS CRÍTICAS ANTI-MISTURA:
1. Se anvisa_cmed.matched === true ou anti_mix_rule === "LOCKED_TO_MEDICATION_DEPARTMENT":
   - O produto é OFICIALMENTE UM MEDICAMENTO. O "department" DEVE ser o departamento de Medicamentos da loja (nunca Perfumaria, Higiene, Beleza, Cabelos ou Mamãe e Bebê).
   - Use "anvisa_cmed.classe_terapeutica" (código ATC) e "anvisa_cmed.suggested_atc_category" como guia prioritário para escolher a subcategoria mais exata em Medicamentos.
2. Se anti_mix_rule === "FORBIDDEN_IN_MEDICATION_DEPARTMENT" ou o item for claramente de perfumaria, higiene pessoal, beleza, cosmético, bebê, fralda, desodorante, protetor solar, maquiagem, spray fixador, sabonete, creme dental ou preservativo:
   - NUNCA coloque no departamento de Medicamentos nem em "Outros Medicamentos". Escolha o departamento/subcategoria corretos de Perfumaria/Higiene/Beleza/Mamãe e Bebê/Primeiros Socorros.
3. NUNCA use "Outros Medicamentos" como depósito genérico para itens que NÃO são medicamentos!
4. Retorne o "id" EXATO de cada produto recebido e copie o nome recebido no campo "matched_product_name".
5. Use confidence = "low" se o nome for ambíguo, código interno indecifrável ou se não houver segurança para escolher a categoria exata.
6. Em "reason", informe um motivo curto (ex: "CMED ATC N02BA01 - Analgésico" ou "Desodorante antitranspirante aerossol").

PRODUTOS PARA CLASSIFICAR:
${JSON.stringify(payloadForPrompt, null, 2)}`;

  let aiResults: any[] = [];
  try {
    const response = await retryWithBackoff<GenerateContentResponse>(() =>
      ai.models.generateContent({
        model: DEFAULT_CATEGORIZE_MODEL,
        contents: prompt,
        config: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                matched_product_name: { type: Type.STRING },
                department: {
                  type: Type.STRING,
                  enum: allowedDeptNames,
                },
                category: { type: Type.STRING },
                confidence: {
                  type: Type.STRING,
                  enum: ["high", "medium", "low"],
                },
                reason: { type: Type.STRING },
              },
              required: [
                "id",
                "matched_product_name",
                "department",
                "category",
                "confidence",
                "reason",
              ],
            },
          },
        },
      })
    );

    const parsed = JSON.parse(cleanJsonResponse(response.text || "[]"));
    if (Array.isArray(parsed)) {
      aiResults = parsed;
    }
  } catch (err: any) {
    throw mapGeminiException(err, "Erro ao classificar categorias com IA no servidor.");
  }

  // Casamento ESTRITO por `id` (nunca por posição do array)
  const aiById = new Map<string, any>();
  for (const item of aiResults) {
    if (item && typeof item.id === "string" && item.id.trim()) {
      aiById.set(item.id.trim(), item);
    }
  }

  const supabaseAdmin = getSupabaseAdmin();
  const outcomes: CategorizeItemOutcome[] = [];

  for (const ctx of contexts) {
    const { prod, anvisa, oldCategory, oldDepartment, mustBeMedication, forbiddenInMedication } =
      ctx;

    const aiItem = aiById.get(String(prod.id).trim());
    if (!aiItem) {
      // Fallback seguro quando ANVISA CMED deu match exato mesmo se IA omitiu item
      if (anvisa.found) {
        const medFallback = buildMedicationDepartmentFallback(
          effectiveTree,
          effectiveConfigs,
          anvisa,
          prod
        );
        if (medFallback) {
          const outcome = await finalizeAndPersistCategorizeOutcome({
            ctx,
            chosenDepartment: medFallback.department,
            chosenCategory: medFallback.category,
            confidence: "high",
            reason: `CMED oficial (${anvisa.therapeuticClass || anvisa.activePrinciple || "EAN validado"})`,
            shouldPersist,
            tenantId,
            supabaseAdmin,
          });
          outcomes.push(outcome);
          continue;
        }
      }

      outcomes.push({
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "skipped_low_confidence",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence: "low",
        reason: "A IA não retornou o ID exato deste produto; mantido intacto para revisão manual.",
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
      });
      continue;
    }

    const nameMatches = isMatchedProductNameValid(prod.name, aiItem.matched_product_name);
    if (!nameMatches) {
      outcomes.push({
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "skipped_low_confidence",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence: "low",
        reason: "Nome validado pela IA divergiu do produto original; alteração bloqueada por segurança.",
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
      });
      continue;
    }

    let confidence: AiConfidenceLevel =
      aiItem.confidence === "high" || aiItem.confidence === "medium" ? aiItem.confidence : "low";
    let reason = sanitizeTextHint(aiItem.reason, 200) || "Classificação validada";

    // Localiza o departamento exato na árvore da loja
    const rawDept = sanitizeTextHint(aiItem.department, 100);
    const rawCat = sanitizeTextHint(aiItem.category, 100);

    let targetDept = effectiveTree.find(
      (d) => normalizeTaxonomyText(d.name) === normalizeTaxonomyText(rawDept)
    );
    let targetCat = targetDept
      ? findMatchingCategoryInList([rawCat], targetDept.categories)
      : "";

    // Camada 2A: Se é medicamento travado (CMED / tarja / drugType+princípio ativo),
    // PROÍBE sair do departamento de Medicamentos
    if (mustBeMedication && (!targetDept || !isMedicationDepartmentName(targetDept.name))) {
      if (anvisa.found) {
        const medFallback = buildMedicationDepartmentFallback(
          effectiveTree,
          effectiveConfigs,
          anvisa,
          prod
        );
        if (medFallback) {
          targetDept = effectiveTree.find((d) => d.name === medFallback.department);
          targetCat = medFallback.category;
          confidence = "high";
          reason = `Trava CMED/ANVISA aplicada (${anvisa.therapeuticClass || anvisa.activePrinciple || "Medicamento"})`;
        } else {
          confidence = "low";
        }
      } else {
        const detMed = classifyProductCategory(
          prod.name,
          prod.manufacturer || "",
          "",
          prod.activePrinciple || "",
          prod.description || "",
          prod.drugType || ""
        );
        if (isMedicationDepartmentName(detMed.department) && medDeptObj) {
          targetDept = medDeptObj;
          targetCat =
            findMatchingCategoryInList([detMed.subcategory], medDeptObj.categories) ||
            "Outros Medicamentos";
          reason = `Trava medicamentosa aplicada (${reason})`;
        } else {
          confidence = "low";
          reason = "Trava anti-mistura: medicamento não pode ser movido para Perfumaria/Higiene.";
        }
      }
    }

    // Camada 2B: Se NÃO é medicamento (ou é perfumaria/higiene/cosmético explícito),
    // PROÍBE salvar em Medicamentos ou Outros Medicamentos
    if (
      !mustBeMedication &&
      ((targetDept && isMedicationDepartmentName(targetDept.name)) ||
        normalizeTaxonomyText(targetCat) === "outros medicamentos")
    ) {
      if (forbiddenInMedication || !anvisa.found) {
        const nonMedFallback = buildNonMedicationFallback(
          effectiveTree,
          effectiveConfigs,
          prod
        );
        if (nonMedFallback) {
          targetDept = effectiveTree.find((d) => d.name === nonMedFallback.department);
          targetCat = nonMedFallback.category;
          reason = `Trava anti-mistura: direcionado fora de Medicamentos (${nonMedFallback.category})`;
        } else {
          confidence = "low";
          reason =
            "Bloqueado em Medicamentos/Outros Medicamentos: item não possui EAN na CMED nem evidência medicamentosa clara.";
        }
      }
    }

    // Bloqueia categoria que pertence a Perfumaria/Higiene quando produto é medicamento
    if (mustBeMedication && targetDept && isPerfumeryOrHygieneDepartmentName(targetDept.name)) {
      confidence = "low";
      reason = "Bloqueado: medicamento não pode ser classificado em Perfumaria/Higiene.";
    }

    if (confidence === "low" || !targetDept || !targetCat) {
      outcomes.push({
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "skipped_low_confidence",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence: "low",
        reason:
          reason ||
          "Confiança insuficiente ou subcategoria fora da árvore oficial da loja; mantido para revisão manual.",
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
      });
      continue;
    }

    // Garante coerência inequívoca entre `category` salvo e `getDepartmentForCategory(category, tenant.departments)`
    const unambiguousCategory = findUnambiguousSubcategoryInDepartment(
      targetDept,
      targetCat,
      effectiveConfigs,
      mustBeMedication || isMedicationDepartmentName(targetDept.name)
    );

    if (!unambiguousCategory) {
      outcomes.push({
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "skipped_low_confidence",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence: "low",
        reason: `Subcategoria "${targetCat}" ambígua em relação à árvore de departamentos da loja; revisão manual recomendada.`,
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
      });
      continue;
    }

    const finalDepartment = getDepartmentForCategory(unambiguousCategory, effectiveConfigs);
    if (
      mustBeMedication &&
      !isMedicationDepartmentName(finalDepartment)
    ) {
      outcomes.push({
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "skipped_low_confidence",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence: "low",
        reason: "Bloqueado pela trava de departamento medicamentoso.",
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
      });
      continue;
    }
    if (
      forbiddenInMedication &&
      isMedicationDepartmentName(finalDepartment)
    ) {
      outcomes.push({
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "skipped_low_confidence",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence: "low",
        reason: "Bloqueado pela trava anti-mistura de Perfumaria/Higiene em Medicamentos.",
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
      });
      continue;
    }

    // Impede que categoria genérica ("Geral"/"Outros") passe como alta confiança se não houve melhoria real
    if (
      isGenericOrAmbiguousCategoryName(unambiguousCategory) &&
      !anvisa.found &&
      normalizeTaxonomyText(oldCategory) !== normalizeTaxonomyText(unambiguousCategory)
    ) {
      confidence = "low";
      outcomes.push({
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "skipped_low_confidence",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence: "low",
        reason: "Sem subcategoria específica segura — mantido para revisão manual.",
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
      });
      continue;
    }

    const outcome = await finalizeAndPersistCategorizeOutcome({
      ctx,
      chosenDepartment: finalDepartment,
      chosenCategory: unambiguousCategory,
      confidence,
      reason,
      shouldPersist,
      tenantId,
      supabaseAdmin,
    });
    outcomes.push(outcome);
  }

  const resolvedWithoutAi = outcomes.filter(o => o.status === "updated" && (o.reason?.includes("CMED") || o.reason?.includes("regra"))).length;
  return { outcomes, resolvedWithoutAi };
}

async function finalizeAndPersistCategorizeOutcome(params: {
  ctx: {
    prod: ProductCategorizeInput;
    oldCategory: string;
    oldDepartment: string;
    anvisa: AnvisaMatchInfo;
  };
  chosenDepartment: string;
  chosenCategory: string;
  confidence: AiConfidenceLevel;
  reason: string;
  shouldPersist: boolean;
  tenantId: string;
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
}): Promise<CategorizeItemOutcome> {
  const {
    ctx,
    chosenDepartment,
    chosenCategory,
    confidence,
    reason,
    shouldPersist,
    tenantId,
    supabaseAdmin,
  } = params;
  const { prod, oldCategory, oldDepartment, anvisa } = ctx;

  const dbPatch: Record<string, any> = {};
  const clientPatch: Record<string, any> = {};
  const updatedFields: string[] = [];

  if (String(prod.category || "").trim() !== chosenCategory) {
    dbPatch.category = chosenCategory;
    clientPatch.category = chosenCategory;
    updatedFields.push("category");
  }

  // Aproveita match oficial CMED para corrigir drug_type, active_principle e requires_prescription
  if (anvisa.found) {
    const mappedDrugType = mapAnvisaTipoProdutoToDrugType(anvisa.drugType);
    const currentDrugNorm = normalizeTaxonomyText(prod.drugType || "");
    if (
      mappedDrugType &&
      (!currentDrugNorm ||
        currentDrugNorm === "livre" ||
        currentDrugNorm === "outros" ||
        NON_MED_DRUG_TYPES_NORM.has(currentDrugNorm)) &&
      prod.drugType !== mappedDrugType
    ) {
      dbPatch.drug_type = mappedDrugType;
      clientPatch.drugType = mappedDrugType;
      updatedFields.push("drugType");
    }

    const dcb = formatAnvisaSubstanceToDcb(anvisa.activePrinciple);
    if (dcb && !sanitizeTextHint(prod.activePrinciple, 120)) {
      dbPatch.active_principle = dcb;
      clientPatch.activePrinciple = dcb;
      updatedFields.push("activePrinciple");
    }

    // Nunca remove requires_prescription = true já marcado manualmente
    if (prod.requires_prescription !== true && doesAnvisaTarjaRequirePrescription(anvisa.tarja)) {
      dbPatch.requires_prescription = true;
      clientPatch.requires_prescription = true;
      updatedFields.push("requires_prescription");
    }
  }

  if (updatedFields.length === 0) {
    return {
      id: prod.id,
      name: prod.name,
      barcode: prod.barcode,
      status: "unchanged",
      oldDepartment,
      oldCategory,
      newDepartment: chosenDepartment,
      newCategory: chosenCategory,
      confidence,
      reason,
      anvisaMatched: anvisa.found,
      updatedFields: [],
      patch: {},
    };
  }

  if (shouldPersist && supabaseAdmin && prod.id && tenantId) {
    const { error } = await supabaseAdmin
      .from("products")
      .update(dbPatch)
      .eq("id", prod.id)
      .eq("tenant_id", tenantId);

    if (error) {
      return {
        id: prod.id,
        name: prod.name,
        barcode: prod.barcode,
        status: "error",
        oldDepartment,
        oldCategory,
        newDepartment: oldDepartment,
        newCategory: oldCategory,
        confidence,
        reason,
        anvisaMatched: anvisa.found,
        updatedFields: [],
        patch: {},
        error: error.message || "Falha ao salvar categoria no Supabase.",
      };
    }
  }

  return {
    id: prod.id,
    name: prod.name,
    barcode: prod.barcode,
    status: "updated",
    oldDepartment,
    oldCategory,
    newDepartment: chosenDepartment,
    newCategory: chosenCategory,
    confidence,
    reason,
    anvisaMatched: anvisa.found,
    updatedFields,
    patch: clientPatch,
  };
}
