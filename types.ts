export interface Product {
  id: string;
  tenantId: string;
  internalCode: string;
  barcode?: string;
  name: string;
  activePrinciple?: string;
  drugType?: string; // Ex: 'Genérico', 'Referência', 'Similar'
  manufacturer?: string;
  presentation?: string;
  price: number;
  originalPrice?: number;
  promotionalPrice?: number;
  promotional_price?: number | null;
  stock: number;
  category: string; // Estritamente Classe Terapêutica (Ex: 'Antibiótico')
  groupingSlug?: string; // Slug para agrupar variações (ex: fralda-huggies-supreme)
  variantAttribute?: string; // Atributo de variação (ex: P, M, Romã)
  image?: string;
  image_url_2?: string;
  image_url_3?: string;
  videoUri?: string;
  description?: string;
  indications?: string;
  usage?: string;
  sideEffects?: string;
  contraindications?: string;
  isAiEnriched?: boolean;
  promotionType?: "NONE" | "DISCOUNT" | "BUY_X_PAY_Y" | "DISCOUNT_ON_QTY";
  buyX?: number;
  payY?: number;
  discountQtyThreshold?: number;
  discountQtyPercentage?: number;
  isFeatured?: boolean;
  requires_prescription?: boolean;
  is_continuous_use?: boolean;
  continuous_use_days?: number;
}

export interface CartItem extends Product {
  quantity: number;
  appliedPromotionId?: string;
  promotionDiscount?: number;
}

export const isControlledProduct = (product: Product): boolean => {
  if (product.requires_prescription) return true;

  const normalize = (s: string) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const name = normalize(product.name);
  const cat = normalize(product.category);
  const desc = normalize(product.description || "");
  const ind = normalize(product.indications || "");

  return (
    cat.includes("psicotropico") ||
    cat.includes("controlado") ||
    name.includes("tarja preta") ||
    name.includes("tarja vermelha") ||
    desc.includes("receita retida") ||
    desc.includes("medicamento controlado") ||
    desc.includes("controle especial") ||
    ind.includes("medicamento controlado") ||
    ind.includes("controle especial")
  );
};

export interface CustomerInfo {
  name: string;
  phone: string;
  address: string;
  addressNumber: string;
  neighborhood: string;
  city: string;
  cep?: string;
  complement?: string;
  paymentMethod: "Pix" | "Cartão" | "Dinheiro" | "Mercado Pago";
  changeFor?: string;
  locationUrl?: string;
}

export type OrderStatus = "pending" | "confirmed" | "dispatched" | "cancelled" | "enviado_ao_pdv" | "impresso_no_pdv" | "concluido_no_pdv" | "erro_integracao_pdv";

export type PrescriptionStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface MedicalPrescription {
  id: string;
  store_id: string;
  customer_id: string;
  cart_id?: string;
  order_id?: string;
  file_url: string;
  status: PrescriptionStatus;
  notes?: string;
  validated_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Order {
  id: string;
  tenantId: string;
  items: CartItem[];
  customer: CustomerInfo;
  total: number;
  date: string;
  status: OrderStatus;
  observation?: string;
  receiptFile?: string;
  appliedCoupon?: string;
  couponDiscount?: number;
  networkId?: string;
  deliveryMode?: "delivery" | "pickup";
  prescriptionStatus?: string;
}

export interface AppReview {
  id: string;
  tenantId?: string; // Opcional, para saber de qual loja veio o feedback
  rating: number;
  comment: string;
  date: string;
}

export interface DepartmentConfig {
  id: string;
  name: string;
  iconName: string;
  priority: number;
  categories: string[];
}

export interface SmartBannerConfig {
  enabled: boolean;
  imageUrl?: string;
}

export interface DeliveryFeeRange {
  id: string;
  minKm: number;
  maxKm: number;
  fee: number;
}

export interface DeliverySettingsConfig {
  enabled: boolean;
  type?: 'fixed' | 'dynamic';
  fee: number;
  ranges?: DeliveryFeeRange[];
  minOrderForFreeDelivery?: number;
  storePickupEnabled?: boolean;
}

export interface AiAgentConfig {
  active?: boolean;
  enabled?: boolean;
  provider: 'gemini' | 'openai';
  apiKey?: string;
  openai_api_key?: string;
  api_key?: string;
  model?: string;
  systemPrompt?: string;
  storeLink?: string;
  temperature?: number;
  maxTokens?: number;
  fallbackMessage?: string;
  fallbackToHumanOnKeywords?: boolean;
  welcomeMessage?: string;
  maxInteractionsPerSession?: number;
  transitionToHumanMessage?: string;
  antiAbuseGuardrailsEnabled?: boolean;
  strictStoreLinkEnforcement?: boolean;
  [key: string]: any;
}

export interface PharmacyConfig {
  id: string;
  slug?: string;
  custom_domain?: string;
  owner_id?: string;
  type: "PHARMACY"; // Fixo em PHARMACY
  name: string;
  whatsapp: string;
  logo?: string;
  logo_url?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor?: string;
  accentColor?: string;
  admin_email?: string;
  admin_password?: string;
  bannerTitle?: string;
  bannerSubtitle?: string;
  isBlocked?: boolean;
  isChatEnabled?: boolean;
  isAiAgentEnabled?: boolean;
  isAiCopilotEnabled?: boolean;
  is_ai_copilot_enabled?: boolean;
  aiAgentConfig?: AiAgentConfig;
  customCategories?: string[];
  customManufacturers?: string[];
  licenseExpiration?: string;
  cnpj?: string;
  fullAddress?: string;
  corporateEmail?: string;
  manufacturerLogos?: Record<string, string>;
  manufacturerSynonyms?: Record<string, string>;
  departments?: DepartmentConfig[];
  backupConfig?: {
    frequency: "OFF" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
    lastBackup?: string;
    nextBackup?: string;
  };
  integrationToken?: string;
  erpUrl?: string;
  erpType?: string;
  enableSmartBanners?: boolean;
  smartBanners?: Record<string, SmartBannerConfig>;
  couponBannerColor?: string;
  minimumOrderValue?: number;
  notificationSound?: string;
  notificationVolume?: number;
  isNetworkMaster?: boolean;
  networkId?: string;
  deliverySettings?: DeliverySettingsConfig;
  ignore_erp_prices?: boolean;
  welcomeMessageEnabled?: boolean;
  welcomeMessageText?: string;
  welcomeMessageFormat?: 'button' | 'text';
  welcomeMessageLink?: string;
  subdomain?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;
  street?: string;
  phone?: string;
  bannertitle?: string;
  bannersubtitle?: string;
  razao_social?: string;
  razaoSocial?: string;
  farmaceutico_responsavel?: string;
  farmaceuticoResponsavel?: string;
  crf?: string;
  horario_funcionamento?: string;
  horarioFuncionamento?: string;
  telefone_contato?: string;
  address_number?: string;
  full_address?: string;
  complement?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  nome_loja?: string;
  updatedAt?: string;
}

export interface BackupLog {
  id: string;
  tenantId: string;
  date: string;
  fileName: string;
  fileSize: number;
  status: "SUCCESS" | "FAILED";
  downloadUrl?: string;
}

export interface PharmacyStats {
  tenantId: string;
  averageRating: number;
  totalReviews: number;
  lastUpdated: string;
}

export type KanbanStageId = 
  | 'novos_triagem' 
  | 'ia_atendendo' 
  | 'em_atendimento' 
  | 'aguardando_pagamento' 
  | 'saiu_entrega' 
  | 'finalizado'
  // Retrocompatibilidade para estágios anteriores e legados
  | 'triagem'
  | 'novos'
  | 'delivery'
  | 'em_separacao'
  | 'NEW' 
  | 'BOT' 
  | 'WAITING' 
  | 'STORE_REDIRECT' 
  | 'HUMAN' 
  | 'CLOSED'
  | 'novos_clientes' 
  | 'atendimento_humano' 
  | 'enviado_webloja' 
  | 'aguardando_resposta' 
  | 'concluido';

export interface KanbanColumnConfig {
  id: KanbanStageId;
  title: string;
  subtitle: string;
  color: string;
  badgeBg: string;
  badgeText: string;
  borderColor: string;
  iconName: string;
  order: number;
}

export interface AuthSession {
  type: "SUPER_ADMIN" | "PHARMACY_ADMIN" | "GUEST";
  tenantId?: string;
  originalTenantId?: string;
  masterTenantId?: string;
  isMatrixUser?: boolean;
  role?: "owner" | "admin" | "gerente" | "operador" | "entregador" | "matriz" | "MATRIZ" | string;
  user?: any;
  access_token?: string;
  refresh_token?: string;
}

export enum ViewMode {
  CATALOG = "CATALOG",
  CART = "CART",
  ADMIN_PHARMACY = "ADMIN_PHARMACY",
  ADMIN_SUPER = "ADMIN_SUPER",
  LOGIN = "LOGIN",
}

export interface CouponRule {
  id: string;
  tenantId: string;
  code: string;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: number;
  couponScope?: "GLOBAL" | "SPECIFIC_PRODUCT";
  minPurchaseValue?: number;
  targetType:
    | "CATEGORY"
    | "MANUFACTURER"
    | "PRODUCT"
    | "SPECIFIC_SELECTION"
    | "ALL";
  targetValue?: string;
  specificProductIds?: string[];
  filtersMetadata?: {
    categories?: string[];
    manufacturers?: string[];
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    branchIds?: string[];
  };
  networkId?: string;
  targetBranchIds?: string[];
  startDate: string;
  endDate: string;
  isActive: boolean;
  scope?: "SINGLE_STORE" | "NETWORK";
  usageLimit?: number;
  timesUsed?: number;
  firstPurchaseOnly?: boolean;
  applicableProducts?: string[];
  applicableCategories?: string[];
  applicableManufacturers?: string[];
  maxUses?: number;
  currentUses?: number;
}

export interface FlashDealsScheduleConfig {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  daysOfWeek?: number[]; // 0=Sunday, 1=Monday... 6=Saturday
  daysOfMonth?: number[]; // 1-31
  startTime: string; // "15:00"
  endTime: string; // "16:30"
}

export interface PromotionRule {
  id: string;
  tenantId: string;
  name: string;
  type:
    | "BUY_X_PAY_Y"
    | "PROGRESSIVE_DISCOUNT"
    | "FIXED_COMBO"
    | "LIGHTNING_OFFER"
    | "DISCOUNT_ON_QTY"
    | "VARIABLE_COMBO";
  targetType: "CATEGORY" | "MANUFACTURER" | "PRODUCT" | "SPECIFIC_SELECTION";
  targetValue: string; // Category name, Manufacturer name, or Product ID
  specificProductIds?: string[]; // For SPECIFIC_SELECTION or VARIABLE_COMBO
  scheduleConfig?: FlashDealsScheduleConfig;
  filtersMetadata?: {
    category?: string | string[];
    manufacturer?: string | string[];
    search?: string;
    minPrice?: string;
    maxPrice?: string;
    minStock?: string;
    branchIds?: string[];
    buyX?: number;
    payY?: number;
    comboProducts?: string[];
    comboPrice?: number;
    show_banner_card?: boolean;
    banner_headline?: string;
  };
  networkId?: string;
  targetBranchIds?: string[];
  highlightInCategoriesBar?: boolean;
  highlightColor?: string;
  highlightIcon?: string;
  show_banner_card?: boolean;
  banner_headline?: string;
  buyX?: number;
  payY?: number;
  lightningDiscountPercentage?: number; // For LIGHTNING_OFFER
  discountThresholds?: { qty: number; discountPercentage: number }[]; // For progressive
  comboProducts?: string[]; // Array of Product IDs for Variable Combo / Fixed Combo
  comboPrice?: number; // Fixed promotional price for the entire Variable Combo (e.g. 14.99)
  bundle_price?: number;
  bundle_slots?: any;
  comboDiscountPercentage?: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt?: string;
  scope?: "SINGLE_STORE" | "NETWORK";
}

export interface PromotionDetail {
  promotionId?: string;
  promotionName?: string;
  discount: number;
}

export const isPromotionActive = (
  p: PromotionRule,
  now: Date = new Date(),
): boolean => {
  if (!p.isActive) return false;

  const start = p.startDate ? new Date(p.startDate) : null;
  let end = null;
  if (p.endDate) {
    if (p.type === "LIGHTNING_OFFER" || p.endDate.includes("T")) {
      end = new Date(p.endDate);
    } else {
      const [year, month, day] = p.endDate.split("T")[0].split("-");
      end = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        23,
        59,
        59,
        999,
      );
    }
  }
  if (start && now < start) return false;
  if (end && now > end) return false;

  if (p.scheduleConfig) {
    const spFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour12: false,
      weekday: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = spFormatter.formatToParts(now);
    const getP = (type: string) =>
      parts.find((pt) => pt.type === type)?.value || "";

    const dayOfWeekMap: { [key: string]: number } = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const currentDayOfWeek = dayOfWeekMap[getP("weekday")] ?? now.getDay();
    const currentDayOfMonth = parseInt(getP("day"), 10) || now.getDate();
    const currentHourRaw = parseInt(getP("hour"), 10) || now.getHours();
    const currentHour = currentHourRaw === 24 ? 0 : currentHourRaw;
    const currentMinute = parseInt(getP("minute"), 10) || now.getMinutes();
    const currentSecond = parseInt(getP("second"), 10) || now.getSeconds();

    const sch = p.scheduleConfig;

    if (sch && typeof sch === "object") {
      if (
        sch.frequency === "WEEKLY" &&
        Array.isArray(sch.daysOfWeek) &&
        sch.daysOfWeek.length > 0
      ) {
        if (!sch.daysOfWeek.includes(currentDayOfWeek)) return false;
      }
      if (
        sch.frequency === "MONTHLY" &&
        Array.isArray(sch.daysOfMonth) &&
        sch.daysOfMonth.length > 0
      ) {
        if (!sch.daysOfMonth.includes(currentDayOfMonth)) return false;
      }

      if (
        typeof sch.startTime === "string" &&
        typeof sch.endTime === "string" &&
        sch.startTime.includes(":") &&
        sch.endTime.includes(":")
      ) {
        const [startH, startM] = sch.startTime.split(":").map(Number);
        const [endH, endM] = sch.endTime.split(":").map(Number);

        const currentSeconds = currentHour * 3600 + currentMinute * 60 + currentSecond;
        const startSeconds = (startH || 0) * 3600 + (startM || 0) * 60;
        const endSeconds = (endH || 0) * 3600 + (endM || 0) * 60;

        if (startSeconds > endSeconds) {
          if (currentSeconds < startSeconds && currentSeconds >= endSeconds) {
            return false;
          }
        } else {
          if (currentSeconds < startSeconds || currentSeconds >= endSeconds) {
            return false;
          }
        }
      }
    }
  }

  return true;
};

export const matchProductToSlot = (
  productIdOrSlot: string,
  product: Product,
  matrizProducts: Product[] = [],
  tenantId?: string,
  isNetworkScope?: boolean,
): boolean => {
  if (product.id === productIdOrSlot) return true;
  if (isNetworkScope && product.barcode) {
    const matrizProd = matrizProducts.find((mp) => mp.id === productIdOrSlot);
    if (matrizProd && matrizProd.barcode && matrizProd.barcode === product.barcode) {
      return true;
    }
  }
  return false;
};

// Cache rule Sets for instant O(1) membership validation (eliminates slow array scans)
interface RuleCachedSets {
  idSet: Set<string>;
  barcodeSet: Set<string>;
  matrizLength: number;
}
const ruleSetsCache = new WeakMap<PromotionRule | CouponRule, RuleCachedSets>();

export const getRuleEligibleSets = (
  rule: PromotionRule | CouponRule,
  matrizProducts: Product[] = [],
  tenantId?: string,
): { idSet: Set<string>; barcodeSet: Set<string> } => {
  const isNetworkScope = rule.scope === "NETWORK" || (tenantId && rule.tenantId !== tenantId);
  const cached = ruleSetsCache.get(rule);
  if (cached && cached.matrizLength === matrizProducts.length) {
    return cached;
  }

  let rawIds: string[] = [];
  if ("type" in rule && (rule.type === "VARIABLE_COMBO" || (rule.type as string) === "COMBO_VARIABLE")) {
    rawIds = (rule.comboProducts && rule.comboProducts.length > 0)
      ? rule.comboProducts
      : (rule.specificProductIds || []);
  } else if (rule.targetType === "SPECIFIC_SELECTION") {
    rawIds = rule.specificProductIds || (rule as any).applicableProducts || [];
  } else if (rule.targetType === "PRODUCT" && rule.targetValue) {
    rawIds = [rule.targetValue];
  }

  const idSet = new Set<string>(rawIds);
  const barcodeSet = new Set<string>();

  // If network scope, index matching barcodes from matrizProducts once in O(M)
  if (isNetworkScope && matrizProducts.length > 0 && idSet.size > 0) {
    for (let i = 0; i < matrizProducts.length; i++) {
      const mp = matrizProducts[i];
      if (mp.barcode && idSet.has(mp.id)) {
        barcodeSet.add(mp.barcode);
      }
    }
  }

  const entry: RuleCachedSets = {
    idSet,
    barcodeSet,
    matrizLength: matrizProducts.length,
  };
  ruleSetsCache.set(rule, entry);
  return entry;
};

export const checkProductMatchesRule = (
  rule: PromotionRule | CouponRule,
  p: Product,
  matrizProducts: Product[] = [],
  tenantId?: string,
): boolean => {
  if (!p || !p.id) return false;
  // Se a regra for de rede ou pertencer a um tenant diferente do produto, é escopo rede
  const isNetworkScope = rule.scope === "NETWORK" || (tenantId && rule.tenantId !== tenantId);

  if ("type" in rule && (rule.type === "VARIABLE_COMBO" || (rule.type as string) === "COMBO_VARIABLE")) {
    const { idSet, barcodeSet } = getRuleEligibleSets(rule, matrizProducts, tenantId);
    if (idSet.has(p.id)) return true;
    if (isNetworkScope && p.barcode && barcodeSet.has(p.barcode)) return true;
    return false;
  }

  if (rule.targetType === "PRODUCT") {
    if (rule.targetValue === p.id) return true;
    // Se for escopo de rede, targetValue é o ID do produto na matriz. Comparamos pelo código de barras (EAN)
    if (isNetworkScope && p.barcode) {
      const { barcodeSet } = getRuleEligibleSets(rule, matrizProducts, tenantId);
      if (barcodeSet.has(p.barcode)) return true;
    }
    return false;
  }

  if (rule.targetType === "CATEGORY") {
    const norm = (s: string) => (s || "").toLowerCase().trim();
    return norm(rule.targetValue) === norm(p.category);
  }

  if (rule.targetType === "MANUFACTURER") {
    const norm = (s: string) => (s || "").toLowerCase().trim();
    return norm(rule.targetValue) === norm(p.manufacturer || "");
  }

  if (rule.targetType === "SPECIFIC_SELECTION") {
    const { idSet, barcodeSet } = getRuleEligibleSets(rule, matrizProducts, tenantId);
    if (idSet.has(p.id)) return true;
    if (p.barcode && idSet.has(p.barcode)) return true;
    if (isNetworkScope && p.barcode && barcodeSet.has(p.barcode)) return true;
    return false;
  }

  if (rule.targetType === "ALL") {
    return true;
  }

  return false;
};

export interface VariableComboRequirement {
  promo: PromotionRule;
  comboPrice: number;
  regularTotal: number;
  discountAmount: number;
  discountPercentage: number;
  requiredProducts: {
    productId: string;
    productName: string;
    productPresentation?: string;
    requiredQty: number;
    unitPrice: number;
    product?: Product;
    isCurrentProduct: boolean;
    isCurrentSelected: boolean;
  }[];
}

export const getVariableCombosForProduct = (
  product: Product,
  promotions: PromotionRule[] = [],
  allProducts: Product[] = [],
  matrizProducts: Product[] = [],
  tenantId?: string,
): VariableComboRequirement[] => {
  const now = new Date();
  const comboPromos = promotions.filter((p) => {
    if (!isPromotionActive(p, now)) return false;
    const isVarCombo = p.type === "VARIABLE_COMBO" || (p.type as string) === "COMBO_VARIABLE";
    if (!isVarCombo) return false;
    return checkProductMatchesRule(p, product, matrizProducts, tenantId);
  });

  return comboPromos.map((promo) => {
    const isNetworkScope = promo.scope === "NETWORK" || (tenantId && promo.tenantId !== tenantId);
    const rawIds = (promo.comboProducts && promo.comboProducts.length > 0)
      ? promo.comboProducts
      : (promo.specificProductIds || []);

    const slotMap = new Map<string, number>();
    rawIds.forEach((id) => {
      slotMap.set(id, (slotMap.get(id) || 0) + 1);
    });

    const requiredProducts = Array.from(slotMap.entries()).map(([pId, reqQty]) => {
      const isCurrent = matchProductToSlot(pId, product, matrizProducts, tenantId, isNetworkScope);
      const foundProduct = isCurrent
        ? product
        : allProducts.find((p) => matchProductToSlot(pId, p, matrizProducts, tenantId, isNetworkScope)) ||
          matrizProducts.find((mp) => mp.id === pId);

      const name = foundProduct?.name || `Produto (ID: ${pId.slice(0, 8)})`;
      const presentation = foundProduct?.presentation;
      const unitPrice = foundProduct?.price || 0;

      return {
        productId: pId,
        productName: name,
        productPresentation: presentation,
        requiredQty: reqQty,
        unitPrice,
        product: foundProduct,
        isCurrentProduct: isCurrent,
        isCurrentSelected: isCurrent,
      };
    });

    const regularTotal = requiredProducts.reduce((sum, item) => {
      const price = item.product?.price || 0;
      return sum + price * item.requiredQty;
    }, 0);

    const comboPrice = Number(promo.comboPrice ?? promo.bundle_price ?? promo.payY ?? regularTotal);
    const discountAmount = Math.max(0, regularTotal - comboPrice);
    const discountPercentage = regularTotal > 0 ? Math.round((discountAmount / regularTotal) * 100) : 0;

    return {
      promo,
      comboPrice,
      regularTotal,
      discountAmount,
      discountPercentage,
      requiredProducts,
    };
  });
};

export const calculateItemPromotionDetails = (
  item: CartItem,
  activePromotions: PromotionRule[] = [],
  matrizProducts: Product[] = [],
  tenantId?: string,
  allCartItems?: CartItem[],
): PromotionDetail => {
  const now = new Date();
  const applicablePromos = activePromotions.filter((p) => {
    if (!isPromotionActive(p, now)) return false;
    return checkProductMatchesRule(p, item, matrizProducts, tenantId);
  });

  const baseTotal = item.price * item.quantity;

  if (applicablePromos.length > 0) {
    // Sort to prioritize VARIABLE_COMBO and FIXED_COMBO rules over generic rules
    applicablePromos.sort((a, b) => {
      const isACombo = a.type === "VARIABLE_COMBO" || (a.type as string) === "COMBO_VARIABLE";
      const isBCombo = b.type === "VARIABLE_COMBO" || (b.type as string) === "COMBO_VARIABLE";
      if (isACombo && !isBCombo) return -1;
      if (isBCombo && !isACombo) return 1;
      if (a.type === "FIXED_COMBO" && b.type !== "FIXED_COMBO") return -1;
      if (b.type === "FIXED_COMBO" && a.type !== "FIXED_COMBO") return 1;
      return 0;
    });

    const promo = applicablePromos[0];
    let discountedTotal = baseTotal;

    if (promo.type === "VARIABLE_COMBO" || (promo.type as string) === "COMBO_VARIABLE") {
      const isNetworkScope = promo.scope === "NETWORK" || (tenantId && promo.tenantId !== tenantId);
      const rawIds = (promo.comboProducts && promo.comboProducts.length > 0)
        ? promo.comboProducts
        : (promo.specificProductIds || []);

      const cartSource = allCartItems && allCartItems.length > 0 ? allCartItems : [item];

      // Build requirement map of slot -> required quantity
      const slotMap = new Map<string, number>();
      rawIds.forEach((id) => {
        slotMap.set(id, (slotMap.get(id) || 0) + 1);
      });

      // Check each distinct required slot against cart items
      let canFormCombo = rawIds.length >= 2;
      const slotChecks: { slotId: string; reqQty: number; availableQty: number; cartItem?: CartItem; price: number }[] = [];

      for (const [slotId, reqQty] of slotMap.entries()) {
        // Find matching cart item for THIS specific slot (strict slot matching, not any-promo match)
        const matchingItems = cartSource.filter((ci) =>
          matchProductToSlot(slotId, ci, matrizProducts, tenantId, isNetworkScope),
        );
        const availableQty = matchingItems.reduce((sum, ci) => sum + ci.quantity, 0);

        if (availableQty < reqQty) {
          canFormCombo = false;
        }

        const sampleItem = matchingItems[0] || matrizProducts.find((mp) => mp.id === slotId);
        slotChecks.push({
          slotId,
          reqQty,
          availableQty,
          cartItem: matchingItems[0],
          price: sampleItem?.price || 0,
        });
      }

      if (canFormCombo) {
        // Number of complete combos formed
        const numCombos = Math.min(...slotChecks.map((s) => Math.floor(s.availableQty / s.reqQty)));

        if (numCombos > 0) {
          const regularComboTotal = slotChecks.reduce((sum, s) => sum + s.price * s.reqQty, 0);
          const comboPromoPrice = Number(promo.comboPrice ?? promo.bundle_price ?? promo.payY ?? regularComboTotal);
          const comboDiscountPerSet = Math.max(0, regularComboTotal - comboPromoPrice);

          // Find THIS item's slot requirement
          const thisSlot = slotChecks.find((s) =>
            matchProductToSlot(s.slotId, item, matrizProducts, tenantId, isNetworkScope),
          );

          if (thisSlot && regularComboTotal > 0 && comboDiscountPerSet > 0) {
            const itemShareRatio = (thisSlot.price * thisSlot.reqQty) / regularComboTotal;
            const itemDiscount = numCombos * comboDiscountPerSet * itemShareRatio;
            discountedTotal = Math.max(0, baseTotal - itemDiscount);

            return {
              promotionId: promo.id,
              promotionName: promo.name,
              discount: Math.max(0, baseTotal - discountedTotal),
            };
          }
        }
      }

      // If combo is not formed or only partial items in cart, discount is 0
      return {
        promotionId: promo.id,
        promotionName: promo.name,
        discount: 0,
      };
    } else if (
      promo.type === "BUY_X_PAY_Y" &&
      promo.buyX &&
      promo.payY &&
      promo.buyX > 0
    ) {
      const sets = Math.floor(item.quantity / promo.buyX);
      const remainder = item.quantity % promo.buyX;
      discountedTotal = sets * promo.payY * item.price + remainder * item.price;
    } else if (
      promo.type === "PROGRESSIVE_DISCOUNT" &&
      promo.discountThresholds
    ) {
      const sortedThresholds = [...promo.discountThresholds].sort(
        (a, b) => b.qty - a.qty,
      );
      const applicableThreshold = sortedThresholds.find(
        (t) => item.quantity >= t.qty,
      );
      if (applicableThreshold) {
        discountedTotal =
          item.quantity *
          item.price *
          (1 - applicableThreshold.discountPercentage / 100);
      }
    } else if (
      promo.type === "FIXED_COMBO" &&
      promo.buyX &&
      promo.payY &&
      promo.buyX > 0
    ) {
      const sets = Math.floor(item.quantity / promo.buyX);
      const remainder = item.quantity % promo.buyX;
      discountedTotal = sets * promo.payY + remainder * item.price;
    } else if (promo.type === "LIGHTNING_OFFER") {
      if (promo.lightningDiscountPercentage && promo.lightningDiscountPercentage > 0) {
        discountedTotal = baseTotal * (1 - promo.lightningDiscountPercentage / 100);
      } else if (promo.buyX && promo.payY && promo.buyX > 0) {
        const sets = Math.floor(item.quantity / promo.buyX);
        const remainder = item.quantity % promo.buyX;
        discountedTotal = sets * promo.payY + remainder * item.price;
      }
    }

    return {
      promotionId: promo.id,
      promotionName: promo.name,
      discount: Math.max(0, baseTotal - discountedTotal),
    };
  }

  // Legacy fallback
  let legacyDiscountedTotal = baseTotal;
  if (
    item.promotionType === "BUY_X_PAY_Y" &&
    item.buyX &&
    item.payY &&
    item.buyX > 0
  ) {
    const sets = Math.floor(item.quantity / item.buyX);
    const remainder = item.quantity % item.buyX;
    legacyDiscountedTotal =
      sets * item.payY * item.price + remainder * item.price;

    return {
      promotionId: "legacy_buy_x_pay_y",
      promotionName: `Leve ${item.buyX} e Pague Menos`,
      discount: Math.max(0, baseTotal - legacyDiscountedTotal),
    };
  } else if (
    item.promotionType === "DISCOUNT_ON_QTY" &&
    item.discountQtyThreshold &&
    item.discountQtyPercentage &&
    item.discountQtyThreshold > 0
  ) {
    if (item.quantity >= item.discountQtyThreshold) {
      legacyDiscountedTotal =
        item.quantity * item.price * (1 - item.discountQtyPercentage / 100);
      return {
        promotionId: "legacy_discount_on_qty",
        promotionName: `Desconto por Volume`,
        discount: Math.max(0, baseTotal - legacyDiscountedTotal),
      };
    }

    // Se a quantidade for menor que a necessária, ainda queremos retornar a informação para o frontend mostrar o badge de aviso do que falta.
    return {
      promotionId: "legacy_discount_on_qty_pending",
      promotionName: `Leve ${item.discountQtyThreshold} c/ Desconto`,
      discount: 0,
    };
  }

  return {
    discount: Math.max(0, baseTotal - legacyDiscountedTotal),
  };
};

export const calculateItemTotal = (
  item: CartItem,
  activePromotions: PromotionRule[] = [],
  matrizProducts: Product[] = [],
  tenantId?: string,
  allCartItems?: CartItem[],
): number => {
  const details = calculateItemPromotionDetails(item, activePromotions, matrizProducts, tenantId, allCartItems);
  return item.price * item.quantity - details.discount;
};

export interface VolumePromotionInfo {
  isVolumePromo: boolean;
  minQty: number;
  totalComboPrice: number;
  unitRatePrice: number;
  badgeText: string;
  promoTitle: string;
  auxText: string;
  modalDetailText: string;
  quickAddLabel: string;
}

export const getProductVolumePromotionInfo = (
  product: Product,
  promotions: PromotionRule[] = [],
  matrizProducts: Product[] = [],
  tenantId?: string
): VolumePromotionInfo | null => {
  const regularPrice = Number(product.price) || 0;
  if (regularPrice <= 0) return null;

  const now = new Date();
  const applicableRule = promotions.find((p) => {
    if (!isPromotionActive(p, now)) return false;
    return checkProductMatchesRule(p, product, matrizProducts, tenantId);
  });

  if (applicableRule) {
    if (applicableRule.type === "BUY_X_PAY_Y" && applicableRule.buyX && applicableRule.payY && applicableRule.buyX > 1) {
      const buyX = applicableRule.buyX;
      const payY = applicableRule.payY;
      const totalComboPrice = Number((regularPrice * payY).toFixed(2));
      const unitRatePrice = Number((totalComboPrice / buyX).toFixed(2));
      const badgeText = `LEVE ${buyX}, PAGUE ${payY}`;
      return {
        isVolumePromo: true,
        minQty: buyX,
        totalComboPrice,
        unitRatePrice,
        badgeText,
        promoTitle: applicableRule.name || badgeText,
        auxText: `Na compra de ${buyX} un: R$ ${unitRatePrice.toFixed(2).replace('.', ',')} cada`,
        modalDetailText: `Adicione ${buyX} unidades ao carrinho e pague apenas R$ ${totalComboPrice.toFixed(2).replace('.', ',')} (cada uma sai a R$ ${unitRatePrice.toFixed(2).replace('.', ',')})`,
        quickAddLabel: `Adicionar Kit com ${buyX} unidades ao carrinho (R$ ${totalComboPrice.toFixed(2).replace('.', ',')})`
      };
    }

    if (applicableRule.type === "FIXED_COMBO" && applicableRule.buyX && applicableRule.payY && applicableRule.buyX > 1) {
      const buyX = applicableRule.buyX;
      const totalComboPrice = Number(applicableRule.payY);
      const unitRatePrice = Number((totalComboPrice / buyX).toFixed(2));
      const badgeText = `LEVE ${buyX} POR R$ ${totalComboPrice.toFixed(2).replace('.', ',')}`;
      return {
        isVolumePromo: true,
        minQty: buyX,
        totalComboPrice,
        unitRatePrice,
        badgeText,
        promoTitle: applicableRule.name || badgeText,
        auxText: `Na compra de ${buyX} un: R$ ${unitRatePrice.toFixed(2).replace('.', ',')} cada`,
        modalDetailText: `Adicione ${buyX} unidades ao carrinho e pague apenas R$ ${totalComboPrice.toFixed(2).replace('.', ',')} (cada uma sai a R$ ${unitRatePrice.toFixed(2).replace('.', ',')})`,
        quickAddLabel: `Adicionar Kit com ${buyX} unidades ao carrinho (R$ ${totalComboPrice.toFixed(2).replace('.', ',')})`
      };
    }

    if (applicableRule.type === "LIGHTNING_OFFER" && applicableRule.buyX && applicableRule.payY && applicableRule.buyX > 1) {
      const buyX = applicableRule.buyX;
      const totalComboPrice = Number(applicableRule.payY);
      const unitRatePrice = Number((totalComboPrice / buyX).toFixed(2));
      const badgeText = `LEVE ${buyX} POR R$ ${totalComboPrice.toFixed(2).replace('.', ',')}`;
      return {
        isVolumePromo: true,
        minQty: buyX,
        totalComboPrice,
        unitRatePrice,
        badgeText,
        promoTitle: applicableRule.name || 'OFERTA RELÂMPAGO',
        auxText: `Na compra de ${buyX} un: R$ ${unitRatePrice.toFixed(2).replace('.', ',')} cada`,
        modalDetailText: `Adicione ${buyX} unidades ao carrinho e pague apenas R$ ${totalComboPrice.toFixed(2).replace('.', ',')} (cada uma sai a R$ ${unitRatePrice.toFixed(2).replace('.', ',')})`,
        quickAddLabel: `Adicionar Kit com ${buyX} unidades ao carrinho (R$ ${totalComboPrice.toFixed(2).replace('.', ',')})`
      };
    }

    if (applicableRule.type === "PROGRESSIVE_DISCOUNT" && applicableRule.discountThresholds && applicableRule.discountThresholds.length > 0) {
      const sorted = [...applicableRule.discountThresholds].sort((a, b) => a.qty - b.qty);
      const first = sorted[0];
      if (first && first.qty > 1) {
        const unitRatePrice = Number((regularPrice * (1 - first.discountPercentage / 100)).toFixed(2));
        const totalComboPrice = Number((unitRatePrice * first.qty).toFixed(2));
        const badgeText = `A PARTIR DE ${first.qty} UN: -${first.discountPercentage}%`;
        return {
          isVolumePromo: true,
          minQty: first.qty,
          totalComboPrice,
          unitRatePrice,
          badgeText,
          promoTitle: applicableRule.name || badgeText,
          auxText: `A partir de ${first.qty} un: R$ ${unitRatePrice.toFixed(2).replace('.', ',')} cada`,
          modalDetailText: `Compre ${first.qty} ou mais e pague apenas R$ ${unitRatePrice.toFixed(2).replace('.', ',')} em cada (${first.discountPercentage}% OFF)`,
          quickAddLabel: `Adicionar ${first.qty} unidades ao carrinho (${first.discountPercentage}% OFF)`
        };
      }
    }
  }

  // Fallback para campos direct no product (legados)
  if (product.promotionType === "BUY_X_PAY_Y" && product.buyX && product.payY && product.buyX > 1) {
    const buyX = product.buyX;
    const payY = product.payY;
    const totalComboPrice = Number((regularPrice * payY).toFixed(2));
    const unitRatePrice = Number((totalComboPrice / buyX).toFixed(2));
    const badgeText = `LEVE ${buyX}, PAGUE ${payY}`;
    return {
      isVolumePromo: true,
      minQty: buyX,
      totalComboPrice,
      unitRatePrice,
      badgeText,
      promoTitle: badgeText,
      auxText: `Na compra de ${buyX} un: R$ ${unitRatePrice.toFixed(2).replace('.', ',')} cada`,
      modalDetailText: `Adicione ${buyX} unidades ao carrinho e pague apenas R$ ${totalComboPrice.toFixed(2).replace('.', ',')} (cada uma sai a R$ ${unitRatePrice.toFixed(2).replace('.', ',')})`,
      quickAddLabel: `Adicionar Kit com ${buyX} unidades ao carrinho (R$ ${totalComboPrice.toFixed(2).replace('.', ',')})`
    };
  }

  if (product.promotionType === "DISCOUNT_ON_QTY" && product.discountQtyThreshold && product.discountQtyPercentage && product.discountQtyThreshold > 1) {
    const qty = product.discountQtyThreshold;
    const pct = product.discountQtyPercentage;
    const unitRatePrice = Number((regularPrice * (1 - pct / 100)).toFixed(2));
    const totalComboPrice = Number((unitRatePrice * qty).toFixed(2));
    const badgeText = `LEVE ${qty} OU MAIS (-${pct}%)`;
    return {
      isVolumePromo: true,
      minQty: qty,
      totalComboPrice,
      unitRatePrice,
      badgeText,
      promoTitle: `Desconto por Quantidade`,
      auxText: `A partir de ${qty} un: R$ ${unitRatePrice.toFixed(2).replace('.', ',')} cada`,
      modalDetailText: `Compre ${qty} ou mais e ganhe ${pct}% de desconto (sai a R$ ${unitRatePrice.toFixed(2).replace('.', ',')} cada)`,
      quickAddLabel: `Adicionar ${qty} unidades com desconto`
    };
  }

  return null;
};

export interface ChatMessageReaction {
  emoji: string;
  sender?: "CUSTOMER" | "USER" | "SYSTEM" | string;
  fromMe?: boolean;
  created_at?: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_type: "CUSTOMER" | "USER" | "BOT" | "SYSTEM";
  sender_id?: string | null;
  content: string;
  is_private: boolean;
  media_url?: string;
  media_type?: string;
  mediaUrl?: string;
  mediaType?: string;
  type?: string;
  reaction?: string | null;
  reactions?: ChatMessageReaction[];
  remote_id?: string | null;
  message_ack?: string;
  created_at: string;
}

export interface ChatContact {
  id: string;
  store_id: string;
  name: string;
  phone_number: string;
  created_at: string;
}

export interface ChatLabel {
  id: string;
  store_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  store_id: string;
  contact_id: string;
  inbox_id?: string | null;
  team_id?: string | null;
  assigned_user_id?: string | null;
  assigned_to?: string | null;
  is_human_controlled?: boolean;
  status: "OPEN" | "PENDING" | "finalizado" | "BOT" | string;
  kanban_stage?: "novos_triagem" | "ia_atendendo" | "aguardando_pagamento" | "em_atendimento" | "finalizado" | "saiu_entrega" | string;
  stage?: string;
  last_message_at: string;
  last_message_content: string;
  unread_count?: number;
  is_bot_active?: boolean;
  bot_interaction_count?: number;
  bot_handoff_reason?: string;
  bot_handoff_at?: string;
  contact?: ChatContact;
  labels?: ChatLabel[];
  created_at: string;
  updated_at?: string;
}
