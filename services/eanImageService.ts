/**
 * FARMAFLOW - Serviço de Busca e Enriquecimento de Fotos por EAN
 * 
 * Busca fotos de produtos farmacêuticos e cosméticos via Código de Barras (EAN)
 * em cascata (Redes de Farmácias BR / VTEX, CDN Cosmos, OpenBeautyFacts, OpenFoodFacts, Cosmos API)
 * e persiste definitivamente no Supabase Storage (bucket products/ean/{ean}.jpg).
 * 
 * Reaproveitamento global: uma foto salva por EAN serve para qualquer drogaria do sistema.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type EanImageSource = 
  | 'supabase_cache' 
  | 'drogariasaopaulo' 
  | 'pacheco' 
  | 'paguemenos' 
  | 'araujo'
  | 'venancio'
  | 'nissei'
  | 'cosmos_cdn' 
  | 'openbeautyfacts' 
  | 'openfoodfacts' 
  | 'cosmos_api' 
  | null;

export interface EanImageResult {
  success: boolean;
  ean: string;
  url?: string;
  source?: EanImageSource;
  error?: string;
  productId?: string;
}

export interface BatchSyncOptions {
  tenantId?: string;
  productIds?: string[];
  limit?: number;
  concurrency?: number;
}

export interface BatchSyncSummary {
  total: number;
  processed: number;
  updated: number;
  failed: number;
  cached: number;
  results: EanImageResult[];
}

/**
 * Valida e limpa o código EAN (apenas dígitos numéricos entre 8 e 14 caracteres).
 */
export function validateAndCleanEan(ean: string | null | undefined): { isValid: boolean; cleanEan: string } {
  if (!ean) return { isValid: false, cleanEan: '' };
  const cleanEan = String(ean).trim().replace(/\D/g, '');
  const isValid = cleanEan.length >= 8 && cleanEan.length <= 14;
  return { isValid, cleanEan };
}

let resolvedBucketName: string | null = null;

/**
 * Garante que o bucket do Supabase Storage esteja acessível e público.
 * Tenta 'products' e faz fallback para 'product-images' se necessário.
 */
export async function getOrEnsureStorageBucket(supabaseAdmin: SupabaseClient): Promise<string> {
  if (resolvedBucketName) return resolvedBucketName;

  const targetBucket = 'products';
  try {
    const { data: bucket, error: getErr } = await supabaseAdmin.storage.getBucket(targetBucket);
    if (!getErr && bucket) {
      resolvedBucketName = targetBucket;
      return targetBucket;
    }

    // Tenta criar o bucket 'products' como público
    const { error: createErr } = await supabaseAdmin.storage.createBucket(targetBucket, {
      public: true,
      fileSizeLimit: 10485760 // 10MB
    });

    if (!createErr) {
      console.log(`[EanImageService] Bucket '${targetBucket}' criado com sucesso no Supabase Storage.`);
      resolvedBucketName = targetBucket;
      return targetBucket;
    }

    // Se falhar a criação (ex: sem permissão ou já existe com outro nome), verifica buckets existentes
    const { data: listBuckets } = await supabaseAdmin.storage.listBuckets();
    if (listBuckets && listBuckets.length > 0) {
      const match = listBuckets.find(b => b.name === 'products' || b.name === 'product-images');
      if (match) {
        resolvedBucketName = match.name;
        return match.name;
      }
      resolvedBucketName = listBuckets[0].name;
      return resolvedBucketName;
    }
  } catch (err) {
    console.warn(`[EanImageService] Falha ao verificar bucket '${targetBucket}', usando fallback 'product-images':`, err);
  }

  resolvedBucketName = 'product-images';
  return resolvedBucketName;
}

/**
 * Verifica se a foto já existe no Supabase Storage para reaproveitamento global instantâneo.
 */
export async function checkExistingSupabaseImage(
  supabaseAdmin: SupabaseClient,
  bucketName: string,
  cleanEan: string
): Promise<string | null> {
  const filePath = `ean/${cleanEan}.jpg`;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucketName)
      .list('ean', { limit: 1, search: `${cleanEan}.jpg` });

    if (!error && data && data.length > 0) {
      const found = data.find(f => f.name === `${cleanEan}.jpg` && (!f.metadata || (f.metadata.size || 0) > 1000));
      if (found) {
        const { data: publicData } = supabaseAdmin.storage
          .from(bucketName)
          .getPublicUrl(filePath);
        return publicData.publicUrl;
      }
    }
  } catch (err) {
    console.debug(`[EanImageService] Verificação rápida no cache do storage falhou para ${cleanEan}:`, err);
  }

  return null;
}

/**
 * Rejeita URLs de imagem que são placeholders regulatórios genéricos (faixas de tarja ou ícones 'sem foto')
 */
function isPlaceholderImageUrl(url: string): boolean {
  if (!url) return true;
  const l = url.toLowerCase();
  return (
    l.includes('tarja-vermelha') ||
    l.includes('tarja_vermelha') ||
    l.includes('tarja%20vermelha') ||
    l.includes('tarja vermelha') ||
    l.includes('tarja-preta') ||
    l.includes('tarja_preta') ||
    l.includes('tarja%20preta') ||
    l.includes('tarja preta') ||
    l.includes('generico-tarja') ||
    l.includes('genericos-tarja') ||
    l.includes('generico_tarja') ||
    l.includes('no-image') ||
    l.includes('no_image') ||
    l.includes('default') ||
    l.includes('placeholder') ||
    l.includes('sem-foto') ||
    l.includes('sem_foto')
  );
}

/**
 * Faz download de um buffer de imagem com headers de navegador e validação rigorosa.
 */
async function downloadImageBuffer(url: string, customHeaders: Record<string, string> = {}): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    if (isPlaceholderImageUrl(url)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        ...customHeaders
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const finalUrl = response.url.toLowerCase();
    if (isPlaceholderImageUrl(finalUrl)) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Ignora buffers menores que 3KB (geralmente 1x1 transparente ou ícone de erro)
    if (buffer.length < 3072) {
      return null;
    }

    // Rejeita se o buffer for HTML ou texto de erro
    const headText = buffer.slice(0, 100).toString('utf-8').toLowerCase().trim();
    if (headText.startsWith('<!doctype') || headText.startsWith('<html') || headText.startsWith('<?xml') || headText.startsWith('{')) {
      return null;
    }

    // Detecta tipo real pelos magic bytes da imagem
    let detectedType = 'image/jpeg';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      detectedType = 'image/jpeg';
    } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      detectedType = 'image/png';
    } else if (buffer.length > 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
      detectedType = 'image/webp';
    } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      detectedType = 'image/gif';
    } else {
      const headerType = response.headers.get('content-type');
      if (headerType && headerType.toLowerCase().includes('image/')) {
        detectedType = headerType.split(';')[0].trim();
      } else {
        return null; // Não é uma imagem reconhecida
      }
    }

    return { buffer, contentType: detectedType };
  } catch (err) {
    return null;
  }
}

/**
 * Consulta catálogos farmacêuticos brasileiros oficiais via VTEX.
 * Executa em paralelo nas maiores redes do Brasil: Drogaria São Paulo, Pacheco, Pague Menos, Araujo, Venancio e Nissei.
 */
async function searchPharmacyNetworks(cleanEan: string): Promise<{ url: string; source: EanImageSource } | null> {
  const providers: Array<{ source: EanImageSource; url: string }> = [
    {
      source: 'drogariasaopaulo',
      url: `https://www.drogariasaopaulo.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`
    },
    {
      source: 'pacheco',
      url: `https://www.drogariaspacheco.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`
    },
    {
      source: 'paguemenos',
      url: `https://www.paguemenos.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`
    },
    {
      source: 'araujo',
      url: `https://www.drogariaaraujo.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`
    },
    {
      source: 'venancio',
      url: `https://www.drogariasvenancio.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`
    },
    {
      source: 'nissei',
      url: `https://www.farmaciasnissei.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`
    }
  ];

  try {
    const promises = providers.map(async (p) => {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(p.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        clearTimeout(to);

        if (res.ok) {
          const data = await res.json();
          const imageUrl = data?.[0]?.items?.[0]?.images?.[0]?.imageUrl;
          if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http') && !isPlaceholderImageUrl(imageUrl)) {
            return { url: imageUrl, source: p.source };
          }
        }
      } catch (_) {}
      return null;
    });

    const results = await Promise.all(promises);
    const valid = results.find(r => r !== null);
    return valid || null;
  } catch (_) {
    return null;
  }
}

/**
 * Busca a imagem de um produto pelo código EAN em cascata (Waterfall):
 * 1. Cache Supabase Storage (reaproveitamento global instantâneo)
 * 2. Redes Farmacêuticas Brasileiras em Paralelo (Drogaria SP, Pacheco, Pague Menos, Araujo, Venancio, Nissei)
 * 3. CDN Cosmos Bluesoft
 * 4. OpenBeautyFacts (Cosméticos, dermocosméticos, higiene e perfumaria)
 * 5. OpenFoodFacts (Suplementos, vitaminas, nutrição)
 * 6. API Cosmos oficial (se token configurado)
 * Persiste no Supabase Storage e atualiza o banco se productId for fornecido.
 */
export async function fetchAndStoreProductImageByEan(
  supabaseAdmin: SupabaseClient,
  ean: string,
  productName?: string,
  tenantId?: string,
  productId?: string
): Promise<EanImageResult> {
  const { isValid, cleanEan } = validateAndCleanEan(ean);
  if (!isValid) {
    return {
      success: false,
      ean: ean || '',
      error: 'EAN inválido. O código de barras deve conter entre 8 e 14 dígitos numéricos.',
      productId
    };
  }

  const bucketName = await getOrEnsureStorageBucket(supabaseAdmin);
  const storagePath = `ean/${cleanEan}.jpg`;

  // 1. REAPROVEITAMENTO GLOBAL: Verifica se já existe salvo no Supabase Storage
  const cachedUrl = await checkExistingSupabaseImage(supabaseAdmin, bucketName, cleanEan);
  if (cachedUrl) {
    if (productId) {
      await updateProductImageInDb(supabaseAdmin, productId, cachedUrl, tenantId);
    }
    return {
      success: true,
      ean: cleanEan,
      url: cachedUrl,
      source: 'supabase_cache',
      productId
    };
  }

  let foundBuffer: Buffer | null = null;
  let foundContentType = 'image/jpeg';
  let sourceFound: EanImageSource = null;

  // 2. FONTE 1: Redes Farmacêuticas Brasileiras (DPSP, Pacheco, Pague Menos, Araujo, Venancio, Nissei)
  try {
    const pharmacyCandidate = await searchPharmacyNetworks(cleanEan);
    if (pharmacyCandidate) {
      const dl = await downloadImageBuffer(pharmacyCandidate.url);
      if (dl && dl.buffer.length >= 3072) {
        foundBuffer = dl.buffer;
        foundContentType = dl.contentType;
        sourceFound = pharmacyCandidate.source;
      }
    }
  } catch (err) {
    console.debug(`[EanImageService] Busca em redes de farmácia falhou para ${cleanEan}:`, err);
  }

  // 3. FONTE 2: CDN Cosmos (Bluesoft)
  if (!foundBuffer) {
    try {
      const cosmosCdnUrl = `https://cdn-cosmos.bluesoft.com.br/products/${cleanEan}`;
      const result = await downloadImageBuffer(cosmosCdnUrl, {
        'Referer': 'https://cosmos.bluesoft.com.br/'
      });

      if (result && result.buffer.length >= 3072) {
        foundBuffer = result.buffer;
        foundContentType = result.contentType;
        sourceFound = 'cosmos_cdn';
      }
    } catch (err) {
      console.debug(`[EanImageService] CDN Cosmos falhou para ${cleanEan}:`, err);
    }
  }

  // 4. FONTE 3: OpenBeautyFacts (Cosméticos, dermocosméticos, higiene e perfumaria)
  if (!foundBuffer) {
    try {
      const obfController = new AbortController();
      const obfTimeout = setTimeout(() => obfController.abort(), 4000);
      const obfRes = await fetch(`https://world.openbeautyfacts.org/api/v2/product/${cleanEan}.json`, {
        signal: obfController.signal,
        headers: { 'User-Agent': 'FarmaFlow/1.0 (contato@farmaflow.online)' }
      });
      clearTimeout(obfTimeout);

      if (obfRes.ok) {
        const obfData = await obfRes.json();
        const candUrl =
          obfData?.product?.image_front_url ||
          obfData?.product?.image_url ||
          obfData?.product?.selected_images?.front?.display?.pt ||
          obfData?.product?.selected_images?.front?.display?.en;

        if (candUrl && typeof candUrl === 'string' && candUrl.startsWith('http')) {
          const dl = await downloadImageBuffer(candUrl);
          if (dl && dl.buffer.length >= 3072) {
            foundBuffer = dl.buffer;
            foundContentType = dl.contentType;
            sourceFound = 'openbeautyfacts';
          }
        }
      }
    } catch (_) {}
  }

  // 5. FONTE 4: OpenFoodFacts (Suplementos, vitaminas, nutrição e alimentos infantis)
  if (!foundBuffer) {
    try {
      const offController = new AbortController();
      const offTimeout = setTimeout(() => offController.abort(), 4000);
      const offRes = await fetch(`https://br.openfoodfacts.org/api/v2/product/${cleanEan}.json`, {
        signal: offController.signal,
        headers: { 'User-Agent': 'FarmaFlow/1.0 (contato@farmaflow.online)' }
      });
      clearTimeout(offTimeout);

      if (offRes.ok) {
        const offData = await offRes.json();
        const candUrl =
          offData?.product?.image_front_url ||
          offData?.product?.image_url ||
          offData?.product?.selected_images?.front?.display?.pt ||
          offData?.product?.selected_images?.front?.display?.en;

        if (candUrl && typeof candUrl === 'string' && candUrl.startsWith('http')) {
          const dl = await downloadImageBuffer(candUrl);
          if (dl && dl.buffer.length >= 3072) {
            foundBuffer = dl.buffer;
            foundContentType = dl.contentType;
            sourceFound = 'openfoodfacts';
          }
        }
      }
    } catch (_) {}
  }

  // 6. FONTE 5: API Cosmos Oficial (caso COSMOS_API_TOKEN esteja configurado no ambiente)
  const cosmosToken = process.env.COSMOS_API_TOKEN;
  if (!foundBuffer && cosmosToken) {
    try {
      const cosmosController = new AbortController();
      const cosmosTimeout = setTimeout(() => cosmosController.abort(), 4000);
      const cosmosRes = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${cleanEan}`, {
        signal: cosmosController.signal,
        headers: {
          'X-Cosmos-Token': cosmosToken,
          'User-Agent': 'Cosmos-API-Request'
        }
      });
      clearTimeout(cosmosTimeout);

      if (cosmosRes.ok) {
        const cosmosJson = await cosmosRes.json();
        const candUrl = cosmosJson?.thumbnail || cosmosJson?.image;
        if (candUrl && typeof candUrl === 'string' && candUrl.startsWith('http')) {
          const dl = await downloadImageBuffer(candUrl);
          if (dl && dl.buffer.length >= 3072) {
            foundBuffer = dl.buffer;
            foundContentType = dl.contentType;
            sourceFound = 'cosmos_api';
          }
        }
      }
    } catch (err) {
      console.debug(`[EanImageService] API Oficial Cosmos falhou para ${cleanEan}:`, err);
    }
  }

  if (!foundBuffer) {
    return {
      success: false,
      ean: cleanEan,
      error: 'Foto não encontrada nas bases públicas de código de barras para este EAN.',
      productId
    };
  }

  // 7. PERSISTÊNCIA NO SUPABASE STORAGE (Bucket products/ean/{cleanEan}.jpg)
  try {
    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucketName)
      .upload(storagePath, foundBuffer, {
        contentType: foundContentType || 'image/jpeg',
        upsert: true
      });

    if (uploadError) {
      console.error(`[EanImageService] Erro ao fazer upload no Supabase Storage (${bucketName}/${storagePath}):`, uploadError);
      return {
        success: false,
        ean: cleanEan,
        error: `Erro ao salvar no Supabase Storage: ${uploadError.message}`,
        productId
      };
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData.publicUrl;

    // Atualiza a coluna de imagem do produto no banco de dados se o ID foi passado
    if (productId) {
      await updateProductImageInDb(supabaseAdmin, productId, publicUrl, tenantId);
    }

    return {
      success: true,
      ean: cleanEan,
      url: publicUrl,
      source: sourceFound,
      productId
    };
  } catch (err: any) {
    return {
      success: false,
      ean: cleanEan,
      error: `Exceção ao persistir no storage: ${err?.message || err}`,
      productId
    };
  }
}

/**
 * Atualiza o registro do produto no Supabase com a URL definitiva.
 */
async function updateProductImageInDb(
  supabaseAdmin: SupabaseClient,
  productId: string,
  imageUrl: string,
  tenantId?: string
) {
  try {
    let query = supabaseAdmin
      .from('products')
      .update({
        image: imageUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', productId);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { error } = await query;
    if (error) {
      console.warn(`[EanImageService] Aviso ao atualizar coluna image do produto ${productId}:`, error.message);
    }
  } catch (err) {
    console.warn(`[EanImageService] Exceção ao atualizar produto ${productId}:`, err);
  }
}

/**
 * Processamento em lote para enriquecimento de fotos de produtos sem imagem.
 */
export async function syncEanImagesBatch(
  supabaseAdmin: SupabaseClient,
  options: BatchSyncOptions
): Promise<BatchSyncSummary> {
  const { tenantId, productIds, limit = 50, concurrency = 4 } = options;

  let query = supabaseAdmin
    .from('products')
    .select('id, name, barcode, image, tenant_id')
    .not('barcode', 'is', null)
    .neq('barcode', '');

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  if (productIds && productIds.length > 0) {
    // Limita IDs na cláusula .in() para evitar overflow de cabeçalho HTTP PostgREST
    const safeIds = productIds.slice(0, Math.min(limit, 100));
    query = query.in('id', safeIds);
  } else {
    // Sincroniza APENAS produtos sem foto cadastrada
    query = query.or('image.is.null,image.eq.,image.ilike.%placeholder%,image.ilike.%sem-foto%,image.ilike.%no-image%');
  }

  query = query.limit(Math.min(limit, 100));

  const { data: productsToProcess, error } = await query;

  if (error || !productsToProcess || productsToProcess.length === 0) {
    if (error) {
      console.error('[EanImageService] Erro ao buscar produtos para lote:', error);
    }
    return {
      total: 0,
      processed: 0,
      updated: 0,
      failed: 0,
      cached: 0,
      results: []
    };
  }

  const results: EanImageResult[] = [];
  let updated = 0;
  let cached = 0;
  let failed = 0;

  // Processa com concorrência controlada para respeitar limites de requisição
  for (let i = 0; i < productsToProcess.length; i += concurrency) {
    const chunk = productsToProcess.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (prod) => {
      const res = await fetchAndStoreProductImageByEan(
        supabaseAdmin,
        prod.barcode,
        prod.name,
        prod.tenant_id,
        prod.id
      );

      if (res.success) {
        if (res.source === 'supabase_cache') {
          cached++;
        }
        updated++;
      } else {
        failed++;
      }

      return res;
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);

    // Pausa de 100ms entre lotes de concorrência para amortecer requisições
    if (i + concurrency < productsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return {
    total: productsToProcess.length,
    processed: results.length,
    updated,
    failed,
    cached,
    results
  };
}
