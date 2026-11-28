import { supabase } from "./supabase.js";
import { classifyProductTaxonomy } from "../lib/departments.js";
import type { EnrichableFieldKey } from "../utils/productCompleteness.js";
import type { DepartmentConfig } from "../types.js";

export type AiConfidenceLevel = "high" | "medium" | "low";

export interface ProductDetailsAiRequest {
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
  tenantId?: string;
}

export interface ProductDetailsAiBatchItem {
  id?: string;
  name: string;
  missingFields: string[];
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

export interface CatalogMiniBatchOutcome {
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

export interface EanPropagationSummary {
  updatedProducts: number;
  updatedStores: number;
  fieldsFilled: number;
  eansPropagated: number;
}

export interface CatalogMiniBatchResponse {
  items: Record<string, any>[];
  outcomes: CatalogMiniBatchOutcome[];
  propagation?: EanPropagationSummary;
}

export interface TenantEanHydrationResponse {
  totalScanned: number;
  matchedEans: number;
  updatedProducts: number;
  fieldsFilled: number;
  updatedItems: Array<{ id: string; patch: Record<string, any> }>;
  tokensUsed: 0;
}

async function getAiRequestHeaders(tenantId?: string): Promise<Record<string, string>> {
  let token = "";

  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || "";
  } catch (_) {}

  if (!token && typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("ff_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.access_token) {
          token = String(parsed.access_token);
        }
      }
    } catch (_) {}
  }

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { "x-tenant-id": tenantId } : {}),
  };
}

async function parseJsonSafe(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

export const enrichCatalogMiniBatch = async (params: {
  tenantId: string;
  products: ProductDetailsAiBatchItem[];
  targetFields?: EnrichableFieldKey[];
  overwriteExisting?: boolean;
  persist?: boolean;
  propagateToOtherStores?: boolean;
  signal?: AbortSignal;
}): Promise<CatalogMiniBatchResponse> => {
  const {
    tenantId,
    products,
    targetFields,
    overwriteExisting = false,
    persist = true,
    propagateToOtherStores = true,
    signal,
  } = params;

  if (!Array.isArray(products) || products.length === 0) {
    return { items: [], outcomes: [] };
  }

  const headers = await getAiRequestHeaders(tenantId);
  const response = await fetch("/api/ai/enrich-batch", {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      tenantId,
      products,
      targetFields,
      overwriteExisting,
      persist,
      propagateToOtherStores,
    }),
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("LIMITE_IA_ATINGIDO");
    }
    throw new Error(data?.error || "Falha ao enriquecer mini-lote de produtos com IA.");
  }

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const rawOutcomes = Array.isArray(data?.outcomes) ? data.outcomes : [];

  const normalizedItems = products.map((origProd, idx) => {
    const item = rawItems[idx] || {};
    if (!item || Object.keys(item).length === 0) return {};

    const classified = classifyProductTaxonomy({
      name: origProd?.name || "",
      activePrinciple: item.activePrinciple || origProd.activePrinciple,
      description: item.description,
      rawCategory: item.category || origProd.category,
      drugType: item.drugType,
      indications: item.indications,
      manufacturer: item.manufacturer || origProd.manufacturer,
    });

    return {
      ...item,
      department: classified.department,
      category: item.category || classified.subcategory,
    };
  });

  return {
    items: normalizedItems,
    outcomes: rawOutcomes,
    propagation: data?.propagation,
  };
};

export const hydrateCatalogByEanBase = async (params: {
  tenantId: string;
  productIds?: string[];
}): Promise<TenantEanHydrationResponse> => {
  const { tenantId, productIds } = params;
  const headers = await getAiRequestHeaders(tenantId);

  const response = await fetch("/api/ai/hydrate-by-ean", {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenantId,
      ...(Array.isArray(productIds) && productIds.length > 0 ? { productIds } : {}),
    }),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw new Error(data?.error || "Falha ao preencher dados técnicos pela base EAN do FarmaFlow.");
  }

  return {
    totalScanned: Number(data?.totalScanned || 0),
    matchedEans: Number(data?.matchedEans || 0),
    updatedProducts: Number(data?.updatedProducts || 0),
    fieldsFilled: Number(data?.fieldsFilled || 0),
    updatedItems: Array.isArray(data?.updatedItems) ? data.updatedItems : [],
    tokensUsed: 0,
  };
};

export interface ProductCategorizeBatchItem {
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

export interface CatalogCategorizeOutcome {
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

export const categorizeCatalogMiniBatch = async (params: {
  tenantId: string;
  products: ProductCategorizeBatchItem[];
  departments?: DepartmentConfig[];
  persist?: boolean;
  signal?: AbortSignal;
}): Promise<{ outcomes: CatalogCategorizeOutcome[] }> => {
  const { tenantId, products, departments, persist = true, signal } = params;

  if (!Array.isArray(products) || products.length === 0) {
    return { outcomes: [] };
  }

  const headers = await getAiRequestHeaders(tenantId);
  const response = await fetch("/api/ai/categorize-batch", {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      tenantId,
      products,
      departments,
      persist,
    }),
  });

  const data = await parseJsonSafe(response);

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("LIMITE_IA_ATINGIDO");
    }
    throw new Error(data?.error || "Falha ao organizar categorias do mini-lote com IA.");
  }

  return {
    outcomes: Array.isArray(data?.outcomes) ? data.outcomes : [],
  };
};

export const fetchProductDetailsBatch = async (
  productsToEnrich: ProductDetailsAiBatchItem[],
  tenantId?: string
) => {
  if (!Array.isArray(productsToEnrich) || productsToEnrich.length === 0) return [];

  try {
    const headers = await getAiRequestHeaders(tenantId);
    const response = await fetch("/api/ai/enrich-batch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        products: productsToEnrich,
        ...(tenantId ? { tenantId } : {}),
        persist: false,
      }),
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("LIMITE_IA_ATINGIDO");
      }
      throw new Error(data?.error || "Falha ao enriquecer lote de produtos com IA.");
    }

    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];

    return productsToEnrich.map((origProd, idx) => {
      const item = items[idx] || {};
      if (!item || Object.keys(item).length === 0) return {};

      const classified = classifyProductTaxonomy({
        name: origProd?.name || "",
        activePrinciple: item.activePrinciple || origProd.activePrinciple,
        description: item.description,
        rawCategory: item.category || origProd.category,
        drugType: item.drugType,
        indications: item.indications,
        manufacturer: item.manufacturer || origProd.manufacturer,
      });

      return {
        ...item,
        department: classified.department,
        category: item.category || classified.subcategory,
      };
    });
  } catch (e: any) {
    console.error("Erro Gemini Batch Details:", e);
    if (
      e?.message === "LIMITE_IA_ATINGIDO" ||
      String(e?.message || "").includes("429") ||
      String(e?.message || "").includes("RESOURCE_EXHAUSTED")
    ) {
      throw e;
    }
    return productsToEnrich.map(() => ({}));
  }
};

export const fetchProductDetails = async (input: string | ProductDetailsAiRequest) => {
  const payload: ProductDetailsAiRequest =
    typeof input === "string" ? { name: input } : { ...input };

  if (!payload.name || !payload.name.trim()) {
    throw new Error("Informe o nome do produto antes de gerar os dados com IA.");
  }

  try {
    const headers = await getAiRequestHeaders(payload.tenantId);
    const response = await fetch("/api/ai/enrich-product", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      throw new Error(data?.error || "Erro na comunicação com o servidor de IA.");
    }

    const result = data?.data || data;
    if (!result || typeof result !== "object") {
      throw new Error("Resposta inválida recebida do servidor de IA.");
    }

    const classified = classifyProductTaxonomy({
      name: payload.name,
      activePrinciple: result.activePrinciple || payload.activePrinciple,
      description: result.description,
      rawCategory: result.category || payload.category,
      drugType: result.drugType,
      indications: result.indications,
      manufacturer: result.manufacturer || payload.manufacturer,
    });

    return {
      ...result,
      department: classified.department,
      category: result.category || classified.subcategory,
    };
  } catch (e: any) {
    console.error("Erro ao enriquecer produto com IA:", e);
    throw new Error(e?.message || "Erro na comunicação com a IA.");
  }
};

export const generateAiProductImage = async (productName: string, tenantId?: string) => {
  if (!productName || !productName.trim()) {
    throw new Error("Informe o nome do produto antes de gerar a imagem com IA.");
  }

  try {
    const headers = await getAiRequestHeaders(tenantId);
    const response = await fetch("/api/ai/generate-product-image", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: productName,
        ...(tenantId ? { tenantId } : {}),
      }),
    });

    const data = await parseJsonSafe(response);

    if (!response.ok) {
      throw new Error(data?.error || "Falha ao gerar imagem do produto com IA.");
    }

    if (!data?.image) {
      throw new Error("Nenhuma imagem foi gerada para este produto.");
    }

    return data.image;
  } catch (e: any) {
    console.error("Erro ao gerar imagem do produto com IA:", e);
    throw new Error(e?.message || "Falha ao gerar imagem com IA.");
  }
};
