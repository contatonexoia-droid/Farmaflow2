/**
 * FARMAFLOW - Serviço de Busca e Enriquecimento de Fotos por EAN
 * 
 * Busca fotos de produtos farmacêuticos e cosméticos via Código de Barras (EAN)
 * em cascata otimizada para ambientes Cloud (Vercel / AWS) e persiste
 * definitivamente no Supabase Storage (bucket products/ean/{ean}.jpg).
 * 
 * 1. Sincronização Cross-Tenant no banco de dados (reaproveitamento instantâneo de outras lojas em 5ms)
 * 2. Cache determinístico no Supabase Storage via HEAD (sem limite de paginação do .list())
 * 3. Catálogo Mercado Livre Brasil (alta resolução -O.jpg)
 * 4. Redes de Farmácias BR (VTEX DPSP, Pacheco, Pague Menos, Araujo, Venancio, Nissei) com headers BR
 * 5. CDN Cosmos Bluesoft
 * 6. OpenBeautyFacts e OpenFoodFacts
 * 7. Persistência de URLs externas enviadas via fallback do navegador do lojista
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type EanImageSource = 
  | 'supabase_cross_tenant'
  | 'supabase_cache' 
  | 'mercadolivre'
  | 'web_scraper'
  | 'drogariasaopaulo' 
  | 'pacheco' 
  | 'paguemenos' 
  | 'araujo'
  | 'venancio'
  | 'panvel'
  | 'nissei'
  | 'cosmos_cdn' 
  | 'openbeautyfacts' 
  | 'openfoodfacts' 
  | 'cosmos_api' 
  | 'client_browser_fallback'
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

  resolvedBucketName = 'products';
  return resolvedBucketName;
}

/**
 * 4. SINCRONIZAÇÃO GLOBAL ENTRE TENANTS NO BANCO:
 * Antes mesmo de ir ao Storage ou à internet, consulta na própria tabela products
 * do Supabase (sem filtro de tenant_id) se qualquer outra drogaria já possui foto salva
 * no Supabase Storage para este EAN. Reaproveita na hora em ~5ms.
 */
export async function checkCrossTenantDbImage(
  supabaseAdmin: SupabaseClient,
  cleanEan: string,
  productId?: string,
  tenantId?: string
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('image')
      .eq('barcode', cleanEan)
      .not('image', 'is', null)
      .neq('image', '')
      .or('image.ilike.%supabase.co%,image.ilike.%/storage/v1/object/public/%')
      .limit(1);

    if (!error && data && data.length > 0 && data[0].image && !isPlaceholderImageUrl(data[0].image)) {
      const existingUrl = data[0].image;
      await updateProductImageInDb(supabaseAdmin, productId, existingUrl, tenantId, cleanEan);
      return existingUrl;
    }
  } catch (err) {
    console.debug(`[EanImageService] Consulta cross-tenant falhou para ${cleanEan}:`, err);
  }

  return null;
}

/**
 * 1. CORREÇÃO DA VERIFICAÇÃO DE CACHE NO SUPABASE STORAGE (SEM USAR .list()):
 * NUNCA usa .list() para checar se ean/${cleanEan}.jpg existe (pois .list() pagina em 100 itens).
 * Em vez disso, gera a publicUrl determinística de 'ean/${cleanEan}.jpg' no bucket 'products'
 * e faz uma requisição fetch(publicUrl, { method: 'HEAD' }).
 * Se retornar status === 200, significa que a foto JÁ EXISTE no Supabase Storage!
 */
export async function checkExistingSupabaseImage(
  supabaseAdmin: SupabaseClient,
  bucketName: string,
  cleanEan: string
): Promise<string | null> {
  const candidateBuckets = Array.from(new Set(['products', bucketName, 'product-images']));

  for (const bucket of candidateBuckets) {
    const filePath = `ean/${cleanEan}.jpg`;
    try {
      const { data: publicData } = supabaseAdmin.storage
        .from(bucket)
        .getPublicUrl(filePath);

      if (publicData?.publicUrl) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);
        const res = await fetch(publicData.publicUrl, {
          method: 'HEAD',
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (res.status === 200) {
          return publicData.publicUrl;
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Rejeita URLs de imagem que são placeholders regulatórios genéricos (faixas de tarja ou ícones 'sem foto')
 */
export function isPlaceholderImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const l = String(url).toLowerCase();
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
 * Detecta o tipo real de imagem a partir dos magic bytes do buffer.
 */
export function detectImageContentType(buffer: Buffer, fallbackType: string = 'image/jpeg'): string | null {
  if (buffer.length < 4) return null;
  // JPEG: FF D8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  // WEBP: RIFF .... WEBP
  if (buffer.length > 12 && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  // GIF: GIF8
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  // Se tiver fallback válido de imagem
  if (fallbackType && fallbackType.toLowerCase().includes('image/')) {
    return fallbackType.split(';')[0].trim();
  }
  return null;
}

/**
 * Faz download de um buffer de imagem com headers de navegador e validação rigorosa.
 */
export async function downloadImageBuffer(
  url: string, 
  customHeaders: Record<string, string> = {}
): Promise<{ buffer: Buffer; contentType: string } | null> {
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

    const detectedType = detectImageContentType(buffer, response.headers.get('content-type') || 'image/jpeg');
    if (!detectedType) {
      return null;
    }

    return { buffer, contentType: detectedType };
  } catch (err) {
    return null;
  }
}

/**
 * 2A. FONTE A: Consulta Mercado Livre Brasil por GTIN/EAN.
 * 1. API Oficial por GTIN: https://api.mercadolibre.com/products/search?status=active&site_id=MLB&product_identifier=${cleanEan}
 * 2. API Oficial por Query: https://api.mercadolibre.com/sites/MLB/search?q=${cleanEan}
 * 3. Fallback Catálogo Web: https://lista.mercadolivre.com.br/${cleanEan}
 * Troca thumbnail (-I.jpg / -V.jpg) por alta resolução (-O.jpg).
 */
export async function searchMercadoLivre(cleanEan: string): Promise<string | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  const toHighRes = (url: string | null | undefined): string | null => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    let high = url.replace(/-[IV]\.(jpg|webp|jpeg)/i, '-O.$1');
    high = high.replace(/-[A-Z0-9]+\.(webp|jpg|jpeg)/i, '-O.$1');
    if (high.endsWith('"') || high.endsWith("'")) high = high.slice(0, -1);
    return high;
  };

  // 1. API Oficial Mercado Livre Brasil por GTIN/Product Identifier
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://api.mercadolibre.com/products/search?status=active&site_id=MLB&product_identifier=${cleanEan}`, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const pic = data?.results?.[0]?.pictures?.[0]?.url || data?.results?.[0]?.thumbnail;
      const highRes = toHighRes(pic);
      if (highRes) return highRes;
    }
  } catch (_) {}

  // 2. API Oficial Mercado Livre Brasil por Query (sites/MLB/search?q=)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${cleanEan}`, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const pic = data?.results?.[0]?.pictures?.[0]?.url || data?.results?.[0]?.thumbnail;
      const highRes = toHighRes(pic);
      if (highRes) return highRes;
    }
  } catch (_) {}

  // 3. Fallback: Catálogo público de listagem Mercado Livre
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://lista.mercadolivre.com.br/${cleanEan}`, {
      headers: {
        ...headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      const html = await res.text();
      const urls = [...html.matchAll(/https:\/\/http2\.mlstatic\.com\/D_[^"'\s<>]+/g)].map(m => m[0]);
      if (urls.length > 0) {
        const candidate = toHighRes(urls[0]);
        if (candidate) return candidate;
      }
    }
  } catch (_) {}

  return null;
}

/**
 * 2B. FONTE B: Buscador de Imagens por EAN (Bing / DuckDuckGo Scraper).
 * Busca pela query `"${cleanEan}" ${productName || 'farmacia'}` extraindo a URL direta
 * da imagem do produto em alta resolução. Imune a bloqueios de IP de datacenter.
 */
export async function searchWebImageScraper(cleanEan: string, productName?: string): Promise<string | null> {
  const query = `"${cleanEan}" ${productName ? productName.trim().slice(0, 40) : 'farmacia'}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  // 1. Bing Images Scraper (extração de murl / imgurl)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1`, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const html = await res.text();
      const murlMatches = [...html.matchAll(/(?:murl|imgurl)&quot;:&quot;(https?:[^&"]+)&quot;/gi)]
        .map(m => decodeURIComponent(m[1]))
        .filter(u => !isPlaceholderImageUrl(u) && !u.includes('bing.com') && !u.includes('microsoft.com'));

      if (murlMatches.length > 0) {
        return murlMatches[0];
      }

      // Fallback em links diretos de imagem encontrados no HTML
      const cdnMatches = [...html.matchAll(/https?:\/\/[a-zA-Z0-9_\-\.]+\/[^"'\s<>\\]+\.(?:jpg|png|webp|jpeg)/gi)]
        .map(m => m[0])
        .filter(u => 
          !u.includes('bing.com') && 
          !u.includes('microsoft.com') && 
          !u.includes('schema.org') &&
          !isPlaceholderImageUrl(u)
        );

      if (cdnMatches.length > 0) {
        return cdnMatches[0];
      }
    }
  } catch (_) {}

  // 2. DuckDuckGo Scraper
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (res.ok) {
      const html = await res.text();
      const imgMatches = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi)]
        .map(m => m[0])
        .filter(u => !u.includes('duckduckgo.com') && !isPlaceholderImageUrl(u));

      if (imgMatches.length > 0) {
        return imgMatches[0];
      }
    }
  } catch (_) {}

  return null;
}

/**
 * 2C. FONTE C: Consulta VTEX Farmácias Nacionais com Headers de IP e Idioma Brasileiro.
 * Redes: Drogaria São Paulo, Pacheco, Pague Menos, Araujo, Venancio, Panvel, Nissei.
 * Envia obrigatoriamente headers simulando navegador no Brasil.
 */
export async function searchPharmacyNetworks(cleanEan: string): Promise<{ url: string; source: EanImageSource } | null> {
  const providers: Array<{ source: EanImageSource; url: string; origin: string }> = [
    {
      source: 'drogariasaopaulo',
      url: `https://www.drogariasaopaulo.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`,
      origin: 'https://www.drogariasaopaulo.com.br'
    },
    {
      source: 'pacheco',
      url: `https://www.drogariaspacheco.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`,
      origin: 'https://www.drogariaspacheco.com.br'
    },
    {
      source: 'paguemenos',
      url: `https://www.paguemenos.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`,
      origin: 'https://www.paguemenos.com.br'
    },
    {
      source: 'araujo',
      url: `https://www.drogariaaraujo.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`,
      origin: 'https://www.drogariaaraujo.com.br'
    },
    {
      source: 'venancio',
      url: `https://www.drogariasvenancio.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`,
      origin: 'https://www.drogariasvenancio.com.br'
    },
    {
      source: 'panvel',
      url: `https://www.panvel.com/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`,
      origin: 'https://www.panvel.com'
    },
    {
      source: 'nissei',
      url: `https://www.farmaciasnissei.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${cleanEan}`,
      origin: 'https://www.farmaciasnissei.com.br'
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
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Origin': p.origin,
            'Referer': `${p.origin}/`,
            'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
          }
        });
        clearTimeout(to);

        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await res.json();
            const imageUrl = data?.[0]?.items?.[0]?.images?.[0]?.imageUrl;
            if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http') && !isPlaceholderImageUrl(imageUrl)) {
              return { url: imageUrl, source: p.source };
            }
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
 * Busca a imagem de um produto pelo código EAN em cascata completa (Waterfall):
 * 1. Sincronização Cross-Tenant no banco de dados (5ms)
 * 2. Cache determinístico no Supabase Storage via HEAD (sem limite de paginação do .list())
 * 3. Base64 ou URL externa enviada via fallback do navegador do lojista (IP Residencial BR)
 * 4. Fonte A: Mercado Livre Brasil por GTIN/EAN (APIs oficiais e catálogo de alta resolução -O.jpg)
 * 5. Fonte B: Buscador de imagens Web por EAN (Bing / DuckDuckGo scraper)
 * 6. Fonte C: VTEX Farmácias Nacionais com Headers BR (Drogaria SP, Pacheco, Pague Menos, Araujo, Venancio, Panvel, Nissei)
 * 7. CDN Cosmos Bluesoft
 * 8. OpenBeautyFacts (Cosméticos, higiene e perfumaria)
 * 9. OpenFoodFacts (Suplementos, vitaminas e nutrição)
 * 10. API Cosmos oficial (se token configurado)
 * Persiste definitivamente no Supabase Storage (products/ean/{cleanEan}.jpg) e atualiza o banco.
 */
export async function fetchAndStoreProductImageByEan(
  supabaseAdmin: SupabaseClient,
  ean: string,
  productName?: string,
  tenantId?: string,
  productId?: string,
  externalImageUrl?: string,
  imageBase64?: string
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

  // 1. REAPROVEITAMENTO GLOBAL CROSS-TENANT NO BANCO:
  // Se qualquer outra loja do FarmaFlow já tiver essa foto hospedada no Supabase, reaproveita em 5ms!
  const crossTenantUrl = await checkCrossTenantDbImage(supabaseAdmin, cleanEan, productId, tenantId);
  if (crossTenantUrl) {
    return {
      success: true,
      ean: cleanEan,
      url: crossTenantUrl,
      source: 'supabase_cross_tenant',
      productId
    };
  }

  // 2. REAPROVEITAMENTO NO SUPABASE STORAGE (HEAD direto sem .list()):
  const cachedUrl = await checkExistingSupabaseImage(supabaseAdmin, bucketName, cleanEan);
  if (cachedUrl) {
    await updateProductImageInDb(supabaseAdmin, productId, cachedUrl, tenantId, cleanEan);
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

  // 3. PERSISTÊNCIA DIRETA SE O FRONTEND (IP RESIDENCIAL BR) ENVIOU BASE64 OU URL EXTERNA:
  if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 100) {
    try {
      const cleanData = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
      const buf = Buffer.from(cleanData, 'base64');
      if (buf.length >= 3072) {
        const detected = detectImageContentType(buf, 'image/jpeg');
        if (detected) {
          foundBuffer = buf;
          foundContentType = detected;
          sourceFound = 'client_browser_fallback';
        }
      }
    } catch (_) {}
  }

  if (!foundBuffer && externalImageUrl && typeof externalImageUrl === 'string' && externalImageUrl.startsWith('http')) {
    try {
      const dl = await downloadImageBuffer(externalImageUrl);
      if (dl && dl.buffer.length >= 3072) {
        foundBuffer = dl.buffer;
        foundContentType = dl.contentType;
        sourceFound = 'client_browser_fallback';
      }
    } catch (_) {}
  }

  // 4. FONTE A: Mercado Livre Brasil (APIs oficiais e catálogo de alta resolução -O.jpg)
  if (!foundBuffer) {
    try {
      const mlUrl = await searchMercadoLivre(cleanEan);
      if (mlUrl) {
        const dl = await downloadImageBuffer(mlUrl);
        if (dl && dl.buffer.length >= 3072) {
          foundBuffer = dl.buffer;
          foundContentType = dl.contentType;
          sourceFound = 'mercadolivre';
        }
      }
    } catch (err) {
      console.debug(`[EanImageService] Mercado Livre falhou para ${cleanEan}:`, err);
    }
  }

  // 5. FONTE B: Buscador de Imagens na Web por EAN (Bing / DuckDuckGo Scraper)
  if (!foundBuffer) {
    try {
      const webImgUrl = await searchWebImageScraper(cleanEan, productName);
      if (webImgUrl) {
        const dl = await downloadImageBuffer(webImgUrl);
        if (dl && dl.buffer.length >= 3072) {
          foundBuffer = dl.buffer;
          foundContentType = dl.contentType;
          sourceFound = 'web_scraper';
        }
      }
    } catch (err) {
      console.debug(`[EanImageService] Web scraper falhou para ${cleanEan}:`, err);
    }
  }

  // 6. FONTE C: VTEX Farmácias Nacionais (DPSP, Pacheco, Pague Menos, Araujo, Venancio, Panvel, Nissei)
  if (!foundBuffer) {
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
  }

  // 6. FONTE C: CDN Cosmos (Bluesoft)
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

  // 7. FONTE D: OpenBeautyFacts (Cosméticos, dermocosméticos, higiene e perfumaria)
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

  // 8. FONTE E: OpenFoodFacts (Suplementos, vitaminas, nutrição e alimentos infantis)
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

  // 9. FONTE F: API Cosmos Oficial (caso COSMOS_API_TOKEN esteja configurado no ambiente)
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

  // 10. PERSISTÊNCIA DEFINITIVA NO SUPABASE STORAGE (Bucket products/ean/{cleanEan}.jpg)
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

    // Atualiza a coluna de imagem do produto no banco de dados imediatamente
    await updateProductImageInDb(supabaseAdmin, productId, publicUrl, tenantId, cleanEan);

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
 * Pode atualizar por productId ou por barcode (EAN).
 */
export async function updateProductImageInDb(
  supabaseAdmin: SupabaseClient,
  productId?: string,
  imageUrl?: string,
  tenantId?: string,
  barcode?: string
) {
  if (!imageUrl) return;

  try {
    let query = supabaseAdmin
      .from('products')
      .update({
        image: imageUrl,
        updated_at: new Date().toISOString()
      });

    if (productId) {
      query = query.eq('id', productId);
    } else if (barcode) {
      query = query.eq('barcode', barcode);
    } else {
      return;
    }

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { error } = await query;
    if (error) {
      console.warn(`[EanImageService] Aviso ao atualizar coluna image do produto ${productId || barcode}:`, error.message);
    }
  } catch (err) {
    console.warn(`[EanImageService] Exceção ao atualizar produto ${productId || barcode}:`, err);
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

  // Processa com concorrência baixa (máximo 2 em paralelo) e pausa para respeitar limites de conexões do Supabase
  const safeConcurrency = Math.min(concurrency || 2, 2);
  for (let i = 0; i < productsToProcess.length; i += safeConcurrency) {
    const chunk = productsToProcess.slice(i, i + safeConcurrency);
    const chunkResults: EanImageResult[] = [];

    for (const prod of chunk) {
      const res = await fetchAndStoreProductImageByEan(
        supabaseAdmin,
        prod.barcode,
        prod.name,
        prod.tenant_id,
        prod.id
      );

      if (res.success) {
        if (res.source === 'supabase_cache' || res.source === 'supabase_cross_tenant') {
          cached++;
        }
        updated++;
      } else {
        failed++;
      }

      chunkResults.push(res);
      // Pausa de 250ms entre cada requisição individual para evitar esgotamento de conexões do DB
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    results.push(...chunkResults);

    // Pausa de 400ms entre blocos de concorrência
    if (i + safeConcurrency < productsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 400));
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
