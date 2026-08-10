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

export interface PharmacyConfig {
  id: string;
  slug?: string;
  custom_domain?: string;
  owner_id?: string;
  type: "PHARMACY"; // Fixo em PHARMACY
  name: string;
  whatsapp: string;
  logo?: string;
  primaryColor: string;
  secondaryColor?: string;
  accentColor?: string;
  admin_email?: string;
  admin_password?: string;
  bannerTitle?: string;
  bannerSubtitle?: string;
  isBlocked?: boolean;
  isChatEnabled?: boolean;
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

export interface AuthSession {
  type: "SUPER_ADMIN" | "PHARMACY_ADMIN" | "GUEST";
  tenantId?: string;
  role?: "owner" | "admin" | "gerente" | "operador" | "entregador";
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
    | "DISCOUNT_ON_QTY";
  targetType: "CATEGORY" | "MANUFACTURER" | "PRODUCT" | "SPECIFIC_SELECTION";
  targetValue: string; // Category name, Manufacturer name, or Product ID
  specificProductIds?: string[]; // For SPECIFIC_SELECTION
  scheduleConfig?: FlashDealsScheduleConfig;
  filtersMetadata?: {
    category?: string | string[];
    manufacturer?: string | string[];
    search?: string;
    minPrice?: string;
    maxPrice?: string;
    minStock?: string;
    branchIds?: string[];
  };
  networkId?: string;
  targetBranchIds?: string[];
  highlightInCategoriesBar?: boolean;
  highlightColor?: string;
  highlightIcon?: string;
  buyX?: number;
  payY?: number;
  lightningDiscountPercentage?: number; // For LIGHTNING_OFFER
  discountThresholds?: { qty: number; discountPercentage: number }[]; // For progressive
  comboProducts?: string[]; // Array of Product IDs for Fixed Combo
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

    if (
      sch.frequency === "WEEKLY" &&
      sch.daysOfWeek &&
      sch.daysOfWeek.length > 0
    ) {
      if (!sch.daysOfWeek.includes(currentDayOfWeek)) return false;
    }
    if (
      sch.frequency === "MONTHLY" &&
      sch.daysOfMonth &&
      sch.daysOfMonth.length > 0
    ) {
      if (!sch.daysOfMonth.includes(currentDayOfMonth)) return false;
    }

    if (sch.startTime && sch.endTime) {
      const [startH, startM] = sch.startTime.split(":").map(Number);
      const [endH, endM] = sch.endTime.split(":").map(Number);

      const currentSeconds = currentHour * 3600 + currentMinute * 60 + currentSecond;
      const startSeconds = startH * 3600 + (startM || 0) * 60;
      const endSeconds = endH * 3600 + (endM || 0) * 60;

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

  return true;
};

export const checkProductMatchesRule = (
  rule: PromotionRule | CouponRule,
  p: Product,
  matrizProducts: Product[] = [],
  tenantId?: string,
): boolean => {
  // Se a regra for de rede ou pertencer a um tenant diferente do produto, é escopo rede
  const isNetworkScope = rule.scope === "NETWORK" || (tenantId && rule.tenantId !== tenantId);

  if (rule.targetType === "PRODUCT") {
    if (rule.targetValue === p.id) return true;
    // Se for escopo de rede, targetValue é o ID do produto na matriz. Comparamos pelo código de barras (EAN)
    if (isNetworkScope && p.barcode) {
      const matrizProd = matrizProducts.find((mp) => mp.id === rule.targetValue);
      if (matrizProd && matrizProd.barcode === p.barcode) return true;
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
    if (rule.specificProductIds?.includes(p.id)) return true;
    if (isNetworkScope && p.barcode) {
      const targetEans = matrizProducts
        .filter((mp) => rule.specificProductIds?.includes(mp.id) && mp.barcode)
        .map((mp) => mp.barcode);
      if (p.barcode && targetEans.includes(p.barcode)) return true;
    }
    return false;
  }

  if (rule.targetType === "ALL") {
    return true;
  }

  return false;
};

export const calculateItemPromotionDetails = (
  item: CartItem,
  activePromotions: PromotionRule[] = [],
  matrizProducts: Product[] = [],
  tenantId?: string,
): PromotionDetail => {
  const now = new Date();
  const applicablePromos = activePromotions.filter((p) => {
    if (!isPromotionActive(p, now)) return false;
    return checkProductMatchesRule(p, item, matrizProducts, tenantId);
  });

  const baseTotal = item.price * item.quantity;

  if (applicablePromos.length > 0) {
    // Sort to prioritize FIXED_COMBO rules or more specific rules
    applicablePromos.sort((a, b) => {
      if (a.type === "FIXED_COMBO" && b.type !== "FIXED_COMBO") return -1;
      if (b.type === "FIXED_COMBO" && a.type !== "FIXED_COMBO") return 1;
      return 0;
    });

    const promo = applicablePromos[0];
    let discountedTotal = baseTotal;

    if (
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
): number => {
  const details = calculateItemPromotionDetails(item, activePromotions, matrizProducts, tenantId);
  return item.price * item.quantity - details.discount;
};
