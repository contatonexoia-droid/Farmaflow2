import { supabase, isSupabaseConfigured } from "./supabase";
export { isSupabaseConfigured };
import {
  Product,
  Order,
  PharmacyConfig,
  AppReview,
  PromotionRule,
} from "../types";

/**
 * SQL DEFINITIVO PARA CORREÇÃO DO BANCO (Execute no SQL Editor do Supabase):
 *
 * -- 1. HABILITAR EXTENSÃO UUID
 * CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
 *
 * -- 2. CRIAR TABELA DE AVALIAÇÕES E CORRIGIR PERMISSÕES (RLS)
 * CREATE TABLE IF NOT EXISTS app_reviews (
 *   id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
 *   tenant_id TEXT,
 *   rating INTEGER,
 *   comment TEXT,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
 * );
 *
 * -- CORREÇÃO DO ERRO DE PERMISSÃO (RLS POLICY):
 * ALTER TABLE app_reviews ENABLE ROW LEVEL SECURITY;
 * DROP POLICY IF EXISTS "Public Insert Reviews" ON app_reviews;
 * CREATE POLICY "Public Insert Reviews" ON app_reviews FOR INSERT TO public WITH CHECK (true);
 * DROP POLICY IF EXISTS "Public Select Reviews" ON app_reviews;
 * CREATE POLICY "Public Select Reviews" ON app_reviews FOR SELECT TO public USING (true);
 *
 * -- 3. COLUNAS EXTRAS
 * ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;
 * ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN DEFAULT FALSE;
 * ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_manufacturers TEXT[];
 * ALTER TABLE tenants ADD COLUMN IF NOT EXISTS manufacturer_logos JSONB;
 * ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_categories TEXT[];
 * ALTER TABLE tenants ADD COLUMN IF NOT EXISTS departments JSONB;
 *
 * -- 4. AJUSTES DE COLUNAS
 * ALTER TABLE products ALTER COLUMN tenant_id DROP NOT NULL;
 * ALTER TABLE orders ALTER COLUMN tenant_id DROP NOT NULL;
 *
 * -- 5. OTIMIZAÇÃO DE PERFORMANCE (ÍNDICES)
 * CREATE INDEX IF NOT EXISTS idx_products_tenant_id ON products(tenant_id);
 * CREATE INDEX IF NOT EXISTS idx_orders_tenant_id ON orders(tenant_id);
 *
 * -- 6. BUCKET DE IMAGENS (STORAGE)
 * INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true) ON CONFLICT DO NOTHING;
 * CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
 * CREATE POLICY "Auth Insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images');
 * CREATE POLICY "Auth Update" ON storage.objects FOR UPDATE USING (bucket_id = 'product-images');
 *
 * -- 7. TABELA DE PROMOÇÕES
 * CREATE TABLE IF NOT EXISTS promotions (
 *   id TEXT PRIMARY KEY,
 *   tenant_id TEXT,
 *   name TEXT,
 *   type TEXT,
 *   target_type TEXT,
 *   target_value TEXT,
 *   buy_x INTEGER,
 *   pay_y INTEGER,
 *   discount_thresholds JSONB,
 *   combo_products JSONB,
 *   combo_discount_percentage NUMERIC,
 *   specific_product_ids TEXT[],
 *   filters_metadata JSONB,
 *   start_date TIMESTAMP WITH TIME ZONE,
 *   end_date TIMESTAMP WITH TIME ZONE,
 *   is_active BOOLEAN DEFAULT TRUE,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
 * );
 *
 * -- PERMISSÕES RLS PARA PROMOÇÕES
 * ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
 * DROP POLICY IF EXISTS "Public Select Promotions" ON promotions;
 * CREATE POLICY "Public Select Promotions" ON promotions FOR SELECT TO public USING (true);
 * DROP POLICY IF EXISTS "Public Insert Promotions" ON promotions;
 * CREATE POLICY "Public Insert Promotions" ON promotions FOR INSERT TO public WITH CHECK (true);
 * DROP POLICY IF EXISTS "Public Update Promotions" ON promotions;
 * CREATE POLICY "Public Update Promotions" ON promotions FOR UPDATE TO public USING (true);
 * DROP POLICY IF EXISTS "Public Delete Promotions" ON promotions;
 * CREATE POLICY "Public Delete Promotions" ON promotions FOR DELETE TO public USING (true);
 *
 * -- 8. TABELA DE CUPONS
 * CREATE TABLE IF NOT EXISTS coupons (
 *   id TEXT PRIMARY KEY,
 *   tenant_id TEXT,
 *   code TEXT,
 *   discount_type TEXT,
 *   discount_value NUMERIC,
 *   target_type TEXT,
 *   target_value TEXT,
 *   specific_product_ids TEXT[],
 *   filters_metadata JSONB,
 *   start_date TIMESTAMP WITH TIME ZONE,
 *   end_date TIMESTAMP WITH TIME ZONE,
 *   is_active BOOLEAN DEFAULT TRUE,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
 * );
 *
 * -- PERMISSÕES RLS PARA CUPONS
 * ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
 * DROP POLICY IF EXISTS "Public Select Coupons" ON coupons;
 * CREATE POLICY "Public Select Coupons" ON coupons FOR SELECT TO public USING (true);
 * DROP POLICY IF EXISTS "Public Insert Coupons" ON coupons;
 * CREATE POLICY "Public Insert Coupons" ON coupons FOR INSERT TO public WITH CHECK (true);
 * DROP POLICY IF EXISTS "Public Update Coupons" ON coupons;
 * CREATE POLICY "Public Update Coupons" ON coupons FOR UPDATE TO public USING (true);
 * DROP POLICY IF EXISTS "Public Delete Coupons" ON coupons;
 * CREATE POLICY "Public Delete Coupons" ON coupons FOR DELETE TO public USING (true);
 */

export const retryRequest = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000,
): Promise<T> => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");

  try {
    return await fn();
  } catch (error: any) {
    const msg = error?.message || "";
    if (
      retries > 0 &&
      (msg.includes("fetch") ||
        error.status === 502 ||
        error.status === 503 ||
        error.status === 0)
    ) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryRequest(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

const handleNetworkError = (error: any, context: string): string => {
  if (error?.message === "CONFIG_MISSING")
    return "Configuração do Supabase ausente.";

  let errorMsg = "Erro desconhecido";
  if (typeof error === "string") {
    errorMsg = error;
  } else if (error?.message) {
    errorMsg = error.message;
  } else if (error?.details) {
    errorMsg = `${error.message || "Erro"} (${error.details})`;
  } else {
    errorMsg = String(error);
  }

  console.error(`[Storage Error - ${context}]:`, errorMsg);
  return errorMsg;
};

let schemaSupport = {
  hasNetworkTenants: true,
  hasNetworkCoupons: true,
  hasNetworkPromotions: true,
  hasDeliverySettings: true,
  hasIgnoreErpPrices: true,
  checked: false,
};

export const checkSchemaSupport = async () => {
  if (schemaSupport.checked) return schemaSupport;
  
  if (!isSupabaseConfigured()) return schemaSupport;

  try {
    const { error: ignoreErpPricesError } = await supabase.from("tenants").select("ignore_erp_prices").limit(1);
    if (ignoreErpPricesError && (ignoreErpPricesError.code === "42703" || ignoreErpPricesError.message?.includes("ignore_erp_prices") || ignoreErpPricesError.message?.includes("does not exist"))) {
      schemaSupport.hasIgnoreErpPrices = false;
    }
  } catch (e) {
    schemaSupport.hasIgnoreErpPrices = false;
  }

  try {
    const { error: tenantError } = await supabase.from("tenants").select("is_network_master").limit(1);
    if (tenantError && (tenantError.code === "42703" || tenantError.message?.includes("is_network_master") || tenantError.message?.includes("does not exist"))) {
      schemaSupport.hasNetworkTenants = false;
    }
  } catch (e) {
    schemaSupport.hasNetworkTenants = false;
  }

  try {
    const { error: deliveryError } = await supabase.from("tenants").select("delivery_settings").limit(1);
    if (deliveryError && (deliveryError.code === "42703" || deliveryError.message?.includes("delivery_settings") || deliveryError.message?.includes("does not exist"))) {
      schemaSupport.hasDeliverySettings = false;
    }
  } catch (e) {
    schemaSupport.hasDeliverySettings = false;
  }

  try {
    const { error: couponError } = await supabase.from("coupons").select("scope").limit(1);
    if (couponError && (couponError.code === "42703" || couponError.message?.includes("scope") || couponError.message?.includes("does not exist"))) {
      schemaSupport.hasNetworkCoupons = false;
    }
  } catch (e) {
    schemaSupport.hasNetworkCoupons = false;
  }

  try {
    const { error: promoError } = await supabase.from("promotions").select("scope").limit(1);
    if (promoError && (promoError.code === "42703" || promoError.message?.includes("scope") || promoError.message?.includes("does not exist"))) {
      schemaSupport.hasNetworkPromotions = false;
    }
  } catch (e) {
    schemaSupport.hasNetworkPromotions = false;
  }

  schemaSupport.checked = true;
  console.log("[FarmaFlow Schema Support Cache]:", schemaSupport);
  return schemaSupport;
};

export const mapDbTenantToApp = (t: any): PharmacyConfig => {
  const smartBannersObj = t.smart_banners || t.smartbanners || {};
  const fallbackSettings = smartBannersObj._deliverySettings || { enabled: false, fee: 0, minOrderForFreeDelivery: 0 };
  
  return {
    id: t.id,
    slug: t.slug,
    custom_domain: t.custom_domain || t.customdomain,
    type: "PHARMACY",
    name: t.name || "Drogaria Sem Nome",
    whatsapp: t.whatsapp || "",
    logo: t.logo || "",
    primaryColor: t.primary_color || t.primarycolor || "#059669",
    secondaryColor: t.secondary_color || t.secondarycolor || "#047857",
    accentColor: t.accent_color || t.accentcolor || "#10b981",
    admin_email: t.admin_email || t.adminemail || "",
    admin_password: t.admin_password || t.adminpassword || "",
    bannerTitle: t.banner_title || t.bannertitle || "",
    bannerSubtitle: t.banner_subtitle || t.bannersubtitle || "",
    isBlocked: t.is_blocked || t.isblocked === true,
    customCategories: t.custom_categories || t.customcategories || [],
    departments: t.departments || undefined,
    customManufacturers: t.custom_manufacturers || t.custommanufacturers || [],
    licenseExpiration: t.license_expiration || t.licenseexpiration,
    cnpj: t.cnpj,
    fullAddress: t.full_address || t.fulladdress,
    corporateEmail: t.corporate_email || t.corporateemail,
    manufacturerLogos: t.manufacturer_logos || t.manufacturerlogos || {},
    backupConfig: t.backup_config || t.backupconfig || { frequency: "OFF" },
    integrationToken: t.integration_token || t.integrationtoken || "",
    erpUrl: t.erp_url || t.erpurl || "",
    erpType: t.erp_type || t.erptype || "",
    enableSmartBanners: t.enable_smart_banners || t.enablesmartbanners || false,
    smartBanners: smartBannersObj,
    couponBannerColor: t.coupon_banner_color || t.couponbannercolor || "",
    minimumOrderValue: t.minimum_order_value || t.minimumordervalue || 0,
    notificationSound: t.notification_sound || t.notificationsound || "",
    notificationVolume: t.notification_volume || t.notificationvolume || 0.5,
    isNetworkMaster: t.is_network_master || t.isnetworkmaster === true,
    networkId: t.network_id || t.networkid || "",
    deliverySettings: t.delivery_settings || t.deliverysettings || fallbackSettings,
    ignore_erp_prices: t.ignore_erp_prices !== undefined ? t.ignore_erp_prices : (t.delivery_settings?.ignore_erp_prices || false),
  };
};

export const getTenants = async (): Promise<PharmacyConfig[]> => {
  try {
    return await retryRequest(async () => {
      try {
        // Tentativa de usar API proxy para bypass do RLS (SuperAdmin)
        const res = await fetch("/api/v1/tenants/admin");
        if (res.ok) {
          const json = await res.json();
          if (!json.error && json.data) {
            return json.data.map(mapDbTenantToApp);
          }
        }
      } catch (proxyError) {
        console.warn(
          "API proxy falhou, tentando acesso direto (RLS):",
          proxyError,
        );
      }

      // Fallback para acesso direto (precisa que SQL RLS libere o acesso)
      const support = await checkSchemaSupport();
      let fields = "id, slug, custom_domain, name, whatsapp, logo, primary_color, secondary_color, accent_color, banner_title, banner_subtitle, is_blocked, license_expiration, cnpj, full_address, corporate_email, manufacturer_logos, enable_smart_banners, smart_banners, coupon_banner_color, minimum_order_value, admin_email, admin_password, notification_sound, notification_volume, departments";
      if (support.hasNetworkTenants) {
        fields += ", is_network_master, network_id";
      }
      if (support.hasDeliverySettings) {
        fields += ", delivery_settings";
      }

      const { data, error } = await supabase
        .from("tenants")
        .select(fields);
      if (error) throw error;
      return (data || []).map(mapDbTenantToApp);
    });
  } catch (e: any) {
    if (e.message !== "CONFIG_MISSING") handleNetworkError(e, "Empresas");
    return [];
  }
};

export const getTenantByHostname = async (hostname: string): Promise<PharmacyConfig | null> => {
  try {
    const res = await fetch(`/api/v1/resolve-tenant?hostname=${encodeURIComponent(hostname)}`);
    if (res.ok) {
      const json = await res.json();
      if (!json.error && json.tenant) {
        return mapDbTenantToApp(json.tenant);
      }
    }
  } catch (e) {
    console.warn("Failed to resolve tenant by hostname API:", e);
  }

  try {
    const hostParts = hostname.split(".");
    const subdomain = (hostParts.length >= 3 && hostParts[0] !== "www") ? hostParts[0] : "";
    const cleanSubdomain = subdomain
      ? subdomain.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")
      : "";

    const tenants = await getTenants();
    return tenants.find((t) => {
      const cleanSlug = t.slug
        ? t.slug.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "")
        : "";
      return (
        t.custom_domain === hostname ||
        (cleanSubdomain && (cleanSlug === cleanSubdomain || t.id === subdomain))
      );
    }) || null;
  } catch (err) {
    console.warn("Failed to resolve tenant by hostname fallback:", err);
    return null;
  }
};

export interface SearchLog {
  id?: string;
  tenant_id: string;
  term: string;
  results_count: number;
  created_at: string;
}

export const logSearch = async (
  tenantId: string,
  term: string,
  resultsCount: number,
) => {
  if (!term || !term.trim()) return;

  const searchLog = {
    tenant_id: tenantId,
    term: term.trim().toLowerCase(),
    results_count: resultsCount,
    is_success: resultsCount > 0,
    created_at: new Date().toISOString(),
  };

  try {
    if (isSupabaseConfigured()) {
      await supabase.from("search_logs").insert(searchLog);
    }
  } catch (e) {
    console.warn("Failed to log search to Supabase, falling back to local", e);
  }

  // Fallback to localforage
  try {
    const logs: SearchLog[] =
      (await localforage.getItem(`search_logs_${tenantId}`)) || [];
    logs.push(searchLog);
    // Keep only last 1000 to avoid bloat
    if (logs.length > 1000) logs.shift();
    await localforage.setItem(`search_logs_${tenantId}`, logs);
  } catch (e) {
    console.warn("Failed to log search locally", e);
  }
};

export const getEmptySearches = async (
  tenantId: string,
): Promise<{ term: string; count: number }[]> => {
  try {
    if (isSupabaseConfigured()) {
      // Usa a RPC otimizada do lado do servidor para desviar do limite de 1000 rows
      const { data, error } = await supabase.rpc(
        "get_dashboard_empty_searches",
        {
          p_tenant_id: tenantId,
          p_hours: 48,
        },
      );

      if (!error && data) {
        return data.map((d: any) => ({
          term: d.search_term,
          count: Number(d.search_count),
        })); // Removido o drop do ".slice(0, 10)", mantendo a fidelidade real
      }
    }
  } catch (e) {
    console.warn(
      "Failed to fetch search logs from Supabase RPC, falling back locally",
      e,
    );
  }

  // Fallback para storage local caso Offline ou Supabase falhe
  let logs: SearchLog[] = [];
  const fortyEightHoursAgo = new Date(
    Date.now() - 48 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const localLogs: SearchLog[] =
      (await localforage.getItem(`search_logs_${tenantId}`)) || [];
    logs = localLogs.filter(
      (l) =>
        l.results_count === 0 &&
        l.created_at &&
        l.created_at >= fortyEightHoursAgo,
    );
  } catch (e) {
    console.warn("Failed to fetch local search logs", e);
  }

  // Aggregate local
  const counts: Record<string, number> = {};
  logs.forEach((l) => {
    const cleanTerm = (l.term || "").trim().toLowerCase();
    if (cleanTerm) {
      counts[cleanTerm] = (counts[cleanTerm] || 0) + 1;
    }
  });

  return Object.entries(counts)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count);
};

export const saveTenant = async (
  tenant: PharmacyConfig,
  isUpdate: boolean = true,
) => {
  if (!isSupabaseConfigured())
    throw new Error("Configuração do Supabase ausente.");

  try {
    const payload: any = {
      id: tenant.id,
      name: tenant.name,
      whatsapp: tenant.whatsapp || "",
      logo: tenant.logo || "",
      primary_color: tenant.primaryColor,
      secondary_color: tenant.secondaryColor,
      accent_color: tenant.accentColor,
      admin_email: tenant.admin_email,
      admin_password: tenant.admin_password,
      banner_title: tenant.bannerTitle || "",
      banner_subtitle: tenant.bannerSubtitle || "",
      is_blocked: tenant.isBlocked || false,
      license_expiration: tenant.licenseExpiration || null,
      cnpj: tenant.cnpj || "",
      full_address: tenant.fullAddress || "",
      corporate_email: tenant.corporateEmail || "",
      custom_categories: tenant.customCategories || [],
      departments: tenant.departments || undefined,
      custom_manufacturers: tenant.customManufacturers || [],
      manufacturer_logos: tenant.manufacturerLogos || {},
      backup_config: tenant.backupConfig || { frequency: "OFF" },
      integration_token: tenant.integrationToken || "",
      erp_url: tenant.erpUrl || "",
      erp_type: tenant.erpType || "",
      enable_smart_banners: tenant.enableSmartBanners || false,
      smart_banners: tenant.smartBanners || {},
      coupon_banner_color: tenant.couponBannerColor || "",
      minimum_order_value: tenant.minimumOrderValue || 0,
      notification_sound: tenant.notificationSound || "",
      notification_volume: tenant.notificationVolume ?? 0.5,
    };

    const support = await checkSchemaSupport();
    if (support.hasIgnoreErpPrices) {
      payload.ignore_erp_prices = tenant.ignore_erp_prices || false;
    }

    if (support.hasDeliverySettings) {
      payload.delivery_settings = {
        ...(tenant.deliverySettings || { enabled: false, fee: 0, minOrderForFreeDelivery: 0 }),
        ...(!support.hasIgnoreErpPrices ? { ignore_erp_prices: tenant.ignore_erp_prices || false } : {})
      };
    } else {
      payload.smart_banners = {
        ...(tenant.smartBanners || {}),
        _deliverySettings: {
          ...(tenant.deliverySettings || { enabled: false, fee: 0, minOrderForFreeDelivery: 0 }),
          ...(!support.hasIgnoreErpPrices ? { ignore_erp_prices: tenant.ignore_erp_prices || false } : {})
        }
      };
    }

    if (support.hasNetworkTenants) {
      payload.is_network_master = tenant.isNetworkMaster || false;
      payload.network_id = tenant.networkId || "";
    }

    // CORREÇÃO CRÍTICA: Tenta Bypass RLS via API.
    await retryRequest(async () => {
      try {
        const res = await fetch("/api/v1/tenants/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload, isUpdate }),
        });
        const json = await res.json();
        if (res.ok && !json.error) return; // Sucesso na API
      } catch (apiErr) {
        console.warn(
          "API proxy falhou, tentando ação direta (verifique RLS):",
          apiErr,
        );
      }

      // Fallback: Acesso Direto
      if (isUpdate) {
        const { error } = await supabase.from("tenants").upsert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tenants").insert(payload);
        if (error) throw error;
      }
    });
  } catch (e: any) {
    const msg = handleNetworkError(e, "Salvar Empresa");
    throw new Error(msg);
  }
};

export const deleteTenant = async (id: string) => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    try {
      const res = await fetch(`/api/v1/tenants/admin/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && !data.error) return;
    } catch (err) {
      console.warn("API proxy delete falhou, tentando fallback direto", err);
    }

    // Fallback: Acesso direto
    await supabase.from("products").delete().eq("tenant_id", id);
    await supabase.from("orders").delete().eq("tenant_id", id);
    const { error } = await supabase.from("tenants").delete().eq("id", id);
    if (error) throw error;
  } catch (e: any) {
    handleNetworkError(e, "Excluir Empresa");
    throw e;
  }
};

export const mapDbProductToApp = (p: any): Product => ({
  id: p.id,
  tenantId: p.tenant_id || p.tenantid,
  internalCode: p.internal_code || p.internalcode || "",
  barcode: p.barcode || "",
  name: p.name || "Produto Sem Nome",
  activePrinciple: p.active_principle || p.activeprinciple || "",
  drugType: p.drug_type || p.drugtype || "",
  manufacturer: p.manufacturer || "Outros",
  price: Number(p.price) || 0,
  stock: Number(p.stock) || 0,
  category: p.category || "Geral",
  groupingSlug: p.grouping_slug || p.groupingslug || "",
  variantAttribute: p.variant_attribute || p.variantattribute || "",
  image: p.image,
  description: p.description || "",
  indications: p.indications || "",
  presentation: p.presentation || "",
  usage: p.usage || "",
  sideEffects: p.side_effects || p.sideeffects || "",
  contraindications: p.contraindications || "",
  isAiEnriched: p.is_ai_enriched || p.isaienriched,
  promotionType: p.promotion_type || p.promotiontype || "NONE",
  originalPrice: Number(p.original_price || p.originalprice) || 0,
  buyX: p.buy_x || p.buyx || 0,
  payY: p.pay_y || p.payy || 0,
  discountQtyThreshold: p.discount_qty_threshold || p.discountqtythreshold || 0,
  discountQtyPercentage:
    p.discount_qty_percentage || p.discountqtypercentage || 0,
  videoUri: p.video_uri || p.videouri,
  isFeatured: p.is_featured === true || p.isfeatured === true,
  requires_prescription: p.requires_prescription === true,
});

export const mapDbOrderToApp = (o: any): Order => ({
  id: o.id,
  tenantId: o.tenant_id || o.tenantid,
  items: o.items || [],
  customer: o.customer || { name: "", phone: "", address: "" },
  total: Number(o.total) || 0,
  date: o.date || new Date().toISOString(),
  status: o.status || "pending",
  observation: o.observation || "",
  receiptFile: o.receipt_file || o.receiptfile || "",
  appliedCoupon: o.applied_coupon || o.appliedCoupon || undefined,
  couponDiscount:
    Number(
      o.coupon_discount ||
        o.coupondiscount ||
        (o.customer as any)?.couponDiscount,
    ) || 0,
});

import localforage from "localforage";

export const getProductsByTenant = async (
  tenantId: string,
  onUpdate?: (products: Product[]) => void,
  forceFetch: boolean = false,
  abortSignal?: AbortSignal,
): Promise<Product[]> => {
  try {
    const cacheKey = `products_${tenantId}`;

    const fetchFromDb = async () => {
      try {
        // CORREÇÃO CRÍTICA: Bypassa o cache de borda (Edge CDN) do Vercel usando um parâmetro de timestamp (?t=...)
        // para garantir que as atualizações de preços de planilhas importadas apareçam imediatamente.
        const response = await fetch(`/api/v1/tenants/${tenantId}/products?t=${Date.now()}`, {
          signal: abortSignal,
        });
        if (!response.ok) throw new Error("API Fetch failed");
        const json = await response.json();
        if (json.data) {
          const mapped = json.data.map(mapDbProductToApp);
          await localforage.setItem(cacheKey, mapped);
          return mapped;
        }
      } catch (err: any) {
        if (err.name === "AbortError") throw err;
        console.warn(
          "Failed to fetch products from edge cache, falling back to direct db query...",
          err,
        );
      }

      let allData: any[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        if (abortSignal?.aborted) throw new Error("AbortError");
        let query = supabase
          .from("products")
          .select("*")
          .eq("tenant_id", tenantId)
          .range(from, from + step - 1);
        if (abortSignal) {
          query = query.abortSignal(abortSignal);
        }
        const { data, error } = await query;
        if (error) {
          if (error.name === "AbortError") throw error;
          throw error;
        }
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < step) break;
        from += step;
      }
      const mapped = allData.map(mapDbProductToApp);
      await localforage.setItem(cacheKey, mapped);
      return mapped;
    };

    if (forceFetch) {
      await localforage.removeItem(cacheKey).catch(() => {});
      return await retryRequest(fetchFromDb);
    }

    let cachedData: Product[] | null = null;
    try {
      cachedData = await localforage.getItem<Product[]>(cacheKey);
    } catch (e) {
      console.warn("Error reading products from IndexedDB, clearing cache", e);
      await localforage.removeItem(cacheKey).catch(() => {});
    }

    if (cachedData && cachedData.length > 0) {
      if (onUpdate) {
        retryRequest(fetchFromDb)
          .then(onUpdate)
          .catch((e) => console.error("Background fetch failed", e));
      } else {
        // CORREÇÃO: Mesmo sem onUpdate, atualiza o cache localforage em segundo plano com dados recentes
        retryRequest(fetchFromDb)
          .catch((e) => console.error("Background cache update failed", e));
      }
      return cachedData;
    }

    // Performance Optimization: TTFB/FCP Fast Path
    // If there is no cache, fetch a small optimized payload from the init endpoint instantly
    try {
      const initResponse = await fetch(`/api/v1/store/${tenantId}/init?t=${Date.now()}`, { signal: abortSignal });
      if (initResponse.ok) {
        const initJson = await initResponse.json();
        if (initJson.products) {
          const initialProducts = initJson.products.map(mapDbProductToApp);
          
          // Fire the heavy fetch in the background to load the remaining 9600+ items
          if (onUpdate) {
            retryRequest(fetchFromDb)
              .then(onUpdate)
              .catch((e) => console.error("Background full-fetch failed", e));
          }
          return initialProducts;
        }
      }
    } catch(err) {
      console.warn("Init fast-path failed, falling back to slow full load.");
    }

    return await retryRequest(fetchFromDb);
  } catch (e: any) {
    if (e.message !== "CONFIG_MISSING") handleNetworkError(e, "Produtos");
    return [];
  }
};

export const getAiEnrichedProductsCache = async (): Promise<
  Partial<Product>[]
> => {
  try {
    return await retryRequest(async () => {
      let allData: any[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        // Fetch only necessary fields for AI enriched products to act as a cache
        const { data, error } = await supabase
          .from("products")
          .select(
            "name, barcode, active_principle, drug_type, category, manufacturer, presentation, description, indications, usage, side_effects, contraindications",
          )
          .eq("is_ai_enriched", true)
          .range(from, from + step - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < step) break;
        from += step;
      }
      return allData.map((p) => ({
        name: p.name,
        barcode: p.barcode,
        activePrinciple: p.active_principle || p.activeprinciple,
        drugType: p.drug_type || p.drugtype,
        category: p.category,
        manufacturer: p.manufacturer,
        presentation: p.presentation,
        description: p.description,
        indications: p.indications,
        usage: p.usage,
        sideEffects: p.side_effects || p.sideeffects,
        contraindications: p.contraindications,
      }));
    });
  } catch (e: any) {
    if (e.message !== "CONFIG_MISSING") handleNetworkError(e, "Cache IA");
    return [];
  }
};

export const getAllProducts = async (): Promise<Product[]> => {
  try {
    return await retryRequest(async () => {
      let allData: any[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .range(from, from + step - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < step) break;
        from += step;
      }
      return allData.map(mapDbProductToApp);
    });
  } catch (e: any) {
    if (e.message !== "CONFIG_MISSING")
      handleNetworkError(e, "Todos os Produtos");
    return [];
  }
};

export const saveProductsByTenant = async (
  tenantId: string,
  products: Product[],
) => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    // Buscar produtos existentes do tenant para mapear IDs corretos por código de barras/código interno
    const { data: currentDbProducts } = await supabase
      .from("products")
      .select("id, barcode, internal_code")
      .eq("tenant_id", tenantId);

    const currentByBarcode = new Map<string, string>();
    const currentByInternalCode = new Map<string, string>();

    if (currentDbProducts) {
      currentDbProducts.forEach((p) => {
        if (p.barcode) {
          currentByBarcode.set(p.barcode.trim().toLowerCase(), p.id);
        }
        if (p.internal_code) {
          currentByInternalCode.set(p.internal_code.trim().toLowerCase(), p.id);
        }
      });
    }

    // Deduplicar produtos para evitar erro "ON CONFLICT DO UPDATE cannot affect row a second time"
    const uniqueProductsMap = new Map<string, Product>();
    products.forEach((p) => uniqueProductsMap.set(p.id, p));
    const uniqueProducts = Array.from(uniqueProductsMap.values());

    const dbProducts = uniqueProducts.map((p) => {
      const barcode = p.barcode ? p.barcode.trim() : null;
      const internalCode = p.internalCode ? p.internalCode.trim() : null;

      let existingId = p.id;
      if (barcode && currentByBarcode.has(barcode.toLowerCase())) {
        existingId = currentByBarcode.get(barcode.toLowerCase())!;
        p.id = existingId; // Atualiza in-place para sincronizar o estado local do React
      }

      return {
        id: existingId,
        tenant_id: tenantId,
        internal_code: internalCode,
        barcode: barcode,
        name: p.name,
        active_principle: p.activePrinciple,
        drug_type: p.drugType,
        price: p.price,
        stock: p.stock,
        category: p.category,
        grouping_slug: p.groupingSlug || "",
        variant_attribute: p.variantAttribute || "",
        manufacturer: p.manufacturer,
        presentation: p.presentation,
        image: p.image,
        description: p.description,
        indications: p.indications,
        usage: p.usage,
        side_effects: p.sideEffects,
        contraindications: p.contraindications,
        is_ai_enriched: p.isAiEnriched,
        promotion_type: p.promotionType,
        original_price: p.originalPrice,
        buy_x: p.buyX,
        pay_y: p.payY,
        discount_qty_threshold: p.discountQtyThreshold,
        discount_qty_percentage: p.discountQtyPercentage,
        video_uri: p.videoUri,
        is_featured: p.isFeatured || false,
        requires_prescription: p.requires_prescription || false,
      };
    });

    // CORREÇÃO: Salvamento em lotes (Chunks) para evitar AbortError / Timeout em grandes cargas
    const CHUNK_SIZE = 50;
    for (let i = 0; i < dbProducts.length; i += CHUNK_SIZE) {
      const chunk = dbProducts.slice(i, i + CHUNK_SIZE);
      
      await retryRequest(async () => {
        const { error } = await supabase
          .from("products")
          .upsert(chunk);
        if (error) throw error;
      });
    }

    // CORREÇÃO CRÍTICA: Limpa o cache localforage do tenant para forçar re-fetch na próxima renderização
    await clearProductsCache(tenantId).catch(() => {});
  } catch (e: any) {
    handleNetworkError(e, "Salvar Produtos");
    throw e;
  }
};

export const clearProductsCache = async (tenantId: string) => {
  try {
    await localforage.removeItem(`products_${tenantId}`);
  } catch (e) {
    console.warn("Failed to clear products cache for tenant", tenantId, e);
  }
};

export const updateProductAiFields = async (products: Product[]) => {
  if (!isSupabaseConfigured()) return;
  try {
    const CONCURRENCY_LIMIT = 10;
    for (let i = 0; i < products.length; i += CONCURRENCY_LIMIT) {
      const batch = products.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.all(
        batch.map((p) =>
          retryRequest(async () => {
            const { error } = await supabase
              .from("products")
              .update({
                active_principle: p.activePrinciple,
                drug_type: p.drugType,
                presentation: p.presentation,
                description: p.description,
                indications: p.indications,
                category: p.category,
                manufacturer: p.manufacturer,
                is_ai_enriched: true,
              })
              .eq("id", p.id);
            if (error) throw error;
          }),
        ),
      );
    }
  } catch (error) {
    console.error("Erro ao atualizar campos de IA:", error);
    throw error;
  }
};

export const migrateControlledProducts = async (
  tenantId: string,
): Promise<number> => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    const products = await getProductsByTenant(tenantId);
    const productsToUpdate = products.filter((p) => {
      if (p.requires_prescription) return false; // Already marked

      const searchStr =
        `${p.name} ${p.description || ""} ${p.category || ""} ${p.indications || ""}`.toLowerCase();
      return (
        searchStr.includes("psicotrópico") ||
        searchStr.includes("controlado") ||
        searchStr.includes("tarja preta") ||
        searchStr.includes("tarja vermelha") ||
        searchStr.includes("receita retida")
      );
    });

    if (productsToUpdate.length === 0) return 0;

    const updatedProducts = productsToUpdate.map((p) => ({
      ...p,
      requires_prescription: true,
    }));
    await saveProductsByTenant(tenantId, updatedProducts);

    return updatedProducts.length;
  } catch (error: any) {
    console.error("Error migrating controlled products:", error);
    throw error;
  }
};

export const deleteProduct = async (productId: string) => {
  if (!isSupabaseConfigured()) return;
  try {
    await retryRequest(async () => {
      const { error, count } = await supabase
        .from("products")
        .delete({ count: "exact" })
        .eq("id", productId);
      if (error) throw error;
      if (count === 0)
        throw new Error(
          "Produto não encontrado no banco de dados ou sem permissão para excluir.",
        );
    });
  } catch (error) {
    const msg = handleNetworkError(error, "Excluir Produto");
    throw new Error(msg);
  }
};

export const deleteProducts = async (productIds: string[]) => {
  if (!isSupabaseConfigured()) return;
  try {
    const CHUNK_SIZE = 50;
    const CONCURRENCY_LIMIT = 5;
    let totalDeleted = 0;

    const chunks = [];
    for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
      chunks.push(productIds.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
      const batch = chunks.slice(i, i + CONCURRENCY_LIMIT);
      const results = await Promise.all(
        batch.map((chunk) =>
          retryRequest(async () => {
            const { error, count } = await supabase
              .from("products")
              .delete({ count: "exact" })
              .in("id", chunk);
            if (error) throw error;
            return count || 0;
          }),
        ),
      );
      totalDeleted += results.reduce((acc, val) => acc + val, 0);
    }

    if (totalDeleted === 0 && productIds.length > 0) {
      console.warn(
        "Nenhum produto foi excluído no banco de dados. Verifique as permissões (RLS) ou se os IDs existem.",
      );
    }
  } catch (error) {
    const msg = handleNetworkError(error, "Exclusão em Massa");
    throw new Error(msg);
  }
};

export const getOrdersByTenant = async (tenantId: string): Promise<Order[]> => {
  try {
    return await retryRequest(async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data || []).map(mapDbOrderToApp);
    });
  } catch (e: any) {
    if (e.message !== "CONFIG_MISSING") handleNetworkError(e, "Pedidos");
    return [];
  }
};

export const saveOrderByTenant = async (tenantId: string, order: Order) => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    const payload = {
      id: order.id,
      tenant_id: tenantId,
      items: order.items,
      customer: {
        ...order.customer,
        couponDiscount: order.couponDiscount, // Store here as fallback for missing column
      },
      total: order.total,
      date: order.date || new Date().toISOString(),
      status: order.status,
      observation: order.observation,
      receipt_file: order.receiptFile,
      applied_coupon: order.appliedCoupon,
    };
    await retryRequest(async () => {
      const { error } = await supabase.from("orders").insert(payload);
      if (error) throw error;
    });
  } catch (e) {
    handleNetworkError(e, "Finalizar Pedido");
    throw e;
  }
};

export const saveOrdersByTenant = async (tenantId: string, orders: Order[]) => {
  if (!isSupabaseConfigured()) return;
  const dbOrders = orders.map((o) => ({
    id: o.id,
    tenant_id: tenantId,
    status: o.status,
    customer: {
      ...o.customer,
      couponDiscount: o.couponDiscount,
    },
    total: o.total,
    items: o.items,
    date: o.date || new Date().toISOString(),
    observation: o.observation,
    receipt_file: o.receiptFile,
    applied_coupon: o.appliedCoupon,
  }));
  try {
    await retryRequest(async () => {
      const { error } = await supabase.from("orders").upsert(dbOrders);
      if (error) throw error;
    });
  } catch (e) {
    handleNetworkError(e, "Salvar Pedidos");
  }
};

export const deleteOrder = async (orderId: string) => {
  if (!isSupabaseConfigured()) return;
  try {
    await retryRequest(async () => {
      const { error } = await supabase
        .from("orders")
        .delete()
        .eq("id", orderId);
      if (error) throw error;
    });
  } catch (e) {
    handleNetworkError(e, "Excluir Pedido");
  }
};

const safeParseJson = (field: any) => {
  if (!field) return {};
  if (typeof field === "string") {
    try {
      return JSON.parse(field);
    } catch (e) {
      console.error("Error parsing JSON field:", e);
      return {};
    }
  }
  return field;
};

export const mapDbPromotionToApp = (p: any): PromotionRule => {
  const fm = safeParseJson(p.filters_metadata || p.filtersmetadata);
  const bundleSlots = p.bundle_slots ?? p.bundleSlots ?? fm?.bundleSlots ?? fm?.bundle_slots ?? fm?.slots;
  
  let slotProductIds: string[] = [];
  if (Array.isArray(bundleSlots)) {
    bundleSlots.forEach((slot: any) => {
      if (Array.isArray(slot)) {
        slot.forEach((x: any) => {
          const id = typeof x === "object" ? String(x?.id || x?.productId || x?.product_id || x?.ean || x?.barcode || "").trim() : String(x || "").trim();
          if (id) slotProductIds.push(id);
        });
      }
    });
  }

  const rawSpecificIds = [
    ...(Array.isArray(p.specific_product_ids) ? p.specific_product_ids : []),
    ...(Array.isArray(p.specificproductids) ? p.specificproductids : []),
    ...(Array.isArray(p.product_ids) ? p.product_ids : []),
    ...(Array.isArray(p.productids) ? p.productids : []),
    ...(Array.isArray(p.combo_products) ? p.combo_products : []),
    ...(Array.isArray(fm?.specificProductIds) ? fm.specificProductIds : []),
    ...(Array.isArray(fm?.product_ids) ? fm.product_ids : []),
    ...(Array.isArray(fm?.productIds) ? fm.productIds : []),
    ...slotProductIds,
  ];

  const mergedSpecificProductIds = Array.from(new Set(rawSpecificIds.map((x) => String(x).trim()).filter(Boolean)));

  return {
    id: p.id,
    tenantId: p.tenant_id || p.tenantid,
    name: p.name || "",
    type: p.type || "BUY_X_PAY_Y",
    targetType: p.target_type || p.targettype || "PRODUCT",
    targetValue: p.target_value || p.targetvalue || "",
    buyX: p.buy_x || p.buyx,
    payY: p.pay_y || p.payy,
    lightningDiscountPercentage:
      p.lightning_discount_percentage || p.lightningdiscountpercentage,
    discountThresholds: p.discount_thresholds || p.discountthresholds || [],
    comboProducts: mergedSpecificProductIds,
    comboDiscountPercentage:
      p.combo_discount_percentage || p.combodiscountpercentage,
    specificProductIds: mergedSpecificProductIds,
    filtersMetadata: {
      ...(fm || {}),
      product_ids: mergedSpecificProductIds,
      specificProductIds: mergedSpecificProductIds,
    },
    bundlePrice: p.bundle_price ?? p.bundlePrice ?? fm?.bundlePrice ?? fm?.bundle_price,
    bundleSlots: bundleSlots,
    highlightInCategoriesBar:
      p.highlight_in_categories_bar ?? fm?.highlightInCategoriesBar,
    highlightColor:
      p.highlight_color ?? fm?.highlightColor,
    highlightIcon:
      p.highlight_icon ?? fm?.highlightIcon,
    scheduleConfig: fm?.scheduleConfig,
    startDate: p.start_date || p.startdate,
    endDate: p.end_date || p.enddate,
    isActive: p.is_active !== false && p.isactive !== false,
    scope: p.scope || "SINGLE_STORE",
  };
};

export const getPromotionsByTenant = async (
  tenantId: string,
  networkId?: string,
): Promise<PromotionRule[]> => {
  try {
    // 1. Tenta buscar do endpoint público otimizado com cache (Init Fast Path)
    const res = await fetch(`/api/v1/store/${tenantId}/init`);
    if (res.ok) {
      const json = await res.json();
      if (json.promotions && Array.isArray(json.promotions)) {
        return json.promotions.map(mapDbPromotionToApp);
      }
    }
  } catch (e) {
    console.warn("FALHA AO BUSCAR PROMOÇÕES PELO ENDPOINT DE INIT, USANDO FALLBACK SUPABASE:", e);
  }

  // Fallback: consulta direta ao Supabase
  if (!isSupabaseConfigured()) return [];
  try {
    return await retryRequest(async () => {
      let query = supabase.from("promotions").select("*");
      if (networkId) {
        query = query.or(`tenant_id.eq."${tenantId}",tenant_id.eq."${networkId}"`);
      } else {
        query = query.eq("tenant_id", tenantId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(mapDbPromotionToApp);
    });
  } catch (e: any) {
    handleNetworkError(e, "Promoções");
    return [];
  }
};

export const savePromotion = async (promotion: PromotionRule) => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    // Extrai todos os IDs de produtos de todos os slots de combo
    const rawSlots = promotion.bundleSlots || (promotion as any).bundle_slots || (promotion.filtersMetadata as any)?.bundleSlots || (promotion.filtersMetadata as any)?.bundle_slots || [];
    let slotProductIds: string[] = [];
    if (Array.isArray(rawSlots)) {
      rawSlots.forEach((slot: any) => {
        if (Array.isArray(slot)) {
          slot.forEach((x: any) => {
            const id = typeof x === "object" ? String(x?.id || x?.productId || x?.product_id || x?.ean || x?.barcode || "").trim() : String(x || "").trim();
            if (id) slotProductIds.push(id);
          });
        }
      });
    }

    const existingSpecIds = Array.isArray(promotion.specificProductIds) ? promotion.specificProductIds : [];
    const existingComboProds = Array.isArray(promotion.comboProducts) ? promotion.comboProducts : [];
    const existingProductIds = Array.isArray((promotion as any).product_ids) ? (promotion as any).product_ids : (Array.isArray((promotion as any).productIds) ? (promotion as any).productIds : []);

    const mergedProductIds = Array.from(
      new Set([
        ...existingSpecIds,
        ...existingComboProds,
        ...existingProductIds,
        ...slotProductIds,
      ].map((x) => String(x).trim()).filter(Boolean))
    );

    const payload: any = {
      id: promotion.id,
      tenant_id: promotion.tenantId,
      name: promotion.name,
      type: promotion.type,
      target_type: promotion.targetType,
      target_value: promotion.targetValue,
      buy_x: promotion.buyX,
      pay_y: promotion.payY,
      lightning_discount_percentage: promotion.lightningDiscountPercentage,
      discount_thresholds: promotion.discountThresholds,
      combo_products: mergedProductIds,
      combo_discount_percentage: promotion.comboDiscountPercentage,
      specific_product_ids: mergedProductIds,
      filters_metadata: {
        ...(promotion.filtersMetadata || {}),
        bundlePrice: promotion.bundlePrice,
        bundleSlots: rawSlots,
        product_ids: mergedProductIds,
        productIds: mergedProductIds,
        specificProductIds: mergedProductIds,
        highlightInCategoriesBar: promotion.highlightInCategoriesBar,
        highlightColor: promotion.highlightColor,
        highlightIcon: promotion.highlightIcon,
        scheduleConfig: promotion.scheduleConfig,
      },
      start_date: promotion.startDate,
      end_date: promotion.endDate,
      is_active: promotion.isActive,
    };
    const support = await checkSchemaSupport();
    if (support.hasNetworkPromotions) {
      payload.scope = promotion.scope || "SINGLE_STORE";
    }
    await retryRequest(async () => {
      const { error } = await supabase.from("promotions").upsert(payload);
      if (error) throw error;
    });
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Salvar Promoção"));
  }
};

export const deletePromotion = async (id: string) => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    await retryRequest(async () => {
      const { error } = await supabase.from("promotions").delete().eq("id", id);
      if (error) throw error;
    });
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Excluir Promoção"));
  }
};

import { CouponRule } from "../types";

const mapCouponFromDB = (c: any): CouponRule => {
  const fm = safeParseJson(c.filters_metadata || c.filtersmetadata);
  return {
    id: c.id,
    tenantId: c.tenant_id || c.tenantid,
    code: c.code,
    discountType: c.discount_type || c.discounttype,
    discountValue: c.discount_value || c.discountvalue,
    couponScope: c.coupon_scope || c.couponscope,
    minPurchaseValue: c.min_purchase_value || c.minpurchasevalue,
    targetType: c.target_type || c.targettype,
    targetValue: c.target_value || c.targetvalue,
    specificProductIds: c.specific_product_ids || c.specificproductids,
    filtersMetadata: fm,
    startDate: c.start_date || c.startdate,
    endDate: c.end_date || c.enddate,
    isActive: c.is_active !== false && c.isactive !== false,
    scope: c.scope || "SINGLE_STORE",
  };
};

export const getCouponsByTenant = async (
  tenantId: string,
  networkId?: string,
): Promise<CouponRule[]> => {
  try {
    // 1. Tenta buscar do endpoint público otimizado com cache (Init Fast Path)
    const res = await fetch(`/api/v1/store/${tenantId}/init`);
    if (res.ok) {
      const json = await res.json();
      if (json.coupons && Array.isArray(json.coupons)) {
        return json.coupons.map(mapCouponFromDB);
      }
    }
  } catch (e) {
    console.warn("FALHA AO BUSCAR CUPONS PELO ENDPOINT DE INIT, USANDO FALLBACK SUPABASE:", e);
  }

  // Fallback: consulta direta ao Supabase
  if (!isSupabaseConfigured()) return [];
  try {
    return await retryRequest(async () => {
      let query = supabase.from("coupons").select("*");
      if (networkId) {
        query = query.or(`tenant_id.eq."${tenantId}",tenant_id.eq."${networkId}"`);
      } else {
        query = query.eq("tenant_id", tenantId);
      }
      const { data, error } = await query;

      if (error) throw error;
      return (data || []).map(mapCouponFromDB);
    });
  } catch (e: any) {
    console.error("Error fetching coupons:", e);
    return [];
  }
};

export const saveCoupon = async (coupon: CouponRule) => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    await retryRequest(async () => {
      const dbCoupon: any = {
        id: coupon.id,
        tenant_id: coupon.tenantId,
        code: coupon.code,
        discount_type: coupon.discountType,
        discount_value: coupon.discountValue,
        coupon_scope: coupon.couponScope,
        min_purchase_value: coupon.minPurchaseValue,
        target_type: coupon.targetType,
        target_value: coupon.targetValue,
        specific_product_ids: coupon.specificProductIds,
        filters_metadata: coupon.filtersMetadata,
        start_date: coupon.startDate,
        end_date: coupon.endDate,
        is_active: coupon.isActive,
      };

      const support = await checkSchemaSupport();
      if (support.hasNetworkCoupons) {
        dbCoupon.scope = coupon.scope || "SINGLE_STORE";
      }

      const { error } = await supabase.from("coupons").upsert(dbCoupon);

      if (error) throw error;
    });
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Salvar Cupom"));
  }
};

export const deleteCoupon = async (id: string) => {
  if (!isSupabaseConfigured()) throw new Error("CONFIG_MISSING");
  try {
    await retryRequest(async () => {
      const { error } = await supabase.from("coupons").delete().eq("id", id);
      if (error) throw error;
    });
  } catch (e: any) {
    throw new Error(handleNetworkError(e, "Excluir Cupom"));
  }
};

export const saveAppReview = async (review: AppReview) => {
  if (!isSupabaseConfigured()) return;
  const payload = {
    tenant_id: review.tenantId,
    rating: review.rating,
    comment: review.comment,
    created_at: review.date || new Date().toISOString(),
  };
  try {
    await retryRequest(async () => {
      const { error } = await supabase.from("app_reviews").insert(payload);
      if (error) throw error;
    });
  } catch (error: any) {
    if (
      error.code === "42501" ||
      error.message?.includes("row-level security")
    ) {
      console.error(
        "ERRO DE PERMISSÃO (RLS): É necessário executar o comando SQL para criar a política de segurança no Supabase. Verifique o topo do arquivo services/storage.ts",
      );
    }
    handleNetworkError(error, "Salvar Avaliação");
  }
};

export const getAppReviews = async (): Promise<AppReview[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from("app_reviews")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      rating: r.rating,
      comment: r.comment,
      date: r.created_at,
    }));
  } catch (e: any) {
    handleNetworkError(e, "Buscar Avaliações");
    return [];
  }
};

export interface ProductSearchFilters {
  tenantId: string;
  categoria?: string | null;
  promocao_id?: string | null;
  cupom_id?: string | null;
  termo_busca?: string;
  promotionsData?: PromotionRule[]; // Needed to map promo to categories/products
  couponsData?: CouponRule[]; // Needed to map coupon to categories/products
}

const PHARMA_SYNONYMS: Record<string, string[]> = {
  absorvente: ['absorvente', 'abs'],
  abs: ['absorvente', 'abs'],
  gotas: ['gotas', 'gts'],
  gts: ['gotas', 'gts'],
  comprimido: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps', 'cpl'],
  comprimidos: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps', 'cpl'],
  cpr: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps', 'cpl'],
  cp: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps', 'cpl'],
  cps: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps', 'cpl'],
  cpl: ['comprimido', 'comprimidos', 'cpr', 'cp', 'cps', 'cpl'],
  paracetamol: ['paracetamol', 'tylenol'],
  tylenol: ['paracetamol', 'tylenol'],
  dipirona: ['dipirona', 'novalgina'],
  novalgina: ['dipirona', 'novalgina'],
  ibuprofeno: ['ibuprofeno', 'alivium'],
  alivium: ['ibuprofeno', 'alivium'],
  xarope: ['xarope', 'xpe'],
  xpe: ['xarope', 'xpe'],
  pomada: ['pomada', 'pmd'],
  pmd: ['pomada', 'pmd'],
  injetavel: ['injetavel', 'inj'],
  inj: ['injetavel', 'inj'],
  solucao: ['solucao', 'sol'],
  sol: ['solucao', 'sol'],
  suspenso: ['suspenso', 'suspensao', 'susp'],
  suspensao: ['suspenso', 'suspensao', 'susp'],
  susp: ['suspenso', 'suspensao', 'susp'],
  creme: ['creme', 'crm'],
  crm: ['creme', 'crm']
};

export const searchProductsByFilters = async (
  filters: ProductSearchFilters,
): Promise<Product[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    let query = supabase
      .from("products")
      .select("*")
      .eq("tenant_id", filters.tenantId);

    if (filters.categoria && filters.categoria !== "Todos") {
      query = query.eq("category", filters.categoria);
    }

    if (filters.promocao_id && filters.promotionsData) {
      const p = filters.promotionsData.find(
        (pr) => pr.id === filters.promocao_id,
      );
      if (p) {
        if (p.targetType === "CATEGORY")
          query = query.eq("category", p.targetValue);
        if (p.targetType === "MANUFACTURER")
          query = query.eq("manufacturer", p.targetValue);
        if (
          p.targetType === "SPECIFIC_SELECTION" &&
          p.specificProductIds?.length
        ) {
          query = query.in("id", p.specificProductIds);
        }
      }
    }

    if (filters.cupom_id && filters.couponsData) {
      const c = filters.couponsData.find((cr) => cr.id === filters.cupom_id);
      if (c) {
        if (c.targetType === "CATEGORY")
          query = query.eq("category", c.targetValue);
        if (c.targetType === "MANUFACTURER")
          query = query.eq("manufacturer", c.targetValue);
        if (
          c.targetType === "SPECIFIC_SELECTION" &&
          c.specificProductIds?.length
        ) {
          query = query.in("id", c.specificProductIds);
        }
      }
    }

    if (filters.termo_busca && filters.termo_busca.trim().length > 0) {
      const termo = filters.termo_busca.trim();
      const palavras = termo.split(/\s+/);

      const temLetraIsolada = palavras.some((p) => p.length === 1);

      if (temLetraIsolada) {
        // Fallback para ILIKE combinando os termos (Trigram/Wildcard approach) para palavras pequenas ("Vitamina C")
        let ilikePatterns: string[] = [""];
        palavras.forEach((p) => {
            const norm = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const syns = PHARMA_SYNONYMS[norm] || [p];
            const newPatterns: string[] = [];
            ilikePatterns.forEach(pattern => {
                syns.forEach(syn => {
                    newPatterns.push(pattern + (pattern ? "%" : "") + syn);
                });
            });
            ilikePatterns = newPatterns;
        });
        const orClauses = ilikePatterns.map(pattern => {
            const finalPattern = `%${pattern}%`;
            return `name.ilike.${finalPattern},description.ilike.${finalPattern}`;
        }).join(",");
        query = query.or(orClauses);
      } else {
        // Busca Otimizada em Full-Text Search
        const tsQueryFormated = palavras.map((p) => {
            const norm = p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const syns = PHARMA_SYNONYMS[norm] || [p];
            if (syns.length > 1) {
               return `(${syns.map(s => `${s}:*`).join(" | ")})`;
            }
            return `${p}:*`;
        }).join(" & ");
        
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated}`,
        );
      }
    }

    const { data, error } = await query.limit(1000);
    if (error) throw error;

    return (data || []).map(mapDbProductToApp);
  } catch (e: any) {
    handleNetworkError(e, "Busca Dinâmica");
    return [];
  }
};

export const getBackupLogs = async (tenantId: string) => {
  if (!tenantId) {
    console.warn("getBackupLogs called with empty tenantId");
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("backuplogs")
      .select("*")
      .eq("tenantid", tenantId)
      .order("createdat", { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []).map((log: any) => ({
      id: log.id,
      tenantId: log.tenantid,
      date: log.createdat,
      fileName: log.filename,
      fileSize: log.filesize,
      status: log.status,
    }));
  } catch (e: any) {
    console.error("Erro ao buscar logs de backup:", e);
    throw e;
  }
};

export const runManualBackup = async (tenantId: string) => {
  if (!tenantId) {
    throw new Error("tenantId is required to run manual backup");
  }
  try {
    // 1. Fetch Data
    const [tenantResult, productsResult, ordersResult, reviewsResult] =
      await Promise.all([
        supabase.from("tenants").select("*").eq("id", tenantId).single(),
        supabase.from("products").select("*").eq("tenant_id", tenantId),
        supabase.from("orders").select("*").eq("tenant_id", tenantId),
        supabase.from("app_reviews").select("*").eq("tenant_id", tenantId),
      ]);

    const tenantData = tenantResult.data;
    const products = productsResult.data || [];
    const orders = ordersResult.data || [];
    const reviews = reviewsResult.data || [];

    const payload = {
      tenant: tenantData,
      products,
      orders,
      reviews,
      timestamp: new Date().toISOString(),
    };

    // 2. Generate JSON Content for Fallback & Storage
    const fileName = `backup_empresa_${tenantId}.json`;
    const jsonContent = JSON.stringify(payload, null, 2);

    // 3. Perform Native UPSERT Backup via RPC (Single State)
    const { error: rpcError } = await supabase.rpc("perform_tenant_backup", {
      target_tenant_id: tenantId,
      payload: payload,
    });

    // 4. Upload to Supabase Storage (Fallback/Legacy)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("backups_empresas")
      .upload(`${tenantId}/ultimo_backup.json`, jsonContent, {
        contentType: "application/json",
        upsert: true,
      });

    // 5. Log Backup
    const { error: insertError } = await supabase.from("backuplogs").insert({
      tenantid: tenantId,
      createdat: new Date().toISOString(),
      filename: fileName,
      filesize: jsonContent.length,
      status: uploadError || rpcError ? "FAILED" : "SUCCESS",
    });

    if (rpcError || uploadError)
      throw new Error(rpcError?.message || uploadError?.message);

    // 5. Update last backup date
    const { data: scheduleData } = await supabase
      .from("backupschedules")
      .select("backupconfig")
      .eq("tenantid", tenantId)
      .single();
    if (scheduleData) {
      const currentConfig = scheduleData.backupconfig || {};
      const newConfig = {
        ...currentConfig,
        lastBackup: new Date().toISOString(),
      };
      await supabase
        .from("backupschedules")
        .update({ backupconfig: newConfig })
        .eq("tenantid", tenantId);
      await supabase
        .from("tenants")
        .update({ backup_config: newConfig })
        .eq("id", tenantId);
    }

    return { success: true, fileName };
  } catch (e: any) {
    console.error("Erro ao executar backup manual:", e);

    // Log failure
    await supabase.from("backuplogs").insert({
      tenantid: tenantId,
      createdat: new Date().toISOString(),
      filename: "FAILED",
      filesize: 0,
      status: "FAILED",
    });

    throw e;
  }
};

export const getBackupConfig = async (tenantId: string) => {
  if (!tenantId) {
    console.warn("getBackupConfig called with empty tenantId");
    return { frequency: "OFF" };
  }
  try {
    const { data, error } = await supabase
      .from("backupschedules")
      .select("backupconfig")
      .eq("tenantid", tenantId)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error(error.message);
    }

    return data?.backupconfig || { frequency: "OFF" };
  } catch (e: any) {
    console.error("Erro ao buscar configuração de backup:", e);
    return { frequency: "OFF" };
  }
};

export const saveBackupConfig = async (tenantId: string, config: any) => {
  if (!tenantId) {
    throw new Error("tenantId is required to save backup config");
  }
  try {
    const { error: scheduleError } = await supabase
      .from("backupschedules")
      .upsert(
        {
          tenantid: tenantId,
          backupconfig: config,
          updatedat: new Date().toISOString(),
        },
        { onConflict: "tenantid" },
      );

    const { error: tenantError } = await supabase
      .from("tenants")
      .update({ backup_config: config })
      .eq("id", tenantId);

    if (scheduleError) throw new Error(scheduleError.message);
    return { success: true };
  } catch (e: any) {
    console.error("Erro ao salvar config de backup:", e);
    throw e;
  }
};

export const exportBackupData = async (
  tenantId: string,
  format: "sql" | "csv",
) => {
  try {
    const [tenantResult, productsResult, ordersResult, reviewsResult] =
      await Promise.all([
        supabase.from("tenants").select("*").eq("id", tenantId).single(),
        supabase.from("products").select("*").eq("tenant_id", tenantId),
        supabase.from("orders").select("*").eq("tenant_id", tenantId),
        supabase.from("app_reviews").select("*").eq("tenant_id", tenantId),
      ]);

    const tenantData = tenantResult.data;
    const products = productsResult.data || [];
    const orders = ordersResult.data || [];
    const reviews = reviewsResult.data || [];

    if (format === "csv") {
      const data = products;
      if (data.length === 0) {
        alert("Nenhum dado encontrado para exportar.");
        return;
      }

      const headers = Object.keys(data[0]);
      const csvRows = [headers.join(",")];

      for (const row of data) {
        const values = headers.map((header) => {
          const val = row[header];
          const escaped = ("" + val).replace(/"/g, '""');
          return `"${escaped}"`;
        });
        csvRows.push(values.join(","));
      }

      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_${tenantId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      let sqlContent = `-- Backup for tenant ${tenantId}\n`;
      const tables = [
        { name: "tenants", data: tenantData ? [tenantData] : [] },
        { name: "products", data: products },
        { name: "orders", data: orders },
        { name: "app_reviews", data: reviews },
      ];

      tables.forEach((table) => {
        if (table.data && table.data.length > 0) {
          sqlContent += `-- Table: ${table.name}\n`;
          table.data.forEach((row: any) => {
            if (!row) return;
            const keys = Object.keys(row).join(", ");
            const values = Object.values(row)
              .map((v) => {
                if (v === null) return "NULL";
                if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
                if (typeof v === "object")
                  return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
                return v;
              })
              .join(", ");
            sqlContent += `INSERT INTO ${table.name} (${keys}) VALUES (${values});\n`;
          });
          sqlContent += "\n";
        }
      });

      const blob = new Blob([sqlContent], { type: "application/sql" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_${tenantId}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    console.error("Erro ao exportar backup:", err);
    alert("Erro ao exportar backup: " + err.message);
  }
};

export const downloadLatestBackupFile = async (tenantId: string) => {
  try {
    const { data: backupRow, error: dbError } = await supabase
      .from("tenant_backups")
      .select("backup_data")
      .eq("tenant_id", tenantId)
      .single();

    if (!dbError && backupRow && backupRow.backup_data) {
      const dataBlob = new Blob(
        [JSON.stringify(backupRow.backup_data, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(dataBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_empresa_${tenantId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }

    let { data, error } = await supabase.storage
      .from("backups_empresas")
      .download(`${tenantId}/ultimo_backup.json`);

    if (error) {
      // Tentar fallback pro antigo .sql
      const { data: sqlData, error: sqlError } = await supabase.storage
        .from("backups_empresas")
        .download(`${tenantId}/ultimo_backup.sql`);

      if (sqlError) {
        throw new Error("Backup não encontrado.");
      }
      data = sqlData;
    }

    const url = URL.createObjectURL(data!);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup_empresa_${tenantId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err: any) {
    console.error("Erro ao baixar backup:", err);
    throw err;
  }
};

export const getIntegrationLogs = async (tenantId: string) => {
  if (!tenantId) {
    console.warn("getIntegrationLogs called with empty tenantId");
    return [];
  }
  try {
    const { data, error } = await supabase
      .from("integration_logs")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      const errMsg = error.message || String(error);
      const errStr = JSON.stringify(error);
      if (
        errMsg.includes("schema cache") ||
        errStr.includes("schema cache") ||
        error.code === "42P01"
      ) {
        return [];
      }
      throw new Error(errMsg);
    }
    return data || [];
  } catch (e: any) {
    console.error("Erro ao buscar logs de integração:", e);
    throw e;
  }
};

export const getPharmacyStats = async (tenantId: string) => {
  try {
    const { data, error } = await supabase
      .from("pharmacy_stats")
      .select("*")
      .eq("tenantid", tenantId)
      .maybeSingle();
      
    if (error) {
      console.warn("Aviso ao buscar estatísticas (ignorado):", error);
      return { averageRating: 0, totalReviews: 0 };
    }
    
    if (!data) return { averageRating: 0, totalReviews: 0 };
    return {
      averageRating: Number(data.averagerating || 0),
      totalReviews: Number(data.totalreviews || 0),
    };
  } catch (e: any) {
    console.error("Erro ao buscar estatísticas:", e.message || e);
    return { averageRating: 0, totalReviews: 0 };
  }
};
