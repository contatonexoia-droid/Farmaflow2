import { Order, PharmacyConfig, Product, PromotionRule, calculateItemTotal, isValidStoreProduct } from '../types';
import { getStoreUrl } from './store';
import { supabase } from '../services/supabase';
import { isSupabaseConfigured } from '../services/storage';

export type RepurchaseCycleCategory =
  | 'bebe_fraldas'
  | 'uso_continuo_60'
  | 'uso_continuo_30'
  | 'geral';

export type RepurchaseFilterKey =
  | 'all'
  | 'uso_continuo'
  | 'bebe_fraldas'
  | 'geral';

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
  quantity: number;
  lastPurchasedAt: string;
  daysSincePurchase: number;
  cycleCategory: RepurchaseCycleCategory;
  cycleLabel: string;
  minDays: number;
  maxDays: number;
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

export const classifyProductCycle = (
  name?: string | null,
  category?: string | null,
  description?: string | null,
): {
  category: RepurchaseCycleCategory;
  label: string;
  minDays: number;
  maxDays: number;
} => {
  const haystack = `${normalizeTextUpper(name)} ${normalizeTextUpper(category)} ${normalizeTextUpper(description)}`;

  // 1. Fraldas, leites infantis e higiene recorrente (12 a 25 dias)
  const babyKeywords = ['FRALDA', 'LEITE', 'NAN', 'APTAMIL', 'NESTOGENO', 'LENCO'];
  const matchesBaby = babyKeywords.some((kw) => {
    if (kw === 'NAN') {
      return /\bNAN\b/.test(haystack) || haystack.includes('NAN ');
    }
    return haystack.includes(kw);
  });
  if (matchesBaby) {
    return {
      category: 'bebe_fraldas',
      label: 'Bebê & Fraldas (12-25d)',
      minDays: 12,
      maxDays: 25,
    };
  }

  // 2. Caixas de 60 unidades (50 a 70 dias)
  if (/\b60\s*(COMP|COMPRIM|CAPS|CP)\b/.test(haystack) || /C\/?\s*60\b/.test(haystack)) {
    return {
      category: 'uso_continuo_60',
      label: 'Uso Contínuo 60un (50-70d)',
      minDays: 50,
      maxDays: 70,
    };
  }

  // 3. Uso contínuo e caixas de 28/30 unidades (22 a 40 dias)
  const continuousKeywords = [
    'LOSARTANA',
    'METFORMINA',
    'GLIFAGE',
    'ATENOLOL',
    'SINVASTATINA',
    'OMEPRAZOL',
    'ANTICONCEPCIONAL',
    'INSULINA',
    'PRESSAO',
  ];
  const has28or30 =
    /\b(28|30)\s*(COMP|COMPRIM|CAPS|CP)\b/.test(haystack) || /C\/?\s*(28|30)\b/.test(haystack);
  const matchesContinuous =
    has28or30 || continuousKeywords.some((kw) => haystack.includes(kw));

  if (matchesContinuous) {
    return {
      category: 'uso_continuo_30',
      label: 'Uso Contínuo (22-40d)',
      minDays: 22,
      maxDays: 40,
    };
  }

  // 4. Demais itens recorrentes (25 a 45 dias)
  return {
    category: 'geral',
    label: 'Recorrente Geral (25-45d)',
    minDays: 25,
    maxDays: 45,
  };
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
): string => {
  const targetItems =
    candidate.inStockItems.length > 0 ? candidate.inStockItems : candidate.items;
  const productSummary = targetItems
    .slice(0, 3)
    .map((item) => (item.quantity > 1 ? `${item.quantity}x ${item.name}` : item.name))
    .join(', ');
  const extraCount = targetItems.length > 3 ? ` e mais ${targetItems.length - 3}` : '';
  const productsText = `${productSummary}${extraCount}`;

  return (template || DEFAULT_REPURCHASE_WHATSAPP_TEMPLATE)
    .replace(/\{nome\}/gi, candidate.firstName)
    .replace(/\{produtos\}/gi, productsText)
    .replace(/\{farmacia\}/gi, storeName || 'nossa drogaria')
    .replace(/\{link\}/gi, candidate.magicLink);
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
}): RepurchaseCandidate[] => {
  const { orders, products, tenant, promotions = [], contacts = [], now = new Date() } = params;
  const nowMs = now.getTime();
  const ninetyDaysAgoMs = nowMs - 90 * DAY_MS;

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

  // 1. Filtra pedidos válidos dos últimos 90 dias
  const validOrders = (orders || []).filter((o) => {
    if (!o || !o.date || !Array.isArray(o.items) || o.items.length === 0) return false;
    const st = String(o.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'cancelado' || st === 'rejected' || st === 'rejeitado') {
      return false;
    }
    const ts = new Date(o.date).getTime();
    if (Number.isNaN(ts) || ts < ninetyDaysAgoMs || ts > nowMs + DAY_MS) return false;
    const phone = normalizePhoneBR(o.customer?.phone);
    return phone.length >= 10;
  });

  // 2. Agrupa por telefone normalizado e rastreia a ÚLTIMA compra de cada produto
  // (Se o cliente já recomprou o mesmo produto mais recentemente, o timestamp mais novo
  // prevalece e fica abaixo do minDays — ocultando automaticamente quem já recomprou!)
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

    for (const item of order.items) {
      if (!item || !item.name) continue;
      const pKey = buildCanonicalProductKey(item);
      const existing = bucket.productMap.get(pKey);
      if (!existing || orderMs > existing.purchasedMs) {
        bucket.productMap.set(pKey, {
          productKey: pKey,
          item,
          orderId: order.id,
          purchasedMs: orderMs,
          purchasedAt: order.date,
          quantity: Math.max(1, Number(item.quantity) || 1),
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
      const cycle = classifyProductCycle(
        matched?.name || entry.item.name,
        matched?.category || entry.item.category,
        matched?.description || entry.item.description,
      );

      // Só entra no radar se estiver na janela ideal de reposição do seu ciclo
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
        name: matched?.name || entry.item.name,
        quantity: entry.quantity,
        lastPurchasedAt: entry.purchasedAt,
        daysSincePurchase: daysSince,
        cycleCategory: cycle.category,
        cycleLabel: cycle.label,
        minDays: cycle.minDays,
        maxDays: cycle.maxDays,
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
