import { supabase, isSupabaseConfigured } from "./supabase.js";
export { isSupabaseConfigured };
import {
  Product,
  Order,
  PharmacyConfig,
  AppReview,
  PromotionRule,
  CouponRule,
  FlashDealsScheduleConfig,
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

  if (errorMsg.includes("<!doctype") || errorMsg.includes("<html") || errorMsg.includes("Unexpected token '<'")) {
    errorMsg = "A resposta do servidor retornou página HTML ao invés de dados JSON.";
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
  hasRegulatoryFields: true,
  checked: false,
};

export const checkSchemaSupport = async () => {
  if (schemaSupport.checked) return schemaSupport;
  
  if (!isSupabaseConfigured()) return schemaSupport;

  try {
    const { error: regError } = await supabase.from("tenants").select("razao_social, farmaceutico_responsavel, crf, horario_funcionamento, telefone_contato").limit(1);
    if (regError && (regError.code === "42703" || regError.message?.includes("does not exist") || regError.message?.includes("razao_social"))) {
      schemaSupport.hasRegulatoryFields = false;
    } else {
      schemaSupport.hasRegulatoryFields = true;
    }
  } catch (e) {
    schemaSupport.hasRegulatoryFields = false;
  }

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
  const fallbackRegulatory = smartBannersObj._regulatoryData || {};
  
  return {
    id: t.id,
    slug: t.slug,
    custom_domain: t.custom_domain || t.customdomain,
    type: "PHARMACY",
    name: t.name || "Drogaria Sem Nome",
    whatsapp: t.whatsapp || "",
    logo: t.logo_url || t.logourl || t.logo || "",
    logo_url: t.logo_url || t.logourl || t.logo || "",
    logoUrl: t.logo_url || t.logourl || t.logo || "",
    primaryColor: t.primary_color || t.primarycolor || "#059669",
    secondaryColor: t.secondary_color || t.secondarycolor || "#047857",
    accentColor: t.accent_color || t.accentcolor || "#10b981",
    admin_email: t.admin_email || t.adminemail || "",
    admin_password: t.admin_password || t.adminpassword || "",
    bannerTitle: t.banner_title || t.bannertitle || "",
    bannerSubtitle: t.banner_subtitle || t.bannersubtitle || "",
    isBlocked: t.is_blocked || t.isblocked === true,
    isChatEnabled: t.is_chat_enabled === true || t.ischatenabled === true,
    customCategories: t.custom_categories || t.customcategories || [],
    departments: t.departments || undefined,
    customManufacturers: t.custom_manufacturers || t.custommanufacturers || [],
    licenseExpiration: t.license_expiration || t.licenseexpiration,
    cnpj: t.cnpj || fallbackRegulatory.cnpj || "",
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
    welcomeMessageEnabled: t.welcome_message_enabled ?? t.welcomemessageenabled ?? false,
    welcomeMessageText: t.welcome_message_text || t.welcomemessagetext || "Olá! Seja muito bem-vindo(a) à nossa farmácia! Como podemos te ajudar hoje?",
    welcomeMessageFormat: t.welcome_message_format || t.welcome_button_format || t.button_type || t.welcomemessageformat || "button",
    welcomeMessageLink: t.welcome_message_link || t.welcomemessagelink || "",
    isAiAgentEnabled: t.is_ai_agent_enabled === true || t.isaiagentenabled === true,
    aiAgentConfig: t.ai_agent_config || t.aiagentconfig || undefined,
    razao_social: t.razao_social || t.razaosocial || fallbackRegulatory.razao_social || "",
    farmaceutico_responsavel: t.farmaceutico_responsavel || t.farmaceuticoresponsavel || fallbackRegulatory.farmaceutico_responsavel || "",
    crf: t.crf || fallbackRegulatory.crf || "",
    horario_funcionamento: t.horario_funcionamento || t.horariofuncionamento || fallbackRegulatory.horario_funcionamento || "",
    telefone_contato: t.telefone_contato || t.telefonecontato || fallbackRegulatory.telefone_contato || "",
    street: t.street || "",
    address_number: t.address_number || t.addressnumber || "",
    complement: t.complement || "",
    neighborhood: t.neighborhood || "",
    city: t.city || "",
    state: t.state || "",
    cep: t.cep || "",
    logradouro: t.street || "",
    numero: t.address_number || t.addressnumber || "",
    complemento: t.complement || "",
    bairro: t.neighborhood || "",
    cidade: t.city || "",
    uf: t.state || "",
    nome_loja: t.name || "",
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
      let fields = "id, slug, custom_domain, name, whatsapp, logo, primary_color, secondary_color, accent_color, banner_title, banner_subtitle, is_blocked, is_chat_enabled, license_expiration, cnpj, full_address, corporate_email, manufacturer_logos, enable_smart_banners, smart_banners, coupon_banner_color, minimum_order_value, admin_email, admin_password, notification_sound, notification_volume, departments, welcome_message_enabled, welcome_message_text, welcome_message_format, welcome_message_link, is_ai_agent_enabled, ai_agent_config";
      if (support.hasNetworkTenants) {
        fields += ", is_network_master, network_id";
      }
      if (support.hasDeliverySettings) {
        fields += ", delivery_settings";
      }
      if (support.hasRegulatoryFields) {
        fields += ", razao_social, farmaceutico_responsavel, crf, horario_funcionamento, telefone_contato";
      }
      fields += ", street, address_number, complement, neighborhood, city, state, cep";

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
    return null;
  } catch (e) {
    console.warn("Failed to resolve tenant by hostname:", e);
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
      logo: tenant.logo_url || tenant.logo || "",
      logo_url: tenant.logo_url || tenant.logo || "",
      primary_color: tenant.primaryColor,
      secondary_color: tenant.secondaryColor,
      accent_color: tenant.accentColor,
      admin_email: tenant.admin_email,
      admin_password: tenant.admin_password,
      banner_title: tenant.bannerTitle || "",
      banner_subtitle: tenant.bannerSubtitle || "",
      is_blocked: tenant.isBlocked || false,
      is_chat_enabled: tenant.isChatEnabled || false,
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
      welcome_message_enabled: tenant.welcomeMessageEnabled ?? false,
      welcome_message_text: tenant.welcomeMessageText || "",
      welcome_message_format: tenant.welcomeMessageFormat || "button",
      welcome_message_link: tenant.welcomeMessageLink || "",
      is_ai_agent_enabled: tenant.isAiAgentEnabled ?? false,
      ai_agent_config: tenant.aiAgentConfig ?? null,
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

    const regData = {
      razao_social: tenant.razao_social || tenant.razaoSocial || "",
      cnpj: tenant.cnpj || "",
      farmaceutico_responsavel: tenant.farmaceutico_responsavel || tenant.farmaceuticoResponsavel || "",
      crf: tenant.crf || "",
      horario_funcionamento: tenant.horario_funcionamento || tenant.horarioFuncionamento || "",
      telefone_contato: tenant.telefone_contato || tenant.phone || "",
    };

    payload.smart_banners = {
      ...(payload.smart_banners || {}),
      _regulatoryData: regData
    };

    if (support.hasRegulatoryFields) {
      payload.razao_social = regData.razao_social;
      payload.farmaceutico_responsavel = regData.farmaceutico_responsavel;
      payload.crf = regData.crf;
      payload.horario_funcionamento = regData.horario_funcionamento;
      payload.telefone_contato = regData.telefone_contato;
    }

    if (tenant.street !== undefined) payload.street = tenant.street || "";
    if (tenant.address_number !== undefined) payload.address_number = tenant.address_number || "";
    if (tenant.complement !== undefined) payload.complement = tenant.complement || "";
    if (tenant.neighborhood !== undefined) payload.neighborhood = tenant.neighborhood || "";
    if (tenant.city !== undefined) payload.city = tenant.city || "";
    if (tenant.state !== undefined) payload.state = tenant.state || "";
    if (tenant.cep !== undefined) payload.cep = tenant.cep || "";

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
      const res = await fetch(`/api/v1/tenants/admin/${encodeURIComponent(id)}`, {
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
  isAiEnriched: p.is_ai_enriched === true || p.isaienriched === true,
  promotionType: p.promotion_type || p.promotiontype || "NONE",
  promo_type: p.promo_type || (
    p.promotion_type === 'BUY_X_PAY_Y' ? 'buy_x_pay_y' :
    p.promotion_type === 'DISCOUNT_ON_QTY' ? 'progressive' :
    p.promotion_type === 'DISCOUNT' ? 'simple' :
    (p.promotional_price && Number(p.promotional_price) > 0 && Number(p.promotional_price) < Number(p.price)) ? 'simple' : 'none'
  ),
  promo_buy_qty: p.promo_buy_qty ?? (Number(p.buy_x || p.discount_qty_threshold) || null),
  promo_pay_qty: p.promo_pay_qty ?? (Number(p.pay_y) || null),
  promo_progressive_price: p.promo_progressive_price ?? (
    p.promotion_type === 'DISCOUNT_ON_QTY' && p.promotional_price ? Number(p.promotional_price) :
    (p.promotion_type === 'DISCOUNT_ON_QTY' && p.discount_qty_percentage && Number(p.price) > 0)
      ? Number((Number(p.price) * (1 - Number(p.discount_qty_percentage) / 100)).toFixed(2))
      : null
  ),
  promo_start_date: p.promo_start_date || p.promo_data_inicio || null,
  promo_end_date: p.promo_end_date || p.promo_data_fim || null,
  originalPrice: Number(p.original_price || p.originalprice) || 0,
  promotionalPrice:
    p.promotional_price !== null && p.promotional_price !== undefined && !isNaN(Number(p.promotional_price)) && Number(p.promotional_price) > 0
      ? Number(p.promotional_price)
      : (p.promotionalPrice !== null && p.promotionalPrice !== undefined && !isNaN(Number(p.promotionalPrice)) && Number(p.promotionalPrice) > 0
        ? Number(p.promotionalPrice)
        : undefined),
  promotional_price:
    p.promotional_price !== null && p.promotional_price !== undefined && !isNaN(Number(p.promotional_price)) && Number(p.promotional_price) > 0
      ? Number(p.promotional_price)
      : null,
  buyX: Number(p.buy_x || p.buyx) || 0,
  payY: Number(p.pay_y || p.payy) || 0,
  discountQtyThreshold: Number(p.discount_qty_threshold || p.discountqtythreshold) || 0,
  discountQtyPercentage:
    Number(p.discount_qty_percentage || p.discountqtypercentage) || 0,
  videoUri: p.video_uri || p.videouri,
  isFeatured: p.is_featured === true || p.isfeatured === true,
  requires_prescription: p.requires_prescription === true || p.requiresprescription === true || p.requires_prescription === 1 || p.requires_prescription === "true",
  is_continuous_use: p.is_continuous_use === true || p.iscontinuoususe === true || p.is_continuous_use === 1 || p.is_continuous_use === "true",
  continuous_use_days: Number(p.continuous_use_days || p.continuoususedays) || undefined,
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
  deliveryMode: o.delivery_mode || o.deliveryMode || "delivery",
  couponDiscount:
    Number(
      o.coupon_discount ||
        o.coupondiscount ||
        (o.customer as any)?.couponDiscount,
    ) || 0,
  prescriptionStatus: o.prescription_status,
});

import localforage from "localforage";

export const deduplicateProducts = (list: Product[]): Product[] => {
  const map = new Map<string, Product>();
  for (const item of list) {
    if (item && item.id) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
};

export const getProductsByTenant = async (
  tenantId: string,
  onUpdate?: (products: Product[]) => void,
  forceFetch: boolean = false,
  abortSignal?: AbortSignal,
  isAdmin: boolean = false,
): Promise<Product[]> => {
  try {
    const cacheKey = `products_${tenantId}${isAdmin ? "_admin" : ""}`;

    const fetchFromDb = async () => {
      try {
        // CORREÇÃO CRÍTICA: Bypassa o cache de borda (Edge CDN) do Vercel usando um parâmetro de timestamp (?t=...)
        // para garantir que as atualizações de preços de planilhas importadas apareçam imediatamente.
        const url = `/api/v1/tenants/${encodeURIComponent(tenantId)}/products${isAdmin ? "?admin=true" : ""}`;
        const response = await fetch(url, {
          signal: abortSignal,
        });
        if (!response.ok) throw new Error("API Fetch failed");
        const json = await response.json();
        if (json.data) {
          const rawMapped = json.data.map(mapDbProductToApp);
          const mapped = deduplicateProducts(!isAdmin ? rawMapped.filter((p: any) => Number(p.price) > 0) : rawMapped);
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
          .select("id, tenant_id, internal_code, barcode, name, active_principle, drug_type, manufacturer, presentation, price, original_price, promotional_price, stock, category, grouping_slug, variant_attribute, image, is_featured, requires_prescription, promotion_type, buy_x, pay_y, discount_qty_threshold, discount_qty_percentage, video_uri, description, indications, usage, side_effects, contraindications, is_ai_enriched")
          .eq("tenant_id", tenantId);

        if (!isAdmin) {
          query = query.gt("price", 0);
        }

        query = query.order("id", { ascending: true }).range(from, from + step - 1);
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
      const mapped = deduplicateProducts(allData.map(mapDbProductToApp));
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
      const uniqueCached = deduplicateProducts(cachedData);
      if (onUpdate) {
        retryRequest(fetchFromDb)
          .then(onUpdate)
          .catch((e) => console.error("Background fetch failed", e));
      } else {
        // CORREÇÃO: Mesmo sem onUpdate, atualiza o cache localforage em segundo plano com dados recentes
        retryRequest(fetchFromDb)
          .catch((e) => console.error("Background cache update failed", e));
      }
      return uniqueCached;
    }

    // Performance Optimization: TTFB/FCP Fast Path APENAS quando há callback onUpdate (renderização progressiva do storefront)
    if (onUpdate) {
      try {
        const initResponse = await fetch(`/api/v1/store/${encodeURIComponent(tenantId)}/init`, { signal: abortSignal });
        if (initResponse.ok) {
          const initJson = await initResponse.json();
          if (initJson.products) {
            const initialProducts = deduplicateProducts(initJson.products.map(mapDbProductToApp));
            
            // Dispara a carga completa em segundo plano para carregar todos os milhares de itens
            retryRequest(fetchFromDb)
              .then(onUpdate)
              .catch((e) => console.error("Background full-fetch failed", e));
            return initialProducts;
          }
        }
      } catch(err) {
        console.warn("Init fast-path failed, falling back to slow full load.");
      }
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
    const uniqueProductsMap = new Map<string, Product>();
    products.forEach((p) => uniqueProductsMap.set(p.id, p));
    const uniqueProducts = Array.from(uniqueProductsMap.values());

    const currentByBarcode = new Map<string, string>();

    // Otimização: Apenas consulta o banco se houver produtos sem ID ou novos
    const barcodesToCheck = uniqueProducts
      .map((p) => p.barcode?.trim())
      .filter((b): b is string => Boolean(b && b.length > 0));

    if (barcodesToCheck.length > 0 && barcodesToCheck.length <= 100) {
      const { data: matchedDb } = await supabase
        .from("products")
        .select("id, barcode")
        .eq("tenant_id", tenantId)
        .in("barcode", barcodesToCheck);

      if (matchedDb) {
        matchedDb.forEach((p) => {
          if (p.barcode) currentByBarcode.set(p.barcode.trim().toLowerCase(), p.id);
        });
      }
    }

    const dbProducts = uniqueProducts.map((p) => {
      const barcode = p.barcode ? p.barcode.trim() : null;
      const internalCode = p.internalCode ? p.internalCode.trim() : null;

      let existingId = p.id;
      if (barcode && currentByBarcode.has(barcode.toLowerCase())) {
        existingId = currentByBarcode.get(barcode.toLowerCase())!;
        p.id = existingId;
      }

      // Conversão e tratamento estrito de promotional_price:
      // Se vazio, zero ou inválido, envia null; caso contrário o float tratado
      const rawPromo = (p as any).promotional_price !== undefined && (p as any).promotional_price !== null
        ? (p as any).promotional_price
        : p.promotionalPrice;
      const numPromo = rawPromo !== '' && rawPromo !== null && rawPromo !== undefined ? Number(rawPromo) : NaN;
      const validPromotionalPrice = !isNaN(numPromo) && numPromo > 0 ? numPromo : null;

      return {
        id: existingId,
        tenant_id: tenantId,
        internal_code: internalCode,
        barcode: barcode,
        name: p.name,
        active_principle: p.activePrinciple || "",
        drug_type: p.drugType || "",
        price: Number(p.price) || 0,
        original_price: Number(p.originalPrice) || 0,
        promotional_price: validPromotionalPrice,
        stock: Number(p.stock) || 0,
        category: p.category || "Geral",
        grouping_slug: p.groupingSlug || "",
        variant_attribute: p.variantAttribute || "",
        manufacturer: p.manufacturer || "Outros",
        presentation: p.presentation || "",
        image: p.image || null,
        description: p.description || "",
        indications: p.indications || "",
        usage: p.usage || "",
        side_effects: p.sideEffects || "",
        contraindications: p.contraindications || "",
        is_featured: p.isFeatured === true,
        requires_prescription: Boolean(p.requires_prescription || (p as any).requiresprescription),
        promotion_type: p.promotionType || "NONE",
        buy_x: Number(p.buyX) || 0,
        pay_y: Number(p.payY) || 0,
        discount_qty_threshold: Number(p.discountQtyThreshold) || 0,
        discount_qty_percentage: Number(p.discountQtyPercentage) || 0,
        video_uri: p.videoUri || null,
        is_ai_enriched: Boolean(p.isAiEnriched)
      };
    });

    // Use the backend API to bypass RLS issues for product updates in safe chunks
    const BATCH_SIZE = 250;
    for (let i = 0; i < dbProducts.length; i += BATCH_SIZE) {
      const batch = dbProducts.slice(i, i + BATCH_SIZE);
      await retryRequest(async () => {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch(`/api/v1/tenants/${tenantId}/products/bulk`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ products: batch }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao salvar produtos no servidor.");
        }
      });
    }

    // Sincronização e Invalidação Imediata do Cache IndexedDB / Localforage
    try {
      const cacheKey = `products_${tenantId}`;
      const cached = await localforage.getItem<Product[]>(cacheKey);
      if (cached && Array.isArray(cached)) {
        const updatedCache = [...cached];
        uniqueProducts.forEach((item) => {
          const idx = updatedCache.findIndex((p) => p.id === item.id);
          if (idx > -1) {
            updatedCache[idx] = { ...updatedCache[idx], ...item };
          } else {
            updatedCache.push(item);
          }
        });
        await localforage.setItem(cacheKey, updatedCache);
      } else {
        await clearProductsCache(tenantId);
      }
    } catch (cacheErr) {
      console.warn("Aviso ao atualizar cache local:", cacheErr);
      await clearProductsCache(tenantId);
    }
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
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/orders`);
    if (res.ok) {
      const json = await res.json();
      return (json || []).map(mapDbOrderToApp);
    }
  } catch (apiError) {
    console.warn("API fallback failed for orders:", apiError);
  }

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
      delivery_mode: order.deliveryMode || "delivery",
    };

    await retryRequest(async () => {
      const { error } = await supabase.from("orders").insert(payload);
      if (error) throw error;
      
      // Call new deduct-stock endpoint
      try {
        await fetch("/api/checkout/deduct-stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId, items: order.items })
        });
      } catch (e) {
        console.error("Erro ao notificar baixa de estoque", e);
      }
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
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/orders`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dbOrders),
    });
    if (res.ok) return;
  } catch (apiError) {
    console.warn("API fallback failed for saveOrdersByTenant:", apiError);
  }
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
    const res = await fetch(`/api/v1/orders/admin/${encodeURIComponent(orderId)}`, {
      method: "DELETE",
    });
    if (res.ok) return;
  } catch (apiError) {
    console.warn("API fallback failed for deleteOrder:", apiError);
  }
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

export const mapDbPromotionToApp = (p: any): PromotionRule => {
  let safeScheduleConfig: FlashDealsScheduleConfig | undefined = undefined;
  const rawSchedule = (p.filters_metadata || p.filtersmetadata)?.scheduleConfig;
  if (rawSchedule) {
    if (typeof rawSchedule === "string") {
      try {
        const parsed = JSON.parse(rawSchedule);
        if (parsed && typeof parsed === "object") {
          safeScheduleConfig = {
            frequency: parsed.frequency || "DAILY",
            startTime: typeof parsed.startTime === "string" ? parsed.startTime : "00:00",
            endTime: typeof parsed.endTime === "string" ? parsed.endTime : "23:59",
            daysOfWeek: Array.isArray(parsed.daysOfWeek) ? parsed.daysOfWeek : undefined,
            daysOfMonth: Array.isArray(parsed.daysOfMonth) ? parsed.daysOfMonth : undefined,
          };
        }
      } catch {
        safeScheduleConfig = undefined;
      }
    } else if (typeof rawSchedule === "object") {
      safeScheduleConfig = {
        frequency: rawSchedule.frequency || "DAILY",
        startTime: typeof rawSchedule.startTime === "string" ? rawSchedule.startTime : "00:00",
        endTime: typeof rawSchedule.endTime === "string" ? rawSchedule.endTime : "23:59",
        daysOfWeek: Array.isArray(rawSchedule.daysOfWeek) ? rawSchedule.daysOfWeek : undefined,
        daysOfMonth: Array.isArray(rawSchedule.daysOfMonth) ? rawSchedule.daysOfMonth : undefined,
      };
    }
  }

  return {
    id: p.id,
    tenantId: p.tenant_id || p.tenantid,
    name: p.name || "",
    type: p.type || "BUY_X_PAY_Y",
    targetType: p.target_type || p.targettype || "PRODUCT",
    targetValue: p.target_value || p.targetvalue || "",
    buyX: p.buy_x ?? p.buyx ?? (p.filters_metadata || p.filtersmetadata)?.buyX ?? (p.type === "BUY_X_PAY_Y" ? 3 : undefined),
    payY: p.pay_y ?? p.payy ?? (p.filters_metadata || p.filtersmetadata)?.payY ?? (p.type === "BUY_X_PAY_Y" ? 2 : undefined),
    lightningDiscountPercentage:
      p.lightning_discount_percentage || p.lightningdiscountpercentage,
    discountThresholds: p.discount_thresholds || p.discountthresholds || [],
    comboProducts:
      p.combo_products ||
      p.comboproducts ||
      (p.filters_metadata || p.filtersmetadata)?.comboProducts ||
      p.specific_product_ids ||
      p.specificproductids ||
      [],
    comboPrice:
      p.bundle_price ??
      p.combo_price ??
      (p.filters_metadata || p.filtersmetadata)?.comboPrice ??
      (p.type === "VARIABLE_COMBO" || p.type === "COMBO_VARIABLE" ? (p.pay_y ?? p.payy) : undefined),
    bundle_price:
      p.bundle_price ??
      p.combo_price ??
      (p.filters_metadata || p.filtersmetadata)?.comboPrice,
    comboDiscountPercentage:
      p.combo_discount_percentage || p.combodiscountpercentage,
    specificProductIds:
      p.specific_product_ids ||
      p.specificproductids ||
      p.combo_products ||
      p.comboproducts ||
      [],
    filtersMetadata: p.filters_metadata || p.filtersmetadata,
    highlightInCategoriesBar:
      p.highlight_in_categories_bar ??
      (p.filters_metadata || p.filtersmetadata)?.highlightInCategoriesBar,
    highlightColor:
      p.highlight_color ??
      (p.filters_metadata || p.filtersmetadata)?.highlightColor,
    highlightIcon:
      p.highlight_icon ??
      (p.filters_metadata || p.filtersmetadata)?.highlightIcon,
    show_banner_card:
      p.show_banner_card ??
      (p.filters_metadata || p.filtersmetadata)?.show_banner_card ??
      (p.filters_metadata || p.filtersmetadata)?.showBannerCard,
    banner_headline:
      p.banner_headline ??
      p.bannerheadline ??
      (p.filters_metadata || p.filtersmetadata)?.banner_headline ??
      (p.filters_metadata || p.filtersmetadata)?.bannerHeadline,
    scheduleConfig: safeScheduleConfig,
    startDate: p.start_date || p.startdate,
    endDate: p.end_date || p.enddate,
    isActive: p.is_active !== false && p.isactive !== false,
    scope: p.scope || "SINGLE_STORE",
  };
};


export const getAuthHeaders = async (tenantId: string) => {
  let token = '';

  // 1. Try Supabase Auth native session
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) {
      token = data.session.access_token;
    }
  } catch (e) {}

  // 2. If no token or expired, try session refresh
  if (!token) {
    try {
      const { data } = await supabase.auth.refreshSession();
      if (data?.session?.access_token) {
        token = data.session.access_token;
      }
    } catch (e) {}
  }

  // 3. Fallback: ff_session from localStorage
  if (!token && typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem('ff_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        token = parsed.access_token || parsed.token || '';
      }
    } catch (e) {}
  }

  // 4. Fallback: ff_user from localStorage
  if (!token && typeof window !== 'undefined') {
    try {
      const ffUser = window.localStorage.getItem('ff_user');
      if (ffUser) {
        const parsed = JSON.parse(ffUser);
        token = parsed.access_token || parsed.token || '';
      }
    } catch (e) {}
  }

  // 5. Fallback: check any sb-*-auth-token or supabase.auth.token in localStorage
  if (!token && typeof window !== 'undefined') {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && ((key.startsWith('sb-') && key.endsWith('-auth-token')) || key === 'supabase.auth.token')) {
          const raw = window.localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            token = parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token) || '';
            if (token) break;
          }
        }
      }
    } catch (e) {}
  }

  return {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
};

export const getPromotionsByTenant = async (
  tenantId: string,
  networkId?: string,
): Promise<PromotionRule[]> => {
  if (!tenantId || tenantId === 'undefined' || tenantId === 'null' || !tenantId.trim()) {
    return [];
  }

  const cacheKey = `promotions_${tenantId}`;
  const validNetworkId = (networkId && networkId !== 'undefined' && networkId !== 'null' && networkId !== tenantId) 
    ? networkId 
    : undefined;

  // 1. Tenta buscar via endpoint de API dedicado
  try {
    const query = validNetworkId ? `?networkId=${encodeURIComponent(validNetworkId)}` : '';
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/promos${query}`);
    
    if (res.ok) {
      const text = await res.text();
      if (!text.trim().startsWith('<')) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            const mapped = data.map(mapDbPromotionToApp);
            await localforage.setItem(cacheKey, mapped).catch(() => {});
            return mapped;
          }
        } catch (_) {}
      }
    }
  } catch (apiError: any) {
    console.warn("[getPromotionsByTenant] API fetch não disponível, tentando fallback direto no banco:", apiError?.message || apiError);
  }

  // 2. Fallback direto no Supabase Client
  try {
    return await retryRequest(async () => {
      let sbQuery = supabase.from("promotions").select("*");
      if (validNetworkId) {
        sbQuery = sbQuery.or(`tenant_id.eq.${tenantId},tenant_id.eq.${validNetworkId}`);
      } else {
        sbQuery = sbQuery.eq("tenant_id", tenantId);
      }
      const { data, error } = await sbQuery;
      if (error) throw error;
      const mapped = (data || []).map(mapDbPromotionToApp);
      await localforage.setItem(cacheKey, mapped).catch(() => {});
      return mapped;
    });
  } catch (dbError: any) {
    if (dbError.message !== "CONFIG_MISSING") {
      console.warn("[getPromotionsByTenant] Fallback do banco falhou, tentando cache offline:", dbError?.message || dbError);
    }
  }

  // 3. Fallback para cache local (offline)
  try {
    const cached = await localforage.getItem<PromotionRule[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return cached;
    }
  } catch (cacheErr) {
    console.error("Erro ao ler promoções do cache local:", cacheErr);
  }

  return [];
};

export const savePromotion = async (promotion: PromotionRule) => {
  const isVarCombo = promotion.type === "VARIABLE_COMBO" || (promotion.type as string) === "COMBO_VARIABLE";
  const comboProds = promotion.comboProducts || promotion.specificProductIds || [];
  const comboPriceVal = promotion.comboPrice !== undefined && promotion.comboPrice !== null ? Number(promotion.comboPrice) : (promotion.bundle_price !== undefined ? Number(promotion.bundle_price) : undefined);

  const buyXVal = promotion.buyX !== undefined && promotion.buyX !== null
    ? Number(promotion.buyX)
    : (promotion.type === "BUY_X_PAY_Y" ? 3 : (isVarCombo ? (comboProds.length || 2) : null));

  const payYVal = promotion.payY !== undefined && promotion.payY !== null
    ? Number(promotion.payY)
    : (promotion.type === "BUY_X_PAY_Y" ? 2 : (isVarCombo ? comboPriceVal : null));

  const payload: any = {
    id: promotion.id,
    tenant_id: promotion.tenantId,
    name: promotion.name,
    type: promotion.type,
    target_type: promotion.targetType,
    target_value: promotion.targetValue,
    buy_x: buyXVal,
    pay_y: payYVal,
    bundle_price: comboPriceVal ?? (isVarCombo ? payYVal : null),
    lightning_discount_percentage: promotion.lightningDiscountPercentage,
    discount_thresholds: promotion.discountThresholds,
    combo_products: comboProds,
    combo_discount_percentage: promotion.comboDiscountPercentage,
    specific_product_ids: promotion.specificProductIds || comboProds,
    filters_metadata: {
      ...(promotion.filtersMetadata || {}),
      buyX: buyXVal,
      payY: payYVal,
      comboProducts: comboProds,
      comboPrice: comboPriceVal ?? (isVarCombo ? payYVal : null),
      highlightInCategoriesBar: promotion.highlightInCategoriesBar,
      highlightColor: promotion.highlightColor,
      highlightIcon: promotion.highlightIcon,
      scheduleConfig: promotion.scheduleConfig,
      show_banner_card: promotion.show_banner_card,
      banner_headline: promotion.banner_headline,
    },
    show_banner_card: promotion.show_banner_card,
    banner_headline: promotion.banner_headline,
    start_date: promotion.startDate,
    end_date: promotion.endDate,
    is_active: promotion.isActive,
    scope: promotion.scope || "SINGLE_STORE",
  };

  try {
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(promotion.tenantId)}/promos`, {
      method: 'POST',
      headers: await getAuthHeaders(promotion.tenantId),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      // Direct Supabase fallback
      const { error: sbErr } = await supabase.from('promotions').upsert(payload);
      if (sbErr) {
        let errMessage = 'Falha ao salvar promoção';
        try {
          const errData = await res.json();
          errMessage = errData.error || errData.message || JSON.stringify(errData);
        } catch {
          errMessage = await res.text();
        }
        throw new Error(errMessage || sbErr.message);
      }
    }
  } catch (e: any) {
    // Attempt final direct Supabase fallback before failing
    try {
      const { error: sbErr } = await supabase.from('promotions').upsert(payload);
      if (sbErr) throw sbErr;
    } catch (finalErr: any) {
      throw new Error(handleNetworkError(finalErr || e, "Salvar Promoção"));
    }
  }
};

export const deletePromotion = async (id: string, tenantId: string) => {
  if (!id) {
    throw new Error("ID da promoção é obrigatório para exclusão.");
  }

  try {
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/promos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: await getAuthHeaders(tenantId)
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({ success: true }));
      return { success: true, id, ...data };
    }

    // Direct Supabase fallback by id
    const { error: sbErr } = await supabase.from('promotions').delete().eq('id', id);
    if (sbErr) {
      let errMessage = 'Falha ao excluir promoção';
      try {
        const errData = await res.json();
        errMessage = errData.error || errData.message || JSON.stringify(errData);
      } catch {
        errMessage = await res.text();
      }
      throw new Error(errMessage || sbErr.message);
    }
    return { success: true, id };
  } catch (e: any) {
    try {
      const { error: sbErr } = await supabase.from('promotions').delete().eq('id', id);
      if (sbErr) throw sbErr;
      return { success: true, id };
    } catch (finalErr: any) {
      throw new Error(handleNetworkError(finalErr || e, "Excluir Promoção"));
    }
  }
};

export const mapCouponFromDB = (c: any): CouponRule => ({
  id: c.id,
  tenantId: c.tenant_id || c.tenantid,
  code: c.code || "",
  discountType: c.discount_type || c.discounttype || "PERCENTAGE",
  discountValue: Number(c.discount_value ?? c.discountvalue ?? 0),
  couponScope: c.coupon_scope || c.couponscope || "GLOBAL",
  minPurchaseValue: Number(c.min_purchase_value ?? c.minpurchasevalue ?? 0),
  targetType: c.target_type || c.targettype || "ALL",
  targetValue: c.target_value || c.targetvalue || "",
  specificProductIds: c.specific_product_ids || c.specificproductids || c.applicable_products || [],
  applicableProducts: c.specific_product_ids || c.specificproductids || c.applicable_products || [],
  filtersMetadata: c.filters_metadata || c.filtersmetadata || null,
  maxUses: c.max_uses ?? c.maxuses,
  currentUses: c.current_uses ?? c.currentuses,
  startDate: c.start_date || c.startdate,
  endDate: c.end_date || c.enddate,
  isActive: c.is_active !== false && c.isactive !== false,
  scope: c.scope || "SINGLE_STORE",
});

export const getCouponsByTenant = async (
  tenantId: string,
  networkId?: string,
): Promise<CouponRule[]> => {
  if (!tenantId || tenantId === 'undefined' || tenantId === 'null') {
    return [];
  }
  const cacheKey = `coupons_${tenantId}`;
  const validNetworkId = (networkId && networkId !== 'undefined' && networkId !== 'null') ? networkId : undefined;
  // 1. Tenta buscar via endpoint de API dedicado
  try {
    const query = validNetworkId ? `?networkId=${encodeURIComponent(validNetworkId)}` : '';
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/vouchers${query}`);
    if (res.ok) {
      const text = await res.text();
      if (!text.trim().startsWith('<')) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            const mapped = data.map(mapCouponFromDB);
            await localforage.setItem(cacheKey, mapped).catch(() => {});
            return mapped;
          }
        } catch (_) {}
      }
    }
  } catch (apiError: any) {
    console.warn("[getCouponsByTenant] API fetch não disponível, tentando fallback direto no banco:", apiError?.message || apiError);
  }

  // 2. Fallback direto no Supabase Client
  try {
    return await retryRequest(async () => {
      let sbQuery = supabase.from("coupons").select("*");
      if (validNetworkId) {
        sbQuery = sbQuery.or(`tenant_id.eq.${tenantId},tenant_id.eq.${validNetworkId}`);
      } else {
        sbQuery = sbQuery.eq("tenant_id", tenantId);
      }
      const { data, error } = await sbQuery;
      if (error) throw error;
      const mapped = (data || []).map(mapCouponFromDB);
      await localforage.setItem(cacheKey, mapped).catch(() => {});
      return mapped;
    });
  } catch (dbError: any) {
    if (dbError.message !== "CONFIG_MISSING") {
      console.warn("[getCouponsByTenant] Fallback do banco falhou, tentando cache offline:", dbError?.message || dbError);
    }
  }

  // 3. Fallback para cache local (offline)
  try {
    const cached = await localforage.getItem<CouponRule[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return cached;
    }
  } catch (cacheErr) {
    console.error("Error reading cached coupons:", cacheErr);
  }

  return [];
};

export const saveCoupon = async (coupon: CouponRule) => {
  const specificIds = coupon.specificProductIds || coupon.applicableProducts || [];
  const dbCoupon: any = {
    id: coupon.id,
    tenant_id: coupon.tenantId,
    code: coupon.code,
    discount_type: coupon.discountType,
    discount_value: coupon.discountValue,
    target_type: coupon.targetType || "ALL",
    target_value: coupon.targetValue || null,
    specific_product_ids: specificIds,
    filters_metadata: coupon.filtersMetadata || null,
    coupon_scope: coupon.couponScope || "SPECIFIC_PRODUCT",
    min_purchase_value: coupon.minPurchaseValue || 0,
    start_date: coupon.startDate,
    end_date: coupon.endDate,
    is_active: coupon.isActive !== false,
    scope: coupon.scope || "SINGLE_STORE",
  };

  try {
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(coupon.tenantId)}/vouchers`, {
      method: 'POST',
      headers: await getAuthHeaders(coupon.tenantId),
      body: JSON.stringify(dbCoupon)
    });
    if (!res.ok) {
      const { error: sbErr } = await supabase.from('coupons').upsert(dbCoupon);
      if (sbErr) {
        let errMessage = 'Falha ao salvar cupom';
        try {
          const errData = await res.json();
          errMessage = errData.error || errData.message || JSON.stringify(errData);
        } catch {
          errMessage = await res.text();
        }
        throw new Error(errMessage || sbErr.message);
      }
    }
  } catch (e: any) {
    try {
      const { error: sbErr } = await supabase.from('coupons').upsert(dbCoupon);
      if (sbErr) throw sbErr;
    } catch (finalErr: any) {
      throw new Error(handleNetworkError(finalErr || e, "Salvar Cupom"));
    }
  }
};

export const deleteCoupon = async (id: string, tenantId: string) => {
  try {
    const res = await fetch(`/api/v1/tenants/${encodeURIComponent(tenantId)}/vouchers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: await getAuthHeaders(tenantId)
    });
    if (!res.ok) {
      const { error: sbErr } = await supabase.from('coupons').delete().eq('id', id).eq('tenant_id', tenantId);
      if (sbErr) {
        let errMessage = 'Falha ao excluir cupom';
        try {
          const errData = await res.json();
          errMessage = errData.error || errData.message || JSON.stringify(errData);
        } catch {
          errMessage = await res.text();
        }
        throw new Error(errMessage || sbErr.message);
      }
    }
  } catch (e: any) {
    try {
      const { error: sbErr } = await supabase.from('coupons').delete().eq('id', id).eq('tenant_id', tenantId);
      if (sbErr) throw sbErr;
    } catch (finalErr: any) {
      throw new Error(handleNetworkError(finalErr || e, "Excluir Cupom"));
    }
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
      const termoNorm = termo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const isDiaSeguinte = 
        termoNorm.includes("pilula do dia seguinte") || 
        termoNorm.includes("pilula dia seguinte") || 
        termoNorm.includes("dia seguinte") ||
        termoNorm.includes("anticoncepcional de emergencia") ||
        termoNorm.includes("anticoncepcional do dia seguinte");

      const isEstomago = 
        termoNorm.includes("estomago") || 
        termoNorm.includes("estômago") || 
        termoNorm.includes("gastrico") || 
        termoNorm.includes("gástrico") || 
        termoNorm.includes("protetor gastrico") || 
        termoNorm.includes("protetor gástrico") || 
        termoNorm.includes("digestao") || 
        termoNorm.includes("digestão") || 
        termoNorm.includes("azia") || 
        termoNorm.includes("digestivo") || 
        termoNorm.includes("digestivos") ||
        termoNorm.includes("antiacido") ||
        termoNorm.includes("antiácido");

      if (isDiaSeguinte) {
        const emergencyKeywords = ["dia d", "diad", "dia-d", "pozato", "neodia", "pilem", "levonorgestrel", "postinor", "evenose", "emergencia"];
        const tsQueryFormated = emergencyKeywords.map(s => `${s}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated}`
        );
      } else if (isEstomago) {
        const gastricoKeywords = ["omeprazol", "pantoprazol", "esomeprazol", "lansoprazol", "rabeprazol", "dexlansoprazol", "peprazol", "pantocal", "gastrium", "estomago", "gastrico", "digestivo", "digestao", "azia", "antiacido", "eno", "estomazil", "luftal", "simeticona", "ranitidina", "antidin", "pepto", "domperidona", "metoclopramida", "plasil", "digesan", "gastro"];
        const tsQueryFormated = gastricoKeywords.map(s => `${s}:*`).join(" | ");
        query = query.or(
          `name.fts.${tsQueryFormated},description.fts.${tsQueryFormated}`
        );
      } else {
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
    // Helper para buscar todos os registros com paginação contínua
    const fetchAllPaginated = async (tableName: string, sortCol: string = "id") => {
      let results: any[] = [];
      let from = 0;
      const step = 1000;
      while (true) {
        const { data, error } = await supabase
          .from(tableName)
          .select("*")
          .eq("tenant_id", tenantId)
          .order(sortCol, { ascending: true })
          .range(from, from + step - 1);
        if (error) {
          // Se falhar no order, tenta sem order
          const fallback = await supabase
            .from(tableName)
            .select("*")
            .eq("tenant_id", tenantId)
            .range(from, from + step - 1);
          if (fallback.error) break;
          if (!fallback.data || fallback.data.length === 0) break;
          results = results.concat(fallback.data);
          if (fallback.data.length < step) break;
        } else {
          if (!data || data.length === 0) break;
          results = results.concat(data);
          if (data.length < step) break;
        }
        from += step;
      }
      return results;
    };

    const [tenantResult, products, orders, reviews] =
      await Promise.all([
        supabase.from("tenants").select("*").eq("id", tenantId).single(),
        fetchAllPaginated("products", "id"),
        fetchAllPaginated("orders", "id"),
        fetchAllPaginated("app_reviews", "id"),
      ]);

    const tenantData = tenantResult.data;

    if (format === "csv") {
      const data = products;
      if (data.length === 0) {
        alert("Nenhum dado encontrado para exportar.");
        return;
      }

      const enrichedData = data.map((p: any) => {
        const promo = p.promotional_price !== undefined && p.promotional_price !== null
          ? p.promotional_price
          : (p.promotionalPrice !== undefined && p.promotionalPrice !== null ? p.promotionalPrice : '');
        return {
          ...p,
          promotional_price: promo,
          PRECO_PROMOCIONAL: promo,
          PROMOTIONAL_PRICE: promo
        };
      });

      const headers = Object.keys(enrichedData[0]);
      const csvRows = [headers.join(",")];

      for (const row of enrichedData) {
        const values = headers.map((header) => {
          const val = row[header] !== undefined && row[header] !== null ? row[header] : "";
          const escaped = ("" + val).replace(/"/g, '""');
          return `"${escaped}"`;
        });
        csvRows.push(values.join(","));
      }

      const csvContent = "\uFEFF" + csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
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

export const exportProductsSpreadsheet = async (
  tenantId: string,
  tenantName: string = "farmacia",
  format: "xlsx" | "csv" = "xlsx"
) => {
  const endpoint = `/api/v1/tenants/${encodeURIComponent(tenantId)}/products/export?format=${format}`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Erro ao exportar produtos: ${response.statusText}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `produtos_${tenantName.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

export const testAiAgent = async (
  tenantId: string,
  message: string,
  history: Array<{ role: 'user' | 'model' | 'assistant'; content: string }> = [],
  configOverride?: any
): Promise<{ reply: string; provider: string; model: string; storeLinkUsed: string }> => {
  const response = await fetch("/api/v1/ai/agent/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId,
      message,
      history,
      configOverride,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Falha ao testar Agente de IA.");
  }
  return data;
};

export const deleteTeamMember = async (userId: string, tenantId?: string): Promise<{ success: boolean }> => {
  try {
    let token = '';
    const saved = typeof window !== 'undefined' ? localStorage.getItem('ff_session') : null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        token = parsed.access_token;
      } catch (e) {}
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };

    const res = await fetch(`/api/v1/team/users/${userId}${tenantId ? `?tenantId=${tenantId}` : ''}`, {
      method: 'DELETE',
      headers
    });

    if (res.ok) {
      return { success: true };
    }

    const errorData = await res.json().catch(() => null);
    console.warn("[deleteTeamMember] API retornou status não-ok:", res.status, errorData);
  } catch (apiErr) {
    console.warn("[deleteTeamMember] Erro na requisição de API, tentando fallback direto no Supabase:", apiErr);
  }

  // Fallback direto no Supabase caso a API não esteja acessível
  try {
    let query = supabase.from('tenant_users').delete().eq('id', userId);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { error } = await query;
    if (error) {
      // Tenta fallback na tabela profiles se existir
      const { error: profileErr } = await supabase.from('profiles').delete().eq('id', userId);
      if (profileErr) {
        throw new Error(error.message || profileErr.message || "Erro ao excluir membro da equipe no banco de dados.");
      }
    }
    return { success: true };
  } catch (sbErr: any) {
    console.error("[deleteTeamMember] Falha no Supabase fallback:", sbErr);
    throw new Error(sbErr.message || "Erro ao excluir membro da equipe no Supabase.");
  }
};


