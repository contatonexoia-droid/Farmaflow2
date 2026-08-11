import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useDeferredValue,
  useCallback,
} from "react";
import { flushSync } from "react-dom";
import {
  Product,
  PharmacyConfig,
  AppReview,
  isControlledProduct,
  PromotionRule,
  CouponRule,
  isPromotionActive,
  checkProductMatchesRule,
  CartItem,
} from "../types";
import {
  Search,
  Package,
  ShoppingBag,
  Sparkles,
  AlertCircle,
  Bell,
  ShoppingCart,
  ArrowLeft,
  Plus,
  Pill,
  Baby,
  SprayCan,
  Heart,
  Sun,
  Droplets,
  Stethoscope,
  BriefcaseMedical,
  Thermometer,
  User,
  ChevronRight,
  ChevronLeft,
  X,
  Filter,
  ShoppingBasket,
  Percent,
  Layers,
  Factory,
  Star,
  Smile,
  Send,
  AlertTriangle,
  CheckCircle2,
  Tag,
  Copy,
  Flame,
  Gift,
  Clock,
  ChevronDown,
  Info,
} from "lucide-react";
import { saveAppReview, logSearch, getProductsByTenant } from "../services/storage";
import { CouponBanner } from "./CouponBanner";
import { toast } from "react-hot-toast";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  getDepartmentForCategory,
  FALLBACK_DEPARTMENT,
  DEPARTMENT_MAPPING,
} from "../lib/departments";
import { CookieBanner } from "./CookieBanner";

const GENERIC_PLACEHOLDER = "https://i.imgur.com/fLz8F3X.png";

/**
 * Utilitário para corrigir URLs de imagem (Mixed Content & Proxy)
 * Resolve o problema de links HTTP (inseguros) em ambiente HTTPS e portas não padrão.
 */
const fixImageUrl = (url?: string, width: number = 400): string | null => {
  if (!url || url === "IGNORE" || url === "PENDENTE_CURADORIA") return null;
  if (url.startsWith("data:")) return url;

  // Bypass proxy for known CDNs that work well and might block proxies
  if (url.includes("cdn-cosmos.bluesoft.com.br")) {
    return url;
  }

  // Se for uma URL de imagem relativa ou local, não passamos pelo proxy wsrv.nl para evitar falhas/timeouts
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }

  // Otimização de Imagem: Utilizamos o proxy Weserv.nl para:
  // 1. Garantir HTTPS (evitar Mixed Content)
  // 2. Converter para WebP (muito mais leve)
  // 3. Redimensionar se necessário (aqui mantemos original ou limitamos para performance)
  // 4. Cache agressivo via CDN
  const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&q=80&w=${width}&we&default=${encodeURIComponent(GENERIC_PLACEHOLDER)}`;
  return proxyUrl;
};

// Mapa de afinidade terapêutica refinado para incluir Perfumaria e Conveniência obrigatoriamente
const SEARCH_CROSS_SELL_MAP: Record<string, string[]> = {
  dor: ["Analgésico", "Anti-inflamatório", "Doces", "Conveniência", "Higiene"],
  febre: ["Analgésico", "Antigripal", "Termômetro", "Doces"],
  gripe: [
    "Vitamina C",
    "Descongestionante Nasal",
    "Antigripal",
    "Lenço",
    "Conveniência",
  ],
  infantil: ["Higiene Bebê", "Fraldas", "Vitamina", "Doces", "Acessórios"],
  rosto: ["Dermocosmético", "Hidratante", "Perfumaria"],
  pele: ["Dermocosmético", "Hidratante", "Protetor Solar", "Higiene"],
  infec: ["Antibiótico", "Probiótico", "Vitamina", "Higiene"],
  gastro: ["Probiótico", "Antiácido", "Conveniência"],
  vitamin: ["Suplemento", "Minerais", "Higiene"],
  ibuprofeno: ["Analgésico", "Doces", "Absorvente", "Fralda", "Conveniência"],
  dipirona: ["Analgésico", "Doces", "Higiene", "Conveniência"],
  colica: [
    "Antiespasmódico",
    "Analgésico",
    "Bolsa Térmica",
    "Absorvente",
    "Chocolate",
    "Chá",
  ],
  menstrual: [
    "Antiespasmódico",
    "Analgésico",
    "Bolsa Térmica",
    "Absorvente",
    "Chocolate",
    "Chá",
  ],
  estomago: ["Antiácido", "Digestivo", "Chá"],
  enjoo: ["Antiemético", "Digestivo", "Chá"],
  tosse: ["Xarope", "Pastilha", "Mel", "Vitamina C"],
  alergia: ["Antialérgico", "Colírio", "Lenço"],
  olho: ["Colírio", "Soro Fisiológico", "Higiene"],
  nariz: ["Descongestionante Nasal", "Soro Fisiológico", "Lenço"],
  ferida: ["Curativo", "Antisséptico", "Pomada", "Algodão"],
  machucado: ["Curativo", "Antisséptico", "Pomada", "Algodão"],
  queimadura: ["Pomada", "Hidratante", "Curativo"],
  musculo: ["Relaxante Muscular", "Pomada", "Bolsa Térmica", "Analgésico"],
  articulacao: ["Anti-inflamatório", "Pomada", "Suplemento"],
  sono: ["Calmante", "Chá", "Higiene"],
  ansiedade: ["Calmante", "Chá", "Higiene"],
  cabelo: ["Shampoo", "Condicionador", "Vitamina", "Dermocosmético"],
  unha: ["Esmalte", "Removedor", "Vitamina", "Higiene"],
  boca: ["Antisséptico Bucal", "Fio Dental", "Escova", "Creme Dental"],
  dente: [
    "Antisséptico Bucal",
    "Fio Dental",
    "Escova",
    "Creme Dental",
    "Analgésico",
  ],
  sexo: ["Preservativo", "Lubrificante", "Higiene Íntima"],
  intimo: ["Higiene Íntima", "Absorvente", "Sabonete Íntimo"],
  diarreia: ["Probiótico", "Soro", "Antidiarreico", "Higiene"],
  "prisao de ventre": ["Laxante", "Fibras", "Probiótico"],
  constipacao: ["Laxante", "Fibras", "Probiótico"],
  azia: ["Antiácido", "Digestivo"],
  ressaca: [
    "Analgésico",
    "Antiácido",
    "Engov",
    "Epocler",
    "Hidratação",
    "Doces",
  ],
};

const TYPO_MAP: Record<string, string> = {
  doflex: "dorflex",
  neosadina: "neosaldina",
  dipiron: "dipirona",
  ibuprofen: "ibuprofeno",
  paracetamo: "paracetamol",
  tilenol: "tylenol",
  advil: "advil",
  buscopan: "buscopan",
  buscopa: "buscopan",
  epocler: "epocler",
  epocle: "epocler",
  eno: "eno",
  "sal de fruta": "sal de frutas",
  sorine: "sorine",
  neosoro: "neosoro",
  neosor: "neosoro",
  rinso: "rinso",
  rinossoro: "rinosoro",
  dorfe: "dorflex",
  dorflx: "dorflex",
  tyleno: "tylenol",
  shamp: "shampoo",
  shampo: "shampoo",
  xamp: "xampu",
  xampo: "xampu",
};

const SYNONYM_MAP: Record<string, string[]> = {
      absorvente: [
        "absorvente",
        "abs",
        "protetor",
        "intimo",
        "calcinha",
        "tampa",
        "diario",
      ],
      abs: ["absorvente", "abs"],
      gotas: ["gotas", "gts"],
      gts: ["gotas", "gts"],
      comprimido: ["comprimido", "comprimidos", "cp", "cpl", "cpr"],
      comprimidos: ["comprimido", "comprimidos", "cp", "cpl", "cpr"],
      cp: ["comprimido", "comprimidos", "cp", "cpl", "cpr"],
      cpl: ["comprimido", "comprimidos", "cp", "cpl", "cpr"],
      cpr: ["comprimido", "comprimidos", "cp", "cpl", "cpr"],
      paracetamol: ["paracetamol", "tylenol"],
      tylenol: ["paracetamol", "tylenol"],
      dipirona: ["dipirona", "novalgina"],
      novalgina: ["dipirona", "novalgina"],
      ibuprofeno: ["ibuprofeno", "alivium"],
      alivium: ["ibuprofeno", "alivium"],
      desodorante: [
        "desodorante",
        "antitranspirante",
        "rollon",
        "roll-on",
        "aerosol",
      ],
      remedio: [
        "medicamento",
        "comprimido",
        "gotas",
        "xarope",
        "pilula",
        "capsula",
      ],
      cabelo: [
        "shampoo",
        "condicionador",
        "creme",
        "mascara",
        "tinta",
        "coloracao",
      ],
      pele: ["hidratante", "protetor solar", "creme", "locao", "sabonete"],
      higiene: [
        "sabonete",
        "desodorante",
        "creme dental",
        "escova",
        "fio dental",
        "enxaguante",
        "cotonete",
        "papel higienico",
        "higiene intima",
      ],
      bebe: [
        "fralda",
        "lenco umedecido",
        "chupeta",
        "mamadeira",
        "pomada",
        "pomadinha",
      ],
      shampoo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
      sh: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
      xampu: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
      shamp: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
      shampo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
      xamp: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
      xampo: ["shampoo", "sh", "xampu", "champu", "shamp", "shampo", "xamp", "xampo"],
  };


const levenshteinDistance = (s1: string, s2: string) => {
  if (s1.length < s2.length) return levenshteinDistance(s2, s1);
  if (s2.length === 0) return s1.length;
  let previousRow = Array.from({ length: s2.length + 1 }, (_, i) => i);
  for (let i = 0; i < s1.length; i++) {
    let currentRow = [i + 1];
    for (let j = 0; j < s2.length; j++) {
      let insertions = previousRow[j + 1] + 1;
      let deletions = currentRow[j] + 1;
      let substitutions = previousRow[j] + (s1[i] === s2[j] ? 0 : 1);
      currentRow.push(Math.min(insertions, deletions, substitutions));
    }
    previousRow = currentRow;
  }
  return previousRow[s2.length];
};

interface StorefrontProps {
  tenant: PharmacyConfig;
  products: Product[];
  promotions?: PromotionRule[];
  coupons?: CouponRule[];
  cartCount: number;
  cartItems?: CartItem[];
  onAddToCart: (
    product: Product,
    isMainProduct?: boolean,
    showGlobalToast?: boolean,
  ) => void;
  onProductClick: (product: Product) => void;
  onOpenCart: () => void;
  onBack?: () => void;
  onSearch?: (term: string, count: number) => void;
}

const normalizeStr = (str: string) =>
  (str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const STOP_WORDS = new Set([
  "de",
  "para",
  "com",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "o",
  "a",
  "os",
  "as",
  "em",
  "um",
  "uma",
  "na",
  "no",
  "nas",
  "nos",
]);

const singularize = (word: string) => {
  if (word.length <= 3) return word; // Prevent ruining short acronyms/words
  if (word.endsWith("oes")) return word.slice(0, -3) + "ao";
  if (word.endsWith("aes")) return word.slice(0, -3) + "ao";
  if (word.endsWith("ais")) return word.slice(0, -3) + "al";
  if (word.endsWith("eis")) return word.slice(0, -3) + "el";
  if (word.endsWith("ois")) return word.slice(0, -3) + "ol";
  if (word.endsWith("uis")) return word.slice(0, -3) + "ul";
  if (word.endsWith("ns")) return word.slice(0, -2) + "m";
  if (word.endsWith("zes") || word.endsWith("res")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
};

const getCategoryIcon = (categoryName: string) => {
  const lower = normalizeStr(categoryName);
  if (
    lower.includes("anti") ||
    lower.includes("medicament") ||
    lower.includes("remedio")
  )
    return <Pill size={16} />;
  if (lower.includes("infantil") || lower.includes("bebe"))
    return <Baby size={16} />;
  if (lower.includes("dermo") || lower.includes("beleza"))
    return <SprayCan size={16} />;
  if (lower.includes("higiene") || lower.includes("banho"))
    return <Droplets size={16} />;
  if (lower.includes("saude") || lower.includes("vitamin"))
    return <Heart size={16} />;
  if (lower.includes("aparelho")) return <Thermometer size={16} />;
  return <BriefcaseMedical size={16} />;
};

const getDepartmentIcon = (deptName: string) => {
  if (deptName === "Todos") return <Package size={28} />;
  switch (deptName) {
    case "Medicamentos":
      return <Pill size={28} />;
    case "Higiene e Banho":
      return <Droplets size={28} />;
    case "Beleza e Dermo":
      return <SprayCan size={28} />;
    case "Mamãe e Bebê":
      return <Baby size={28} />;
    case "Bem-estar e Vitaminas":
      return <Sun size={28} />;
    case "Cuidados com a Saúde":
      return <Heart size={28} />;
    case "Conveniência":
      return <ShoppingBasket size={28} />;
    default:
      return <Package size={28} />;
  }
};

const getPromoIcon = (iconName?: string) => {
  switch (iconName) {
    case "Flame":
      return Flame;
    case "Gift":
      return Gift;
    case "Tag":
      return Tag;
    case "Sparkles":
      return Sparkles;
    case "Clock":
      return Clock;
    case "Percent":
      return Percent;
    default:
      return Tag;
  }
};

const ProductCard = React.memo(
  ({
    product,
    tenant,
    promotions = [],
    onProductClick,
    onAddToCart,
    onNotify,
    isCompact,
    priority = false,
    isProductInRule,
    cartItems = [],
  }: {
    product: Product;
    tenant: PharmacyConfig;
    promotions?: PromotionRule[];
    onProductClick: (p: Product) => void;
    onAddToCart: (e: any, p: Product) => void;
    onNotify: (e: any, p: Product) => void;
    isCompact?: boolean;
    priority?: boolean;
    isProductInRule?: (rule: PromotionRule | CouponRule, p: Product) => boolean;
    cartItems?: CartItem[];
  }) => {
    const isOutOfStock = product.stock <= 0;
    const cartItem = cartItems?.find((item) => item.id === product.id);
    const itemQuantity = cartItem ? (cartItem.quantity || 0) : 0;
    const hasDiscount = Boolean(
      product.promotionType === "DISCOUNT" &&
      product.originalPrice &&
      product.originalPrice > product.price
    );
    const isKit = Boolean(product.promotionType === "BUY_X_PAY_Y");
    const isDiscountOnQty = Boolean(product.promotionType === "DISCOUNT_ON_QTY");

    const activePromo = promotions.find((p) => {
      // The promotions array passed here generally comes from activePromotions,
      // but to be absolutely safe without needing real-time currentTime:
      if (isProductInRule) {
        return isProductInRule(p, product);
      }
      
      if (p.targetType === "PRODUCT" && p.targetValue === product.id)
        return true;
      if (p.targetType === "CATEGORY" && p.targetValue === product.category)
        return true;
      if (
        p.targetType === "MANUFACTURER" &&
        p.targetValue === product.manufacturer
      )
        return true;
      if (
        p.targetType === "SPECIFIC_SELECTION" &&
        p.specificProductIds?.includes(product.id)
      )
        return true;
      return false;
    });

    let currentPrice = product.price;
    let fallbackOriginalPrice = product.originalPrice ?? product.price;
    let promoDescription = "";

    if (activePromo) {
      if (activePromo.type === "LIGHTNING_OFFER") {
        if (
          activePromo.lightningDiscountPercentage &&
          activePromo.lightningDiscountPercentage > 0
        ) {
          currentPrice =
            product.price * (1 - activePromo.lightningDiscountPercentage / 100);
          promoDescription = "OFERTA RELÂMPAGO";
        } else if (activePromo.buyX && activePromo.payY) {
          currentPrice = activePromo.payY / activePromo.buyX;
          promoDescription = `OFERTA RELÂMPAGO: R$ ${currentPrice.toFixed(2)} cada no combo`;
        }
      } else if (
        activePromo.type === "BUY_X_PAY_Y" &&
        activePromo.buyX &&
        activePromo.payY
      ) {
        currentPrice = (product.price * activePromo.payY) / activePromo.buyX;
        promoDescription = `Nesta promoção, cada unidade sai por R$ ${currentPrice.toFixed(2)}`;
      } else if (
        activePromo.type === "FIXED_COMBO" &&
        activePromo.buyX &&
        activePromo.payY
      ) {
        currentPrice = activePromo.payY / activePromo.buyX;
        promoDescription = `Combo: R$ ${currentPrice.toFixed(2)} cada no combo`;
      } else if (
        activePromo.type === "PROGRESSIVE_DISCOUNT" &&
        activePromo.discountThresholds?.[0]
      ) {
        currentPrice =
          product.price *
          (1 - activePromo.discountThresholds[0].discountPercentage / 100);
        promoDescription = `A partir de ${activePromo.discountThresholds[0].qty} unidades`;
      }
    } else if (isKit) {
      currentPrice =
        (product.price * (product.payY || 0)) / (product.buyX || 1);
      promoDescription = `Nesta promoção, cada unidade sai por apenas R$ ${currentPrice.toFixed(2)}`;
    } else if (isDiscountOnQty) {
      currentPrice =
        product.price * (1 - (product.discountQtyPercentage || 0) / 100);
      promoDescription = `Leve ${product.discountQtyThreshold} ou mais por R$ ${currentPrice.toFixed(2)} cada`;
    }

    // Force original price to show crossed if there is an active discount
    const showOriginalPrice = Boolean(hasDiscount || currentPrice < product.price);
    const finalOriginalPrice = showOriginalPrice
      ? hasDiscount
        ? Math.max(product.originalPrice || 0, product.price)
        : product.price
      : product.price;

    const [imgError, setImgError] = useState(false);
    const [isAdding, setIsAdding] = useState(false);

    let displayImage = fixImageUrl(product.image);
    const isGeneric =
      product.drugType?.trim().toLowerCase() === "genérico" ||
      product.drugType?.trim().toLowerCase() === "generico";
    if (!displayImage && isGeneric) {
      const mfgKey = product.manufacturer
        ? Object.keys(tenant.manufacturerLogos || {}).find(
            (k) =>
              k.trim().toLowerCase() ===
              product.manufacturer?.trim().toLowerCase(),
          )
        : null;
      if (mfgKey && tenant.manufacturerLogos?.[mfgKey]) {
        displayImage = fixImageUrl(tenant.manufacturerLogos[mfgKey]);
      } else {
        displayImage = GENERIC_PLACEHOLDER;
      }
    }

    const handleAddToCart = (e: React.MouseEvent) => {
      e.stopPropagation();

      // Fly to cart animation
      const button = e.currentTarget as HTMLButtonElement;
      const rect = button.getBoundingClientRect();

      const ghost = document.createElement("div");
      ghost.className =
        "fixed z-[9999] w-5 h-5 rounded-full shadow-lg pointer-events-none flex items-center justify-center";
      ghost.style.backgroundColor = tenant.primaryColor;
      ghost.style.left = `${rect.left + rect.width / 2 - 10}px`;
      ghost.style.top = `${rect.top + rect.height / 2 - 10}px`;
      ghost.style.transition = "all 0.6s cubic-bezier(0.25, 1, 0.5, 1)";
      document.body.appendChild(ghost);

      // Trigger reflow
      void ghost.offsetWidth;

      // Find cart icon
      const cartIcon = document.getElementById("floating-cart-btn");
      if (cartIcon) {
        const cartRect = cartIcon.getBoundingClientRect();
        ghost.style.left = `${cartRect.left + cartRect.width / 2 - 10}px`;
        ghost.style.top = `${cartRect.top + cartRect.height / 2 - 10}px`;
        ghost.style.transform = "scale(0.2)";
        ghost.style.opacity = "0.5";
      } else {
        ghost.style.transform = "translateY(-100px) scale(0)";
        ghost.style.opacity = "0";
      }

      setTimeout(() => {
        if (document.body.contains(ghost)) {
          document.body.removeChild(ghost);
        }
      }, 600);

      // Button state
      setIsAdding(true);
      onAddToCart(e, product);

      setTimeout(() => {
        setIsAdding(false);
      }, 500);
    };

    const handleMouseEnter = () => {
      // Pre-fetch high-res image on hover
      if (displayImage && displayImage !== GENERIC_PLACEHOLDER) {
        const highResUrl = displayImage.replace("w=400", "w=800");
        const img = new Image();
        img.src = highResUrl;
      }
    };

    return (
      <div
        className={`bg-white rounded-[1.5rem] md:rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col group h-full ${isOutOfStock ? "opacity-80" : ""} ${!isCompact ? "w-full" : ""} ${isCompact ? "min-w-[140px] md:min-w-[180px]" : ""} ${product.isFeatured ? "ring-2 ring-yellow-400 ring-inset" : ""} ${(product as any)._justUpdated ? "ring-2 ring-orange-400 ring-inset scale-[1.02]" : ""}`}
        onMouseEnter={handleMouseEnter}
      >
        <div
          className={`relative cursor-pointer flex items-center justify-center overflow-hidden bg-white ${isCompact ? "h-24 md:h-32 p-2" : "h-32 md:h-44 p-3"}`}
          onClick={() => onProductClick(product)}
        >
          {itemQuantity > 0 && (
            <span className="cart-item-quantity-badge absolute top-2 left-2 z-10 bg-emerald-600 text-white font-black text-[9px] md:text-[10px] px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1 animate-in zoom-in duration-200">
              <ShoppingBag size={10} strokeWidth={3} />
              {itemQuantity}
            </span>
          )}

          {displayImage && !imgError ? (
            <picture>
              <source srcSet={displayImage} type="image/webp" />
              <img
                src={displayImage.replace("&output=webp", "&output=jpeg")}
                className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-500"
                alt={product.name}
                onError={() => setImgError(true)}
                loading={priority ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={priority ? "high" : "auto"}
                referrerPolicy="no-referrer"
              />
            </picture>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-2xl">
              <Package className="text-gray-200" size={24} />
            </div>
          )}

          {!isOutOfStock &&
            Boolean(
              hasDiscount ||
              isKit ||
              isDiscountOnQty ||
              activePromo ||
              product.isFeatured ||
              (product as any)._justUpdated
            ) && (
              <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                {Boolean((product as any)._justUpdated) && (
                  <span className="bg-orange-500 text-white px-2 py-0.5 rounded-lg text-[7px] md:text-[9px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 animate-pulse">
                    Atualizado
                  </span>
                )}
                {Boolean(product.isFeatured) && (
                  <span className="bg-yellow-400 text-white px-2 py-0.5 rounded-lg text-[7px] md:text-[9px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1">
                    <Star size={10} fill="currentColor" strokeWidth={4} />{" "}
                    Destaque
                  </span>
                )}
                {Boolean(activePromo) && (
                  <span className="bg-red-600 text-white px-2 py-0.5 rounded-lg text-[7px] md:text-[9px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 animate-pulse">
                    <Tag size={10} strokeWidth={4} />
                    {activePromo.type === "BUY_X_PAY_Y"
                      ? `Leve ${activePromo.buyX} Pague ${activePromo.payY}`
                      : activePromo.type === "LIGHTNING_OFFER" &&
                          activePromo.lightningDiscountPercentage
                        ? `GANHE ${activePromo.lightningDiscountPercentage}% OFF`
                        : activePromo.type === "LIGHTNING_OFFER" &&
                            activePromo.buyX &&
                            activePromo.payY
                          ? `Leve ${activePromo.buyX} por R$ ${activePromo.payY.toFixed(2).replace(".", ",")}`
                          : activePromo.name}
                  </span>
                )}
                {Boolean(hasDiscount && !activePromo) && (
                  <span className="bg-red-500 text-white px-2 py-0.5 rounded-lg text-[7px] md:text-[9px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 animate-pulse">
                    <Percent size={10} strokeWidth={4} /> Oferta
                  </span>
                )}
                {Boolean(isKit) && (
                  <span className="bg-red-600 text-white px-2 py-0.5 rounded-lg text-[7px] md:text-[9px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 animate-pulse">
                    <Layers size={10} strokeWidth={4} /> PROMOÇÃO: Leve{" "}
                    {product.buyX} Pague {product.payY}
                  </span>
                )}
                {Boolean(isDiscountOnQty) && (
                  <span className="bg-red-600 text-white px-2 py-0.5 rounded-lg text-[7px] md:text-[9px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1 animate-pulse">
                    <Percent size={10} strokeWidth={4} /> PROMOÇÃO: A partir de{" "}
                    {product.discountQtyThreshold} unidades, ganhe{" "}
                    {product.discountQtyPercentage}% OFF
                  </span>
                )}
              </div>
            )}

          {isOutOfStock && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center z-10">
              <span className="bg-gray-900 text-white px-2 py-1 rounded-xl font-black uppercase tracking-widest text-[7px] md:text-[8px]">
                Esgotado
              </span>
            </div>
          )}
        </div>

        <div
          className={`${isCompact ? "p-2" : "p-3 md:p-4"} pt-0 flex-1 flex flex-col`}
        >
          {!isCompact && (
            <div className="flex flex-col mb-1">
              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest truncate text-gray-400">
                {product.category}
              </span>
              {product.manufacturer && product.manufacturer !== "Outros" && (
                <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest truncate text-emerald-600">
                  {product.manufacturer}
                </span>
              )}
            </div>
          )}
          <h3
            className={`font-bold text-gray-900 line-clamp-2 leading-snug ${isCompact ? "text-[10px] md:text-[12px] mb-1" : "text-[11px] md:text-[13px] mb-0.5"}`}
          >
            {product.name}
          </h3>
          {product.presentation && (
            <p
              className={`text-gray-400 font-bold uppercase tracking-tight mb-2 ${isCompact ? "text-[7px] md:text-[8px]" : "text-[8px] md:text-[10px]"}`}
            >
              {product.presentation}
            </p>
          )}
          {isControlledProduct(product) && (
            <div className="mb-2">
              <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest flex items-center gap-1 w-fit">
                <AlertTriangle size={8} /> Receita
              </span>
            </div>
          )}
          <div className="flex flex-col gap-2 mt-auto">
            <div>
              {showOriginalPrice && (
                <p className="text-[9px] md:text-[11px] text-gray-400 font-bold line-through leading-none mb-0.5">
                  R$ {finalOriginalPrice.toFixed(2)}
                </p>
              )}
              <p
                className={`font-black ${showOriginalPrice ? "text-red-600" : "text-gray-900"} ${isCompact ? "text-xs md:text-sm" : "text-sm md:text-lg"}`}
              >
                R$ {currentPrice.toFixed(2)}
              </p>
              {promoDescription && !isCompact && (
                <p className="text-[8px] md:text-[9px] text-emerald-600 font-bold mt-1 leading-tight">
                  {promoDescription}
                </p>
              )}
            </div>

            {isOutOfStock ? (
              <button
                onClick={(e) => onNotify(e, product)}
                className="w-full py-2 bg-gray-900 text-white rounded-xl font-black text-[7px] md:text-[8px] uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-1.5"
              >
                <AlertCircle size={12} /> Avise-me quando chegar
              </button>
            ) : (
              <button
                onClick={handleAddToCart}
                disabled={isAdding}
                className={`w-full py-2 rounded-xl flex items-center justify-center text-white shadow-lg active:scale-95 transition-all font-black text-[9px] md:text-[10px] uppercase gap-2 ${isAdding ? "scale-95 opacity-90" : ""}`}
                style={{
                  backgroundColor: isAdding ? "#10b981" : tenant.primaryColor,
                }}
              >
                {isAdding ? (
                  <>
                    <CheckCircle2
                      size={14}
                      strokeWidth={3}
                      className="animate-in zoom-in duration-200"
                    />{" "}
                    Adicionado
                  </>
                ) : (
                  <>
                    <Plus size={14} strokeWidth={3} /> Adicionar
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

const SearchInput = ({
  initialValue,
  onChange,
  onFocus,
  onSubmit,
}: {
  initialValue: string;
  onChange: (val: string) => void;
  onFocus: () => void;
  onSubmit: () => void;
}) => {
  const [localValue, setLocalValue] = useState(initialValue);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      onChange(val);
    }, 300);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    onChange(localValue);
    onSubmit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative w-full max-w-2xl mx-auto z-50"
    >
      <button
        type="submit"
        className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 bg-transparent border-none"
      >
        <Search size={16} />
      </button>
      <input
        type="text"
        placeholder="O que você precisa hoje?"
        className="w-full bg-white pl-12 pr-6 py-2.5 md:py-3 rounded-full font-bold shadow-md outline-none focus:ring-4 focus:ring-white/20 transition-all text-gray-900 border-none text-sm"
        value={localValue}
        onChange={handleChange}
        onFocus={onFocus}
      />
    </form>
  );
};

const SmartBanner: React.FC<{
  searchTerm: string;
  selectedCategory: string;
  onCategorySelect: (cat: string) => void;
  tenant: PharmacyConfig;
}> = ({ searchTerm, selectedCategory, onCategorySelect, tenant }) => {
  const [bannerState, setBannerState] = useState<
    "health" | "beauty" | "kids" | "default"
  >("default");

  useEffect(() => {
    if (!tenant.enableSmartBanners) {
      setBannerState("default");
      return;
    }

    const normalize = (s: string) =>
      (s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const term = normalize(searchTerm);
    const cat = normalize(selectedCategory);

    const isHealth =
      term.includes("dipirona") ||
      term.includes("paracetamol") ||
      term.includes("dor") ||
      term.includes("febre") ||
      term.includes("analgesico") ||
      term.includes("ibuprofeno") ||
      cat.includes("medicamento") ||
      cat.includes("saude");
    const isHygiene =
      term.includes("desodorante") ||
      term.includes("shampoo") ||
      term.includes("sh") ||
      term.includes("xampu") ||
      term.includes("sabonete") ||
      cat.includes("higiene") ||
      cat.includes("beleza") ||
      cat.includes("perfumaria");
    const isBaby =
      term.includes("fralda") ||
      term.includes("bebe") ||
      term.includes("infantil") ||
      cat.includes("infantil");

    if (isHealth && tenant.smartBanners?.["health"]?.enabled !== false) {
      setBannerState("health");
    } else if (isBaby && tenant.smartBanners?.["kids"]?.enabled !== false) {
      setBannerState("kids");
    } else if (
      isHygiene &&
      tenant.smartBanners?.["beauty"]?.enabled !== false
    ) {
      setBannerState("beauty");
    } else {
      setBannerState("default");
    }
  }, [
    searchTerm,
    selectedCategory,
    tenant.enableSmartBanners,
    tenant.smartBanners,
  ]);

  useEffect(() => {
    if (!tenant.enableSmartBanners) return;
    if (searchTerm || selectedCategory !== "Todos") return;

    const isBeautyEnabled = tenant.smartBanners?.["beauty"]?.enabled !== false;
    const isDefaultEnabled =
      tenant.smartBanners?.["default"]?.enabled !== false;

    if (!isBeautyEnabled || !isDefaultEnabled) return;

    const interval = setInterval(() => {
      setBannerState((prev) => {
        if (prev === "default") return "beauty";
        if (prev === "beauty") return "default";
        return "default";
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [
    tenant.enableSmartBanners,
    tenant.smartBanners,
    searchTerm,
    selectedCategory,
  ]);

  const defaultBanners = {
    health: {
      text: "🩺 Cuide de quem você ama: Kit Imunidade com 15% OFF.",
      action: () => onCategorySelect("Vitamina"),
      bg: "bg-blue-50 text-blue-700 border-blue-100",
    },
    beauty: {
      text: "✨ Rotina de autocuidado: Leve 3 desodorantes, pague 2.",
      action: () => onCategorySelect("Higiene"),
      bg: "bg-purple-50 text-purple-700 border-purple-100",
    },
    kids: {
      text: "👶 Mundo Baby: Descontos especiais em fraldas e leites.",
      action: () => onCategorySelect("Infantil"),
      bg: "bg-pink-50 text-pink-700 border-pink-100",
    },
    default: {
      text: "🚀 Entrega Flash: Peça agora e receba em até 60 minutos!",
      action: null,
      bg: "bg-emerald-50 text-emerald-700 border-emerald-100",
    },
  };

  const currentTheme = bannerState;

  if (!tenant.enableSmartBanners) return null;

  const isCurrentBannerEnabled =
    tenant.smartBanners?.[currentTheme]?.enabled !== false;
  if (!isCurrentBannerEnabled) return null;

  const customImage = tenant.smartBanners?.[currentTheme]?.imageUrl;
  const fallbackBanner = defaultBanners[currentTheme];

  if (customImage) {
    return (
      <div
        className="w-full h-32 md:h-48 rounded-3xl mb-8 overflow-hidden cursor-pointer shadow-md hover:shadow-lg transition-all"
        onClick={fallbackBanner.action ? fallbackBanner.action : undefined}
      >
        <img
          src={customImage}
          alt={`Banner ${currentTheme}`}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div
      className={`w-full py-3 px-4 rounded-2xl border mb-6 flex items-center justify-between transition-all duration-500 shadow-sm ${fallbackBanner.bg} ${fallbackBanner.action ? "cursor-pointer hover:shadow-md" : ""}`}
      onClick={fallbackBanner.action ? fallbackBanner.action : undefined}
    >
      <span className="font-bold text-sm md:text-base">
        {fallbackBanner.text}
      </span>
      {fallbackBanner.action && (
        <ChevronRight size={20} className="opacity-50" />
      )}
    </div>
  );
};

// Generic component for horizontal scrolling with fade overlay and arrow navigation
const ScrollableRow: React.FC<{
  children: React.ReactNode;
  wrapperClassName?: string;
  innerClassName?: string;
}> = ({ children, wrapperClassName = "", innerClassName = "" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);

  const checkScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(Math.ceil(scrollLeft + clientWidth) < scrollWidth);
    }
  }, []);

  useEffect(() => {
    checkScroll();
    const currentRef = containerRef.current;
    if (currentRef) {
      currentRef.addEventListener("scroll", checkScroll, { passive: true });
      window.addEventListener("resize", checkScroll, { passive: true });
      // Recheck when children change/load
      const observer = new MutationObserver(checkScroll);
      observer.observe(currentRef, { childList: true, subtree: true });
      return () => {
        currentRef.removeEventListener("scroll", checkScroll);
        window.removeEventListener("resize", checkScroll);
        observer.disconnect();
      };
    }
  }, [checkScroll, children]);

  const scrollBy = (direction: "left" | "right") => {
    if (containerRef.current) {
      const scrollAmount = Math.max(containerRef.current.clientWidth / 2, 200);
      containerRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className={`relative group ${wrapperClassName}`}>
      <div
        ref={containerRef}
        className={`overflow-x-auto no-scrollbar scrollbar-none snap-x snap-mandatory ${innerClassName}`}
      >
        {children}
      </div>

      {/* Fade Overlays */}
      <div
        className={`absolute top-0 right-0 bottom-0 w-16 bg-gradient-to-l from-white to-transparent pointer-events-none transition-opacity duration-300 z-10 ${showRightArrow ? "opacity-100" : "opacity-0"}`}
      ></div>
      <div
        className={`absolute top-0 left-0 bottom-0 w-16 bg-gradient-to-r from-white to-transparent pointer-events-none transition-opacity duration-300 z-10 ${showLeftArrow ? "opacity-100" : "opacity-0"}`}
      ></div>

      {/* Navigation Arrows (Desktop Only) */}
      <button
        onClick={() => scrollBy("left")}
        className={`hidden md:flex absolute top-1/2 left-2 -translate-y-1/2 z-20 w-8 h-8 items-center justify-center rounded-full bg-white text-gray-700 shadow-md border border-gray-100 opacity-0 group-hover:opacity-100 hover:scale-110 hover:bg-gray-50 transition-all ${!showLeftArrow && "pointer-events-none !opacity-0"}`}
        aria-label="Scroll left"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        onClick={() => scrollBy("right")}
        className={`hidden md:flex absolute top-1/2 right-2 -translate-y-1/2 z-20 w-8 h-8 items-center justify-center rounded-full bg-white text-gray-700 shadow-md border border-gray-100 opacity-0 group-hover:opacity-100 hover:scale-110 hover:bg-gray-50 transition-all ${!showRightArrow && "pointer-events-none !opacity-0"}`}
        aria-label="Scroll right"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
};

const HighlightText: React.FC<{ text: string; query: string }> = ({
  text,
  query,
}) => {
  if (!query) return <>{text}</>;

  const tokens = query
    .split(/\s+/)
    .filter((t) => t.trim().length > 0)
    .sort((a, b) => b.length - a.length);

  if (tokens.length === 0) return <>{text}</>;

  const escapeRegExp = (str: string) =>
    str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const safePattern = tokens
    .map((t) => {
      if (t.length === 1) {
        return `\\b${escapeRegExp(t)}\\b`;
      }
      return escapeRegExp(t);
    })
    .join("|");

  const regex = new RegExp(`(${safePattern})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        part && tokens.some((t) => part.toLowerCase() === t.toLowerCase()) ? (
          <mark
            key={i}
            className="bg-emerald-100 text-emerald-800 rounded-[4px] px-0.5 font-bold"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
};

export const Storefront: React.FC<StorefrontProps> = ({
  tenant,
  products,
  promotions = [],
  coupons = [],
  cartCount,
  cartItems = [],
  onAddToCart,
  onProductClick,
  onOpenCart,
  onBack,
  onSearch,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [matrizProducts, setMatrizProducts] = useState<Product[]>([]);
  const [visibleCount, setVisibleCount] = useState(42);

  useEffect(() => {
    if (tenant?.networkId && tenant.networkId !== tenant.id) {
      getProductsByTenant(tenant.networkId, setMatrizProducts).catch(console.error);
    }
  }, [tenant?.networkId, tenant?.id]);
  useEffect(() => {
    if (tenant?.id) {
      const hostname = window.location.hostname;
      const sessionKey = `farmaflow_visited_${hostname}_${tenant.slug || tenant.id}`;
      if (!sessionStorage.getItem(sessionKey)) {
        sessionStorage.setItem(sessionKey, "true");
        fetch(`/api/v1/analytics/${tenant.id}/view`, { method: "POST" }).catch(
          console.error,
        );
      }
    }
  }, [tenant]);

  useEffect(() => {
    const handleSetCategory = (e: any) => {
      setFilters((prev) => ({ ...prev, termo_busca: e.detail, categoria: "Todos", departamento: "Todos", promocao_id: null, cupom_id: null }));
    };
    window.addEventListener("ff_search", handleSetCategory);
    return () => window.removeEventListener("ff_search", handleSetCategory);
  }, []);

  const [filters, setFilters] = useState<{
    departamento: string | null;
    categoria: string | null;
    promocao_id: string | null;
    cupom_id: string | null;
    termo_busca: string;
  }>({
    departamento: "Todos",
    categoria: "Todos",
    promocao_id: null,
    cupom_id: null,
    termo_busca: "",
  });

  // Reset pagination when search or filters change to keep initial results fast
  useEffect(() => {
    setVisibleCount(42);
  }, [filters.termo_busca, filters.categoria, filters.departamento, filters.promocao_id, filters.cupom_id]);

  const selectedDepartment = filters.departamento || "Todos";
  const selectedCategory = filters.categoria || "Todos";
  const searchTerm = filters.termo_busca;
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const productsContainerRef = useRef<HTMLElement>(null);

  const inheritedPromotions = useMemo(() => {
    if (!promotions || !Array.isArray(promotions)) return [];
    return promotions.filter((p) => {
      const isCurrentTenant = p.tenantId === tenant.id;
      const isNetworkShared =
        tenant.networkId &&
        (p.tenantId === tenant.networkId || p.tenantId === tenant.id);
      
      if (isCurrentTenant) {
        return true;
      }
      
      if (isNetworkShared && p.filtersMetadata) {
        const branchIds = p.filtersMetadata.branchIds;
        if (Array.isArray(branchIds) && branchIds.length > 0) {
          return branchIds.includes(tenant.id);
        }
      }
      return isCurrentTenant || isNetworkShared;
    });
  }, [promotions, tenant.id, tenant.networkId]);

  const inheritedCoupons = useMemo(() => {
    if (!coupons || !Array.isArray(coupons)) return [];
    return coupons.filter((c) => {
      // 1. O cupom deve estar ativo
      if (!c.isActive) return false;

      // 2. Regra de herança:
      // O cupom é da própria loja OU pertence à rede/matriz
      const ehDaLoja = c.tenantId === tenant.id;
      const ehDaRede = (c.networkId === tenant.networkId || c.tenantId === tenant.networkId);

      // 3. Se houver filiais específicas no alvo, a filial atual deve estar inclusa
      const targetBranches = c.targetBranchIds || c.filtersMetadata?.branchIds || [];
      const inclusaNoTarget = ehDaLoja || targetBranches.length === 0 || targetBranches.includes(tenant.id);

      return ehDaLoja || (ehDaRede && inclusaNoTarget);
    });
  }, [coupons, tenant.id, tenant.networkId]);

  const topBannerCoupons = useMemo(() => {
    return inheritedCoupons.filter((c) => {
      if (c.couponScope === "GLOBAL") return false;
      if (c.targetType === "ALL") return false;
      if (c.targetType === "SPECIFIC_SELECTION" && (!c.specificProductIds || c.specificProductIds.length === 0)) return false;
      return true;
    });
  }, [inheritedCoupons]);

  // Efficient real-time synchronization
  const [activePromoIds, setActivePromoIds] = useState("");

  useEffect(() => {
    const getActiveIds = () => {
      const now = new Date();
      return inheritedPromotions
        .filter((p) => isPromotionActive(p, now))
        .map((p) => p.id)
        .sort()
        .join(",");
    };

    // Initial check
    setActivePromoIds(getActiveIds());

    const timer = setInterval(() => {
      const currentIds = getActiveIds();
      setActivePromoIds((prev) => (prev !== currentIds ? currentIds : prev));
    }, 1000);

    return () => clearInterval(timer);
  }, [inheritedPromotions]);

  const activePromotions = useMemo(() => {
    const idSet = new Set(activePromoIds.split(",").filter(Boolean));
    return inheritedPromotions.filter((p) => idSet.has(p.id));
  }, [inheritedPromotions, activePromoIds]);

  const selectedPromotion = useMemo(() => {
    const p = activePromotions.find((p) => p.id === filters.promocao_id);
    if (!p) return null;
    return p;
  }, [activePromotions, filters.promocao_id]);

  const activeCouponFilter = useMemo(
    () => inheritedCoupons.find((c) => c.id === filters.cupom_id && c.couponScope !== "GLOBAL") || null,
    [inheritedCoupons, filters.cupom_id],
  );

  const activeGlobalCoupon = useMemo(() => {
    if (!inheritedCoupons || !Array.isArray(inheritedCoupons)) return null;
    return (
      inheritedCoupons.find((c) => {
        if (c?.couponScope !== "GLOBAL" || !c?.isActive) return false;
        const now = new Date();
        if (c?.startDate && now < new Date(c.startDate)) return false;
        if (c?.endDate) {
          let end = c.endDate.includes("T")
            ? new Date(c.endDate)
            : new Date(`${c.endDate}T23:59:59`);
          if (now > end) return false;
        }
        return true;
      }) || null
    );
  }, [inheritedCoupons]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const initialPromoCheck = useRef(false);

  const activePromoIdsStr = activePromotions.map((p) => p.id).join(",");
  useEffect(() => {
    searchCache.current = {};
  }, [activePromoIdsStr, products]);

  useEffect(() => {
    const handleToggleDrawer = () => setIsDrawerOpen((prev) => !prev);
    window.addEventListener("ffToggleStoreDrawer", handleToggleDrawer);
    return () =>
      window.removeEventListener("ffToggleStoreDrawer", handleToggleDrawer);
  }, []);

  const selectDepartment = (dept: string) => {
    setIsTransitioning(true);
    searchCache.current = {};
    window.scrollTo({ top: 0, behavior: "instant" });
    setIsDrawerOpen(false);
    setFilters((prev) => ({
      ...prev,
      departamento: dept,
      categoria: "Todos", // Reset subcategoryId when changing department
      promocao_id: null,
      cupom_id: null,
      termo_busca: "", // Intenção soberana limpa termo de busca
    }));
    setDebouncedSearchTerm("");

    // URL management
    const url = new URL(window.location.href);
    url.searchParams.delete("promo_id");
    url.searchParams.delete("cupom_id");
    url.searchParams.delete("category_id");
    if (dept === "Todos") {
      url.searchParams.delete("dept_id");
    } else {
      url.searchParams.set("dept_id", dept);
    }
    window.history.replaceState({}, "", url.toString());
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const selectDepartmentAndCategory = (dept: string, cat: string) => {
    setIsTransitioning(true);
    searchCache.current = {};
    window.scrollTo({ top: 0, behavior: "instant" });
    setIsDrawerOpen(false);
    setFilters({
      departamento: dept,
      categoria: cat,
      promocao_id: null,
      cupom_id: null,
      termo_busca: "",
    });
    setDebouncedSearchTerm("");

    // URL management
    const url = new URL(window.location.href);
    url.searchParams.delete("promo_id");
    url.searchParams.delete("cupom_id");
    if (dept === "Todos") {
      url.searchParams.delete("dept_id");
    } else {
      url.searchParams.set("dept_id", dept);
    }
    if (cat === "Todos") {
      url.searchParams.delete("category_id");
    } else {
      url.searchParams.set("category_id", cat);
    }
    window.history.replaceState({}, "", url.toString());
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const selectCategory = (cat: string) => {
    setIsTransitioning(true);
    searchCache.current = {};
    window.scrollTo({ top: 0, behavior: "instant" });
    setIsDrawerOpen(false);
    setFilters((prev) => ({
      ...prev,
      categoria: cat,
      promocao_id: null,
      cupom_id: null,
      termo_busca: "", // Intenção soberana limpa termo de busca
    }));
    setDebouncedSearchTerm("");

    // URL management
    const url = new URL(window.location.href);
    url.searchParams.delete("promo_id");
    url.searchParams.delete("cupom_id");
    if (cat === "Todos") {
      url.searchParams.delete("category_id");
    } else {
      url.searchParams.set("category_id", cat);
    }
    window.history.replaceState({}, "", url.toString());
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const selectPromotion = (promoId: string | null) => {
    setIsTransitioning(true);
    searchCache.current = {};
    window.scrollTo({ top: 0, behavior: "instant" });
    setIsDrawerOpen(false);
    setFilters((prev) => ({
      ...prev,
      promocao_id: promoId,
      departamento: "Todos",
      categoria: "Todos",
      cupom_id: null,
      termo_busca: "", // Intenção soberana limpa termo de busca
    }));
    setDebouncedSearchTerm("");

    // URL management
    const url = new URL(window.location.href);
    if (promoId) {
      url.searchParams.set("promo_id", promoId);
    } else {
      url.searchParams.delete("promo_id");
    }
    url.searchParams.delete("category_id");
    url.searchParams.delete("dept_id");
    url.searchParams.delete("cupom_id");
    window.history.replaceState({}, "", url.toString());
    setTimeout(() => setIsTransitioning(false), 300);
  };

  const selectCoupon = (coupon: CouponRule) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setIsDrawerOpen(false);
    setFilters((prev) => ({
      ...prev,
      cupom_id: coupon.id,
      promocao_id: null,
      departamento: "Todos",
      categoria: "Todos",
      termo_busca: "", // Intenção soberana limpa termo de busca
    }));
    setDebouncedSearchTerm("");

    // URL management
    const url = new URL(window.location.href);
    url.searchParams.set("cupom_id", coupon.id);
    url.searchParams.delete("promo_id");
    url.searchParams.delete("dept_id");
    url.searchParams.delete("category_id");
    window.history.replaceState({}, "", url.toString());
  };

  const resetFilters = useCallback(() => {
    setIsTransitioning(true);
    searchCache.current = {};
    window.scrollTo({ top: 0, behavior: "instant" });
    setIsDrawerOpen(false);

    // Do a single state update for all properties
    setFilters({
      departamento: "Todos",
      categoria: "Todos",
      promocao_id: null,
      cupom_id: null,
      termo_busca: "",
    });
    setDebouncedSearchTerm("");

    // Clear URL parameters
    const url = new URL(window.location.href);
    url.searchParams.delete("promo_id");
    url.searchParams.delete("dept_id");
    url.searchParams.delete("category_id");
    url.searchParams.delete("cupom_id");
    window.history.replaceState({}, "", url.toString());

    setTimeout(() => setIsTransitioning(false), 300);
  }, []);

  useEffect(() => {
    if (inheritedPromotions.length > 0 && !initialPromoCheck.current) {
      initialPromoCheck.current = true;
      const params = new URLSearchParams(window.location.search);
      const promoId = params.get("promo_id");
      if (promoId) {
        const p = inheritedPromotions.find((pr) => pr.id === promoId);
        if (p) {
          if (!p.isActive) {
            toast.error(
              "Esta promoção não está mais ativa, mas confira outras ofertas!",
              { duration: 4000 },
            );
            resetFilters();
          } else {
            selectPromotion(p.id);
          }
        } else {
          toast.error("Promoção não encontrada!", { duration: 4000 });
          resetFilters();
        }
      }
    }
  }, [inheritedPromotions]);

  const previousActivePromoIdsRef = useRef<string>("");

  useEffect(() => {
    if (previousActivePromoIdsRef.current !== "" && activePromoIds !== "") {
      const prevIds = new Set(
        previousActivePromoIdsRef.current.split(",").filter(Boolean),
      );
      const currentIds = new Set(activePromoIds.split(",").filter(Boolean));

      const newlyActivatedIds = [...currentIds].filter(
        (id) => !prevIds.has(id),
      );

      if (newlyActivatedIds.length > 0) {
        const newOrActivated = activePromotions.filter(
          (p) =>
            newlyActivatedIds.includes(p.id) && p.type === "LIGHTNING_OFFER",
        );

        if (newOrActivated.length > 0) {
          const offer = newOrActivated[0];
          toast.custom(
            (t) => (
              <div
                className={`bg-white border-2 p-4 rounded-2xl shadow-xl flex flex-col gap-2 relative overflow-hidden`}
                style={{ borderColor: tenant.primaryColor }}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-red-500 opacity-10 rounded-full blur-xl animate-pulse"></div>
                <div className="flex items-center gap-3 relative z-10">
                  <div className="bg-red-100 p-2 rounded-full text-red-600 animate-bounce">
                    <Flame size={24} />
                  </div>
                  <div>
                    <p
                      className="font-black text-gray-900 tracking-tight"
                      style={{ color: tenant.primaryColor }}
                    >
                      Uma nova Oferta Relâmpago acabou de começar! Aproveite.
                    </p>
                    <p className="text-sm text-gray-600 font-bold">
                      {offer.name}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    toast.dismiss(t.id);
                    selectPromotion(offer.id);
                  }}
                  className="mt-2 w-full py-2 bg-red-500 text-white font-bold rounded-xl active:scale-95 transition-all text-sm uppercase tracking-widest shadow-md"
                >
                  Ver Produtos em Oferta
                </button>
              </div>
            ),
            { duration: 7000, position: "top-center" },
          );
        }
      }
    }
    previousActivePromoIdsRef.current = activePromoIds;
  }, [activePromoIds, activePromotions, tenant.primaryColor]);

  useEffect(() => {
    if (!initialPromoCheck.current) return;
    const url = new URL(window.location.href);
    let changed = false;
    if (selectedPromotion) {
      if (url.searchParams.get("promo_id") !== selectedPromotion.id) {
        url.searchParams.set("promo_id", selectedPromotion.id);
        changed = true;
      }
    } else {
      if (url.searchParams.has("promo_id")) {
        url.searchParams.delete("promo_id");
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectedPromotion]);

  useEffect(() => {
    if (!selectedPromotion) return;

    const checkExpiration = () => {
      const now = new Date();
      if (!isPromotionActive(selectedPromotion, now)) {
        toast.error("A oferta relâmpago foi encerrada!", { duration: 5000 });
        selectPromotion(null);
      }
    };

    // Check immediately and then every second
    checkExpiration();
    const interval = setInterval(checkExpiration, 1000);
    return () => clearInterval(interval);
  }, [selectedPromotion]);

  // Feedback State
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [isReviewSubmitting, setIsReviewSubmitting] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [cartBounce, setCartBounce] = useState(false);

  // Cache de busca para evitar re-processamento pesado
  const searchCache = useRef<Record<string, Product[]>>({});

  // Track last search to prevent loops
  const lastSearchRef = useRef({ term: "", count: -1 });

  // Debouncing: Atualiza o termo de busca real após 500ms de inatividade
  useEffect(() => {
    const handler = setTimeout(() => {
      // Só processa busca se tiver 3+ caracteres ou se estiver limpando a busca
      if (deferredSearchTerm.length >= 3 || deferredSearchTerm.length === 0) {
        setDebouncedSearchTerm(deferredSearchTerm);
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [deferredSearchTerm]);

  // Scroll into view when filters change logically
  useEffect(() => {
    if (
      debouncedSearchTerm.trim().length > 0 ||
      selectedCategory !== "Todos" ||
      filters.promocao_id ||
      filters.cupom_id ||
      selectedDepartment !== "Todos"
    ) {
      // Pequeno timeout para garantir renderização do grid
      setTimeout(() => {
        if (productsContainerRef.current) {
          productsContainerRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 100);
    }
  }, [
    debouncedSearchTerm,
    selectedCategory,
    selectedDepartment,
    filters.promocao_id,
    filters.cupom_id,
  ]);

  const [columns, setColumns] = useState(2);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setIsScrolled(window.scrollY > 70);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const updateColumns = () => {
      const w = window.innerWidth;
      if (w >= 1536) setColumns(7);
      else if (w >= 1280) setColumns(6);
      else if (w >= 1024) setColumns(5);
      else if (w >= 768) setColumns(4);
      else if (w >= 640) setColumns(3);
      else setColumns(2);
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    setIsLoading(false); // Finished initial setup
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  // ... (review state)

  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    // Rola automaticamente para revelar campanhas ou oferas logo após a montagem do componente
    // Usa um pequeno delay para garantir que o DOM e as localizações estejam estáveis
    const timer = setTimeout(() => {
      const promoCard = document.getElementById("promo-category-target");
      if (promoCard) {
        promoCard.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [products.length, activePromotions.length]);

  const deptsWithPromos = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.promotionType && p.promotionType !== "NONE") {
        const d = getDepartmentForCategory(p.category, tenant.departments);
        set.add(d);
      }
    });
    return set;
  }, [products, tenant.departments]);

  const departments = useMemo(() => {
    // 1. Group products by department
    const deptSet = new Set<string>();
    products.forEach((p) => {
      const d = getDepartmentForCategory(p.category, tenant.departments);
      deptSet.add(d);
    });

    // 2. Sort: With promos first, then alphabetical
    const sortedDepts = Array.from(deptSet).sort((a, b) => {
      const aPromo = deptsWithPromos.has(a);
      const bPromo = deptsWithPromos.has(b);
      if (aPromo && !bPromo) return -1;
      if (!aPromo && bPromo) return 1;
      return a.localeCompare(b);
    });

    return ["Todos", ...sortedDepts];
  }, [products, tenant.departments, deptsWithPromos]);

  const allCategoriesByDept = useMemo(() => {
    const map = new Map<string, string[]>();
    products.forEach((p) => {
      const d = getDepartmentForCategory(p.category, tenant.departments);
      if (!map.has(d)) {
        map.set(d, []);
      }
      if (!map.get(d)!.includes(p.category)) {
        map.get(d)!.push(p.category);
      }
    });
    // Sort logic
    const sortedMap = new Map<string, string[]>();
    map.forEach((cats, dept) => {
      sortedMap.set(dept, cats.sort());
    });
    return sortedMap;
  }, [products, tenant.departments]);

  const subCategories = useMemo(() => {
    if (selectedDepartment === "Todos") return [];

    const cats = new Set<string>();
    products.forEach((p) => {
      if (
        getDepartmentForCategory(p.category, tenant.departments) ===
        selectedDepartment
      ) {
        cats.add(p.category);
      }
    });
    return ["Todos", ...Array.from(cats).sort()];
  }, [products, selectedDepartment]);

  const promoTargetEans = useMemo(() => {
    if (!matrizProducts.length) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    const processRule = (rule: PromotionRule | CouponRule) => {
      if (rule.scope === 'NETWORK' && tenant.id !== rule.tenantId && rule.targetType === "SPECIFIC_SELECTION") {
        const ids = rule.specificProductIds || [];
        const eans = matrizProducts.filter(mp => ids.includes(mp.id) && mp.barcode).map(mp => mp.barcode as string);
        map.set(rule.id, eans);
      }
    };
    activePromotions.forEach(processRule);
    if (activeCouponFilter) processRule(activeCouponFilter);
    return map;
  }, [activePromotions, activeCouponFilter, matrizProducts, tenant.id]);

  const isProductInRule = useCallback((rule: PromotionRule | CouponRule, p: Product) => {
    return checkProductMatchesRule(rule, p, matrizProducts, tenant.id);
  }, [matrizProducts, tenant.id]);

  const searchFallback = useMemo(() => {
    const term = normalizeStr(debouncedSearchTerm);
    if (!term || term.trim().length === 0) return null;
    
    const strongMatches = products.filter(p => p.id && normalizeStr(p.name).includes(term));
    
    if (strongMatches.length > 0) {
      const hasInStock = strongMatches.some(p => p.stock > 0);
      if (!hasInStock) {
        const reference = strongMatches[0];
        const principle = reference.activePrinciple ? normalizeStr(reference.activePrinciple) : null;
        const presentation = reference.presentation ? normalizeStr(reference.presentation) : null;
        
        if (principle) {
           return {
             originalName: reference.name,
             principle,
             presentation
           };
        }
      }
    }
    return null;
  }, [debouncedSearchTerm, products]);

  const filteredProducts = useMemo<Product[]>(() => {
    const term = normalizeStr(debouncedSearchTerm);
    const activePromoIds = activePromotions.map((p) => p.id).join(",");
    const cacheKey = `${term}_${selectedDepartment}_${selectedCategory}_${selectedPromotion?.id || "none"}_${activeCouponFilter?.id || "none"}_${activePromoIds}_${searchFallback ? "fallback" : "nofallback"}`;

    if (searchCache.current[cacheKey]) {
      return searchCache.current[cacheKey];
    }

    let processedTerm = term;
    // 4. Inteligência de Busca (NLP) - Tratamento de Erros
    if (TYPO_MAP[processedTerm]) {
      processedTerm = TYPO_MAP[processedTerm];
    }

    let sourceList = selectedPromotion
      ? products.filter((p) => isProductInRule(selectedPromotion, p))
      : products;

    // Strict rule: Never show products with zero, negative or missing prices
    sourceList = sourceList.filter(p => typeof p.price === 'number' && p.price > 0);

    // Cache department mappings for O(1) lookups during the filtering loop
    const deptCache: Record<string, string> = {};
    const getDeptCached = (cat: string) => {
      if (!cat) return "Outros";
      if (deptCache[cat] !== undefined) return deptCache[cat];
      const dept = getDepartmentForCategory(cat, tenant.departments);
      deptCache[cat] = dept;
      return dept;
    };

    const getPromoPriority = (p: Product) => {
      if (p.promotionType && p.promotionType !== "NONE") {
        return p.promotionType === "BUY_X_PAY_Y" ? 3 : 2;
      }
      if (!activePromotions) return 0;

      // If a promotion is selected, only consider it for priority
      if (selectedPromotion && selectedPromotion.isActive) {
        if (isProductInRule(selectedPromotion, p)) {
          return selectedPromotion.type === "BUY_X_PAY_Y" ||
            selectedPromotion.type === "FIXED_COMBO"
            ? 3
            : 2;
        }
      }

      // Fallback for all other active promotions
      for (let promo of activePromotions) {
        // If we already have a focused promotion, we don't care about others
        if (selectedPromotion && promo.id === selectedPromotion.id) continue;

        if (isProductInRule(promo, p)) {
          return promo.type === "BUY_X_PAY_Y" || promo.type === "FIXED_COMBO"
            ? 3
            : 2;
        }
      }
      return 0; // NONE
    };

    // Identifica o nível hierárquico do produto
    const getPriority = (p: Product) => {
      // Se há uma promoção ativa, o destaque só vale se o produto fizer parte dela
      let isPartOfActivePromo = false;

      if (activeCouponFilter) {
        isPartOfActivePromo = isProductInRule(activeCouponFilter, p);
      } else if (selectedPromotion) {
        isPartOfActivePromo = isProductInRule(selectedPromotion, p);
      }

      // Prioridade 1: Destaques Manuais (agora condicional se promo ativa)
      if (
        p.isFeatured &&
        ((!selectedPromotion && !activeCouponFilter) || isPartOfActivePromo)
      )
        return 4;

      const promoScore = getPromoPriority(p);
      // Prioridade 2: Promoções Estruturadas (Leve X Pague Y / Combos) => Score 3
      // Prioridade 3: Ofertas de Preço (Descontos) => Score 2
      if (promoScore > 0) return promoScore;

      // Prioridade 4: Catálogo Geral
      return 1;
    };

    // 1. Camada de Substituição Ética (Mesma Fórmula/Similares)
    // Identifica se há correspondência exata para buscar o princípio ativo (only if search is active)
    const activePrinciplesToInclude = new Set<string>();
    if (processedTerm.trim().length > 0) {
      const strongMatches = sourceList.filter(
        (p) => p.id && normalizeStr(p.name).includes(processedTerm),
      );
      strongMatches.forEach((p) => {
        if (p.activePrinciple) {
          activePrinciplesToInclude.add(normalizeStr(p.activePrinciple));
        }
      });
    }


    const isDiaSeguinte = 
      processedTerm.includes("pilula do dia seguinte") || 
      processedTerm.includes("pilula dia seguinte") || 
      processedTerm.includes("dia seguinte") ||
      processedTerm.includes("anticoncepcional de emergencia") ||
      processedTerm.includes("anticoncepcional do dia seguinte");

    const isEstomago = 
      processedTerm.includes("estomago") || 
      processedTerm.includes("estômago") || 
      processedTerm.includes("gastrico") || 
      processedTerm.includes("gástrico") || 
      processedTerm.includes("protetor gastrico") || 
      processedTerm.includes("protetor gástrico") || 
      processedTerm.includes("digestao") || 
      processedTerm.includes("digestão") || 
      processedTerm.includes("azia") || 
      processedTerm.includes("digestivo") || 
      processedTerm.includes("digestivos") ||
      processedTerm.includes("antiacido") ||
      processedTerm.includes("antiácido");

    const isFarmacinha = processedTerm === "farmacinha";

    let searchTokens_raw = processedTerm.split(" ").filter((t) => t.length > 0);
    let searchTokens = searchTokens_raw
      .filter((t, i, arr) => {
        if (!STOP_WORDS.has(t)) return true;
        // Se a stopword tiver apenas 1 letra e a busca for composta, nós a mantemos para não quebrar "vitamina e"
        if (t.length === 1 && arr.length > 1) return true;
        return false;
      })
      .map(singularize);
    let expandedTokens = [...searchTokens];
    searchTokens.forEach((t) => {
      Object.entries(SYNONYM_MAP).forEach(([key, syns]) => {
        if (t.includes(key) || syns.some((s) => t.includes(s))) {
          expandedTokens.push(key);
          expandedTokens = [...expandedTokens, ...syns];
        }
      });
    });
    expandedTokens = Array.from(new Set(expandedTokens));

    const baseList = sourceList
      .map((p) => {
        if (!p.id) return null; // Filter out ghost products

        // 1. Regra de Omissão / Stock Check - Discard immediately to avoid further checks
        const isOutOfStock = p.stock <= 0;
        if (isOutOfStock && !debouncedSearchTerm.trim()) {
          return null;
        }

        // 2. Active coupon and promotion rules (fail fast)
        if (activeCouponFilter && !isProductInRule(activeCouponFilter, p)) {
          return null;
        }

        if (selectedPromotion && !isProductInRule(selectedPromotion, p)) {
          return null;
        }

        // 3. Department and Category filter checks (fail fast using Cached O(1) lookup)
        const matchesDepartment =
          selectedDepartment === "Todos" ||
          getDeptCached(p.category) === selectedDepartment;
        if (!matchesDepartment) return null;

        const matchesCategory =
          selectedCategory === "Todos" || p.category === selectedCategory;
        if (!matchesCategory) return null;

        let matchScore = 0;

        if (isDiaSeguinte) {
          const pName = normalizeStr(p.name);
          const pActive = normalizeStr(p.activePrinciple || "");
          const pCat = normalizeStr(p.category || "");
          const pInd = normalizeStr(p.indications || "");

          const isEmergencyContraceptive = 
            pName.includes("dia d") ||
            pName.includes("diad") ||
            pName.includes("dia-d") ||
            pName.includes("pozato") ||
            pName.includes("neodia") ||
            pName.includes("pilem") ||
            pName.includes("postinor") ||
            pName.includes("evenose") ||
            pName.includes("emergencia") ||
            pCat.includes("emergencia") ||
            pInd.includes("emergencia") ||
            (pActive.includes("levonorgestrel") && !pActive.includes("etinilestradiol"));

          if (isEmergencyContraceptive) {
            matchScore = 1000;
          } else {
            return null;
          }
        }
        else if (isEstomago) {
          const pName = normalizeStr(p.name);
          const pActive = normalizeStr(p.activePrinciple || "");
          const pCat = normalizeStr(p.category || "");
          const pInd = normalizeStr(p.indications || "");

          const isGastrico = 
            pName.includes("omeprazol") ||
            pName.includes("pantoprazol") ||
            pName.includes("esomeprazol") ||
            pName.includes("lansoprazol") ||
            pName.includes("rabeprazol") ||
            pName.includes("dexlansoprazol") ||
            pName.includes("peprazol") ||
            pName.includes("pantocal") ||
            pName.includes("gastrium") ||
            pName.includes("estomago") ||
            pName.includes("gastrico") ||
            pName.includes("digestivo") ||
            pName.includes("digestao") ||
            pName.includes("azia") ||
            pName.includes("antiacido") ||
            pName.includes("eno") ||
            pName.includes("estomazil") ||
            pName.includes("luftal") ||
            pName.includes("simeticona") ||
            pName.includes("ranitidina") ||
            pName.includes("antidin") ||
            pName.includes("pepto") ||
            pName.includes("domperidona") ||
            pName.includes("metoclopramida") ||
            pName.includes("plasil") ||
            pName.includes("digesan") ||
            pCat.includes("gastro") ||
            pCat.includes("antiacido") ||
            pCat.includes("antiulceroso") ||
            pCat.includes("ulcer") ||
            pInd.includes("estomago") ||
            pInd.includes("gastrico") ||
            pInd.includes("azia") ||
            pInd.includes("ulcer") ||
            pActive.includes("omeprazol") ||
            pActive.includes("pantoprazol") ||
            pActive.includes("esomeprazol") ||
            pActive.includes("lansoprazol") ||
            pActive.includes("rabeprazol") ||
            pActive.includes("dexlansoprazol") ||
            pActive.includes("simeticona") ||
            pActive.includes("ranitidina") ||
            pActive.includes("domperidona") ||
            pActive.includes("metoclopramida");

          if (isGastrico) {
            matchScore = 1000;
          } else {
            return null;
          }
        }
        else if (isFarmacinha) {
          const pName = normalizeStr(p.name);
          const pActive = normalizeStr(p.activePrinciple || "");
          const pCat = normalizeStr(p.category || "");
          
          const isEssential = 
            pName.includes("paracetamol") ||
            pName.includes("dipirona") ||
            pName.includes("ibuprofeno") ||
            pName.includes("band-aid") ||
            pName.includes("band aid") ||
            pName.includes("curativo") ||
            pName.includes("fio dental") ||
            pName.includes("absorvente") ||
            pName.includes("dorflex") ||
            pName.includes("neosaldina") ||
            pName.includes("advil") ||
            pName.includes("tilenol") ||
            pName.includes("tylenol") ||
            pName.includes("soro fisiologico") ||
            pActive.includes("paracetamol") ||
            pActive.includes("dipirona") ||
            pActive.includes("ibuprofeno") ||
            pCat.includes("analgesico") ||
            pCat.includes("curativo") ||
            pCat.includes("absorvente") ||
            pCat.includes("higiene bucal");

          const promoPriority = getPriority(p);
          const isOferta = promoPriority > 1 || (p as any).suggestionBadge === "OFERTA";

          // If it is either essential OR has an offer badge/discount
          if (isEssential || isOferta) {
             matchScore = 500;
             if (isEssential) matchScore += 100;
             if (isOferta) matchScore += 500; // Prioritize offers above all
          } else {
             return null;
          }
        }
        // Fallback Logic overrides normal search
        else if (searchFallback) {
           if (p.stock <= 0) return null; // must be in stock
           const pPrinciple = normalizeStr(p.activePrinciple || "");
           const pPres = normalizeStr(p.presentation || "");
           const pName = normalizeStr(p.name || "");
           
           const matchesPrinciple = searchFallback.principle === pPrinciple;
           
           if (matchesPrinciple) {
              matchScore += 100; // Base score for fallback principle match
              
              const presentationKeywords = ["gotas", "comprimido", "xarope", "supositorio", "spray", "capsula", "pomada", "creme", "solucao", "injetavel"];
              
              // 1. Exact presentation match via product struct
              if (searchFallback.presentation && pPres && searchFallback.presentation === pPres) {
                 matchScore += 800;
              } 
              // 2. Exact presentation match via extracted keywords
              else {
                 let hasPresMatch = false;
                 const originalName = normalizeStr(searchFallback.originalName || "");
                 for (const kw of presentationKeywords) {
                    if (originalName.includes(kw) || searchTokens.includes(kw)) {
                        if (pName.includes(kw) || pPres.includes(kw)) {
                            hasPresMatch = true;
                            break;
                        }
                    }
                 }
                 if (hasPresMatch) {
                    matchScore += 800;
                 }
              }
           } else {
              return null; // strictly filter out everything else
           }
        }
        // 4. NLP / Search logic: Only executed if there is a search term query active
        else if (searchTokens.length > 0) {
          const pName = normalizeStr(p.name);
          const pActive = normalizeStr(p.activePrinciple || "");
          const pType = normalizeStr(p.drugType || "");
          const pManuf = normalizeStr(p.manufacturer || "");
          const pCat = normalizeStr(p.category || "");
          const pInd = normalizeStr(p.indications || "");

          let hasExactTokenMatch = false;
          let hasExpandedMatch = false;
          let manufacturerMatched = false;
          let categoryMatched = false;
          let tokensMatchedCount = 0;
          let exactWordMatched = false;

          searchTokens.forEach((token) => {
            let matchedManuf = false;
            let matchedCat = false;
            let nameMatched = false;
            let otherMatched = false;

            if (token.length === 1) {
              // Para caracteres únicos (como "C" ou "E"), precisamos que seja uma palavra isolada e no nome/ativo apenas
              const regex = new RegExp(`(?:^|\\s|-)${token}(?:\\s|-|$)`, "i");
              nameMatched = regex.test(pName) || regex.test(pActive);
              if (nameMatched) exactWordMatched = true;
            } else {
              matchedManuf = pManuf.includes(token);
              matchedCat =
                pCat.includes(token) ||
                SYNONYM_MAP[token]?.some((syn) => pCat.includes(syn));
              nameMatched = 
                pName.includes(token) || 
                pActive.includes(token) ||
                SYNONYM_MAP[token]?.some((syn) => pName.includes(syn) || pActive.includes(syn));
              otherMatched = 
                pInd.includes(token) || 
                pType.includes(token) ||
                SYNONYM_MAP[token]?.some((syn) => pInd.includes(syn) || pType.includes(syn));

              // Check for exact word boundary match for higher relevancy scoring
              const regex = new RegExp(`(?:^|\\s|-|\\+|\\/)${token}(?:\\s|-|\\+|\\/|$)`, "i");
              if (regex.test(pName) || regex.test(pActive) || regex.test(pCat)) exactWordMatched = true;
              
              if (!exactWordMatched && SYNONYM_MAP[token]) {
                for (const syn of SYNONYM_MAP[token]) {
                  const regexSyn = new RegExp(`(?:^|\\s|-|\\+|\\/)${syn}(?:\\s|-|\\+|\\/|$)`, "i");
                  if (regexSyn.test(pName) || regexSyn.test(pActive) || regexSyn.test(pCat)) {
                    exactWordMatched = true;
                    break;
                  }
                }
              }
            }

            if (matchedManuf) manufacturerMatched = true;
            if (matchedCat) categoryMatched = true;

            if (nameMatched || matchedManuf || matchedCat || otherMatched) {
              hasExactTokenMatch = true;
              tokensMatchedCount++;
            }
          });

          expandedTokens.forEach((token) => {
            if (
              pName.includes(token) ||
              pCat.includes(token) ||
              pManuf.includes(token)
            ) {
              hasExpandedMatch = true;
            }
          });

          // Requirement 2: Strict AND for searchTokens if no advanced matching conditions apply
          const matchedAllOriginalTokens =
            tokensMatchedCount === searchTokens.length;

          if (!matchedAllOriginalTokens) {
            return null; // Strict AND logic
          }

          // Sistema de Pesos
          if (manufacturerMatched && categoryMatched) {
            matchScore += 300; // Peso 3: Marca pesquisada + Categoria
          } else if (manufacturerMatched) {
            matchScore += 200; // Peso 2: Marca pesquisada + Termo da mesma linha
          } else if (categoryMatched) {
            matchScore += 200; // Peso 2: Apenas Categoria
          } else {
            matchScore += 100; // Match exato (todos os tokens presentes)
          }

          if (exactWordMatched) {
            matchScore += 1000; // Huge boost for exact word or synonym match (avoids 'sh' matching 'blush' above 'shampoo')
          }

          if (
            activePrinciplesToInclude.size > 0 &&
            activePrinciplesToInclude.has(pActive)
          ) {
            matchScore += 150;
          }

          if (matchScore === 0) {
            return null; // Does not match search
          }
        }

        // Precompute product priority score once (O(N)) to avoid O(N log N) recalculations during sorting
        const priorityScore = getPriority(p);

        return { ...p, _searchScore: matchScore, _priority: priorityScore };
      })
      .filter(Boolean) as (Product & { _searchScore: number; _priority: number })[];

    let finalBaseList = baseList;

    // Fuzzy Search fallback if no results and term is long enough
    if (finalBaseList.length === 0 && processedTerm.length > 3) {
      finalBaseList = sourceList
        .map((p) => {
          if (!p.id) return null;

          if (activeCouponFilter && !isProductInRule(activeCouponFilter, p)) {
            return null;
          }

          if (selectedPromotion && !isProductInRule(selectedPromotion, p)) {
            return null;
          }

          const pName = normalizeStr(p.name);
          const dist = levenshteinDistance(
            processedTerm,
            pName.substring(0, processedTerm.length),
          );
          if (dist <= 2) {
            return { ...p, _searchScore: 10 - dist, _priority: getPriority(p) };
          }
          return null;
        })
        .filter(Boolean) as (Product & { _searchScore: number; _priority: number })[];
    }

    // 3. Algoritmo de Priorização (Ranking de Exibição)
    const result = [...finalBaseList].sort((a, b) => {
      // Primeiro: Score de Busca (mantém a relevância textual se houver busca ativa)
      if (debouncedSearchTerm.length > 0 && b._searchScore !== a._searchScore) {
        return (b._searchScore || 0) - (a._searchScore || 0);
      }

      const aInStock = typeof a.stock === 'number' && a.stock > 0;
      const bInStock = typeof b.stock === 'number' && b.stock > 0;

      // 1. Regra de Ouro: Estoque sempre primeiro
      if (aInStock && !bInStock) return -1;
      if (!aInStock && bInStock) return 1;

      // Use precalculated priority score (O(1) lookup, incredibly fast)
      const priorityA = a._priority ?? 1;
      const priorityB = b._priority ?? 1;

      // Aplica a ordem de prioridade comercial estrita (Destaque > Estruturada > Desconto > Geral)
      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }

      // Sub-ordenação de Relevância de Texto (quando estão na mesma prioridade e há busca)
      if (debouncedSearchTerm.length > 0) {
        const aName = normalizeStr(a.name);
        const bName = normalizeStr(b.name);
        const aStarts = aName.startsWith(processedTerm);
        const bStarts = bName.startsWith(processedTerm);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
      }

      // Desempate Final: Ordem Alfabética
      return a.name.localeCompare(b.name);
    });

    searchCache.current[cacheKey] = result;
    return result;
  }, [
    products,
    debouncedSearchTerm,
    selectedDepartment,
    selectedCategory,
    selectedPromotion,
    activePromotions,
    activeCouponFilter,
    isProductInRule,
  ]);

  const paginatedProducts = useMemo(() => {
    return filteredProducts.slice(0, visibleCount);
  }, [filteredProducts, visibleCount]);

  const rowVirtualizer = useWindowVirtualizer({
    count: Math.ceil(paginatedProducts.length / columns),
    estimateSize: () => 380, // Estimated height of ProductCard + gap
    overscan: 3,
  });

  const crossSellSuggestions = useMemo(() => {
    if (products.length === 0) return [];

    const termNorm = normalizeStr(debouncedSearchTerm);
    let targetCategories: string[] = [];

    // 2. Camada de Intencionalidade e Sintomas (Venda Correlacionada)
    Object.keys(SEARCH_CROSS_SELL_MAP).forEach((key) => {
      if (termNorm.includes(normalizeStr(key))) {
        targetCategories = [...targetCategories, ...SEARCH_CROSS_SELL_MAP[key]];
      }
    });

    const mandatoryCheckoutCats = [
      "Perfumaria",
      "Higiene",
      "Infantil",
      "Doces",
      "Balas",
      "Absorvente",
      "Fralda",
      "Conveniência",
    ];

    const currentResultIds = new Set(filteredProducts.map((p) => p.id));
    const targetCatsNorm = targetCategories.map((c) => normalizeStr(c));

    return products
      .filter((p) => {
        if (!p.id) return false;
        const prodCatNorm = normalizeStr(p.category);
        const prodNameNorm = normalizeStr(p.name);

        const isTarget = targetCatsNorm.some(
          (tc) => prodCatNorm.includes(tc) || prodNameNorm.includes(tc),
        );
        const isMandatory = mandatoryCheckoutCats.some((mc) =>
          prodCatNorm.includes(normalizeStr(mc)),
        );

        return (
          (isTarget || isMandatory) &&
          !currentResultIds.has(p.id) &&
          p.stock > 0
        );
      })
      .sort((a, b) => {
        if (a.isFeatured && !b.isFeatured) return -1;
        if (!a.isFeatured && b.isFeatured) return 1;
        return Math.random() - 0.5;
      })
      .slice(0, 15);
  }, [
    products,
    debouncedSearchTerm,
    selectedCategory,
    filteredProducts,
    activePromotions,
  ]);

  useEffect(() => {
    const inStockCount = filteredProducts.filter((p) => p.stock > 0).length;
    if (
      onSearch &&
      (lastSearchRef.current.term !== debouncedSearchTerm ||
        lastSearchRef.current.count !== inStockCount)
    ) {
      onSearch(debouncedSearchTerm, inStockCount);
      lastSearchRef.current = {
        term: debouncedSearchTerm,
        count: inStockCount,
      };
    }
  }, [debouncedSearchTerm, filteredProducts, onSearch]);

  const intelligentSuggestions = useMemo(() => {
    if (debouncedSearchTerm.length < 3) return [];
    let term = normalizeStr(debouncedSearchTerm);
    if (TYPO_MAP[term]) term = TYPO_MAP[term];

    const isDiaSeguinte = 
      term.includes("pilula do dia seguinte") || 
      term.includes("pilula dia seguinte") || 
      term.includes("dia seguinte") ||
      term.includes("anticoncepcional de emergencia") ||
      term.includes("anticoncepcional do dia seguinte");

    const isEstomago = 
      term.includes("estomago") || 
      term.includes("estômago") || 
      term.includes("gastrico") || 
      term.includes("gástrico") || 
      term.includes("protetor gastrico") || 
      term.includes("protetor gástrico") || 
      term.includes("digestao") || 
      term.includes("digestão") || 
      term.includes("azia") || 
      term.includes("digestivo") || 
      term.includes("digestivos") ||
      term.includes("antiacido") ||
      term.includes("antiácido");

    if (isDiaSeguinte) {
      return products
        .filter((p) => {
          const pName = normalizeStr(p.name);
          const pActive = normalizeStr(p.activePrinciple || "");
          const pCat = normalizeStr(p.category || "");
          const pInd = normalizeStr(p.indications || "");

          return (
            pName.includes("dia d") ||
            pName.includes("diad") ||
            pName.includes("dia-d") ||
            pName.includes("pozato") ||
            pName.includes("neodia") ||
            pName.includes("pilem") ||
            pName.includes("postinor") ||
            pName.includes("evenose") ||
            pName.includes("emergencia") ||
            pCat.includes("emergencia") ||
            pInd.includes("emergencia") ||
            (pActive.includes("levonorgestrel") && !pActive.includes("etinilestradiol"))
          );
        })
        .slice(0, 8);
    }

    if (isEstomago) {
      return products
        .filter((p) => {
          const pName = normalizeStr(p.name);
          const pActive = normalizeStr(p.activePrinciple || "");
          const pCat = normalizeStr(p.category || "");
          const pInd = normalizeStr(p.indications || "");

          return (
            pName.includes("omeprazol") ||
            pName.includes("pantoprazol") ||
            pName.includes("esomeprazol") ||
            pName.includes("lansoprazol") ||
            pName.includes("rabeprazol") ||
            pName.includes("dexlansoprazol") ||
            pName.includes("peprazol") ||
            pName.includes("pantocal") ||
            pName.includes("gastrium") ||
            pName.includes("estomago") ||
            pName.includes("gastrico") ||
            pName.includes("digestivo") ||
            pName.includes("digestao") ||
            pName.includes("azia") ||
            pName.includes("antiacido") ||
            pName.includes("eno") ||
            pName.includes("estomazil") ||
            pName.includes("luftal") ||
            pName.includes("simeticona") ||
            pName.includes("ranitidina") ||
            pName.includes("antidin") ||
            pName.includes("pepto") ||
            pName.includes("domperidona") ||
            pName.includes("metoclopramida") ||
            pName.includes("plasil") ||
            pName.includes("digesan") ||
            pCat.includes("gastro") ||
            pCat.includes("antiacido") ||
            pCat.includes("antiulceroso") ||
            pCat.includes("ulcer") ||
            pInd.includes("estomago") ||
            pInd.includes("gastrico") ||
            pInd.includes("azia") ||
            pInd.includes("ulcer") ||
            pActive.includes("omeprazol") ||
            pActive.includes("pantoprazol") ||
            pActive.includes("esomeprazol") ||
            pActive.includes("lansoprazol") ||
            pActive.includes("rabeprazol") ||
            pActive.includes("dexlansoprazol") ||
            pActive.includes("simeticona") ||
            pActive.includes("ranitidina") ||
            pActive.includes("domperidona") ||
            pActive.includes("metoclopramida")
          );
        })
        .slice(0, 8);
    }

    const searchTokens_raw = term.split(" ").filter((t) => t.length > 0);
    const searchTokens = searchTokens_raw
      .filter((t, i, arr) => {
        if (!STOP_WORDS.has(t)) return true;
        if (t.length === 1 && arr.length > 1) return true;
        return false;
      })
      .map(singularize);

    return products
      .filter((p) => {
        const pName = normalizeStr(p.name);
        const pActive = normalizeStr(p.activePrinciple || "");
        const pInd = normalizeStr(p.indications || "");
        const pCat = normalizeStr(p.category || "");
        const pManuf = normalizeStr(p.manufacturer || "");

        return searchTokens.every((token) => {
          let nameMatched = false;
          let otherMatched = false;
          if (token.length === 1) {
            const regex = new RegExp(`(?:^|\\s|-)${token}(?:\\s|-|$)`, "i");
            nameMatched = regex.test(pName) || regex.test(pActive);
            // Ignore single letter matches in category/manufacturer/indications
            // to prevent matching almost all products.
            otherMatched = false;
          } else {
            nameMatched = 
              pName.includes(token) || 
              pActive.includes(token) ||
              SYNONYM_MAP[token]?.some((syn) => pName.includes(syn) || pActive.includes(syn));
            otherMatched =
              pInd.includes(token) ||
              pCat.includes(token) ||
              pManuf.includes(token) ||
              SYNONYM_MAP[token]?.some((syn) => pInd.includes(syn) || pCat.includes(syn) || pManuf.includes(syn));
          }
          return nameMatched || otherMatched;
        });
      })
      .sort((a, b) => {
        const aName = normalizeStr(a.name);
        const bName = normalizeStr(b.name);

        // 1. Prioridade por Nome (Match no início)
        const aStarts = aName.startsWith(term);
        const bStarts = bName.startsWith(term);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        // Helper para verificar promoção
        const checkPromo = (p: Product) => {
          if (p.promotionType && p.promotionType !== "NONE") return true;
          return activePromotions.some((promo) => isProductInRule(promo, p));
        };

        const aHasPromo = checkPromo(a);
        const bHasPromo = checkPromo(b);
        const aInStock = a.stock > 0;
        const bInStock = b.stock > 0;

        // 2. Promoção + Estoque (Prioridade Máxima)
        if (aHasPromo && aInStock && !(bHasPromo && bInStock)) return -1;
        if (!(aHasPromo && aInStock) && bHasPromo && bInStock) return 1;

        // 3. Apenas Promoção
        if (aHasPromo && !bHasPromo) return -1;
        if (!aHasPromo && bHasPromo) return 1;

        // 4. Apenas Estoque
        if (aInStock && !bInStock) return -1;
        if (!aInStock && bInStock) return 1;

        // 5. Prioridade por Nome (Contém o termo)
        const aContains = aName.includes(term);
        const bContains = bName.includes(term);
        if (aContains && !bContains) return -1;
        if (!aContains && bContains) return 1;

        if (a.isFeatured && !b.isFeatured) return -1;
        if (!a.isFeatured && b.isFeatured) return 1;
        return 0;
      })
      .slice(0, 8);
  }, [debouncedSearchTerm, products, activePromotions]);

  const handleAddToCartWrapper = (product: Product) => {
    onAddToCart(product, false, false);
    setToastMessage("Produto adicionado ao carrinho!");
    setCartBounce(true);
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
    setTimeout(() => {
      setCartBounce(false);
    }, 300);
  };

  const handleNotifyMe = (product: Product) => {
    const msg = `Olá, gostaria de ser avisado quando o produto "${product.name}" estiver disponível novamente.`;
    window.open(
      `https://wa.me/55${tenant.whatsapp}?text=${encodeURIComponent(msg)}`,
      "_blank",
    );
  };

  const handleSubmitReview = async () => {
    if (reviewRating === 0)
      return alert("Por favor, selecione uma nota de 1 a 5 estrelas.");
    setIsReviewSubmitting(true);
    try {
      const review: AppReview = {
        id: Math.random().toString(36).substr(2, 9),
        tenantId: tenant.id,
        rating: reviewRating,
        comment: reviewComment,
        date: new Date().toISOString(),
      };
      await saveAppReview(review);
      setReviewSuccess(true);
      setTimeout(() => {
        setIsReviewOpen(false);
        setReviewSuccess(false);
        setReviewRating(0);
        setReviewComment("");
      }, 2000);
    } catch (error) {
      alert("Erro ao enviar avaliação. Tente novamente.");
    } finally {
      setIsReviewSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-50/50 min-h-screen pb-24 font-sans relative overflow-x-hidden">
      {onBack && (
        <div className="bg-gray-900 text-white text-[10px] md:text-xs py-1.5 px-4 flex items-center justify-center z-[60] relative">
          <button
            onClick={onBack}
            className="flex items-center gap-2 hover:text-gray-300 transition-colors font-bold uppercase tracking-widest"
          >
            <ArrowLeft size={14} /> Voltar ao Portal
          </button>
        </div>
      )}
      {((topBannerCoupons && topBannerCoupons.length > 0) ||
        (activePromotions && activePromotions.length > 0)) && (
        <CouponBanner
          coupons={topBannerCoupons || []}
          promotions={activePromotions || []}
          backgroundColor={tenant.couponBannerColor}
          onFilterByCoupon={(coupon) => {
            selectCoupon(coupon);
            window.scrollTo({ top: 400, behavior: "smooth" });
          }}
          onFilterByPromotion={(promo) => {
            selectPromotion(promo.id);
            window.scrollTo({ top: 400, behavior: "smooth" });
          }}
        />
      )}
      <header
        className={`relative z-30 transition-all duration-300 py-4 md:py-6 px-4 md:px-8`}
        style={{
          background: `linear-gradient(90deg, #1a0505 0%, ${tenant.primaryColor} 100%)`,
        }}
      >
        <div
          className={`w-full max-w-[1600px] mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-8`}
        >
          <div className={`flex items-center gap-3 md:gap-4 shrink-0`}>
            <div
              className={`bg-white rounded-full flex items-center justify-center overflow-hidden border-2 w-10 h-10 md:w-12 md:h-12 border-white/20 shadow-xl`}
            >
              {tenant.logo ? (
                <img
                  src={fixImageUrl(tenant.logo)!}
                  className="w-full h-full object-contain"
                  alt={tenant.name}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span
                  className="font-black text-lg md:text-xl"
                  style={{ color: tenant.primaryColor }}
                >
                  {tenant.name.charAt(0)}
                </span>
              )}
            </div>
            <h1
              className={`font-black tracking-tight leading-none text-white drop-shadow-sm text-xl md:text-2xl lg:text-3xl`}
            >
              {tenant.name}
            </h1>
          </div>

          <div
            className={`w-full flex-1 max-w-2xl md:max-w-2xl lg:max-w-4xl h-[48px] md:h-[56px] relative mx-auto md:mx-0`}
            ref={searchRef}
          >
            <div
              className={`transition-all duration-300 ${isScrolled ? "fixed top-[79px] left-0 right-0 z-[40] bg-white/95 backdrop-blur-md shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1)] px-4 py-3 border-b border-gray-100" : "absolute inset-0 w-full z-40"}`}
            >
              <div
                className={`w-full mx-auto ${isScrolled ? "max-w-2xl lg:max-w-4xl" : "h-full"}`}
              >
                <div className="relative w-full">
                  <SearchInput
                    initialValue={searchTerm}
                    onChange={(val) => {
                      setFilters((prev) => {
                        const newFilters = { ...prev, termo_busca: val };
                        if (val.trim() !== "") {
                          newFilters.promocao_id = null;
                          newFilters.cupom_id = null;
                          newFilters.departamento = "Todos";
                          newFilters.categoria = "Todos";

                          const url = new URL(window.location.href);
                          let urlChanged = false;
                          if (url.searchParams.has("promo_id")) {
                            url.searchParams.delete("promo_id");
                            urlChanged = true;
                          }
                          if (url.searchParams.has("cupom_id")) {
                            url.searchParams.delete("cupom_id");
                            urlChanged = true;
                          }
                          if (url.searchParams.has("dept_id")) {
                            url.searchParams.delete("dept_id");
                            urlChanged = true;
                          }
                          if (url.searchParams.has("category_id")) {
                            url.searchParams.delete("category_id");
                            urlChanged = true;
                          }
                          if (urlChanged) {
                            window.history.replaceState({}, "", url.toString());
                          }
                        }
                        return newFilters;
                      });
                      setShowSuggestions(true);
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onSubmit={() => setShowSuggestions(false)}
                  />

                  {showSuggestions && intelligentSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-4 bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 overflow-hidden z-[50] animate-in slide-in-from-top-2 duration-300 max-w-[100vw]">
                      <div className="p-5 bg-gray-50/80 border-b flex items-center justify-between">
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                          <Sparkles size={14} /> Busca Inteligente
                        </span>
                        <button
                          onClick={() => setShowSuggestions(false)}
                          className="text-[10px] font-black text-gray-400 hover:text-red-500 uppercase tracking-widest px-3 py-1 bg-white rounded-full border border-gray-100"
                        >
                          Fechar
                        </button>
                      </div>
                      <div className="max-h-[450px] overflow-y-auto scrollbar-thin">
                        {intelligentSuggestions.map((p) => {
                          const activePromo = activePromotions.find((promo) => isProductInRule(promo, p));

                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                onProductClick(p);
                                setShowSuggestions(false);
                              }}
                              className="p-3 md:p-5 hover:bg-gray-50 cursor-pointer flex items-center gap-3 md:gap-5 transition-colors group border-b border-gray-50 last:border-none"
                            >
                              <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center border border-gray-200">
                                {fixImageUrl(p.image) ? (
                                  <img
                                    src={fixImageUrl(p.image)!}
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <Package
                                    className="text-gray-300"
                                    size={20}
                                  />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <p className="font-black text-gray-900 text-sm md:text-base leading-tight line-clamp-2 transition-colors flex items-center gap-1 md:gap-2">
                                  {p.isFeatured && (
                                    <Star
                                      size={10}
                                      fill="#fbbf24"
                                      className="text-yellow-400 shrink-0"
                                    />
                                  )}
                                  <span>
                                    <HighlightText
                                      text={p.name}
                                      query={debouncedSearchTerm}
                                    />
                                  </span>
                                </p>
                                <div className="flex flex-wrap items-center gap-1 md:gap-3 mt-1">
                                  <span className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest truncate max-w-[120px] md:max-w-none">
                                    {p.category}
                                  </span>
                                  {activePromo && (
                                    <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest flex items-center gap-1 shadow-sm">
                                      <Tag size={8} strokeWidth={4} />{" "}
                                      {activePromo.name}
                                    </span>
                                  )}
                                  {p.manufacturer && (
                                    <span className="text-[9px] md:text-[10px] font-black text-emerald-600 truncate max-w-[120px] md:max-w-none hidden sm:inline">
                                      {p.manufacturer}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="text-right flex flex-col items-end shrink-0">
                                {(() => {
                                  let currentPrice = p.price;
                                  let hasDiscount = Boolean(
                                    p.promotionType === "DISCOUNT" &&
                                    p.originalPrice &&
                                    p.originalPrice > p.price
                                  );

                                  if (activePromo) {
                                    if (
                                      activePromo.type === "LIGHTNING_OFFER"
                                    ) {
                                      if (
                                        activePromo.lightningDiscountPercentage &&
                                        activePromo.lightningDiscountPercentage >
                                          0
                                      ) {
                                        currentPrice =
                                          p.price *
                                          (1 -
                                            activePromo.lightningDiscountPercentage /
                                              100);
                                      } else if (
                                        activePromo.buyX &&
                                        activePromo.payY
                                      ) {
                                        // fixed combo calculation: effective price per unit
                                        currentPrice =
                                          activePromo.payY / activePromo.buyX;
                                      }
                                    } else if (
                                      activePromo.type === "BUY_X_PAY_Y" &&
                                      activePromo.buyX &&
                                      activePromo.payY
                                    ) {
                                      currentPrice =
                                        (p.price * activePromo.payY) /
                                        activePromo.buyX;
                                    } else if (
                                      activePromo.type === "FIXED_COMBO" &&
                                      activePromo.buyX &&
                                      activePromo.payY
                                    ) {
                                      currentPrice =
                                        activePromo.payY / activePromo.buyX;
                                    } else if (
                                      activePromo.type ===
                                        "PROGRESSIVE_DISCOUNT" &&
                                      activePromo.discountThresholds?.[0]
                                    ) {
                                      currentPrice =
                                        p.price *
                                        (1 -
                                          activePromo.discountThresholds[0]
                                            .discountPercentage /
                                            100);
                                    }
                                  } else if (
                                    p.promotionType === "DISCOUNT" &&
                                    hasDiscount
                                  ) {
                                    currentPrice = p.price;
                                  } else {
                                    currentPrice = p.originalPrice || p.price;
                                  }

                                  const showOriginalPrice = Boolean(
                                    activePromo ||
                                    (hasDiscount && !activePromo)
                                  );
                                  const origPrice = showOriginalPrice
                                    ? Math.max(p.originalPrice || 0, p.price)
                                    : p.price;

                                  return (
                                    <>
                                      {showOriginalPrice &&
                                        origPrice > currentPrice && (
                                          <span className="text-[10px] text-gray-400 line-through font-bold">
                                            R$ {origPrice.toFixed(2)}
                                          </span>
                                        )}
                                      <div className="flex items-center gap-2 md:gap-4">
                                        <p
                                          className={`font-black text-sm md:text-base whitespace-nowrap ${showOriginalPrice && origPrice > currentPrice ? "text-red-600" : "text-emerald-600"}`}
                                        >
                                          R$ {currentPrice.toFixed(2)}
                                        </p>
                                        <div className="hidden md:flex w-8 h-8 rounded-full bg-gray-100 items-center justify-center text-gray-400 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                                          <ChevronRight size={18} />
                                        </div>
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Spacer for centered layout on desktop */}
          <div className="hidden md:block flex-shrink-0 w-[40px] md:w-[150px] lg:w-[300px]"></div>
        </div>
      </header>

      <section className="w-full max-w-[1600px] lg:max-w-none mx-auto lg:mx-0 px-4 md:px-8 lg:px-0 mt-6 md:mt-8 [content-visibility:auto] [contain-intrinsic-size:300px]">
        <div
          className="relative overflow-hidden rounded-[2rem] md:rounded-[3rem] lg:rounded-none p-8 md:p-12 text-center text-white shadow-xl flex flex-col items-center justify-center gap-4 md:gap-6 animate-in zoom-in-95 duration-700"
          style={{
            background: `linear-gradient(135deg, #1a0505 0%, ${tenant.primaryColor} 100%)`,
          }}
        >
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 px-6 py-2 rounded-full flex items-center gap-2 mb-1 shadow-md">
            <Sparkles size={16} className="text-yellow-400 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">
              OFERTAS DO MÊS
            </span>
          </div>
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-black tracking-tighter leading-[0.9] lg:max-w-none w-full drop-shadow-2xl">
            {tenant.bannerTitle || tenant.name}
          </h2>
          {tenant.bannerSubtitle && (
            <p className="text-white/70 font-bold text-sm md:text-lg lg:text-xl lg:max-w-none w-full leading-relaxed uppercase tracking-widest mt-0">
              {tenant.bannerSubtitle}
            </p>
          )}

          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full -mr-[250px] -mt-[250px] blur-[100px]"></div>
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-black/40 rounded-full -ml-[200px] -mb-[200px] blur-[80px]"></div>
        </div>
      </section>

      <section className="bg-white py-6 mt-6 border-b relative shadow-sm z-10 w-full lg:px-4 [content-visibility:auto] [contain-intrinsic-size:200px]">
        <ScrollableRow
          wrapperClassName="w-full max-w-[1600px] lg:max-w-none mx-auto lg:mx-0"
          innerClassName="flex gap-5 md:gap-8 lg:gap-12 justify-start px-4 md:px-8 lg:px-12 pb-4"
        >
          {activePromotions
            ?.filter((p) => p.highlightInCategoriesBar)
            .map((promo, index) => {
              const Icon = getPromoIcon(promo.highlightIcon);
              const colorMap: any = {
                orange: "bg-orange-500 shadow-orange-500/30",
                red: "bg-red-500 shadow-red-500/30",
                purple: "bg-purple-500 shadow-purple-500/30",
                emerald: "bg-emerald-500 shadow-emerald-500/30",
                blue: "bg-blue-500 shadow-blue-500/30",
              };
              const bgClass =
                colorMap[promo.highlightColor || "orange"] ||
                colorMap["orange"];
              const isSelected = selectedPromotion?.id === promo.id;

              return (
                <button
                  key={`promo-${promo.id}`}
                  id={index === 0 ? "promo-category-target" : undefined}
                  onClick={() => {
                    if (isSelected) {
                      selectPromotion(null);
                    } else {
                      selectPromotion(promo.id);
                    }
                  }}
                  className={`relative flex flex-col items-center gap-3 group w-[100px] shrink-0 transition-all snap-start`}
                >
                  <div
                    className={`w-16 h-16 shrink-0 rounded-[1.5rem] flex items-center justify-center transition-all duration-300 relative ${isSelected ? "text-white shadow-[0_15px_30px_-5px_rgba(0,0,0,0.1)] scale-110 " + bgClass : "bg-gray-50 text-gray-400 hover:bg-gray-100"}`}
                  >
                    <div
                      className={`absolute inset-0 rounded-[1.5rem] opacity-20 bg-gradient-to-tr from-transparent to-white/50 ${isSelected ? "hidden" : "block"}`}
                    />
                    <div
                      className={
                        isSelected
                          ? ""
                          : bgClass.split(" ")[0].replace("bg-", "text-")
                      }
                    >
                      <Icon
                        size={28}
                        className={
                          isSelected
                            ? ""
                            : "opacity-80 group-hover:scale-110 transition-transform"
                        }
                      />
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-black uppercase tracking-widest text-center leading-tight transition-colors w-full break-words line-clamp-2 px-1 ${isSelected ? bgClass.split(" ")[0].replace("bg-", "text-") : "text-gray-400 group-hover:text-gray-600"}`}
                    title={promo.name}
                  >
                    {promo.name}
                  </span>
                </button>
              );
            })}
          {departments.map((dept, index) => {
            const isDeptSelected = selectedDepartment === dept;
            const isPromoCard = deptsWithPromos.has(dept);
            const isFirstPromo =
              isPromoCard &&
              index === 1 &&
              !activePromotions?.some((p) => p.highlightInCategoriesBar);
            return (
              <button
                key={dept}
                id={isFirstPromo ? "promo-category-target" : undefined}
                onClick={() => selectDepartment(dept)}
                className={`relative flex flex-col items-center gap-3 group w-[100px] shrink-0 transition-all snap-start ${index === 0 ? "ml-2" : ""} ${index === Object.keys(departments).length - 1 ? "mr-6" : ""}`}
              >
                <div
                  className={`w-16 h-16 shrink-0 rounded-[1.5rem] flex items-center justify-center transition-all duration-300 ${isDeptSelected ? "text-white shadow-[0_15px_30px_-5px_rgba(0,0,0,0.1)] scale-110" : "bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600"}`}
                  style={
                    isDeptSelected
                      ? { backgroundColor: tenant.primaryColor }
                      : {}
                  }
                >
                  {getDepartmentIcon(dept)}
                </div>
                <span
                  className={`text-[10px] font-black uppercase tracking-widest text-center leading-tight transition-colors w-full break-words line-clamp-2 px-1 ${isDeptSelected ? "text-gray-900" : "text-gray-400 group-hover:text-gray-600"}`}
                  title={dept}
                >
                  {dept}
                </span>
              </button>
            );
          })}
        </ScrollableRow>

        {subCategories.length > 1 && (
          <ScrollableRow
            wrapperClassName="w-full max-w-[1600px] mx-auto px-4 md:px-8 mt-2"
            innerClassName="flex gap-2 justify-start pb-2"
          >
            {subCategories.map((cat) => {
              const isCatSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => selectCategory(cat)}
                  className={`snap-start whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold transition-all border ${isCatSelected ? "text-white shadow-sm" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:border-gray-300"}`}
                  style={
                    isCatSelected
                      ? {
                          backgroundColor: tenant.primaryColor,
                          borderColor: tenant.primaryColor,
                        }
                      : {}
                  }
                >
                  {cat}
                </button>
              );
            })}
          </ScrollableRow>
        )}
      </section>

      <main
        ref={productsContainerRef}
        className="w-full lg:max-w-none mx-auto lg:mx-0 px-4 md:px-8 lg:px-6 py-8 scroll-mt-32"
      >
        {activeGlobalCoupon &&
          activeGlobalCoupon?.id !== activeCouponFilter?.id && (
            <div className="mb-8 animate-in slide-in-from-top duration-500">
              <div className="bg-emerald-50 border-2 border-emerald-100 rounded-[2rem] p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-100/50 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                <div className="flex items-center gap-5 relative z-10">
                  <div className="w-16 h-16 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-emerald-200">
                    <Tag size={32} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-xl font-black text-gray-900 tracking-tight">
                        Cupom: {activeGlobalCoupon?.code}
                      </h3>
                      <span className="bg-emerald-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                        Ativo
                      </span>
                    </div>
                    <p className="text-gray-500 font-bold text-sm">
                      ✨ Ganhe desconto nas compras acima de{" "}
                      <span className="font-black text-emerald-700">
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(activeGlobalCoupon?.minPurchaseValue || 0)}
                      </span>{" "}
                      no total do carrinho!
                    </p>
                  </div>
                </div>
                {activeGlobalCoupon?.couponScope !== "GLOBAL" && (
                  <div className="flex items-center gap-3 relative z-10 w-full md:w-auto">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(
                          activeGlobalCoupon?.code || "",
                        );
                        toast.success("Cupom copiado!");
                      }}
                      className="flex-1 md:flex-none px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-100 active:scale-95"
                    >
                      Copiar Código <Copy size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

        {activeCouponFilter && (
          <div className="mb-8 animate-in slide-in-from-top duration-500">
            <div className="bg-blue-50 border-2 border-blue-100 rounded-[2rem] p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100/50 rounded-full -mr-16 -mt-16 blur-2xl"></div>
              <div className="flex items-center gap-5 relative z-10">
                <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-200">
                  <Tag size={32} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-black text-gray-900 tracking-tight">
                      Cupom: {activeCouponFilter?.code}
                    </h3>
                    <span className="bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest">
                      Ativo
                    </span>
                  </div>
                  {activeCouponFilter?.couponScope === "GLOBAL" ? (
                    <p className="text-gray-500 font-bold text-sm">
                      ✨ Ganhe desconto nas compras acima de{" "}
                      <span className="font-black text-blue-700">
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(activeCouponFilter?.minPurchaseValue || 0)}
                      </span>{" "}
                      no total do carrinho!
                    </p>
                  ) : (
                    <p className="text-gray-500 font-bold text-sm">
                      Mostrando apenas produtos que aceitam este cupom.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 relative z-10 w-full md:w-auto">
                {activeCouponFilter?.couponScope !== "GLOBAL" && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        activeCouponFilter?.code || "",
                      );
                      toast.success("Cupom copiado!");
                    }}
                    className="flex-1 md:flex-none px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-100 active:scale-95"
                  >
                    Copiar Código <Copy size={14} />
                  </button>
                )}
                <button
                  onClick={() => resetFilters()}
                  className="flex-1 md:flex-none px-6 py-3 bg-white border-2 border-blue-100 text-blue-600 rounded-xl font-black text-xs hover:bg-blue-50 transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  Limpar Filtro <X size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
        {selectedPromotion && !activeCouponFilter && (
          <div className="mb-8 animate-in slide-in-from-top duration-500">
            <div
              className={`bg-red-50 border-2 border-red-100 rounded-[2rem] p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm relative overflow-hidden`}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-red-100/50 rounded-full -mr-16 -mt-16 blur-2xl"></div>
              <div className="flex items-center gap-5 relative z-10">
                <div
                  className={`w-16 h-16 bg-red-500 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-red-200`}
                >
                  <Percent size={32} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-black text-gray-900 tracking-tight">
                      {selectedPromotion.name}
                    </h3>
                    <span
                      className={`bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest`}
                    >
                      Oferta Ativa
                    </span>
                  </div>
                  <p className="text-gray-500 font-bold text-sm">
                    {selectedPromotion.type === "LIGHTNING_OFFER" &&
                    selectedPromotion.lightningDiscountPercentage
                      ? `Exibindo apenas itens com ${selectedPromotion.lightningDiscountPercentage}% OFF`
                      : selectedPromotion.type === "LIGHTNING_OFFER" &&
                          selectedPromotion.buyX &&
                          selectedPromotion.payY
                        ? `Exibindo produtos da oferta (Leve ${selectedPromotion.buyX} por R$ ${selectedPromotion.payY.toFixed(2).replace(".", ",")})`
                        : `Mostrando apenas produtos desta promoção.`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 relative z-10 w-full md:w-auto">
                <button
                  onClick={() => selectPromotion(null)}
                  className="flex-1 md:flex-none px-6 py-3 bg-white border-2 border-red-100 text-red-500 rounded-xl font-black text-xs hover:bg-red-50 transition-all flex items-center justify-center gap-2 active:scale-95"
                >
                  Remover Filtro <X size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
        {searchFallback && (
          <div className="mb-6 p-4 md:p-6 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-4">
             <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-blue-500">
               <Info size={20} />
             </div>
             <div>
               <h4 className="text-blue-900 font-bold text-sm md:text-base">
                 Não encontramos '{searchFallback.originalName}' disponível no momento.
               </h4>
               <p className="text-blue-700 text-xs md:text-sm mt-1 font-medium">
                 Mas temos opções com a mesma fórmula ({searchFallback.principle}) {searchFallback.presentation ? `e apresentação (${searchFallback.presentation})` : ''} em estoque para você:
               </p>
             </div>
          </div>
        )}
        {!(debouncedSearchTerm.length > 0 && filteredProducts.length > 0) && (
          <SmartBanner
            searchTerm={debouncedSearchTerm}
            selectedCategory={selectedCategory}
            onCategorySelect={(cat) => selectCategory(cat)}
            tenant={tenant}
          />
        )}
        {(selectedCategory !== "Todos" || searchTerm || selectedPromotion) &&
          filteredProducts.length > 0 && (
            <div className="flex items-center justify-between mb-6 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 text-gray-600 rounded-xl">
                  <Filter size={16} />
                </div>
                <div className="flex flex-col">
                  <h3 className="text-lg font-black text-gray-900 tracking-tight leading-none">
                    {selectedPromotion
                      ? searchTerm
                        ? `${selectedPromotion.name} - Busca: "${searchTerm}"`
                        : selectedPromotion.name
                      : searchTerm
                        ? `Busca: "${searchTerm}"`
                        : selectedCategory}
                  </h3>
                  <p className="text-gray-400 text-[10px] font-bold uppercase tracking-wide mt-0.5">
                    {filteredProducts.length} produtos
                  </p>
                </div>
              </div>
              <button
                onClick={resetFilters}
                className="group flex items-center gap-2 px-4 py-2 bg-white border-2 border-gray-100 hover:border-red-100 hover:bg-red-50 text-gray-500 hover:text-red-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm active:scale-95"
              >
                <span>Ver Todos</span>
                <X
                  size={14}
                  className="group-hover:rotate-90 transition-transform"
                />
              </button>
            </div>
          )}

        {isLoading || isTransitioning ? (
          <div className="py-32 text-center text-gray-500 font-black animate-pulse flex flex-col items-center justify-center gap-4">
            <div
              className="w-8 h-8 border-4 border-gray-200 border-t-brand rounded-full animate-spin"
              style={{ borderTopColor: tenant.primaryColor }}
            ></div>
            Carregando visualização...
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-32 text-center space-y-6">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <Package size={48} className="text-gray-300" />
            </div>
            <div className="space-y-2">
              <p className="text-gray-500 font-black text-xl">
                Nada encontrado...
              </p>
              <p className="text-gray-400 font-medium">
                Tente buscar por termos mais genéricos.
              </p>
            </div>
            <button
              onClick={resetFilters}
              className="bg-emerald-600 text-white px-8 py-3 rounded-full font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all"
            >
              Limpar Tudo
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const startIndex = virtualRow.index * columns;
                const rowProducts = paginatedProducts.slice(
                  startIndex,
                  startIndex + columns,
                );

                return (
                  <div
                    key={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5 md:gap-8 pb-5 md:pb-8"
                  >
                    {rowProducts.map((p, colIndex) => {
                      const globalIndex = startIndex + colIndex;
                      return (
                        <ProductCard
                          key={p.id}
                          product={p}
                          tenant={tenant}
                          promotions={activePromotions}
                          cartItems={cartItems}
                          onProductClick={onProductClick}
                          isProductInRule={isProductInRule}
                          onAddToCart={(e, p) => {
                            e.stopPropagation();
                            handleAddToCartWrapper(p);
                          }}
                          onNotify={(e, p) => {
                            e.stopPropagation();
                            handleNotifyMe(p);
                          }}
                          priority={globalIndex < 6}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Controle de Paginação/Carregamento em Lotes por Demanda */}
            {filteredProducts.length > visibleCount && (
              <div className="flex flex-col items-center justify-center mt-12 mb-6 gap-4 animate-in fade-in duration-300">
                <p className="text-sm font-semibold text-gray-500">
                  Exibindo <span className="font-extrabold text-gray-800">{Math.min(visibleCount, filteredProducts.length)}</span> de <span className="font-extrabold text-gray-800">{filteredProducts.length}</span> produtos
                </p>
                <div className="w-full max-w-xs bg-gray-100 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-emerald-600 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${(Math.min(visibleCount, filteredProducts.length) / filteredProducts.length) * 100}%` }}
                  />
                </div>
                <button
                  onClick={() => setVisibleCount(prev => Math.min(filteredProducts.length, prev + 42))}
                  className="px-8 py-3.5 bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition-all rounded-full font-black uppercase tracking-widest text-xs shadow-lg cursor-pointer flex items-center gap-2 border border-transparent"
                >
                  Carregar Mais Produtos
                </button>
              </div>
            )}
          </>
        )}

        {crossSellSuggestions.length > 0 && (
          <section className="mt-12 animate-in slide-in-from-left duration-500 pt-8 border-t border-gray-100 [content-visibility:auto] [contain-intrinsic-size:600px]">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="bg-orange-100 text-orange-600 p-2 rounded-xl shadow-inner">
                  <ShoppingBasket size={18} />
                </div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                  O que outros clientes estão levando
                </h3>
              </div>
              <span className="text-[11px] font-black uppercase text-gray-400 tracking-widest bg-gray-100 px-3 py-1 rounded-full">
                Ofertas do Balcão
              </span>
            </div>
            <ScrollableRow
              wrapperClassName="-mx-4"
              innerClassName="flex gap-5 pb-6 px-4"
            >
              {crossSellSuggestions.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  tenant={tenant}
                  promotions={activePromotions}
                  cartItems={cartItems}
                  onProductClick={onProductClick}
                  isProductInRule={isProductInRule}
                  onAddToCart={(e, p) => {
                    e.stopPropagation();
                    handleAddToCartWrapper(p);
                  }}
                  onNotify={(e, p) => {
                    e.stopPropagation();
                    handleNotifyMe(p);
                  }}
                  isCompact={true}
                />
              ))}
            </ScrollableRow>
          </section>
        )}
      </main>

      {/* Botão de Avaliação Discreto */}
      <button
        onClick={() => setIsReviewOpen(true)}
        className="fixed bottom-6 left-6 z-[100] p-3 rounded-full bg-white text-gray-400 hover:text-emerald-600 shadow-lg border border-gray-100 transition-all"
        title="Avaliar o App"
      >
        <Smile size={24} />
      </button>

      {/* Modal de Avaliação */}
      {isReviewOpen && (
        <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl animate-in zoom-in-95 relative overflow-hidden">
            <button
              onClick={() => setIsReviewOpen(false)}
              className="absolute top-4 right-4 p-2 bg-gray-50 rounded-full hover:text-red-500"
            >
              <X size={20} />
            </button>

            {reviewSuccess ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                  <Star fill="currentColor" size={32} />
                </div>
                <h3 className="text-xl font-black text-gray-900">Obrigado!</h3>
                <p className="text-gray-500 font-medium">
                  Sua avaliação foi enviada.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-center">
                  <h3 className="text-xl font-black text-gray-900">
                    Avalie sua experiência
                  </h3>
                  <p className="text-gray-500 text-xs font-bold mt-1">
                    O que você achou do nosso app?
                  </p>
                </div>

                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setReviewRating(star)}
                      className={`transition-all hover:scale-110 ${reviewRating >= star ? "text-yellow-400" : "text-gray-200"}`}
                    >
                      <Star
                        size={36}
                        fill="currentColor"
                        strokeWidth={reviewRating >= star ? 0 : 2}
                      />
                    </button>
                  ))}
                </div>

                <div>
                  <textarea
                    className="w-full bg-gray-50 border-2 border-gray-100 rounded-2xl p-4 text-sm font-medium outline-none focus:border-emerald-500 resize-none h-24 text-gray-800"
                    placeholder="Deixe um comentário (opcional)..."
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                  />
                </div>

                <button
                  onClick={handleSubmitReview}
                  disabled={isReviewSubmitting}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg active:scale-95 disabled:opacity-70 transition-all flex items-center justify-center gap-2"
                >
                  {isReviewSubmitting ? (
                    "Enviando..."
                  ) : (
                    <>
                      <Send size={14} /> Enviar Avaliação
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[200] flex">
          {/* Overlay */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-300"
            onClick={() => setIsDrawerOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative w-[85%] max-w-sm h-full bg-[#fcfdfe] shadow-2xl flex flex-col animate-in slide-in-from-left duration-300">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
              <div>
                <h2 className="text-xl font-black text-gray-900 tracking-tight">
                  Olá, Bem-vindo!
                </h2>
                <p className="text-[10px] font-black text-gray-400 mt-1 uppercase tracking-widest">
                  Navegar por Departamentos
                </p>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-full flex items-center justify-center text-gray-500 hover:text-red-500 hover:bg-red-50 transition-all shadow-sm"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-3">
              {departments
                .filter((d) => d !== "Todos")
                .map((dept) => {
                  const isExpanded = expandedDept === dept;
                  const cats = allCategoriesByDept.get(dept) || [];
                  return (
                    <div
                      key={dept}
                      className="rounded-2xl border border-gray-100 overflow-hidden bg-white shadow-sm transition-all group hover:border-gray-200"
                    >
                      <button
                        onClick={() =>
                          setExpandedDept(isExpanded ? null : dept)
                        }
                        className="w-full px-5 py-4 flex items-center justify-between bg-white transition-colors"
                      >
                        <span className="font-black text-gray-800 text-[13px] uppercase tracking-wide">
                          {dept}
                        </span>
                        <ChevronDown
                          size={18}
                          className={`text-gray-400 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-4 space-y-1.5 animate-in slide-in-from-top-2 fade-in duration-200">
                          <button
                            onClick={() => {
                              selectDepartmentAndCategory(dept, "Todos");
                            }}
                            className="w-full text-left py-2.5 px-3 rounded-xl text-xs font-black text-white hover:opacity-90 transition-all flex items-center gap-2 mb-2 shadow-sm"
                            style={{ backgroundColor: tenant.primaryColor }}
                          >
                            Ver Tudo de {dept}{" "}
                            <ChevronRight
                              size={14}
                              className="ml-auto opacity-70"
                            />
                          </button>
                          {cats.map((cat) => (
                            <button
                              key={cat}
                              onClick={() => {
                                selectDepartmentAndCategory(dept, cat);
                              }}
                              className="w-full text-left py-2.5 px-3 rounded-xl text-[13px] font-bold text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all border border-transparent hover:border-gray-100"
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      <button
        id="floating-cart-btn"
        onClick={onOpenCart}
        className={`fixed bottom-6 right-4 sm:right-6 z-[100] p-4 rounded-full text-white shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:scale-110 active:scale-95 transition-all duration-300 flex items-center justify-center border-4 border-white/20 backdrop-blur-sm ${cartBounce ? "scale-125" : ""}`}
        style={{
          background: `linear-gradient(135deg, ${tenant.primaryColor}, ${tenant.secondaryColor || tenant.primaryColor})`,
        }}
      >
        <ShoppingCart size={28} strokeWidth={2.5} />
        {cartCount > 0 && (
          <span
            className={`absolute -top-1 -right-1 bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shadow-lg border-2 border-white animate-in zoom-in ${cartBounce ? "animate-bounce" : ""}`}
          >
            {cartCount}
          </span>
        )}
      </button>

      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-[110] bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
            <CheckCircle2 size={14} className="text-white" />
          </div>
          <span className="font-bold text-sm">{toastMessage}</span>
        </div>
      )}

      <CookieBanner />
    </div>
  );
};
