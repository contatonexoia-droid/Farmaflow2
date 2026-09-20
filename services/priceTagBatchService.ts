import { supabase, isSupabaseConfigured } from './supabase';
import { PriceTagItem, TagLayoutKey } from '../components/AdminPriceTags';

export interface PriceTagBatchItemSnapshot {
  id: string;
  productId: string;
  productName: string;
  barcode?: string;
  internalCode?: string;
  category?: string;
  presentation?: string;
  activePrinciple?: string;
  badgeText: string;
  originalPrice: number | string;
  promotionalPrice: number | string;
  showOriginalPrice: boolean;
  unitMeasurementText?: string;
  customObservations?: string;
  expiryDate?: string;
  customStoreName?: string;
  quantity: number;
}

export interface PriceTagBatch {
  id: string;
  store_id: string;
  model: TagLayoutKey;
  total_tags: number;
  items: PriceTagBatchItemSnapshot[];
  created_at: string;
}

const LOCAL_STORAGE_KEY_PREFIX = 'farmaflow_price_tag_batches_';

// Função utilitária para obter chave de cache por loja
const getCacheKey = (storeId: string): string => {
  return `${LOCAL_STORAGE_KEY_PREFIX}${storeId || 'default'}`;
};

// Limpa itens mais velhos que 48 horas do cache local
export const filterLast48Hours = (batches: PriceTagBatch[]): PriceTagBatch[] => {
  const threshold = Date.now() - 48 * 60 * 60 * 1000;
  return batches.filter((b) => {
    const time = new Date(b.created_at).getTime();
    return !isNaN(time) && time >= threshold;
  });
};

// Lê do LocalStorage com tolerância a falhas
const getLocalBatches = (storeId: string): PriceTagBatch[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(getCacheKey(storeId));
    if (!raw) return [];
    const parsed: PriceTagBatch[] = JSON.parse(raw);
    return filterLast48Hours(parsed);
  } catch (err) {
    console.warn('[priceTagBatchService] Erro ao ler cache local de lotes:', err);
    return [];
  }
};

// Grava no LocalStorage
const setLocalBatches = (storeId: string, batches: PriceTagBatch[]) => {
  if (typeof window === 'undefined') return;
  try {
    const clean = filterLast48Hours(batches);
    localStorage.setItem(getCacheKey(storeId), JSON.stringify(clean));
  } catch (err) {
    console.warn('[priceTagBatchService] Erro ao salvar cache local de lotes:', err);
  }
};

/**
 * Converte a lista PriceTagItem em snapshots enxutos e serializáveis
 */
export const serializeTagItemsToSnapshot = (items: PriceTagItem[]): PriceTagBatchItemSnapshot[] => {
  return items.map((item) => ({
    id: item.id,
    productId: item.product?.id || item.id,
    productName: item.product?.name || 'Produto sem nome',
    barcode: item.product?.barcode || '',
    internalCode: item.product?.internalCode || '',
    category: item.product?.category || '',
    presentation: item.product?.presentation || '',
    activePrinciple: item.product?.activePrinciple || '',
    badgeText: item.badgeText || '',
    originalPrice: item.originalPrice ?? 0,
    promotionalPrice: item.promotionalPrice ?? 0,
    showOriginalPrice: item.showOriginalPrice ?? true,
    unitMeasurementText: item.unitMeasurementText || '',
    customObservations: item.customObservations || '',
    expiryDate: item.expiryDate || '',
    customStoreName: item.customStoreName || '',
    quantity: Math.max(1, Number(item.quantity) || 1),
  }));
};

/**
 * Reconstrói a lista PriceTagItem a partir do snapshot salvo
 */
export const deserializeSnapshotToTagItems = (
  snapshots: PriceTagBatchItemSnapshot[],
  catalogProducts?: { id: string; [key: string]: any }[]
): PriceTagItem[] => {
  const catalogMap = new Map<string, any>();
  if (catalogProducts) {
    catalogProducts.forEach((p) => catalogMap.set(p.id, p));
  }

  return snapshots.map((s) => {
    const existing = catalogMap.get(s.productId);
    const product = existing || {
      id: s.productId,
      name: s.productName,
      barcode: s.barcode,
      internalCode: s.internalCode,
      category: s.category || 'Geral',
      presentation: s.presentation,
      activePrinciple: s.activePrinciple,
      price: typeof s.originalPrice === 'number' ? s.originalPrice : parseFloat(String(s.originalPrice)) || 0,
      promotionalPrice: typeof s.promotionalPrice === 'number' ? s.promotionalPrice : parseFloat(String(s.promotionalPrice)) || 0,
      stock: 0,
      tenantId: 'default',
    };

    return {
      id: s.id || s.productId,
      product,
      quantity: Math.max(1, Number(s.quantity) || 1),
      badgeText: s.badgeText || '',
      originalPrice: s.originalPrice,
      promotionalPrice: s.promotionalPrice,
      showOriginalPrice: s.showOriginalPrice ?? true,
      unitMeasurementText: s.unitMeasurementText || '',
      customObservations: s.customObservations || '',
      expiryDate: s.expiryDate || '',
      customStoreName: s.customStoreName || '',
    };
  });
};

/**
 * Salva um novo lote no Supabase e no cache local
 * Executa em background para não bloquear o fluxo de impressão
 */
export const savePriceTagBatch = async (
  storeId: string,
  model: TagLayoutKey,
  tagItems: PriceTagItem[]
): Promise<PriceTagBatch | null> => {
  if (!tagItems || tagItems.length === 0) return null;

  const totalTags = tagItems.reduce((acc, curr) => acc + (Number(curr.quantity) || 1), 0);
  const itemsSnapshot = serializeTagItemsToSnapshot(tagItems);
  const now = new Date().toISOString();

  const newBatch: PriceTagBatch = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `batch_${Date.now()}`,
    store_id: storeId || 'default',
    model,
    total_tags: totalTags,
    items: itemsSnapshot,
    created_at: now,
  };

  // 1. Atualiza imediatamente o cache local (garantia de disponibilidade instantânea)
  const currentLocal = getLocalBatches(storeId);
  setLocalBatches(storeId, [newBatch, ...currentLocal]);

  // 2. Persistência no Supabase em segundo plano
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('price_tag_batches')
        .insert({
          id: newBatch.id,
          store_id: newBatch.store_id,
          model: newBatch.model,
          total_tags: newBatch.total_tags,
          items: newBatch.items,
          created_at: newBatch.created_at,
        })
        .select('*')
        .single();

      if (error) {
        console.warn('[priceTagBatchService] Falha ao persistir no Supabase (mantido no cache local):', error.message);
      } else if (data) {
        return data as PriceTagBatch;
      }
    } catch (err) {
      console.warn('[priceTagBatchService] Erro de rede/requisição com Supabase:', err);
    }
  }

  return newBatch;
};

/**
 * Recupera os lotes das últimas 48 horas da loja
 */
export const fetchRecentPriceTagBatches = async (storeId: string): Promise<PriceTagBatch[]> => {
  const localBatches = getLocalBatches(storeId);
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  if (!isSupabaseConfigured()) {
    return localBatches;
  }

  try {
    const { data, error } = await supabase
      .from('price_tag_batches')
      .select('*')
      .eq('store_id', storeId || 'default')
      .gte('created_at', fortyEightHoursAgo)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('[priceTagBatchService] Erro ao consultar Supabase, usando cache local:', error.message);
      return localBatches;
    }

    if (data && Array.isArray(data)) {
      // Mescla com dados locais caso haja algum lote salvo offline
      const map = new Map<string, PriceTagBatch>();
      (data as PriceTagBatch[]).forEach((b) => map.set(b.id, b));
      localBatches.forEach((b) => {
        if (!map.has(b.id)) map.set(b.id, b);
      });

      const merged = filterLast48Hours(Array.from(map.values())).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // Atualiza cache local sincronizado
      setLocalBatches(storeId, merged);
      return merged;
    }
  } catch (err) {
    console.warn('[priceTagBatchService] Exceção ao consultar lotes recentes:', err);
  }

  return localBatches;
};

/**
 * Exclui um lote por ID (manual pelo operador)
 */
export const deletePriceTagBatch = async (id: string, storeId: string): Promise<boolean> => {
  // 1. Remove do cache local
  const currentLocal = getLocalBatches(storeId);
  const updated = currentLocal.filter((b) => b.id !== id);
  setLocalBatches(storeId, updated);

  // 2. Remove do Supabase
  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase
        .from('price_tag_batches')
        .delete()
        .eq('id', id);

      if (error) {
        console.warn('[priceTagBatchService] Erro ao deletar no Supabase:', error.message);
        return false;
      }
    } catch (err) {
      console.warn('[priceTagBatchService] Exceção ao deletar lote no Supabase:', err);
      return false;
    }
  }

  return true;
};

/**
 * Formata o tempo restante antes da expiração de 48 horas
 */
export const formatTimeRemaining = (createdAt: string): { text: string; isUrgent: boolean } => {
  const createdTime = new Date(createdAt).getTime();
  if (isNaN(createdTime)) {
    return { text: 'Expira em 48h', isUrgent: false };
  }

  const ttlMs = 48 * 60 * 60 * 1000;
  const elapsed = Date.now() - createdTime;
  const remainingMs = ttlMs - elapsed;

  if (remainingMs <= 0) {
    return { text: 'Expirado', isUrgent: true };
  }

  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) {
    return {
      text: `Expira em ${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`,
      isUrgent: hours <= 6,
    };
  }

  return {
    text: `Expira em ${minutes}m`,
    isUrgent: true,
  };
};

/**
 * Formata data e hora legível (Hoje às 14:30 / Ontem às 09:15 / 19/09 às 14:30)
 */
export const formatBatchDateTime = (createdAt: string): string => {
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `Hoje às ${timeStr}`;
  }
  if (isYesterday) {
    return `Ontem às ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${dateStr} às ${timeStr}`;
};

/**
 * Tradução amigável do modelo
 */
export const getModelBadgeInfo = (model: TagLayoutKey) => {
  switch (model) {
    case 'gondola':
      return { label: 'Gôndola (3x10)', capacity: '30 por folha', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'baiana':
      return { label: 'Baiana (2x4)', capacity: '8 por folha', colorClass: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'cartaz_a5':
      return { label: 'Cartaz A5 (1x2)', capacity: '2 por folha', colorClass: 'bg-purple-50 text-purple-700 border-purple-200' };
    case 'cartaz_a4':
      return { label: 'Cartaz A4 (1x1)', capacity: '1 por folha', colorClass: 'bg-blue-50 text-blue-700 border-blue-200' };
    default:
      return { label: 'Gôndola', capacity: '30 por folha', colorClass: 'bg-gray-50 text-gray-700 border-gray-200' };
  }
};
