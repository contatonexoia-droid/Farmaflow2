import { Order, PharmacyConfig, Product, PromotionRule, calculateItemTotal, isValidStoreProduct } from '../types';
import { getStoreUrl } from './store';
import { supabase } from '../services/supabase';
import { isSupabaseConfigured } from '../services/storage';

export type RepurchaseCycleCategory =
  | 'uso_continuo_30'
  | 'uso_continuo_60'
  | 'uso_continuo_90'
  | 'bebe_fraldas'
  | 'higiene_diaria'
  | 'vitaminas_suplementos'
  | 'outros';

export type RepurchaseFilterKey =
  | 'all'
  | 'uso_continuo'
  | 'bebe_fraldas'
  | 'higiene_diaria'
  | 'vitaminas_suplementos'
  | 'outros';

export type RepurchaseContactStatus = 'contacted' | 'ignored';

export interface RepurchaseContactRecord {
  id?: string;
  tenant_id: string;
  customer_phone: string;
  product_signature: string;
  status: RepurchaseContactStatus;
  last_order_id?: string | null;
  contacted_at: string;
}

export interface RepurchaseItemDetail {
  productKey: string;
  productId: string;
  lookupId: string;
  barcode?: string;
  internalCode?: string;
  name: string;
  cleanName: string;
  quantity: number;
  lastPurchasedAt: string;
  daysSincePurchase: number;
  cycleCategory: RepurchaseCycleCategory;
  cycleLabel: string;
  minDays: number;
  maxDays: number;
  isSecondary: boolean;
  requiresPrescription: boolean;
  isIntimateHygiene: boolean;
  inStock: boolean;
  currentUnitPrice: number;
  subtotal: number;
  matchedProduct?: Product;
}

export interface RepurchaseCandidate {
  key: string;
  customerName: string;
  firstName: string;
  customerPhone: string;
  normalizedPhone: string;
  lastOrderId: string;
  lastOrderDate: string;
  daysSinceLastOrder: number;
  cycleCategories: RepurchaseCycleCategory[];
  items: RepurchaseItemDetail[];
  inStockItems: RepurchaseItemDetail[];
  outOfStockItems: RepurchaseItemDetail[];
  recoverableRevenue: number;
  productSignature: string;
  magicLink: string;
  contactRecord?: RepurchaseContactRecord;
}

export interface ParsedRepeatEntry {
  id: string;
  quantity: number;
}

export const DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE =
  'Olá {nome}! Passando para lembrar que seu pedido de {produtos} na {farmacia} já deve estar acabando. Deixei tudo pronto no seu carrinho com entrega rápida em 1 toque: {link}';

const CONTACTS_STORAGE_PREFIX = 'farmaflow_repurchase_contacts_';
const TEMPLATE_STORAGE_PREFIX = 'farmaflow_repurchase_template_';
const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// LISTAS DE CLASSIFICAÇÃO E FILTRAGEM ANTI-FALSO-POSITIVO
// ============================================================================

const ANTIBIOTIC_KEYWORDS = [
  'ANTIBIOTICO',
  'AMOXICILINA',
  'AZITROMICINA',
  'CEFALEXINA',
  'CIPROFLOXACINO',
  'CLAVULIN',
];

const ACUTE_BLACKLIST_SUBSTRINGS = [
  'DIPIRONA',
  'DORFLEX',
  'PARACETAMOL',
  'IBUPROFENO',
  'NEOSALDINA',
  'ADVIL',
  'TYLENOL',
  'BUSCOPAN',
  'ENGOV',
  'SONRISAL',
  'BENEGRIP',
  'CIMEGRIP',
  'RESFENOL',
  'NALDECON',
  'VICK',
  'INALADOR',
  'PASTILHA',
  'STREPSILS',
  'VALDA',
  'XAROPE',
  'DESCONGESTIONANTE',
  'SORINE',
  'NEOSORO',
  'LORATADINA',
  'DESLORATADINA',
  'ALLEGRA',
  'HISTAMIN',
  'POLARAMINE',
  'DECONGEX',
  'DRAMIN',
  'VONAU',
  'REPOSITOR',
  'FLORATIL',
  'REPOFLOR',
  'ANTIBIOTICO',
  'AMOXICILINA',
  'AZITROMICINA',
  'CEFALEXINA',
  'CIPROFLOXACINO',
  'CLAVULIN',
  'NIMESULIDA',
  'DICLOFENACO',
  'TORSILAX',
  'MIOSAN',
  'CICLOBENZAPRINA',
  'PREDNISONA',
  'PREDNISOLONA',
  'DEXAMETASONA',
  'TESTE GRAVIDEZ',
  'TESTE DE GRAVIDEZ',
  'TESTE COVID',
  'TESTE DE COVID',
  'PRESERVATIVO',
  'CURATIVO',
  'BAND-AID',
  'BAND AID',
  'BANDAID',
  'ESPARADRAPO',
  'GAZE',
  'ALGODAO',
  'TERMOMETRO',
  'SERINGA',
];

const ACUTE_BLACKLIST_REGEXES = [
  /\bENO\b/,
  /\bBENEG/,
  /\bRINO/,
];

const SMALL_PACK_REGEXES = [
  /\bCARTELA\b/,
  /\bC\/\s*(?:2|4|6|8|10|12)(?!\d)/,
  /\b(?:4|6|8|10|12)\s*(?:CP|COMP|COMPRIMIDO|COMPRIMIDOS|CAPS|CAPSULA|CAPSULAS)\b/,
];

const CONTRACEPTIVE_KEYWORDS = [
  'ANTICONCEPCIONAL',
  'CICLO 21',
  'SELENE',
  'DIANE',
  'YAZ',
  'YASMIN',
  'ELANI',
  'DESOGESTREL',
  'CERAZETTE',
];

const CONTINUOUS_ACTIVE_KEYWORDS = [
  'LOSARTANA',
  'ATENOLOL',
  'ENALAPRIL',
  'ANLODIPINO',
  'HIDROCLOROTIAZIDA',
  'METFORMINA',
  'GLIFAGE',
  'GLIBENCLAMIDA',
  'INSULINA',
  'SINVASTATINA',
  'ROSUVASTATINA',
  'ATORVASTATINA',
  'LEVOTIROXINA',
  'PURAN',
  'EUTHYROX',
  'OMEPRAZOL',
  'PANTOPRAZOL',
  'ESOMEPRAZOL',
  'BUPROPIONA',
  'ESCITALOPRAM',
  'SERTRALINA',
  'FLUOXETINA',
  'VENLAFAXINA',
  'DESVENLAFAXINA',
  'CLONAZEPAM',
  'ALPRAZOLAM',
  'ZOLPIDEM',
  'QUETIAPINA',
  'RITALINA',
  'VENVANSE',
  ...CONTRACEPTIVE_KEYWORDS,
  'COLIRIO',
  'BOMBINHA',
  'AEROLIN',
  'ALENIA',
  'SYMBICORT',
];

const BABY_DIAPER_KEYWORDS = [
  'FRALDA',
  'LEITE',
  'FORMULA',
  'APTAMIL',
  'NESTOGENO',
  'ENFAMIL',
  'PREGUN',
  'LENCO UMEDECIDO',
  'POMADA ASSADURA',
  'BEPANTOL BABY',
  'HIPOGLOS',
];

const DAILY_HYGIENE_KEYWORDS = [
  'PROTETOR DIARIO',
  'ABSORVENTE',
  'INTIMUS',
  'ALWAYS',
  'SABONETE INTIMO',
  'FRALDA GERIAT',
  'PLENITUD',
  'TENA',
  'BIGFRAL',
  'DESODORANTE',
  'CREME DENTAL',
  'PASTA DE DENTE',
  'ENXAGUANTE',
  'SHAMPOO',
  'CONDICIONADOR',
];

// Itens capilares/cosméticos de giro longo que NÃO devem entrar no ciclo curto de Higiene Diária
const LONG_CYCLE_COSMETIC_EXCLUSIONS = [
  'FINALIZADOR',
  'FLUIDO',
  'MASCARA',
  'TINTURA',
  'COLORACAO',
  'TONALIZANTE',
  'LEAVE-IN',
  'LEAVE IN',
  'REPARADOR DE PONTAS',
];

const VITAMIN_SUPPLEMENT_KEYWORDS = [
  'VITAMINA',
  'OMEGA',
  'MAGNESIO',
  'COLAGENO',
  'CREATINA',
  'WHEY',
  'CENTRUM',
  'LAVITAN',
  'POLIVITAMINICO',
  'MELATONINA',
  'FERRO',
  'CALCIO',
  'PROBIOTICO',
];

const INTIMATE_HYGIENE_SUBSTRINGS = [
  'SABONETE INTIMO',
  'ABS ',
  'ABSORVENTE',
  'PROTETOR DIARIO',
  'INTIMUS',
  'ALWAYS',
];

const LOWERCASE_CONNECTORS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'com',
  'para',
  'por',
  'sem',
  'ao',
  'aos',
  'na',
  'no',
  'nas',
  'nos',
  'c/',
  's/',
]);

const UPPERCASE_ACRONYMS = new Set([
  'FPS',
  'SPF',
  'UVA',
  'UVB',
  'UV',
  'RN',
  'PP',
  'GG',
  'XG',
  'XXG',
  'XXXG',
  'LED',
  'USB',
  'OTC',
  'BB',
  'CC',
  'DD',
  'D3',
  'K2',
  'B1',
  'B2',
  'B3',
  'B5',
  'B6',
  'B12',
  'Q10',
  'HD',
  '3D',
  '4K',
  'II',
  'III',
  'IV',
]);

export const normalizeTextUpper = (value?: string | null): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

export const normalizePhoneBR = (raw?: string | null): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length > 11 && digits.startsWith('55')) {
    return digits.slice(2);
  }
  return digits;
};

export const formatPhoneDisplay = (normalized: string): string => {
  const d = normalizePhoneBR(normalized);
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return normalized || 'Sem telefone';
};

export const extractFirstName = (fullName?: string | null): string => {
  const clean = String(fullName || '').trim();
  if (!clean) return 'Cliente';
  const first = clean.split(/\s+/)[0] || 'Cliente';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
};

const formatCleanWordSegment = (segment: string, isFirstToken: boolean): string => {
  if (!segment) return segment;

  const lower = segment.toLowerCase();
  const upper = segment.toUpperCase();

  // Unidades coladas a números (ex: 500MG -> 500mg, 200ML -> 200ml, 2000UI -> 2000UI, 1L -> 1L)
  const unitMatch = segment.match(/^(\d+(?:[.,]\d+)?)(mg|ml|mcg|kg|g|l|ui|un|cp|cpr|comp|caps|cm|mm|m)$/i);
  if (unitMatch) {
    const [, num, rawUnit] = unitMatch;
    const unitLower = rawUnit.toLowerCase();
    if (unitLower === 'ui') return `${num}UI`;
    if (unitLower === 'l') return `${num}L`;
    return `${num}${unitLower}`;
  }

  if (UPPERCASE_ACRONYMS.has(upper)) {
    return upper;
  }

  if (lower === 'ph') {
    return 'pH';
  }

  if (lower === 'c/' || lower === 's/') {
    return lower;
  }

  // Preserva palavras já em capitalização mista (ex: "La", "iPhone", "McDonald")
  const hasLower = segment !== upper;
  const hasUpper = segment !== lower;
  if (hasLower && hasUpper) {
    return segment;
  }

  if (!isFirstToken && LOWERCASE_CONNECTORS.has(lower)) {
    return lower;
  }

  const matchFirstLetter = lower.match(/^([^a-zA-ZÀ-ÿ]*)([a-zA-ZÀ-ÿ])(.*)$/);
  if (!matchFirstLetter) return segment;

  const [, prefix, firstChar, rest] = matchFirstLetter;
  return `${prefix}${firstChar.toUpperCase()}${rest}`;
};

/**
 * Limpa nomes vindos do ERP para exibição natural na mensagem de WhatsApp:
 * - Remove caracteres soltos de ERP (@, *, #) e marcações internas como (C1)/(B1) quando solicitado
 * - Remove espaços duplos e converte de CAIXA ALTA para Title Case legível
 */
export const cleanErpProductName = (
  rawName?: string | null,
  options?: { stripControlCodes?: boolean },
): string => {
  let cleaned = String(rawName || '')
    .replace(/[@*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (options?.stripControlCodes) {
    cleaned = cleaned
      .replace(/\(\s*(?:C1|B1|B2|A1|A2|A3)\s*\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!cleaned) return '';

  return cleaned
    .split(' ')
    .map((token, tokenIndex) => {
      const lowerToken = token.toLowerCase();
      if (lowerToken === 'c/' || lowerToken === 's/') {
        return lowerToken;
      }

      const parts = token.split(/([-–/])/);
      return parts
        .map((part, partIndex) => {
          if (part === '-' || part === '–' || part === '/') return part;
          return formatCleanWordSegment(part, tokenIndex === 0 && partIndex === 0);
        })
        .join('');
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const isControlledRepurchaseProduct = (
  name?: string | null,
  requiresPrescriptionFlag?: boolean | null,
): boolean => {
  if (requiresPrescriptionFlag === true) return true;
  const upper = normalizeTextUpper(name);
  return /\(\s*C1\s*\)/.test(upper) || /\(\s*B1\s*\)/.test(upper);
};

export const isIntimateHygieneProduct = (name?: string | null): boolean => {
  const upper = ` ${normalizeTextUpper(name)} `;
  if (/\bABS\b/.test(upper)) return true;
  return INTIMATE_HYGIENE_SUBSTRINGS.some((kw) => upper.includes(kw));
};

const isAntibioticProduct = (nameUpper: string, categoryUpper: string): boolean => {
  const combined = `${nameUpper} ${categoryUpper}`;
  return ANTIBIOTIC_KEYWORDS.some((kw) => combined.includes(kw));
};

const matchesContinuousKeyword = (nameUpper: string): boolean => {
  return CONTINUOUS_ACTIVE_KEYWORDS.some((kw) => nameUpper.includes(kw));
};

const extractBoxPillCount = (textUpper: string): 30 | 60 | 90 | null => {
  if (
    /\b90\s*(?:CP|COMP|COMPRIMIDO|COMPRIMIDOS|CAPS|CAPSULA|CAPSULAS)\b/.test(textUpper) ||
    /\bC\/?\s*90(?!\d)/.test(textUpper)
  ) {
    return 90;
  }
  if (
    /\b(?:56|60)\s*(?:CP|COMP|COMPRIMIDO|COMPRIMIDOS|CAPS|CAPSULA|CAPSULAS)\b/.test(textUpper) ||
    /\bC\/?\s*(?:56|60)(?!\d)/.test(textUpper)
  ) {
    return 60;
  }
  if (
    /\b(?:28|30)\s*(?:CP|COMP|COMPRIMIDO|COMPRIMIDOS|CAPS|CAPSULA|CAPSULAS)\b/.test(textUpper) ||
    /\bC\/?\s*(?:28|30)(?!\d)/.test(textUpper)
  ) {
    return 30;
  }
  return null;
};

/**
 * Retorna true se o produto for pontual/agudo e NUNCA deve ser sugerido no Radar.
 */
export const isBlacklistedRepurchaseProduct = (
  name?: string | null,
  category?: string | null,
): boolean => {
  const nameUpper = normalizeTextUpper(name);
  const categoryUpper = normalizeTextUpper(category);
  if (!nameUpper) return true;

  // 1. Sintomáticos, agudos e antibióticos: exclusão absoluta
  if (isAntibioticProduct(nameUpper, categoryUpper)) {
    return true;
  }
  if (ACUTE_BLACKLIST_SUBSTRINGS.some((kw) => nameUpper.includes(kw))) {
    return true;
  }
  if (ACUTE_BLACKLIST_REGEXES.some((rx) => rx.test(nameUpper))) {
    return true;
  }

  // 2. Embalagens pequenas/pontuais (exceto anticoncepcional ou medicamento de uso contínuo listado)
  const isSmallPack = SMALL_PACK_REGEXES.some((rx) => rx.test(nameUpper));
  if (isSmallPack && !matchesContinuousKeyword(nameUpper)) {
    return true;
  }

  return false;
};

/**
 * Aplica multiplicador inteligente pela quantidade comprada no pedido (2x, 3x...).
 * - Fraldas/Bebê: teto razoável (2 pacotes ≈ 20-35 dias)
 * - Demais ciclos: escala proporcional (ex.: 2x de 30d ≈ 52-75 dias)
 */
export const applyQuantityMultiplier = (
  baseMin: number,
  baseMax: number,
  quantity: number,
  category: RepurchaseCycleCategory,
): { minDays: number; maxDays: number } => {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  if (qty <= 1) {
    return { minDays: baseMin, maxDays: baseMax };
  }

  if (category === 'bebe_fraldas') {
    if (qty === 2) {
      return { minDays: 20, maxDays: 35 };
    }
    const extra = Math.min(qty - 2, 4);
    return {
      minDays: Math.min(48, 20 + extra * 8),
      maxDays: Math.min(65, 35 + extra * 10),
    };
  }

  const effectiveQty = Math.min(qty, 4);
  const mid = (baseMin + baseMax) / 2;
  const minDays = Math.round(baseMin + (effectiveQty - 1) * mid * 0.97);
  const maxDays = Math.round(baseMax + (effectiveQty - 1) * mid * 1.13);
  return { minDays, maxDays };
};

export interface ProductCycleClassification {
  category: RepurchaseCycleCategory;
  label: string;
  minDays: number;
  maxDays: number;
  isSecondary: boolean;
  requiresPrescription: boolean;
  isIntimateHygiene: boolean;
}

export const classifyProductCycle = (
  name?: string | null,
  category?: string | null,
  description?: string | null,
  options?: {
    requiresPrescription?: boolean | null;
    quantity?: number;
  },
): ProductCycleClassification | null => {
  const nameUpper = normalizeTextUpper(name);
  const categoryUpper = normalizeTextUpper(category);
  const descUpper = normalizeTextUpper(description);

  // Lista negra: nunca sugerir itens pontuais/agudos
  if (isBlacklistedRepurchaseProduct(name, category)) {
    return null;
  }

  const quantity = Math.max(1, Math.round(Number(options?.quantity) || 1));
  const requiresPrescription = isControlledRepurchaseProduct(name, options?.requiresPrescription);
  const isIntimateHygiene = isIntimateHygieneProduct(name);
  const boxCount = extractBoxPillCount(nameUpper) || extractBoxPillCount(descUpper);
  const haystackName = ` ${nameUpper} `;

  const finalize = (
    cycleCategory: RepurchaseCycleCategory,
    baseName: string,
    baseMin: number,
    baseMax: number,
    isSecondary: boolean,
  ): ProductCycleClassification => {
    const { minDays, maxDays } = applyQuantityMultiplier(baseMin, baseMax, quantity, cycleCategory);
    const qtyTag = quantity > 1 ? ` · ${quantity}x` : '';
    return {
      category: cycleCategory,
      label: `${baseName} (${minDays}-${maxDays}d${qtyTag})`,
      minDays,
      maxDays,
      isSecondary,
      requiresPrescription,
      isIntimateHygiene,
    };
  };

  // 1. Uso Contínuo & Controlados por princípio ativo ou controle/receita (exceto antibióticos já bloqueados)
  if (matchesContinuousKeyword(nameUpper) || requiresPrescription) {
    if (boxCount === 90) {
      return finalize('uso_continuo_90', 'Uso Contínuo 90cp', 80, 105, false);
    }
    if (boxCount === 60) {
      return finalize('uso_continuo_60', 'Uso Contínuo 60cp', 50, 70, false);
    }
    return finalize('uso_continuo_30', 'Uso Contínuo & Controlados', 22, 40, false);
  }

  // 2. Vitaminas & Suplementos (25-45d para 30cp; 50-70d para 60cp; 75-100d para 90cp)
  const matchesVitamin = VITAMIN_SUPPLEMENT_KEYWORDS.some((kw) => nameUpper.includes(kw));
  if (matchesVitamin) {
    if (boxCount === 90) {
      return finalize('vitaminas_suplementos', 'Vitaminas & Suplementos 90cp', 75, 100, false);
    }
    if (boxCount === 60) {
      return finalize('vitaminas_suplementos', 'Vitaminas & Suplementos 60cp', 50, 70, false);
    }
    return finalize('vitaminas_suplementos', 'Vitaminas & Suplementos', 25, 45, false);
  }

  // 3. Higiene & Cuidado Diário (28-50d) — checar antes de Bebê para não confundir Fralda Geriátrica
  const isLongCycleCosmetic = LONG_CYCLE_COSMETIC_EXCLUSIONS.some((kw) => nameUpper.includes(kw));
  const matchesDailyHygiene =
    !isLongCycleCosmetic &&
    (/\bABS\b/.test(haystackName) ||
      DAILY_HYGIENE_KEYWORDS.some((kw) => nameUpper.includes(kw)));
  if (matchesDailyHygiene) {
    return finalize('higiene_diaria', 'Higiene & Cuidado Diário', 28, 50, false);
  }

  // 4. Bebê & Fraldas (12-28d)
  const matchesBaby =
    /\bNAN\b/.test(haystackName) ||
    BABY_DIAPER_KEYWORDS.some((kw) => nameUpper.includes(kw));
  if (matchesBaby) {
    return finalize('bebe_fraldas', 'Bebê & Fraldas', 12, 28, false);
  }

  // 5. Uso Contínuo por apresentação de caixa (28, 30, 56, 60 ou 90 comprimidos/cápsulas)
  if (boxCount === 90) {
    return finalize('uso_continuo_90', 'Uso Contínuo 90cp', 80, 105, false);
  }
  if (boxCount === 60) {
    return finalize('uso_continuo_60', 'Uso Contínuo 60cp', 50, 70, false);
  }
  if (boxCount === 30) {
    return finalize('uso_continuo_30', 'Uso Contínuo 30cp', 22, 40, false);
  }

  // 6. Secundário opcional: Outros (60-90d) — desativado por padrão na aba principal
  return finalize('outros', 'Outros', 60, 90, true);
};

const getEffectiveUnitPrice = (
  product: Product,
  promotions: PromotionRule[] = [],
  tenantId?: string,
): number => {
  const promoPrice =
    product.promotionalPrice &&
    product.promotionalPrice > 0 &&
    product.promotionalPrice < product.price
      ? product.promotionalPrice
      : product.price;

  if (!promotions || promotions.length === 0) {
    return Number(promoPrice) || 0;
  }

  try {
    const calculated = calculateItemTotal(
      { ...product, quantity: 1 },
      promotions,
      [],
      tenantId,
      [{ ...product, quantity: 1 }],
    );
    if (Number.isFinite(calculated) && calculated > 0) {
      return Math.min(calculated, Number(promoPrice) || calculated);
    }
  } catch {
    // fallback silencioso para preço padrão/promocional
  }
  return Number(promoPrice) || 0;
};

const buildCanonicalProductKey = (item: {
  id?: string;
  barcode?: string;
  internalCode?: string;
  name?: string;
}): string => {
  const barcode = String(item.barcode || '').replace(/\D/g, '');
  if (barcode.length >= 8) return `ean:${barcode}`;
  const internal = String(item.internalCode || '').trim().toLowerCase();
  if (internal) return `cod:${internal}`;
  const id = String(item.id || '').trim().toLowerCase();
  if (id) return `id:${id}`;
  return `name:${normalizeTextUpper(item.name)}`;
};

export const buildMagicRepeatUrl = (
  tenant: Partial<PharmacyConfig> & { id?: string; slug?: string; subdomain?: string },
  items: { lookupId: string; quantity: number }[],
): string => {
  const base = getStoreUrl(tenant).replace(/\/+$/, '');
  const pairs = items
    .filter((i) => i.lookupId && i.quantity > 0)
    .slice(0, 20)
    .map((i) => `${encodeURIComponent(String(i.lookupId).trim())}:${Math.max(1, Math.min(99, Math.round(i.quantity)))}`);

  if (pairs.length === 0) {
    return `${base}/?origem=recompra`;
  }
  return `${base}/?repetir=${pairs.join(',')}&origem=recompra`;
};

export const parseRepeatOrderParam = (rawParam?: string | null): ParsedRepeatEntry[] => {
  if (!rawParam) return [];
  const entries: ParsedRepeatEntry[] = [];
  const seen = new Set<string>();

  const tokens = String(rawParam)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 25);

  for (const token of tokens) {
    const lastColon = token.lastIndexOf(':');
    let rawId = token;
    let qty = 1;

    if (lastColon > 0) {
      const maybeQty = Number(token.slice(lastColon + 1));
      if (Number.isFinite(maybeQty) && maybeQty > 0) {
        rawId = token.slice(0, lastColon).trim();
        qty = Math.max(1, Math.min(99, Math.round(maybeQty)));
      }
    }

    let decodedId = rawId;
    try {
      decodedId = decodeURIComponent(rawId).trim();
    } catch {
      decodedId = rawId.trim();
    }

    if (!decodedId) continue;
    const key = decodedId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ id: decodedId, quantity: qty });
  }

  return entries;
};

export const matchCatalogProduct = (
  lookupId: string,
  catalog: Product[],
  fallback?: { barcode?: string; internalCode?: string; name?: string },
): Product | undefined => {
  const needle = String(lookupId || '').trim().toLowerCase();
  const cleanBarcode = String(fallback?.barcode || '').replace(/\D/g, '');
  const cleanInternal = String(fallback?.internalCode || '').trim().toLowerCase();
  const normName = fallback?.name ? normalizeTextUpper(fallback.name) : '';

  for (const prod of catalog) {
    if (!prod) continue;
    if (needle && String(prod.id || '').trim().toLowerCase() === needle) return prod;
    if (needle && prod.internalCode && String(prod.internalCode).trim().toLowerCase() === needle) {
      return prod;
    }
    if (needle && prod.barcode && String(prod.barcode).trim().toLowerCase() === needle) {
      return prod;
    }
  }

  if (cleanBarcode.length >= 8) {
    const byEan = catalog.find(
      (p) => String(p.barcode || '').replace(/\D/g, '') === cleanBarcode,
    );
    if (byEan) return byEan;
  }

  if (cleanInternal) {
    const byCode = catalog.find(
      (p) => String(p.internalCode || '').trim().toLowerCase() === cleanInternal,
    );
    if (byCode) return byCode;
  }

  if (normName) {
    const byName = catalog.find((p) => normalizeTextUpper(p.name) === normName);
    if (byName) return byName;
  }

  return undefined;
};

export const formatRepurchaseWhatsAppMessage = (
  template: string,
  candidate: RepurchaseCandidate,
  storeName: string,
  options?: {
    selectedItems?: RepurchaseItemDetail[];
    magicLink?: string;
  },
): string => {
  const activeItems =
    options?.selectedItems && options.selectedItems.length > 0
      ? options.selectedItems
      : candidate.inStockItems.length > 0
        ? candidate.inStockItems
        : candidate.items;

  const resolvedLink = options?.magicLink || candidate.magicLink;
  const cleanStore = storeName || 'nossa drogaria';

  const isExclusivelyIntimate =
    activeItems.length > 0 && activeItems.every((item) => item.isIntimateHygiene);
  const hasControlledItem = activeItems.some((item) => item.requiresPrescription);

  let productsText = '';
  if (isExclusivelyIntimate) {
    productsText = 'seus itens de cuidado diário';
  } else {
    const productSummary = activeItems
      .slice(0, 3)
      .map((item) => {
        const displayName =
          cleanErpProductName(item.name, { stripControlCodes: true }) || item.name;
        return item.quantity > 1 ? `${item.quantity}x ${displayName}` : displayName;
      })
      .join(', ');
    const extraCount = activeItems.length > 3 ? ` e mais ${activeItems.length - 3}` : '';
    productsText = `${productSummary}${extraCount}`;
  }

  let baseTemplate = template || DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE;

  // Ajuste gramatical natural quando for mensagem discreta de higiene íntima
  if (isExclusivelyIntimate) {
    baseTemplate = baseTemplate
      .replace(/seu pedido de \{produtos\}/gi, '{produtos}')
      .replace(/o pedido de \{produtos\}/gi, '{produtos}')
      .replace(/de \{produtos\}/gi, '{produtos}')
      .replace(/\{produtos\}([^.!?\n]*?)já deve estar acabando/gi, '{produtos}$1já devem estar acabando');
  }

  // Ajuste automático para medicamentos controlados / com receita
  if (hasControlledItem && !/receita/i.test(baseTemplate)) {
    const prescriptionPrompt =
      'Você já está com a receita renovada para agilizarmos sua entrega?';
    if (/\{link\}/i.test(baseTemplate)) {
      baseTemplate = baseTemplate.replace(
        /(\s*Deixei tudo pronto|\s*\{link\})/i,
        ` ${prescriptionPrompt}$1`,
      );
    } else {
      baseTemplate = `${baseTemplate.trim()} ${prescriptionPrompt}`;
    }
  }

  return baseTemplate
    .replace(/\{nome\}/gi, candidate.firstName)
    .replace(/\{produtos\}/gi, productsText)
    .replace(/\{farmacia\}/gi, cleanStore)
    .replace(/\{link\}/gi, resolvedLink)
    .replace(/\s{2,}/g, ' ')
    .trim();
};

export const buildRepurchaseWhatsAppHref = (
  normalizedPhone: string,
  message: string,
): string => {
  const clean = normalizePhoneBR(normalizedPhone);
  const fullPhone = clean.startsWith('55') ? clean : `55${clean}`;
  return `https://wa.me/${fullPhone}?text=${encodeURIComponent(message)}`;
};

export const analyzeRepurchaseCandidates = (params: {
  orders: Order[];
  products: Product[];
  tenant: PharmacyConfig;
  promotions?: PromotionRule[];
  contacts?: RepurchaseContactRecord[];
  now?: Date;
  mode?: 'primary' | 'outros';
}): RepurchaseCandidate[] => {
  const {
    orders,
    products,
    tenant,
    promotions = [],
    contacts = [],
    now = new Date(),
    mode = 'primary',
  } = params;

  const nowMs = now.getTime();
  // Janela ampla (180d) na leitura de pedidos para suportar caixas 90cp (80-105d) e múltiplos (2x/3x),
  // enquanto cada produto só aparece estritamente dentro do seu [minDays, maxDays] calculado.
  const lookbackStartMs = nowMs - 180 * DAY_MS;

  // Índices rápidos do catálogo atual para conferência real de estoque
  const byId = new Map<string, Product>();
  const byInternal = new Map<string, Product>();
  const byBarcode = new Map<string, Product>();
  const byNormName = new Map<string, Product>();

  for (const p of products || []) {
    if (!p) continue;
    if (p.id) byId.set(String(p.id).trim().toLowerCase(), p);
    if (p.internalCode) byInternal.set(String(p.internalCode).trim().toLowerCase(), p);
    const ean = String(p.barcode || '').replace(/\D/g, '');
    if (ean.length >= 8) byBarcode.set(ean, p);
    const nName = normalizeTextUpper(p.name);
    if (nName && !byNormName.has(nName)) byNormName.set(nName, p);
  }

  const findProductFast = (item: {
    id?: string;
    barcode?: string;
    internalCode?: string;
    name?: string;
  }): Product | undefined => {
    const idKey = String(item.id || '').trim().toLowerCase();
    if (idKey && byId.has(idKey)) return byId.get(idKey);
    const ean = String(item.barcode || '').replace(/\D/g, '');
    if (ean.length >= 8 && byBarcode.has(ean)) return byBarcode.get(ean);
    const code = String(item.internalCode || '').trim().toLowerCase();
    if (code && byInternal.has(code)) return byInternal.get(code);
    const nName = normalizeTextUpper(item.name);
    if (nName && byNormName.has(nName)) return byNormName.get(nName);
    return undefined;
  };

  // 1. Filtra pedidos válidos na janela de análise
  const validOrders = (orders || []).filter((o) => {
    if (!o || !o.date || !Array.isArray(o.items) || o.items.length === 0) return false;
    const st = String(o.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'cancelado' || st === 'rejected' || st === 'rejeitado') {
      return false;
    }
    const ts = new Date(o.date).getTime();
    if (Number.isNaN(ts) || ts < lookbackStartMs || ts > nowMs + DAY_MS) return false;
    const phone = normalizePhoneBR(o.customer?.phone);
    return phone.length >= 10;
  });

  // 2. Agrupa por telefone normalizado e rastreia a ÚLTIMA compra de cada produto
  // (agregando quantidades caso o mesmo item apareça duplicado no mesmo pedido)
  interface CustomerBucket {
    customerName: string;
    customerPhone: string;
    normalizedPhone: string;
    lastOrderId: string;
    lastOrderMs: number;
    lastOrderDate: string;
    productMap: Map<
      string,
      {
        productKey: string;
        item: Order['items'][number];
        orderId: string;
        purchasedMs: number;
        purchasedAt: string;
        quantity: number;
      }
    >;
  }

  const customers = new Map<string, CustomerBucket>();

  for (const order of validOrders) {
    const normalizedPhone = normalizePhoneBR(order.customer?.phone);
    const orderMs = new Date(order.date).getTime();
    let bucket = customers.get(normalizedPhone);

    if (!bucket) {
      bucket = {
        customerName: String(order.customer?.name || 'Cliente').trim() || 'Cliente',
        customerPhone: String(order.customer?.phone || normalizedPhone),
        normalizedPhone,
        lastOrderId: order.id,
        lastOrderMs: orderMs,
        lastOrderDate: order.date,
        productMap: new Map(),
      };
      customers.set(normalizedPhone, bucket);
    } else if (orderMs >= bucket.lastOrderMs) {
      bucket.lastOrderMs = orderMs;
      bucket.lastOrderDate = order.date;
      bucket.lastOrderId = order.id;
      if (order.customer?.name && order.customer.name.trim()) {
        bucket.customerName = order.customer.name.trim();
      }
      if (order.customer?.phone) {
        bucket.customerPhone = order.customer.phone;
      }
    }

    // Agrega quantidade do mesmo produto dentro do mesmo pedido
    const orderItemAgg = new Map<
      string,
      { item: Order['items'][number]; quantity: number }
    >();
    for (const item of order.items) {
      if (!item || !item.name) continue;
      const pKey = buildCanonicalProductKey(item);
      const qty = Math.max(1, Number(item.quantity) || 1);
      const prevAgg = orderItemAgg.get(pKey);
      if (prevAgg) {
        prevAgg.quantity += qty;
      } else {
        orderItemAgg.set(pKey, { item, quantity: qty });
      }
    }

    for (const [pKey, agg] of orderItemAgg.entries()) {
      const existing = bucket.productMap.get(pKey);
      if (!existing || orderMs > existing.purchasedMs) {
        bucket.productMap.set(pKey, {
          productKey: pKey,
          item: agg.item,
          orderId: order.id,
          purchasedMs: orderMs,
          purchasedAt: order.date,
          quantity: agg.quantity,
        });
      }
    }
  }

  // Mapa de contatos registrados por telefone (mais recente prevalece)
  const latestContactByPhone = new Map<string, RepurchaseContactRecord>();
  for (const rec of contacts || []) {
    const normPhone = normalizePhoneBR(rec.customer_phone);
    if (!normPhone) continue;
    const prev = latestContactByPhone.get(normPhone);
    const curTs = new Date(rec.contacted_at).getTime() || 0;
    const prevTs = prev ? new Date(prev.contacted_at).getTime() || 0 : -1;
    if (!prev || curTs >= prevTs) {
      latestContactByPhone.set(normPhone, rec);
    }
  }

  const candidates: RepurchaseCandidate[] = [];

  for (const bucket of customers.values()) {
    const dueItems: RepurchaseItemDetail[] = [];

    for (const entry of bucket.productMap.values()) {
      const daysSince = Math.floor((nowMs - entry.purchasedMs) / DAY_MS);
      const matched = findProductFast(entry.item);
      const resolvedName = matched?.name || entry.item.name;
      const resolvedCategory = matched?.category || entry.item.category;
      const resolvedDescription = matched?.description || entry.item.description;
      const requiresPrescriptionFlag = Boolean(
        matched?.requires_prescription ||
          (entry.item as any)?.requires_prescription,
      );

      const cycle = classifyProductCycle(
        resolvedName,
        resolvedCategory,
        resolvedDescription,
        {
          requiresPrescription: requiresPrescriptionFlag,
          quantity: entry.quantity,
        },
      );

      // Excluído pela lista negra (agudos/sintomáticos/cartelas pequenas)
      if (!cycle) continue;

      // Separa fila principal (4 categorias de alta probabilidade) do filtro secundário "Outros (60-90d)"
      if (mode === 'primary' && cycle.isSecondary) continue;
      if (mode === 'outros' && !cycle.isSecondary) continue;

      // Só entra no radar se estiver na janela ideal de reposição (já multiplicada por quantidade)
      if (daysSince < cycle.minDays || daysSince > cycle.maxDays) {
        continue;
      }

      const inStock = Boolean(matched && isValidStoreProduct(matched));
      const unitPrice = matched
        ? getEffectiveUnitPrice(matched, promotions, tenant?.id)
        : Number(entry.item.promotionalPrice || entry.item.price || 0);
      const subtotal = inStock ? unitPrice * entry.quantity : 0;

      dueItems.push({
        productKey: entry.productKey,
        productId: String(matched?.id || entry.item.id || ''),
        lookupId: String(matched?.id || entry.item.id || entry.item.internalCode || entry.item.barcode || ''),
        barcode: matched?.barcode || entry.item.barcode,
        internalCode: matched?.internalCode || entry.item.internalCode,
        name: resolvedName,
        cleanName: cleanErpProductName(resolvedName) || resolvedName,
        quantity: entry.quantity,
        lastPurchasedAt: entry.purchasedAt,
        daysSincePurchase: daysSince,
        cycleCategory: cycle.category,
        cycleLabel: cycle.label,
        minDays: cycle.minDays,
        maxDays: cycle.maxDays,
        isSecondary: cycle.isSecondary,
        requiresPrescription: cycle.requiresPrescription,
        isIntimateHygiene: cycle.isIntimateHygiene,
        inStock,
        currentUnitPrice: unitPrice,
        subtotal,
        matchedProduct: matched,
      });
    }

    if (dueItems.length === 0) continue;

    // Ordena itens: em estoque primeiro, depois mais urgentes
    dueItems.sort((a, b) => {
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      return b.daysSincePurchase - a.daysSincePurchase;
    });

    const inStockItems = dueItems.filter((i) => i.inStock);
    const outOfStockItems = dueItems.filter((i) => !i.inStock);
    const recoverableRevenue = inStockItems.reduce((acc, i) => acc + i.subtotal, 0);
    const productSignature = dueItems
      .map((i) => i.productKey)
      .sort()
      .join('|');

    const linkSource = inStockItems.length > 0 ? inStockItems : dueItems;
    const magicLink = buildMagicRepeatUrl(
      tenant,
      linkSource.map((i) => ({ lookupId: i.lookupId, quantity: i.quantity })),
    );

    const cycleCategories = Array.from(new Set(dueItems.map((i) => i.cycleCategory)));
    const daysSinceLastOrder = Math.max(
      0,
      Math.floor((nowMs - bucket.lastOrderMs) / DAY_MS),
    );

    const contactRecord = latestContactByPhone.get(bucket.normalizedPhone);

    candidates.push({
      key: `${bucket.normalizedPhone}`,
      customerName: bucket.customerName,
      firstName: extractFirstName(bucket.customerName),
      customerPhone: bucket.customerPhone,
      normalizedPhone: bucket.normalizedPhone,
      lastOrderId: bucket.lastOrderId,
      lastOrderDate: bucket.lastOrderDate,
      daysSinceLastOrder,
      cycleCategories,
      items: dueItems,
      inStockItems,
      outOfStockItems,
      recoverableRevenue,
      productSignature,
      magicLink,
      contactRecord,
    });
  }

  // Prioriza clientes com itens em estoque e maior receita recuperável
  candidates.sort((a, b) => {
    if ((a.inStockItems.length > 0) !== (b.inStockItems.length > 0)) {
      return a.inStockItems.length > 0 ? -1 : 1;
    }
    if (b.recoverableRevenue !== a.recoverableRevenue) {
      return b.recoverableRevenue - a.recoverableRevenue;
    }
    return b.daysSinceLastOrder - a.daysSinceLastOrder;
  });

  return candidates;
};

// ============================================================================
// PERSISTÊNCIA DE CONTATOS DO RADAR (Supabase + Fallback automático localStorage)
// ============================================================================

const isMissingRepurchaseTableError = (err: any): boolean => {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    msg.includes('repurchase_contacts') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('relation')
  );
};

const readLocalContacts = (tenantId: string): RepurchaseContactRecord[] => {
  if (typeof window === 'undefined' || !tenantId) return [];
  try {
    const raw = window.localStorage.getItem(`${CONTACTS_STORAGE_PREFIX}${tenantId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalContacts = (tenantId: string, records: RepurchaseContactRecord[]): void => {
  if (typeof window === 'undefined' || !tenantId) return;
  try {
    window.localStorage.setItem(
      `${CONTACTS_STORAGE_PREFIX}${tenantId}`,
      JSON.stringify(records),
    );
  } catch {
    // quota ou privacidade
  }
};

export const loadRepurchaseContacts = async (
  tenantId: string,
): Promise<{ records: RepurchaseContactRecord[]; usingFallback: boolean }> => {
  const localRecords = readLocalContacts(tenantId);
  if (!tenantId || !isSupabaseConfigured()) {
    return { records: localRecords, usingFallback: true };
  }

  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * DAY_MS).toISOString();
    const { data, error } = await supabase
      .from('repurchase_contacts')
      .select('id, tenant_id, customer_phone, product_signature, status, last_order_id, contacted_at')
      .eq('tenant_id', tenantId)
      .gte('contacted_at', ninetyDaysAgo)
      .order('contacted_at', { ascending: false })
      .limit(1000);

    if (error) {
      if (isMissingRepurchaseTableError(error)) {
        return { records: localRecords, usingFallback: true };
      }
      return { records: localRecords, usingFallback: true };
    }

    const remoteRecords: RepurchaseContactRecord[] = (data || []).map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      customer_phone: normalizePhoneBR(row.customer_phone),
      product_signature: row.product_signature || '',
      status: row.status === 'ignored' ? 'ignored' : 'contacted',
      last_order_id: row.last_order_id || null,
      contacted_at: row.contacted_at || new Date().toISOString(),
    }));

    writeLocalContacts(tenantId, remoteRecords);
    return { records: remoteRecords, usingFallback: false };
  } catch {
    return { records: localRecords, usingFallback: true };
  }
};

export const saveRepurchaseContact = async (
  record: Omit<RepurchaseContactRecord, 'id' | 'contacted_at'> & { contacted_at?: string },
): Promise<{ saved: RepurchaseContactRecord; usingFallback: boolean }> => {
  const normalizedPhone = normalizePhoneBR(record.customer_phone);
  const finalRecord: RepurchaseContactRecord = {
    tenant_id: record.tenant_id,
    customer_phone: normalizedPhone,
    product_signature: record.product_signature || '',
    status: record.status,
    last_order_id: record.last_order_id || null,
    contacted_at: record.contacted_at || new Date().toISOString(),
  };

  // Atualiza cache local imediatamente (garante 0% perda mesmo offline ou sem tabela)
  const local = readLocalContacts(record.tenant_id).filter(
    (r) => normalizePhoneBR(r.customer_phone) !== normalizedPhone,
  );
  local.unshift(finalRecord);
  writeLocalContacts(record.tenant_id, local);

  if (!record.tenant_id || !isSupabaseConfigured()) {
    return { saved: finalRecord, usingFallback: true };
  }

  try {
    const { data, error } = await supabase
      .from('repurchase_contacts')
      .upsert(finalRecord, { onConflict: 'tenant_id,customer_phone' })
      .select()
      .maybeSingle();

    if (error) {
      // Se não houver unique constraint ainda, tenta insert simples antes do fallback
      if (!isMissingRepurchaseTableError(error)) {
        const { error: insertErr } = await supabase
          .from('repurchase_contacts')
          .insert(finalRecord);
        if (!insertErr) {
          return { saved: finalRecord, usingFallback: false };
        }
      }
      return { saved: finalRecord, usingFallback: true };
    }

    return {
      saved: (data as RepurchaseContactRecord) || finalRecord,
      usingFallback: false,
    };
  } catch {
    return { saved: finalRecord, usingFallback: true };
  }
};

export const removeRepurchaseContact = async (
  tenantId: string,
  customerPhone: string,
): Promise<void> => {
  const normalizedPhone = normalizePhoneBR(customerPhone);
  const local = readLocalContacts(tenantId).filter(
    (r) => normalizePhoneBR(r.customer_phone) !== normalizedPhone,
  );
  writeLocalContacts(tenantId, local);

  if (!tenantId || !isSupabaseConfigured()) return;

  try {
    await supabase
      .from('repurchase_contacts')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('customer_phone', normalizedPhone);
  } catch {
    // fallback silencioso
  }
};

export const loadRepurchaseTemplate = (tenantId: string): string => {
  if (typeof window === 'undefined' || !tenantId) return DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE;
  try {
    return (
      window.localStorage.getItem(`${TEMPLATE_STORAGE_PREFIX}${tenantId}`) ||
      DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE
    );
  } catch {
    return DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE;
  }
};

export const saveRepurchaseTemplate = (tenantId: string, template: string): void => {
  if (typeof window === 'undefined' || !tenantId) return;
  try {
    window.localStorage.setItem(`${TEMPLATE_STORAGE_PREFIX}${tenantId}`, template);
  } catch {
    // ignore
  }
};
