import { classifyProductTaxonomy, getDepartmentForCategory } from "../lib/departments.js";

export type EnrichableFieldKey =
  | "description"
  | "activePrinciple"
  | "presentation"
  | "indications"
  | "usage";

export const ALL_ENRICHABLE_FIELDS: EnrichableFieldKey[] = [
  "description",
  "activePrinciple",
  "presentation",
  "indications",
  "usage",
];

export const ENRICHABLE_FIELD_LABELS: Record<EnrichableFieldKey, string> = {
  description: "Descrição Comercial",
  activePrinciple: "Princípio Ativo",
  presentation: "Apresentação",
  indications: "Indicações",
  usage: "Modo de Uso",
};

export interface ProductCompletenessLike {
  id?: string;
  name?: string;
  barcode?: string;
  department?: string;
  category?: string;
  manufacturer?: string;
  drugType?: string;
  drug_type?: string;
  activePrinciple?: string;
  active_principle?: string;
  presentation?: string;
  description?: string;
  indications?: string;
  usage?: string;
  requires_prescription?: boolean;
  isAiEnriched?: boolean;
  is_ai_enriched?: boolean;
  stock?: number;
}

const EMPTY_PLACEHOLDER_VALUES = new Set([
  "n/a",
  "na",
  "n.a",
  "n.a.",
  "-",
  "--",
  "---",
  "nenhum",
  "nenhuma",
  "outros",
  "geral",
  "nao se aplica",
  "não se aplica",
  "sem informacao",
  "sem informação",
  "a definir",
  "pendente",
]);

function readFieldString(product: ProductCompletenessLike, field: EnrichableFieldKey): string {
  if (!product) return "";
  if (field === "activePrinciple") {
    return String(product.activePrinciple ?? product.active_principle ?? "").trim();
  }
  return String((product as any)[field] ?? "").trim();
}

function normalizeDescCompare(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detecta descrições vazias, placeholders, curtas demais (< 40 caracteres)
 * ou praticamente idênticas ao próprio nome do produto (típico de importação de ERP).
 */
export function isShallowOrDuplicateDescription(
  description?: string | null,
  productName?: string | null
): boolean {
  const val = String(description ?? "").trim();
  if (!val) return true;
  if (EMPTY_PLACEHOLDER_VALUES.has(val.toLowerCase())) return true;
  if (val.length < 40) return true;

  if (productName) {
    const normDesc = normalizeDescCompare(val);
    const normName = normalizeDescCompare(productName);
    if (normDesc && normName) {
      if (normDesc === normName) return true;
      if (normDesc.includes(normName) || normName.includes(normDesc)) {
        const minLen = Math.min(normDesc.length, normName.length);
        const maxLen = Math.max(normDesc.length, normName.length);
        if (maxLen > 0 && minLen / maxLen >= 0.75) {
          return true;
        }
      }
    }
  }

  return false;
}

export function isEnrichableFieldEmpty(
  product: ProductCompletenessLike,
  field: EnrichableFieldKey
): boolean {
  const val = readFieldString(product, field);
  if (!val) return true;
  const lower = val.toLowerCase();
  if (EMPTY_PLACEHOLDER_VALUES.has(lower)) return true;

  switch (field) {
    case "description":
      return isShallowOrDuplicateDescription(val, product?.name);
    case "activePrinciple":
      return val.length < 2;
    case "presentation":
      return val.length < 2;
    case "indications":
      return val.length < 5;
    case "usage":
      return val.length < 5;
    default:
      return val.length === 0;
  }
}

export function resolveProductOfficialDepartment(product: ProductCompletenessLike): string {
  if (product.department && String(product.department).trim()) {
    const mapped = getDepartmentForCategory(String(product.department).trim());
    if (mapped) return mapped;
  }
  if (product.category && String(product.category).trim() && String(product.category).trim().toLowerCase() !== "geral") {
    const mapped = getDepartmentForCategory(String(product.category).trim());
    if (mapped) return mapped;
  }
  return classifyProductTaxonomy({
    name: product.name || "",
    activePrinciple: product.activePrinciple || product.active_principle || "",
    description: product.description || "",
    rawCategory: product.category || "",
    drugType: product.drugType || product.drug_type || "",
    indications: product.indications || "",
    manufacturer: product.manufacturer || "",
  }).department;
}

const MEDICATION_DRUG_TYPES = new Set([
  "referencia",
  "referência",
  "generico",
  "genérico",
  "similar",
  "fitoterapico",
  "fitoterápico",
  "homeopatico",
  "homeopático",
  "biologico",
  "biológico",
  "controlado",
  "medicamento",
]);

const NON_MEDICATION_DRUG_TYPES = new Set([
  "cosmetico",
  "cosmético",
  "higiene",
  "suplemento",
  "correlato",
  "alimento",
  "perfumaria",
]);

const NON_MEDICATION_DEPARTMENTS = new Set([
  "Dermocosméticos e Beleza",
  "Higiene e Cuidados Pessoais",
  "Mamãe e Bebê",
  "Saúde, Ortopedia e Primeiros Socorros",
  "Conveniência",
]);

/**
 * Distingue medicamentos (que exigem Princípio Ativo padronizado) de cosméticos,
 * higiene, perfumaria, suplementos e correlatos (que não exigem princípio ativo medicamentoso).
 */
export function isMedicationProduct(product: ProductCompletenessLike): boolean {
  const rawDrugType = String(product.drugType || product.drug_type || "")
    .trim()
    .toLowerCase();

  if (NON_MEDICATION_DRUG_TYPES.has(rawDrugType)) {
    return false;
  }
  if (MEDICATION_DRUG_TYPES.has(rawDrugType)) {
    return true;
  }

  const dept = resolveProductOfficialDepartment(product);
  if (dept === "Medicamentos") {
    return true;
  }
  if (NON_MEDICATION_DEPARTMENTS.has(dept)) {
    return false;
  }

  // Saúde e Bem-Estar (Vitaminas / Suplementos): só trata como medicamento se exigir receita ou tiver padrão medicamentoso explícito
  if (product.requires_prescription) {
    return true;
  }

  return false;
}

/**
 * Retorna a lista real de campos faltantes conforme o perfil do produto (Medicamento vs Não-Medicamento).
 * Nunca ignora um produto apenas por `isAiEnriched === true` se ainda houver campos vazios.
 */
export function getMissingEnrichableFields(
  product: ProductCompletenessLike,
  targetFields: EnrichableFieldKey[] = ALL_ENRICHABLE_FIELDS
): EnrichableFieldKey[] {
  const isMed = isMedicationProduct(product);
  return targetFields.filter((field) => {
    if (field === "activePrinciple" && !isMed) {
      return false;
    }
    return isEnrichableFieldEmpty(product, field);
  });
}

export function isProductIncomplete(
  product: ProductCompletenessLike,
  targetFields: EnrichableFieldKey[] = ALL_ENRICHABLE_FIELDS
): boolean {
  return getMissingEnrichableFields(product, targetFields).length > 0;
}

export interface CatalogCompletenessStats {
  total: number;
  incomplete: number;
  missingDescription: number;
  missingActivePrinciple: number;
  missingPresentation: number;
  missingIndications: number;
  missingUsage: number;
}

export function getCatalogCompletenessStats(
  products: ProductCompletenessLike[]
): CatalogCompletenessStats {
  let incomplete = 0;
  let missingDescription = 0;
  let missingActivePrinciple = 0;
  let missingPresentation = 0;
  let missingIndications = 0;
  let missingUsage = 0;

  for (const p of products) {
    if (!p) continue;
    const isMed = isMedicationProduct(p);
    const missDesc = isEnrichableFieldEmpty(p, "description");
    const missAct = isMed && isEnrichableFieldEmpty(p, "activePrinciple");
    const missPres = isEnrichableFieldEmpty(p, "presentation");
    const missInd = isEnrichableFieldEmpty(p, "indications");
    const missUsage = isEnrichableFieldEmpty(p, "usage");

    if (missDesc) missingDescription++;
    if (missAct) missingActivePrinciple++;
    if (missPres) missingPresentation++;
    if (missInd) missingIndications++;
    if (missUsage) missingUsage++;

    if (missDesc || missAct || missPres || missInd || missUsage) {
      incomplete++;
    }
  }

  return {
    total: products.length,
    incomplete,
    missingDescription,
    missingActivePrinciple,
    missingPresentation,
    missingIndications,
    missingUsage,
  };
}
