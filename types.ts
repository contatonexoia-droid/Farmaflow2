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
    | "BUNDLE_FIXED_PRICE"
    | "COMBO_VARIATION"
    | "VARIATION_COMBO"
    | "SLOT_COMBO";
  targetType: "CATEGORY" | "MANUFACTURER" | "PRODUCT" | "SPECIFIC_SELECTION" | "BUNDLE_SLOTS";
  targetValue: string; // Category name, Manufacturer name, or Product ID
  specificProductIds?: string[]; // For SPECIFIC_SELECTION
  bundlePrice?: number;
  bundleSlots?: string[][]; // Array of arrays of product IDs
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

// Performance optimization: Caches to prevent expensive O(N) filtering/searching of matrizProducts inside the product matching loop
const ruleEanCache = new Map<string, string[]>();
const ruleBarcodeCache = new Map<string, string | null>();

export const isBundleType = (rule?: PromotionRule | CouponRule | null): boolean => {
  if (!rule) return false;
  const promoType = (rule as PromotionRule).type;
  return (
    rule.targetType === "BUNDLE_SLOTS" ||
    promoType === "BUNDLE_FIXED_PRICE" ||
    promoType === "COMBO_VARIATION" ||
    promoType === "VARIATION_COMBO" ||
    promoType === "SLOT_COMBO" ||
    Boolean((rule as any).bundleSlots && (rule as any).bundleSlots.length > 0) ||
    Boolean((rule as any).bundle_slots && (rule as any).bundle_slots.length > 0) ||
    Boolean((rule as any).comboProducts && (rule as any).comboProducts.length > 0) ||
    Boolean((rule as any).combo_products && (rule as any).combo_products.length > 0)
  );
};

export const checkProductMatchesRule = (
  rule: PromotionRule | CouponRule,
  p: Product,
  matrizProducts: Product[] = [],
  tenantId?: string,
): boolean => {
  if (!rule || !p) return false;
  // Se a regra for de rede ou pertencer a um tenant diferente do produto, é escopo rede
  const isNetworkScope = rule.scope === "NETWORK" || (tenantId && rule.tenantId !== tenantId);

  const pIdStr = p.id ? String(p.id).trim() : "";
  const pBarcodeStr = p.barcode ? String(p.barcode).trim() : "";
  const pEanStr = (p as any).ean ? String((p as any).ean).trim() : "";
  const productEan = (pBarcodeStr || pEanStr);

  if (rule.targetType === "PRODUCT") {
    if (pIdStr && String(rule.targetValue).trim() === pIdStr) return true;
    // Se for escopo de rede, targetValue é o ID do produto na matriz. Comparamos pelo código de barras (EAN)
    if (productEan) {
      const cacheKey = `${rule.id}_${matrizProducts.length}`;
      let targetBarcode = ruleBarcodeCache.get(cacheKey);
      if (targetBarcode === undefined) {
        const matrizProd = matrizProducts.find((mp) => mp && String(mp.id).trim() === String(rule.targetValue).trim());
        targetBarcode = (matrizProd?.barcode || (matrizProd as any)?.ean)?.toString().trim() || null;
        ruleBarcodeCache.set(cacheKey, targetBarcode);
      }
      if (targetBarcode && targetBarcode === productEan) return true;
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
    const specificIds = (rule.specificProductIds || []).map((x) => String(x).trim());
    if (pIdStr && specificIds.includes(pIdStr)) return true;
    if (productEan) {
      const cacheKey = `${rule.id}__${matrizProducts.length}`;
      let targetEans = ruleEanCache.get(cacheKey);
      if (!targetEans) {
        targetEans = matrizProducts
          .filter((mp) => mp && specificIds.includes(String(mp.id).trim()) && (mp.barcode || (mp as any).ean))
          .map((mp) => (mp.barcode || (mp as any).ean)?.toString().trim() as string);
        ruleEanCache.set(cacheKey, targetEans);
      }
      if (targetEans.includes(productEan)) return true;
    }
    return false;
  }

  if (isBundleType(rule)) {
    const bundlePromo = rule as PromotionRule;
    let slots = bundlePromo.bundleSlots || (bundlePromo as any).bundle_slots;
    if (!slots && (bundlePromo as any).filtersMetadata) {
      const fm = typeof (bundlePromo as any).filtersMetadata === "string" ? (() => { try { return JSON.parse((bundlePromo as any).filtersMetadata); } catch (e) { return {}; } })() : (bundlePromo as any).filtersMetadata;
      slots = fm?.bundleSlots || fm?.bundle_slots || fm?.slots;
    }
    if (typeof slots === "string") {
      try { slots = JSON.parse(slots); } catch (e) {}
    }
    const comboProds = bundlePromo.comboProducts || (bundlePromo as any).combo_products;
    const specProds = bundlePromo.specificProductIds || (bundlePromo as any).specific_product_ids || (bundlePromo as any).product_ids || (bundlePromo as any).productIds;

    if (comboProds && Array.isArray(comboProds)) {
      const normComboProds = comboProds.map((x: any) => String(x).trim());
      if (pIdStr && normComboProds.includes(pIdStr)) return true;
      if (pBarcodeStr && normComboProds.includes(pBarcodeStr)) return true;
      if (pEanStr && normComboProds.includes(pEanStr)) return true;
      if (productEan && normComboProds.includes(productEan)) return true;
    }

    if (specProds && Array.isArray(specProds) && specProds.length > 0) {
      const normSpecProds = specProds.map((x: any) => String(x).trim());
      if (pIdStr && normSpecProds.includes(pIdStr)) return true;
      if (pBarcodeStr && normSpecProds.includes(pBarcodeStr)) return true;
      if (pEanStr && normSpecProds.includes(pEanStr)) return true;
      if (productEan && normSpecProds.includes(productEan)) return true;
      if (productEan) {
        const cacheKey = `${rule.id}_spec_${matrizProducts.length}`;
        let targetEans = ruleEanCache.get(cacheKey);
        if (!targetEans) {
          targetEans = matrizProducts
            .filter((mp) => mp && normSpecProds.includes(String(mp.id).trim()) && (mp.barcode || (mp as any).ean))
            .map((mp) => (mp.barcode || (mp as any).ean)?.toString().trim() as string);
          ruleEanCache.set(cacheKey, targetEans);
        }
        if (targetEans.includes(productEan)) return true;
      }
    }

    if (!slots || !Array.isArray(slots) || slots.length === 0) return false;

    let slotIdx = 0;
    for (const slot of slots) {
      if (!slot) continue;

      if (Array.isArray(slot)) {
        const normSlotItems = slot.map((x: any) => {
          if (x && typeof x === "object") {
            return String(x.id || x.productId || x.product_id || x.ean || x.barcode || "").trim();
          }
          return String(x).trim();
        }).filter(Boolean);

        if (pIdStr && normSlotItems.includes(pIdStr)) return true;
        if (pBarcodeStr && normSlotItems.includes(pBarcodeStr)) return true;
        if (pEanStr && normSlotItems.includes(pEanStr)) return true;
        if (productEan && normSlotItems.includes(productEan)) return true;
        if (productEan) {
          const cacheKey = `${rule.id}_slot_${slotIdx}_${matrizProducts.length}`;
          let targetEans = ruleEanCache.get(cacheKey);
          if (!targetEans) {
            targetEans = matrizProducts
              .filter((mp) => mp && normSlotItems.includes(String(mp.id).trim()) && (mp.barcode || (mp as any).ean))
              .map((mp) => (mp.barcode || (mp as any).ean)?.toString().trim() as string);
            ruleEanCache.set(cacheKey, targetEans);
          }
          if (targetEans.includes(productEan)) return true;
        }
      } else if (typeof slot === "object") {
        const pIds = (slot.productIds || slot.product_ids || slot.productIdsList || []).map((x: any) => String(x).trim());
        const slotEans = (slot.eans || slot.barcodes || []).map((x: any) => String(x).trim());

        if (pIdStr && (pIds.includes(pIdStr) || slotEans.includes(pIdStr))) return true;
        if (pBarcodeStr && (pIds.includes(pBarcodeStr) || slotEans.includes(pBarcodeStr))) return true;
        if (pEanStr && (pIds.includes(pEanStr) || slotEans.includes(pEanStr))) return true;
        if (productEan && (pIds.includes(productEan) || slotEans.includes(productEan))) return true;

        if (productEan) {
          const cacheKey = `${rule.id}_slot_obj_${slotIdx}_${matrizProducts.length}`;
          let targetEans = ruleEanCache.get(cacheKey);
          if (!targetEans) {
            targetEans = matrizProducts
              .filter((mp) => mp && pIds.includes(String(mp.id).trim()) && (mp.barcode || (mp as any).ean))
              .map((mp) => (mp.barcode || (mp as any).ean)?.toString().trim() as string);
            ruleEanCache.set(cacheKey, targetEans);
          }
          if (targetEans.includes(productEan)) return true;
        }
      }
      slotIdx++;
    }
    return false;
  }

  if (rule.targetType === "ALL") {
    return true;
  }

  return false;
};

function getBundleDiscountForItem(
  item: CartItem,
  promo: PromotionRule,
  cartItems: CartItem[],
  matrizProducts: Product[],
  tenantId?: string
): number {
  if (!promo.bundleSlots || promo.bundleSlots.length < 2 || !promo.bundlePrice) return 0;
  
  // To evaluate EAN matches if needed
  const isNetworkScope = promo.scope === "NETWORK" || (tenantId && promo.tenantId !== tenantId);
  const getProductEan = (id: string) => {
    const p = cartItems.find(c => c.id === id);
    if (p?.barcode) return p.barcode;
    const mp = matrizProducts.find(m => m.id === id);
    return mp?.barcode;
  };

  // Build a pool of available quantities for this promo
  const pool = new Map<string, number>();
  cartItems.forEach(ci => {
    pool.set(ci.id, ci.quantity);
  });
  
  let bundleCount = 0;
  let itemsInBundle: Record<string, number> = {};
  
  while (true) {
    let canFormBundle = true;
    let currentBundleItems = [];
    
    for (const slot of promo.bundleSlots) {
      let foundProductId: string | undefined = undefined;
      // Find a product in the slot that has quantity > 0 in our pool
      for (const id of slot) {
        if ((pool.get(id) || 0) > 0) {
          foundProductId = id;
          break;
        }
        // Try EAN matching if it's network scope
        if (isNetworkScope) {
           const targetEan = getProductEan(id);
           if (targetEan) {
             for (const [cartItemId, qty] of pool.entries()) {
               if (qty > 0 && getProductEan(cartItemId) === targetEan) {
                 foundProductId = cartItemId;
                 break;
               }
             }
           }
        }
        if (foundProductId) break;
      }
      
      if (foundProductId) {
        currentBundleItems.push(foundProductId);
      } else {
        canFormBundle = false;
        break;
      }
    }
    
    if (canFormBundle) {
      // Deduct 1 from each used product
      currentBundleItems.forEach(id => {
        pool.set(id, pool.get(id)! - 1);
        itemsInBundle[id] = (itemsInBundle[id] || 0) + 1;
      });
      bundleCount++;
    } else {
      break;
    }
  }
  
  if (bundleCount === 0) return 0;
  
  let totalBasePriceInBundles = 0;
  for (const [id, qty] of Object.entries(itemsInBundle)) {
    const cartItem = cartItems.find(ci => ci.id === id);
    if (cartItem) {
      totalBasePriceInBundles += cartItem.price * qty;
    }
  }
  
  const totalBundlePrice = bundleCount * promo.bundlePrice;
  const totalDiscount = Math.max(0, totalBasePriceInBundles - totalBundlePrice);
  
  const itemQtyInBundle = itemsInBundle[item.id] || 0;
  if (itemQtyInBundle === 0) return 0;
  
  const itemBasePriceInBundle = item.price * itemQtyInBundle;
  const itemDiscountProportion = totalBasePriceInBundles > 0 ? (itemBasePriceInBundle / totalBasePriceInBundles) : 0;
  
  return totalDiscount * itemDiscountProportion;
}

export const calculateItemPromotionDetails = (
  item: CartItem,
  activePromotions: PromotionRule[] = [],
  matrizProducts: Product[] = [],
  tenantId?: string,
  cartItems?: CartItem[]
): PromotionDetail => {
  const now = new Date();
  const applicablePromos = activePromotions.filter((p) => {
    if (!isPromotionActive(p, now)) return false;
    return checkProductMatchesRule(p, item, matrizProducts, tenantId);
  });

  const baseTotal = item.price * item.quantity;

  if (applicablePromos.length > 0) {
    // Sort to prioritize BUNDLE_FIXED_PRICE and FIXED_COMBO rules or more specific rules
    applicablePromos.sort((a, b) => {
      if (a.type === "BUNDLE_FIXED_PRICE" && b.type !== "BUNDLE_FIXED_PRICE") return -1;
      if (b.type === "BUNDLE_FIXED_PRICE" && a.type !== "BUNDLE_FIXED_PRICE") return 1;
      if (a.type === "FIXED_COMBO" && b.type !== "FIXED_COMBO") return -1;
      if (b.type === "FIXED_COMBO" && a.type !== "FIXED_COMBO") return 1;
      return 0;
    });

    const promo = applicablePromos[0];
    let discountedTotal = baseTotal;

    if (promo.type === "BUNDLE_FIXED_PRICE" && promo.bundleSlots && promo.bundlePrice && cartItems) {
      const discount = getBundleDiscountForItem(item, promo, cartItems, matrizProducts, tenantId);
      return {
        promotionId: promo.id,
        promotionName: promo.name,
        discount: discount,
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
  cartItems?: CartItem[]
): number => {
  const details = calculateItemPromotionDetails(item, activePromotions, matrizProducts, tenantId, cartItems);
  return item.price * item.quantity - details.discount;
};
