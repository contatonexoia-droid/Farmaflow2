import { supabase } from "./supabase.js";
import { classifyProductTaxonomy } from "../lib/departments.js";

export interface ProductDetailsAiRequest {
  name: string;
  barcode?: string;
  manufacturer?: string;
  category?: string;
  presentation?: string;
  activePrinciple?: string;
  tenantId?: string;
}

export interface ProductDetailsAiBatchItem {
  name: string;
  missingFields: string[];
  barcode?: string;
  manufacturer?: string;
  category?: string;
  presentation?: string;
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

export const fetchProductDetailsBatch = async (
  productsToEnrich: ProductDetailsAiBatchItem[],
  tenantId?: string
) => {
  if (!Array.isArray(productsToEnrich) || productsToEnrich.length === 0) return [];

  try {
    const headers = await getAiRequestHeaders(tenantId);
    const response = await fetch("/api/ai/enrich-products-batch", {
      method: "POST",
      headers,
      body: JSON.stringify({
        products: productsToEnrich,
        ...(tenantId ? { tenantId } : {}),
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
        activePrinciple: item.activePrinciple,
        description: item.description,
        rawCategory: item.category || origProd.category,
        drugType: item.drugType,
        indications: item.indications,
        manufacturer: item.manufacturer || origProd.manufacturer,
      });

      return {
        ...item,
        department: classified.department,
        category: classified.subcategory,
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
      category: classified.subcategory,
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
