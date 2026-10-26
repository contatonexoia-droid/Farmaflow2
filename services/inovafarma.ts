import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const INOVAFARMA_DEFAULT_API_URL = "https://guiaintegracao.portalps.app";

export interface InovafarmaRawProduct {
  ean?: string | number | null;
  codigoBarras?: string | number | null;
  codBarras?: string | number | null;
  codigo_barras?: string | number | null;
  gtin?: string | number | null;
  barcode?: string | number | null;
  ean13?: string | number | null;
  codigo?: string | number | null;
  codigoInterno?: string | number | null;
  codigo_interno?: string | number | null;
  codProduto?: string | number | null;
  idProduto?: string | number | null;
  id?: string | number | null;
  sku?: string | number | null;
  nome?: string | null;
  descricao?: string | null;
  nomeProduto?: string | null;
  descricaoProduto?: string | null;
  produto?: string | null;
  name?: string | null;
  title?: string | null;
  precoVenda?: number | string | null;
  preco_venda?: number | string | null;
  valorVenda?: number | string | null;
  preco?: number | string | null;
  valor?: number | string | null;
  price?: number | string | null;
  salePrice?: number | string | null;
  precoPromocional?: number | string | null;
  preco_promocional?: number | string | null;
  valorPromocao?: number | string | null;
  precoOferta?: number | string | null;
  promotionalPrice?: number | string | null;
  precoCusto?: number | string | null;
  preco_custo?: number | string | null;
  valorCusto?: number | string | null;
  custo?: number | string | null;
  costPrice?: number | string | null;
  estoque?: number | string | null;
  saldo?: number | string | null;
  saldoEstoque?: number | string | null;
  qtdEstoque?: number | string | null;
  quantidade?: number | string | null;
  estoqueAtual?: number | string | null;
  stock?: number | string | null;
  qty?: number | string | null;
  categoria?: string | null;
  departamento?: string | null;
  grupo?: string | null;
  secao?: string | null;
  category?: string | null;
  fabricante?: string | null;
  laboratorio?: string | null;
  marca?: string | null;
  principioAtivo?: string | null;
  principio_ativo?: string | null;
  substancia?: string | null;
  ativo?: boolean | number | string | null;
}

export interface NormalizedInovafarmaProduct {
  barcode: string;
  internalCode: string;
  name: string;
  price: number;
  promotionalPrice: number | null;
  costPrice: number | null;
  stock: number;
  category: string;
  manufacturer?: string;
  activeIngredient?: string;
}

export interface InovafarmaSyncOptions {
  tenantId: string;
  apiToken?: string;
  erpUrl?: string;
  cnpj?: string;
  ignoreErpPrices?: boolean;
  /** Permite enviar uma lista de produtos diretamente caso o agente local / ponte envie via push */
  productsOverride?: InovafarmaRawProduct[];
}

export interface InovafarmaSyncResult {
  success: boolean;
  tenantId: string;
  endpointUsed: string;
  totalFetched: number;
  totalValid: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  ignoreErpPrices: boolean;
  syncedAt: string;
  message: string;
  error?: string;
}

/**
 * Higieniza códigos EAN/GTIN vindos do Inovafarma / PDV ou planilhas:
 * - Converte notação científica (ex: 7.896094e+12) para string numérica exata
 * - Remove pontos decimais finais (.0) e quaisquer caracteres não numéricos
 */
export function sanitizeInovafarmaEan(raw: unknown): string {
  if (raw === null || raw === undefined) return "";

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return "";
    return Math.round(raw).toLocaleString("fullwide", { useGrouping: false });
  }

  let str = String(raw).trim();
  if (!str) return "";

  const normalizedNumStr = str.replace(",", ".");
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(normalizedNumStr)) {
    const parsed = Number(normalizedNumStr);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed).toLocaleString("fullwide", { useGrouping: false });
    }
  }

  if (/^\d+\.0+$/.test(normalizedNumStr)) {
    str = normalizedNumStr.split(".")[0];
  }

  const digitsOnly = str.replace(/\D+/g, "");
  if (!digitsOnly || /^0+$/.test(digitsOnly)) return "";
  return digitsOnly;
}

/**
 * Converte valores monetários ou de estoque vindos da API do Inovafarma (number ou string pt-BR)
 */
export function parseInovafarmaNumber(raw: unknown, fallback = 0): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : fallback;
  }
  const str = String(raw).trim();
  if (!str) return fallback;

  // Se tiver vírgula como separador decimal (ex: "1.234,56" ou "29,90")
  if (str.includes(",") && str.includes(".")) {
    const cleaned = str.replace(/\./g, "").replace(",", ".");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (str.includes(",")) {
    const parsed = Number(str.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normaliza um item bruto retornado pela API do Inovafarma (Portal PS)
 */
export function normalizeInovafarmaProduct(
  raw: InovafarmaRawProduct,
): NormalizedInovafarmaProduct | null {
  if (!raw || typeof raw !== "object") return null;

  const rawEan =
    raw.ean ??
    raw.codigoBarras ??
    raw.codBarras ??
    raw.codigo_barras ??
    raw.gtin ??
    raw.barcode ??
    raw.ean13 ??
    "";

  const rawInternal =
    raw.codigoInterno ??
    raw.codigo_interno ??
    raw.codigo ??
    raw.codProduto ??
    raw.idProduto ??
    raw.sku ??
    raw.id ??
    "";

  const barcode = sanitizeInovafarmaEan(rawEan);
  const internalCode = String(rawInternal ?? "").trim() || barcode;

  const rawName =
    raw.nome ??
    raw.descricao ??
    raw.nomeProduto ??
    raw.descricaoProduto ??
    raw.produto ??
    raw.name ??
    raw.title ??
    "";

  const name = String(rawName ?? "").trim();

  // Exige pelo menos código (EAN ou interno) e nome (ou gera nome fallback se houver EAN válido)
  if (!barcode && !internalCode) {
    return null;
  }

  const finalName = name || `Produto (${barcode || internalCode})`;

  const rawPrice =
    raw.precoVenda ??
    raw.preco_venda ??
    raw.valorVenda ??
    raw.preco ??
    raw.valor ??
    raw.price ??
    raw.salePrice;

  const rawPromo =
    raw.precoPromocional ??
    raw.preco_promocional ??
    raw.valorPromocao ??
    raw.precoOferta ??
    raw.promotionalPrice;

  const rawCost =
    raw.precoCusto ??
    raw.preco_custo ??
    raw.valorCusto ??
    raw.custo ??
    raw.costPrice;

  const rawStock =
    raw.estoque ??
    raw.saldo ??
    raw.saldoEstoque ??
    raw.qtdEstoque ??
    raw.quantidade ??
    raw.estoqueAtual ??
    raw.stock ??
    raw.qty;

  let price = Math.max(0, Math.round(parseInovafarmaNumber(rawPrice, 0) * 100) / 100);
  const costPriceVal = parseInovafarmaNumber(rawCost, -1);
  const costPrice = costPriceVal >= 0 ? Math.round(costPriceVal * 100) / 100 : null;

  if (price === 0 && costPrice !== null && costPrice > 0) {
    price = Math.round(costPrice * 1.5 * 100) / 100;
  }

  const promoVal = parseInovafarmaNumber(rawPromo, -1);
  const promotionalPrice =
    promoVal > 0 && (price === 0 || promoVal < price)
      ? Math.round(promoVal * 100) / 100
      : null;

  const stock = Math.max(0, Math.floor(parseInovafarmaNumber(rawStock, 0)));

  const category =
    String(
      raw.categoria ??
        raw.departamento ??
        raw.grupo ??
        raw.secao ??
        raw.category ??
        "Geral",
    ).trim() || "Geral";

  const manufacturer = String(
    raw.fabricante ?? raw.laboratorio ?? raw.marca ?? "",
  ).trim();

  const activeIngredient = String(
    raw.principioAtivo ?? raw.principio_ativo ?? raw.substancia ?? "",
  ).trim();

  return {
    barcode: barcode || internalCode,
    internalCode: internalCode || barcode,
    name: finalName,
    price,
    promotionalPrice,
    costPrice,
    stock,
    category,
    manufacturer: manufacturer || undefined,
    activeIngredient: activeIngredient || undefined,
  };
}

/**
 * Extrai a lista de produtos de qualquer envelope JSON retornado pelo Inovafarma / Portal PS
 */
function extractProductArrayFromResponse(payload: any): InovafarmaRawProduct[] | null {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object") {
    const candidateKeys = [
      "produtos",
      "products",
      "data",
      "items",
      "itens",
      "results",
      "result",
      "content",
      "registros",
      "lista",
    ];
    for (const key of candidateKeys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
      if (
        payload[key] &&
        typeof payload[key] === "object" &&
        Array.isArray(payload[key].items || payload[key].produtos || payload[key].data)
      ) {
        return payload[key].items || payload[key].produtos || payload[key].data;
      }
    }
  }
  return null;
}

/**
 * Busca os produtos atualizados na API do Inovafarma (Portal PS)
 */
export async function fetchInovafarmaProducts(params: {
  baseUrl?: string;
  token: string;
  cnpj?: string;
}): Promise<{ products: InovafarmaRawProduct[]; endpointUsed: string }> {
  const rawBase = (params.baseUrl || INOVAFARMA_DEFAULT_API_URL).trim();
  const cleanBase = rawBase.replace(/\/+$/, "");
  const token = (params.token || "").trim();

  if (!token) {
    throw new Error(
      "Credencial/Token da farmácia não configurado. Preencha o Token de Integração (Bearer / API Key) antes de sincronizar.",
    );
  }

  // Monta lista de endpoints candidatos (priorizando URL exata se já possuir path específico, e depois /produtos)
  const candidateUrls: string[] = [];
  try {
    const parsedUrl = new URL(cleanBase);
    if (parsedUrl.pathname && parsedUrl.pathname !== "/" && parsedUrl.pathname.length > 1) {
      candidateUrls.push(cleanBase);
    }
    const origin = parsedUrl.origin;
    const paths = [
      "/produtos",
      "/api/produtos",
      "/v1/produtos",
      "/api/v1/produtos",
      "/integracao/produtos",
      "/api/stock-dump",
    ];
    for (const p of paths) {
      const full = `${origin}${p}`;
      if (!candidateUrls.includes(full)) {
        candidateUrls.push(full);
      }
    }
  } catch {
    candidateUrls.push(`${INOVAFARMA_DEFAULT_API_URL}/produtos`);
    candidateUrls.push(`${INOVAFARMA_DEFAULT_API_URL}/api/produtos`);
    candidateUrls.push(`${INOVAFARMA_DEFAULT_API_URL}/v1/produtos`);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
    "x-api-key": token.replace(/^Bearer\s+/i, ""),
    token: token.replace(/^Bearer\s+/i, ""),
  };

  if (params.cnpj) {
    headers["x-cnpj"] = params.cnpj.replace(/\D/g, "");
  }

  const errors: string[] = [];

  for (const endpoint of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const response = await fetch(endpoint, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        errors.push(
          `${endpoint} -> HTTP ${response.status}${errText ? ` (${errText.slice(0, 120)})` : ""}`,
        );
        continue;
      }

      if (contentType.includes("text/html")) {
        // Caso a URL base seja o portal de documentação HTML (ex: guiaintegracao.portalps.app raiz)
        errors.push(`${endpoint} -> Retornou página HTML de documentação em vez de JSON da API`);
        continue;
      }

      const data = await response.json();
      const extracted = extractProductArrayFromResponse(data);
      if (extracted) {
        return { products: extracted, endpointUsed: endpoint };
      } else {
        errors.push(`${endpoint} -> JSON recebido não contém lista de produtos`);
      }
    } catch (err: any) {
      errors.push(`${endpoint} -> ${err?.message || "Falha de conexão"}`);
    }
  }

  throw new Error(
    `Não foi possível obter a lista de produtos nos endpoints do Inovafarma (Portal PS). Verifique se a URL da API e o Token Bearer/API Key estão ativos no Portal PS. Detalhes: ${errors.slice(0, 3).join(" | ")}`,
  );
}

/**
 * Sincroniza em lote (upsert) os produtos do Inovafarma na tabela `products` do Supabase,
 * vinculando ao `tenant_id` da farmácia e higienizando os códigos EAN.
 */
export async function syncInovafarmaProductsToSupabase(
  supabaseClient: SupabaseClient,
  options: InovafarmaSyncOptions,
  classifyTaxonomyFn?: (
    name: string,
    category?: string,
  ) => { department?: string; category?: string; subcategory?: string },
): Promise<InovafarmaSyncResult> {
  const { tenantId } = options;
  const syncedAt = new Date().toISOString();

  if (!tenantId) {
    throw new Error("tenant_id da farmácia é obrigatório para sincronização com o Inovafarma.");
  }

  // 1. Carrega configurações da farmácia no Supabase
  const { data: tenant, error: tenantError } = await supabaseClient
    .from("tenants")
    .select("id, name, cnpj, erp_url, erp_type, integration_token, ignore_erp_prices")
    .eq("id", tenantId)
    .single();

  if (tenantError || !tenant) {
    throw new Error(
      `Farmácia não encontrada no banco de dados (${tenantError?.message || tenantId}).`,
    );
  }

  const effectiveToken = (options.apiToken || tenant.integration_token || "").trim();
  const effectiveUrl = (options.erpUrl || tenant.erp_url || INOVAFARMA_DEFAULT_API_URL).trim();
  const ignoreErpPrices =
    options.ignoreErpPrices !== undefined
      ? Boolean(options.ignoreErpPrices)
      : Boolean(tenant.ignore_erp_prices);

  let rawProducts: InovafarmaRawProduct[] = [];
  let endpointUsed = "payload_direto";

  try {
    // 2. Obtém produtos da API do Inovafarma (ou usa override se enviado no body)
    if (Array.isArray(options.productsOverride) && options.productsOverride.length > 0) {
      rawProducts = options.productsOverride;
      endpointUsed = "push_payload";
    } else {
      const fetched = await fetchInovafarmaProducts({
        baseUrl: effectiveUrl,
        token: effectiveToken,
        cnpj: options.cnpj || tenant.cnpj || undefined,
      });
      rawProducts = fetched.products;
      endpointUsed = fetched.endpointUsed;
    }

    // 3. Normaliza e deduplica por EAN higienizado (ou código interno)
    const normalizedMap = new Map<string, NormalizedInovafarmaProduct>();
    let skippedCount = 0;

    for (const rawItem of rawProducts) {
      const normalized = normalizeInovafarmaProduct(rawItem);
      if (!normalized) {
        skippedCount++;
        continue;
      }
      const key = normalized.barcode || `INT:${normalized.internalCode}`;
      normalizedMap.set(key, normalized);
    }

    const validProducts = Array.from(normalizedMap.values());

    if (validProducts.length === 0) {
      const emptyResult: InovafarmaSyncResult = {
        success: true,
        tenantId,
        endpointUsed,
        totalFetched: rawProducts.length,
        totalValid: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount,
        ignoreErpPrices,
        syncedAt,
        message: "A API do Inovafarma respondeu com sucesso, mas nenhum produto válido foi retornado.",
      };

      await supabaseClient.from("integration_logs").insert({
        tenant_id: tenantId,
        endpoint: "/inovafarma/sync",
        payload: {
          endpointUsed,
          totalFetched: rawProducts.length,
          totalValid: 0,
          skippedCount,
        },
        status: "SUCCESS",
      });

      return emptyResult;
    }

    // 4. Busca produtos existentes da farmácia no Supabase para preservar IDs, fotos e enriquecimento
    const existingByBarcode = new Map<string, any>();
    const existingByInternalCode = new Map<string, any>();

    let from = 0;
    const step = 1000;
    while (true) {
      const { data: existingBatch, error: fetchErr } = await supabaseClient
        .from("products")
        .select(
          "id, barcode, internal_code, name, price, promotional_price, stock, category, department, subcategory, image, images, description, is_featured, is_ai_enriched",
        )
        .eq("tenant_id", tenantId)
        .range(from, from + step - 1);

      if (fetchErr) {
        throw new Error(`Erro ao consultar catálogo atual da farmácia: ${fetchErr.message}`);
      }
      if (!existingBatch || existingBatch.length === 0) break;

      for (const prod of existingBatch) {
        const cleanBc = sanitizeInovafarmaEan(prod.barcode);
        if (cleanBc) {
          existingByBarcode.set(cleanBc, prod);
        }
        if (prod.barcode) {
          existingByBarcode.set(String(prod.barcode).trim(), prod);
        }
        if (prod.internal_code) {
          existingByInternalCode.set(String(prod.internal_code).trim(), prod);
        }
      }

      if (existingBatch.length < step) break;
      from += step;
    }

    // 5. Prepara lote para upsert
    let insertedCount = 0;
    let updatedCount = 0;
    const upsertPayloads: any[] = [];

    for (const item of validProducts) {
      const existing =
        (item.barcode && existingByBarcode.get(item.barcode)) ||
        (item.internalCode && existingByInternalCode.get(item.internalCode));

      if (existing) {
        updatedCount++;
        const updatedRow: any = {
          id: existing.id,
          tenant_id: tenantId,
          barcode: item.barcode || existing.barcode,
          internal_code: item.internalCode || existing.internal_code || item.barcode,
          name: existing.name || item.name,
          stock: item.stock,
          category: existing.category || item.category || "Geral",
        };

        // Se o produto for zerado no estoque e estava em destaque, oculta da vitrine principal
        if (item.stock === 0 && existing.is_featured) {
          updatedRow.is_featured = false;
        }

        // Respeita a trava `ignore_erp_prices` da farmácia
        if (!ignoreErpPrices) {
          if (item.price > 0) {
            updatedRow.price = item.price;
          } else {
            updatedRow.price = existing.price ?? 0;
          }
          if (item.promotionalPrice !== null) {
            updatedRow.promotional_price = item.promotionalPrice;
          }
        } else {
          updatedRow.price = existing.price ?? item.price ?? 0;
          updatedRow.promotional_price = existing.promotional_price ?? null;
        }

        upsertPayloads.push(updatedRow);
      } else {
        insertedCount++;
        let taxonomy: { department?: string; category?: string; subcategory?: string } = {};
        if (classifyTaxonomyFn) {
          try {
            taxonomy = classifyTaxonomyFn(item.name, item.category);
          } catch {
            taxonomy = {};
          }
        }

        const newRow: any = {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          barcode: item.barcode,
          internal_code: item.internalCode || item.barcode,
          name: item.name,
          description: item.activeIngredient
            ? `Princípio Ativo: ${item.activeIngredient}`
            : "",
          price: item.price,
          promotional_price: item.promotionalPrice,
          stock: item.stock,
          category: taxonomy.category || item.category || "Geral",
          department: taxonomy.department || "Outros",
          subcategory: taxonomy.subcategory || "Outros",
          is_featured: false,
          is_ai_enriched: false,
        };

        upsertPayloads.push(newRow);
      }
    }

    // 6. Executa upsert em lotes de 250 registros no Supabase
    const BATCH_SIZE = 250;
    for (let i = 0; i < upsertPayloads.length; i += BATCH_SIZE) {
      const chunk = upsertPayloads.slice(i, i + BATCH_SIZE);
      const { error: upsertErr } = await supabaseClient
        .from("products")
        .upsert(chunk, { onConflict: "id" });

      if (upsertErr) {
        // Fallback caso alguma coluna opcional (ex: department/subcategory) não exista no schema do cliente
        const minimalChunk = chunk.map((row) => {
          const { department, subcategory, ...rest } = row;
          return rest;
        });
        const { error: retryErr } = await supabaseClient
          .from("products")
          .upsert(minimalChunk, { onConflict: "id" });

        if (retryErr) {
          throw new Error(`Falha ao gravar lote de produtos no Supabase: ${retryErr.message}`);
        }
      }
    }

    const result: InovafarmaSyncResult = {
      success: true,
      tenantId,
      endpointUsed,
      totalFetched: rawProducts.length,
      totalValid: validProducts.length,
      insertedCount,
      updatedCount,
      skippedCount,
      ignoreErpPrices,
      syncedAt,
      message: `Sincronização Inovafarma concluída: ${validProducts.length} produtos processados (${insertedCount} novos, ${updatedCount} atualizados).`,
    };

    await supabaseClient.from("integration_logs").insert({
      tenant_id: tenantId,
      endpoint: "/inovafarma/sync",
      payload: {
        endpointUsed,
        totalFetched: rawProducts.length,
        totalValid: validProducts.length,
        insertedCount,
        updatedCount,
        skippedCount,
        ignoreErpPrices,
      },
      status: "SUCCESS",
    });

    return result;
  } catch (err: any) {
    const errorMessage = err?.message || "Erro desconhecido na sincronização com Inovafarma";
    await supabaseClient.from("integration_logs").insert({
      tenant_id: tenantId,
      endpoint: "/inovafarma/sync",
      payload: {
        erpUrl: effectiveUrl,
        endpointUsed,
      },
      status: "FAILED",
      error_message: errorMessage,
    });
    throw err;
  }
}

/**
 * Helper cliente (Frontend) para acionar a sincronização Inovafarma no servidor
 */
export async function triggerInovafarmaSync(params: {
  tenantId: string;
  erpUrl?: string;
  apiToken?: string;
  ignoreErpPrices?: boolean;
}): Promise<InovafarmaSyncResult> {
  const response = await fetch("/api/integration/inovafarma/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(params.apiToken ? { "x-api-key": params.apiToken } : {}),
    },
    body: JSON.stringify(params),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || data.details || `Falha na sincronização (HTTP ${response.status})`);
  }
  return data as InovafarmaSyncResult;
}
