/**
 * FARMAFLOW - Serviço de Busca, Validação Estrita e Enriquecimento de Fotos por EAN
 * 
 * Busca fotos de produtos farmacêuticos e cosméticos via Código de Barras (EAN)
 * em cascata otimizada para ambientes Cloud (Vercel / AWS) e persiste
 * definitivamente no Supabase Storage (bucket products/ean/{ean}.jpg).
 * 
 * Regras de Ouro:
 * - Ignora medicamentos Genéricos ou produtos com foto automática de fabricante (mantém a caixa padrão do laboratório).
 * - Filtra rigorosamente banners promocionais (ex: Meli+ / Mercado Livre), ícones de martelo/leilão (gavel/flaticon/auction),
 *   placeholders, logos e imagens com proporção de banner horizontal (width > height * 1.5).
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
  skippedGeneric?: boolean;
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
  skippedGeneric?: number;
  results: EanImageResult[];
}

export interface CleanupCorruptedImagesSummary {
  success: boolean;
  scannedProducts: number;
  cleanedTotal: number;
  cleanedGenericOverwrites: number;
  cleanedPlaceholdersAndIcons: number;
  cleanedBannersInStorage: number;
  deletedStorageFiles: string[];
  cleanedProductIds: string[];
}

/**
 * Lista de laboratórios de medicamentos genéricos conhecidos no Brasil
 */
export const KNOWN_GENERIC_MANUFACTURERS = [
  'geolab',
  'medley',
  'ems',
  'neo quimica',
  'neo química',
  'neoquimica',
  'teuto',
  'eurofarma',
  'cimed',
  'prati',
  'donaduzzi',
  'prati-donaduzzi',
  'prati donaduzzi',
  'nova quimica',
  'nova química',
  'novaquimica',
  'sandoz',
  'biosintetica',
  'biosintética',
  'ache',
  'aché',
  'germed',
  'legrand',
  'pharlab',
  'globo',
  'vitamedic',
  'uniao quimica',
  'união química',
  'cristalia',
  'cristália',
  'ranbaxy',
  'althaia',
  'sanofi',
  'brainfarma',
  'multilab',
  'momenta',
  'torrent',
  'zydus',
  'hipolabor',
  'halex istar',
  'blau',
  'belfar',
  'natulab',
  'greenpharma',
  'merck',
  'abbott',
  'actavis',
  'accord',
  'aurobindo',
  'biolab',
  'cellera',
  'diffucap',
  'farmace',
  'fresenius',
  'glenmark',
  'hypera',
  'instituto biochimico',
  'libbs',
  'mabxience',
  'myralis',
  'natcofarma',
  'novartis',
  'pfizer',
  'servier',
  'sun pharma',
  'supera',
  'uci-farma',
  'uci farma',
  'zalika'
];

/**
 * Verifica se um produto é medicamento Genérico ou utiliza imagem automática de fabricante.
 * Produtos Genéricos recebem automaticamente a foto da caixa do laboratório cadastrado no FarmaFlow
 * e NUNCA devem ter sua foto sobrescrita por busca de EAN na internet.
 */
export function isGenericMedicationProduct(
  prod: {
    name?: string | null;
    drug_type?: string | null;
    drugType?: string | null;
    category?: string | null;
    department?: string | null;
    manufacturer?: string | null;
    is_generic?: boolean | null;
    image?: string | null;
  },
  tenantManufacturerLogos?: Record<string, string> | null,
  customManufacturers?: string[] | null
): boolean {
  if (!prod) return false;

  if (prod.is_generic === true) return true;

  const normalize = (str?: string | null) =>
    String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const drugTypeNorm = normalize(prod.drug_type || prod.drugType);
  if (drugTypeNorm === 'generico' || drugTypeNorm.includes('generico')) {
    return true;
  }

  const categoryNorm = normalize(prod.category);
  if (categoryNorm === 'generico' || categoryNorm === 'genericos' || categoryNorm.includes('medicamento generico')) {
    return true;
  }

  const nameRaw = String(prod.name || '').trim();
  const nameNorm = normalize(nameRaw);
  const mfgNorm = normalize(prod.manufacturer);

  // Lista combinada de fabricantes conhecidos + fabricantes cadastrados na loja
  const registeredNorms = new Set<string>(KNOWN_GENERIC_MANUFACTURERS.map(m => normalize(m)));
  if (tenantManufacturerLogos && typeof tenantManufacturerLogos === 'object') {
    for (const k of Object.keys(tenantManufacturerLogos)) {
      const nk = normalize(k);
      if (nk && nk !== 'outros') registeredNorms.add(nk);
    }
  }
  if (Array.isArray(customManufacturers)) {
    for (const m of customManufacturers) {
      const nm = normalize(m);
      if (nm && nm !== 'outros') registeredNorms.add(nm);
    }
  }

  // Se o produto já possui a URL exata de um logo de fabricante cadastrado no tenant
  if (prod.image && tenantManufacturerLogos && typeof tenantManufacturerLogos === 'object') {
    const imgTrim = String(prod.image).trim();
    const logoUrls = Object.values(tenantManufacturerLogos).filter(Boolean).map(v => String(v).trim());
    if (logoUrls.includes(imgTrim)) {
      return true;
    }
  }

  // Indicadores explícitos de Genérico no nome: "GENERICO", "GENÉRICO", "GEN.", "(GEN)"
  if (/\b(generico|genericos|gen\.|med\s+gen)\b/i.test(nameNorm) || /\(\s*gen\s*\)/i.test(nameNorm)) {
    return true;
  }

  // Padrão de nomenclatura de ERP farmacêutico para genéricos: " G " ou final " G" (ex: "DIPIRONA 500MG G MEDLEY", "LOSARTANA 50MG G")
  // Cuidado para não confundir com Fralda Tam G: exige não ser fralda/absorvente/roupa e ter indicador de dosagem ou laboratório
  const isHygieneOrDiaper = /\b(fralda|fraldas|huggies|pampers|mamypoko|pompom|turma da monica|babysec|absorvente|cueca|calcinha| meia |luva|camiseta)\b/i.test(nameNorm);
  if (!isHygieneOrDiaper) {
    const hasStandaloneG = /\s+g\s+/i.test(nameNorm) || /\s+g$/i.test(nameNorm) || /\bgen\b/i.test(nameNorm);
    if (hasStandaloneG) {
      const hasDosageIndicator = /\b\d+\s*(mg|mcg|ml|g|ui|comp|cpr|cp|cap|caps|gts|gotas|amp|env)\b/i.test(nameNorm);
      const matchesKnownLab = Array.from(registeredNorms).some(
        lab => lab.length >= 3 && (nameNorm.includes(lab) || (mfgNorm && mfgNorm.includes(lab)))
      );
      if (hasDosageIndicator || matchesKnownLab) {
        return true;
      }
    }
  }

  return false;
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

    const { error: createErr } = await supabaseAdmin.storage.createBucket(targetBucket, {
      public: true,
      fileSizeLimit: 10485760 // 10MB
    });

    if (!createErr) {
      console.log(`[EanImageService] Bucket '${targetBucket}' criado com sucesso no Supabase Storage.`);
      resolvedBucketName = targetBucket;
      return targetBucket;
    }

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
 * Rejeita URLs de imagem que são banners promocionais (Meli+), ícones de leilão/martelo (gavel/flaticon),
 * placeholders regulatórios genéricos, logos, SVGs ou ícones "sem foto".
 */
export function isPlaceholderImageUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const raw = String(url).trim();
  if (!raw || raw === 'IGNORE' || raw === 'PENDENTE_CURADORIA' || raw === 'null' || raw === 'undefined') {
    return true;
  }

  const l = raw.toLowerCase();

  // Rejeita SVGs ou base64 curtos (ícones/placeholders)
  if (l.endsWith('.svg') || l.includes('.svg?') || l.startsWith('data:image/svg')) {
    return true;
  }
  if (l.startsWith('data:image/') && raw.length < 4096) {
    return true;
  }

  const blockedTerms = [
    // Banners Mercado Livre / Meli+ / Assinaturas
    'meli+',
    'meliplus',
    'meli-plus',
    'meli_plus',
    'loyalty',
    'level-6',
    'level_6',
    'level6',
    'assinatura',
    'disney',
    'deezer',
    'starplus',
    'mercado-pontos',
    'mercadopontos',
    'loy-',
    ' pill-',
    // Ícones de martelo / leilão / flaticon / vetores genéricos
    'flaticon',
    '4668502',
    'gavel',
    'hammer',
    'martelo',
    'auction',
    'leilao',
    'leilão',
    'freepik',
    'vecteezy',
    'pngtree',
    'shutterstock',
    'istockphoto',
    'depositphotos',
    // Banners, headers, footers, ícones e logos
    'banner',
    'promo-banner',
    'header',
    'footer',
    'sprite',
    '/icon',
    '-icon.',
    '_icon.',
    'favicon',
    'avatar',
    '/logo',
    '-logo.',
    '_logo.',
    'logomarca',
    'selo-',
    'badge-',
    // Placeholders e Sem Foto
    'tarja-vermelha',
    'tarja_vermelha',
    'tarja%20vermelha',
    'tarja vermelha',
    'tarja-preta',
    'tarja_preta',
    'tarja%20preta',
    'tarja preta',
    'generico-tarja',
    'genericos-tarja',
    'generico_tarja',
    'no-image',
    'no_image',
    'noimage',
    'sem-foto',
    'sem_foto',
    'semfoto',
    'sem-imagem',
    'sem_imagem',
    'indisponivel',
    'default-product',
    'default_product',
    'product-default',
    'placeholder',
    'blank.',
    '1x1.',
    'pixel.'
  ];

  for (const term of blockedTerms) {
    if (l.includes(term)) {
      return true;
    }
  }

  return false;
}

/**
 * Extrai largura e altura (width x height) diretamente dos bytes binários da imagem (JPEG, PNG, GIF, WebP).
 */
export function extractImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    if (!buffer || buffer.length < 24) return null;

    // 1. PNG: 89 50 4E 47 0D 0A 1A 0A + IHDR chunk (width nos bytes 16..19, height nos bytes 20..23)
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }

    // 2. GIF: "GIF87a" ou "GIF89a" (width nos bytes 6..7 LE, height nos bytes 8..9 LE)
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46
    ) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      if (width > 0 && height > 0) return { width, height };
    }

    // 3. WEBP: "RIFF" .... "WEBP"
    if (
      buffer.length >= 30 &&
      buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
      buffer.slice(8, 12).toString('ascii') === 'WEBP'
    ) {
      const chunkHeader = buffer.slice(12, 16).toString('ascii');
      if (chunkHeader === 'VP8 ' && buffer.length >= 30) {
        // Lossy WebP: keyframe header nos bytes 23..25 (0x9D 0x01 0x2A)
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8L' && buffer.length >= 25) {
        // Lossless WebP: signature 0x2f no byte 20, 4 bytes packed width/height nos bytes 21..24
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        if (width > 0 && height > 0) return { width, height };
      } else if (chunkHeader === 'VP8X' && buffer.length >= 30) {
        // Extended WebP: 24-bit LE width-1 nos bytes 24..26, height-1 nos bytes 27..29
        const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
        const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
        if (width > 0 && height > 0) return { width, height };
      }
    }

    // 4. JPEG: FF D8 ... procura marcador SOF (FF C0..CF, exceto C4, C8, CC)
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        // Pula bytes de preenchimento 0xFF
        while (offset < buffer.length && buffer[offset] === 0xff) {
          offset++;
        }
        if (offset >= buffer.length) break;

        const marker = buffer[offset];
        offset++;

        // Marcadores sem comprimento (SOI, EOI, RST0..RST7, TEM)
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          continue;
        }

        if (offset + 2 > buffer.length) break;
        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2) break;

        // Marcadores SOF0..SOF15 (Start Of Frame) que contêm a resolução real
        const isSofMarker =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);

        if (isSofMarker && offset + 7 <= buffer.length) {
          const height = buffer.readUInt16BE(offset + 3);
          const width = buffer.readUInt16BE(offset + 5);
          if (width > 0 && height > 0) {
            return { width, height };
          }
        }

        offset += segmentLength;
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Valida se um buffer de imagem corresponde a uma foto real de produto (quadrada ou vertical)
 * e rejeita banners horizontais (ex: Meli+ R$ 74,90/mês onde width > height * 1.5) ou ícones minúsculos.
 */
export function isValidProductImageBuffer(buffer: Buffer): {
  valid: boolean;
  width?: number;
  height?: number;
  reason?: string;
} {
  if (!buffer || buffer.length < 3072) {
    return { valid: false, reason: 'Arquivo muito pequeno (< 3KB, provável ícone ou pixel)' };
  }

  const dims = extractImageDimensions(buffer);
  if (dims) {
    const { width, height } = dims;
    // Rejeita miniaturas/ícones muito pequenos
    if (width < 100 || height < 100) {
      return {
        valid: false,
        width,
        height,
        reason: `Dimensões muito pequenas para foto de produto (${width}x${height})`
      };
    }

    // Rejeita banners horizontais (ex: banner Meli+ 720x180, 1200x300, etc.)
    if (width > height * 1.5) {
      return {
        valid: false,
        width,
        height,
        reason: `Proporção de banner horizontal bloqueada (${width}x${height})`
      };
    }

    // Rejeita tiras verticais extremas
    if (height > width * 2.6) {
      return {
        valid: false,
        width,
        height,
        reason: `Proporção vertical estreita bloqueada (${width}x${height})`
      };
    }

    return { valid: true, width, height };
  }

  return { valid: true };
}

/**
 * Verifica se uma URL no Supabase Storage é realmente uma imagem de produto válida (e não um banner Meli+ salvo anteriormente).
 * Se for um banner inválido salvo no passado, remove do Storage para limpar o cache envenenado.
 */
async function validateOrPurgeSupabaseImageUrl(
  supabaseAdmin: SupabaseClient,
  url: string,
  cleanEan: string
): Promise<boolean> {
  if (!url || isPlaceholderImageUrl(url)) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return false;

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const check = isValidProductImageBuffer(buf);

    if (!check.valid) {
      console.warn(`[EanImageService] Imagem em cache para EAN ${cleanEan} reprovada (${check.reason}). Removendo do Storage...`);
      try {
        await supabaseAdmin.storage.from('products').remove([`ean/${cleanEan}.jpg`]);
      } catch (_) {}
      return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 1. SINCRONIZAÇÃO GLOBAL ENTRE TENANTS NO BANCO:
 * Consulta na tabela products se outra drogaria já possui foto válida salva no Supabase Storage para este EAN.
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
      .limit(3);

    if (!error && data && data.length > 0) {
      for (const row of data) {
        if (row.image && !isPlaceholderImageUrl(row.image)) {
          const isValidCached = await validateOrPurgeSupabaseImageUrl(supabaseAdmin, row.image, cleanEan);
          if (isValidCached) {
            const existingUrl = row.image;
            await updateProductImageInDb(supabaseAdmin, productId, existingUrl, tenantId, cleanEan);
            return existingUrl;
          }
        }
      }
    }
  } catch (err) {
    console.debug(`[EanImageService] Consulta cross-tenant falhou para ${cleanEan}:`, err);
  }

  return null;
}

/**
 * 2. VERIFICAÇÃO DE CACHE NO SUPABASE STORAGE (VALIDANDO DIMENSÕES CONTRA BANNERS):
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
        const isValid = await validateOrPurgeSupabaseImageUrl(supabaseAdmin, publicData.publicUrl, cleanEan);
        if (isValid) {
          return publicData.publicUrl;
        }
      }
    } catch (_) {}
  }

  return null;
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
  if (fallbackType && fallbackType.toLowerCase().includes('image/') && !fallbackType.toLowerCase().includes('svg')) {
    return fallbackType.split(';')[0].trim();
  }
  return null;
}

/**
 * Faz download de um buffer de imagem com headers de navegador e validação rigorosa de URL, tipo e proporção.
 */
export async function downloadImageBuffer(
  url: string, 
  customHeaders: Record<string, string> = {}
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    if (isPlaceholderImageUrl(url)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
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

    if (buffer.length < 3072) {
      return null;
    }

    const headText = buffer.slice(0, 150).toString('utf-8').toLowerCase().trim();
    if (
      headText.startsWith('<!doctype') ||
      headText.startsWith('<html') ||
      headText.startsWith('<?xml') ||
      headText.startsWith('<svg') ||
      headText.includes('<svg') ||
      headText.startsWith('{')
    ) {
      return null;
    }

    const detectedType = detectImageContentType(buffer, response.headers.get('content-type') || 'image/jpeg');
    if (!detectedType) {
      return null;
    }

    // Validação rigorosa de dimensões e proporção (bloqueia banners horizontais Meli+ e ícones pequenos)
    const qualityCheck = isValidProductImageBuffer(buffer);
    if (!qualityCheck.valid) {
      console.debug(`[EanImageService] Imagem descartada (${url}): ${qualityCheck.reason}`);
      return null;
    }

    return { buffer, contentType: detectedType };
  } catch (err) {
    return null;
  }
}

/**
 * Verifica se o título/alt de um card de produto possui correspondência real com o EAN ou com as palavras-chave do nome do produto,
 * e garante que não contenha termos de assinatura/banner (ex: Meli+).
 */
function doesTitleMatchProductOrEan(
  candidateTitleOrAlt: string | null | undefined,
  cleanEan: string,
  productName?: string
): boolean {
  const norm = (s?: string | null) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const title = norm(candidateTitleOrAlt);
  if (!title) return false;

  // Bloqueia imediatamente títulos/alts de assinatura Meli+, promoções ou banners
  const forbiddenAltTerms = [
    'meli+',
    'meli plus',
    'meliplus',
    'assinatura',
    'por apenas r$',
    '/mes',
    'disney+',
    'deezer',
    'frete gratis',
    'mercado livre',
    'mercado pago',
    'leilao',
    'gavel',
    'banner'
  ];
  for (const term of forbiddenAltTerms) {
    if (title.includes(term)) return false;
  }

  // Se o título contém o próprio EAN de 8-14 dígitos, é match exato
  if (cleanEan && title.includes(cleanEan)) {
    return true;
  }

  // Se temos o nome do produto, exige que a primeira palavra relevante (ou pelo menos uma palavra-chave >= 4 letras) esteja no título
  if (productName && productName.trim().length >= 3) {
    const stopWords = new Set([
      'para', 'com', 'sem', 'por', 'dos', 'das', 'uma', 'uns', 'umas',
      'caixa', 'frasco', 'embalagem', 'unidade', 'unidades', 'unid',
      'comprimido', 'comprimidos', 'capsula', 'capsulas', 'gotas',
      'solucao', 'xarope', 'pomada', 'creme', 'locao', 'shampoo',
      'condicionador', 'sabonete', 'desodorante', 'infantil', 'adulto',
      ' T ', 'tam', 'tamanho', 'leve', 'pague', 'gratis', 'oferta', 'kit'
    ]);
    const keywords = norm(productName)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !stopWords.has(w));

    if (keywords.length > 0) {
      const matchedKeywords = keywords.filter(kw => title.includes(kw));
      return matchedKeywords.length >= 1;
    }
  }

  // Se não temos o nome do produto para comparar, só aceita se o título tiver aparência de produto (>= 8 chars)
  return title.length >= 8;
}

/**
 * FONTE A: Consulta Mercado Livre Brasil por GTIN/EAN com filtro anti-banner Meli+.
 * - NUNCA extrai `http2.mlstatic.com/D_...` cegamente do HTML (pois páginas sem resultado exibem o banner do Meli+ no mesmo domínio).
 * - Exige correspondência real no catálogo oficial por GTIN ou em elementos de produto `ui-search-result-image__element` / `poly-component__picture`
 *   cujo `alt` ou título corresponda ao EAN ou às palavras-chave do produto.
 */
export async function searchMercadoLivre(cleanEan: string, productName?: string): Promise<string | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  const toHighRes = (url: string | null | undefined): string | null => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    if (isPlaceholderImageUrl(url)) return null;
    let high = url.replace(/-[IV]\.(jpg|webp|jpeg)/i, '-O.$1');
    high = high.replace(/-[A-Z0-9]+\.(webp|jpg|jpeg)/i, '-O.$1');
    if (high.endsWith('"') || high.endsWith("'")) high = high.slice(0, -1);
    return isPlaceholderImageUrl(high) ? null : high;
  };

  // 1. API Oficial Mercado Livre Brasil por GTIN/Product Identifier (busca exata de catálogo)
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
      const firstResult = data?.results?.[0];
      if (firstResult) {
        const title = firstResult.name || firstResult.title || cleanEan;
        if (!productName || doesTitleMatchProductOrEan(title, cleanEan, productName)) {
          const pic = firstResult?.pictures?.[0]?.url || firstResult?.thumbnail;
          const highRes = toHighRes(pic);
          if (highRes) return highRes;
        }
      }
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
      const results = Array.isArray(data?.results) ? data.results : [];
      for (const item of results.slice(0, 3)) {
        const itemTitle = item?.title || '';
        if (doesTitleMatchProductOrEan(itemTitle, cleanEan, productName)) {
          const pic = item?.pictures?.[0]?.url || item?.thumbnail;
          const highRes = toHighRes(pic);
          if (highRes) return highRes;
        }
      }
    }
  } catch (_) {}

  // 3. Fallback: Catálogo público de listagem Mercado Livre (APENAS imagens de cards de produto com validação de alt/title)
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

      // Verifica se a página não é de "Não há anúncios que correspondam à sua busca"
      const isNoResultsPage =
        html.includes('Não há anúncios que correspondam') ||
        html.includes('ui-search-rescue') ||
        html.includes('Não encontramos anúncios');

      if (!isNoResultsPage) {
        // Extrai apenas tags <img ...> pertencentes a cards de resultados de produtos
        const imgTagRegex = /<img\b[^>]*class=["'][^"']*(?:ui-search-result-image__element|poly-component__picture)[^"']*["'][^>]*>/gi;
        const imgTags = [...html.matchAll(imgTagRegex)].map(m => m[0]);

        for (const tag of imgTags) {
          const altMatch = tag.match(/\balt=["']([^"']+)["']/i) || tag.match(/\btitle=["']([^"']+)["']/i);
          const altText = altMatch ? altMatch[1] : '';

          if (!doesTitleMatchProductOrEan(altText, cleanEan, productName)) {
            continue;
          }

          const srcMatch =
            tag.match(/\bdata-src=["'](https:\/\/http2\.mlstatic\.com\/D_[^"'\s<>]+)["']/i) ||
            tag.match(/\bsrc=["'](https:\/\/http2\.mlstatic\.com\/D_[^"'\s<>]+)["']/i);

          if (srcMatch && srcMatch[1]) {
            const candidate = toHighRes(srcMatch[1]);
            if (candidate) return candidate;
          }
        }
      }
    }
  } catch (_) {}

  return null;
}

/**
 * FONTE B: Buscador de Imagens por EAN (Bing / DuckDuckGo Scraper) com validação de correspondência.
 * Exige que o card/metadado contenha o EAN ou palavras-chave do produto e bloqueia ícones (flaticon/gavel) e banners (Meli+).
 */
export async function searchWebImageScraper(cleanEan: string, productName?: string): Promise<string | null> {
  const query = `"${cleanEan}" ${productName ? productName.trim().slice(0, 45) : 'farmacia'}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  // 1. Bing Images Scraper (extração estruturada de m={...} com murl, t, ow, oh)
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
      // Extrai objetos de metadados `m="{&quot;murl&quot;:...}"` do Bing Images
      const metaBlocks = [...html.matchAll(/\bm=["'](\{[^"']*murl[^"']*\})["']/gi)].map(m =>
        m[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
      );

      for (const rawJson of metaBlocks) {
        try {
          const parsed = JSON.parse(rawJson);
          const imgUrl = parsed?.murl || parsed?.imgurl;
          const title = parsed?.t || parsed?.desc || '';
          const ow = Number(parsed?.ow || 0);
          const oh = Number(parsed?.oh || 0);

          if (!imgUrl || typeof imgUrl !== 'string' || !imgUrl.startsWith('http')) continue;
          if (isPlaceholderImageUrl(imgUrl)) continue;
          if (imgUrl.includes('bing.com') || imgUrl.includes('microsoft.com')) continue;

          // Se o Bing informou dimensões no JSON, rejeita banners horizontais imediatamente
          if (ow > 0 && oh > 0) {
            if (ow > oh * 1.5 || ow < 100 || oh < 100) continue;
          }

          if (title && !doesTitleMatchProductOrEan(title, cleanEan, productName)) {
            continue;
          }

          return imgUrl;
        } catch (_) {}
      }
    }
  } catch (_) {}

  // 2. DuckDuckGo Scraper (apenas se encontrar URL de farmácia/catálogo confiável)
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
        .filter(u =>
          !u.includes('duckduckgo.com') &&
          !u.includes('mlstatic.com') &&
          !isPlaceholderImageUrl(u)
        );

      if (imgMatches.length > 0) {
        return imgMatches[0];
      }
    }
  } catch (_) {}

  return null;
}

/**
 * FONTE C: Consulta VTEX Farmácias Nacionais com Headers de IP e Idioma Brasileiro.
 * Redes: Drogaria São Paulo, Pacheco, Pague Menos, Araujo, Venancio, Panvel, Nissei.
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
 * - Ignora medicamentos Genéricos ou produtos com foto automática de fabricante.
 * - Valida estritamente proporção e bloqueia banners do Meli+ e ícones de martelo/leilão.
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

  // Verifica se o produto é Medicamento Genérico ou já possui imagem automática de fabricante
  let effectiveProductName = productName;
  if (productId || tenantId) {
    try {
      let prodQuery = supabaseAdmin
        .from('products')
        .select('id, name, drug_type, category, manufacturer, image, tenant_id');

      if (productId) {
        prodQuery = prodQuery.eq('id', productId);
      } else if (tenantId) {
        prodQuery = prodQuery.eq('tenant_id', tenantId).eq('barcode', cleanEan);
      }

      const { data: prodRow } = await prodQuery.limit(1).maybeSingle();
      if (prodRow) {
        if (!effectiveProductName && prodRow.name) {
          effectiveProductName = prodRow.name;
        }

        let tenantLogos: Record<string, string> | null = null;
        let customMfgs: string[] | null = null;
        const targetTid = tenantId || prodRow.tenant_id;
        if (targetTid) {
          const { data: tRow } = await supabaseAdmin
            .from('tenants')
            .select('manufacturer_logos, custom_manufacturers')
            .eq('id', targetTid)
            .maybeSingle();
          tenantLogos = tRow?.manufacturer_logos || null;
          customMfgs = tRow?.custom_manufacturers || null;
        }

        if (isGenericMedicationProduct(prodRow, tenantLogos, customMfgs)) {
          return {
            success: false,
            ean: cleanEan,
            error: 'Produto ignorado: Medicamento Genérico utiliza automaticamente a imagem padrão da caixa do laboratório/fabricante.',
            productId: prodRow.id || productId,
            skippedGeneric: true
          };
        }
      }
    } catch (_) {}
  } else if (effectiveProductName && isGenericMedicationProduct({ name: effectiveProductName })) {
    return {
      success: false,
      ean: cleanEan,
      error: 'Produto ignorado: Medicamento Genérico utiliza automaticamente a imagem padrão da caixa do laboratório/fabricante.',
      productId,
      skippedGeneric: true
    };
  }

  const bucketName = await getOrEnsureStorageBucket(supabaseAdmin);
  const storagePath = `ean/${cleanEan}.jpg`;

  // 1. REAPROVEITAMENTO GLOBAL CROSS-TENANT NO BANCO (com validação anti-banner):
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

  // 2. REAPROVEITAMENTO NO SUPABASE STORAGE (com validação anti-banner):
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

  // 3. PERSISTÊNCIA DIRETA SE O FRONTEND ENVIOU BASE64 OU URL EXTERNA (validada contra banners e ícones):
  if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.length > 4096) {
    try {
      const cleanData = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
      const buf = Buffer.from(cleanData, 'base64');
      const quality = isValidProductImageBuffer(buf);
      if (quality.valid) {
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

  // 4. FONTE A: Redes de Farmácias Nacionais VTEX (priorizadas por terem fotos 100% farmacêuticas reais)
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

  // 5. FONTE B: CDN Cosmos (Bluesoft)
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

  // 6. FONTE C: OpenBeautyFacts (Cosméticos, dermocosméticos, higiene e perfumaria)
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

  // 7. FONTE D: OpenFoodFacts (Suplementos, vitaminas, nutrição e alimentos infantis)
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

  // 8. FONTE E: Mercado Livre Brasil (com validação estrita anti-Meli+ e correspondência de título)
  if (!foundBuffer) {
    try {
      const mlUrl = await searchMercadoLivre(cleanEan, effectiveProductName);
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

  // 9. FONTE F: Buscador Web (Bing / DuckDuckGo com filtro anti-banner e anti-ícone)
  if (!foundBuffer) {
    try {
      const webImgUrl = await searchWebImageScraper(cleanEan, effectiveProductName);
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

  // 10. FONTE G: API Cosmos Oficial (caso COSMOS_API_TOKEN esteja configurado no ambiente)
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
      error: 'Foto válida não encontrada nas bases públicas de código de barras para este EAN.',
      productId
    };
  }

  // 11. PERSISTÊNCIA DEFINITIVA NO SUPABASE STORAGE (Bucket products/ean/{cleanEan}.jpg)
  try {
    let uploadSuccess = false;
    let lastUploadError: any = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const { error: uploadError } = await supabaseAdmin.storage
        .from(bucketName)
        .upload(storagePath, foundBuffer, {
          contentType: foundContentType || 'image/jpeg',
          upsert: true
        });

      if (!uploadError) {
        uploadSuccess = true;
        break;
      }

      lastUploadError = uploadError;
      const isConnectionLimit = 
        uploadError.message?.includes('Too many connections') ||
        (uploadError as any)?.statusCode === '500' ||
        (uploadError as any)?.status === 500;

      console.warn(`[EanImageService] Tentativa ${attempt}/${maxRetries} de upload falhou (${bucketName}/${storagePath}):`, uploadError.message);

      if (isConnectionLimit && attempt < maxRetries) {
        const backoffMs = attempt * 800 + Math.floor(Math.random() * 400);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } else if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!uploadSuccess && lastUploadError) {
      return {
        success: false,
        ean: cleanEan,
        error: `Erro ao salvar no Supabase Storage: ${lastUploadError.message}`,
        productId
      };
    }

    const { data: publicUrlData } = supabaseAdmin.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData.publicUrl;

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
 */
export async function updateProductImageInDb(
  supabaseAdmin: SupabaseClient,
  productId?: string,
  imageUrl?: string,
  tenantId?: string,
  barcode?: string
) {
  if (!imageUrl || isPlaceholderImageUrl(imageUrl)) return;

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
 * Ignora automaticamente medicamentos Genéricos ou produtos que já possuem imagem válida / fabricante.
 */
export async function syncEanImagesBatch(
  supabaseAdmin: SupabaseClient,
  options: BatchSyncOptions
): Promise<BatchSyncSummary> {
  const { tenantId, productIds, limit = 50, concurrency = 4 } = options;

  let tenantLogos: Record<string, string> | null = null;
  let customMfgs: string[] | null = null;
  if (tenantId) {
    try {
      const { data: tRow } = await supabaseAdmin
        .from('tenants')
        .select('manufacturer_logos, custom_manufacturers')
        .eq('id', tenantId)
        .maybeSingle();
      tenantLogos = tRow?.manufacturer_logos || null;
      customMfgs = tRow?.custom_manufacturers || null;
    } catch (_) {}
  }

  let query = supabaseAdmin
    .from('products')
    .select('id, name, barcode, image, tenant_id, drug_type, category, manufacturer')
    .not('barcode', 'is', null)
    .neq('barcode', '');

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  if (productIds && productIds.length > 0) {
    const safeIds = productIds.slice(0, Math.min(limit, 100));
    query = query.in('id', safeIds);
  } else {
    query = query.or('image.is.null,image.eq.,image.ilike.%placeholder%,image.ilike.%sem-foto%,image.ilike.%no-image%');
  }

  query = query.limit(Math.min(limit, 100));

  const { data: rawProducts, error } = await query;

  if (error || !rawProducts || rawProducts.length === 0) {
    if (error) {
      console.error('[EanImageService] Erro ao buscar produtos para lote:', error);
    }
    return {
      total: 0,
      processed: 0,
      updated: 0,
      failed: 0,
      cached: 0,
      skippedGeneric: 0,
      results: []
    };
  }

  // Filtra produtos que já têm foto válida ou que são medicamentos Genéricos / com foto de fabricante
  let skippedGeneric = 0;
  const productsToProcess = rawProducts.filter((prod: any) => {
    const hasValidExistingPhoto = prod.image && String(prod.image).trim() !== '' && !isPlaceholderImageUrl(prod.image);
    if (hasValidExistingPhoto) {
      return false;
    }
    if (isGenericMedicationProduct(prod, tenantLogos, customMfgs)) {
      skippedGeneric++;
      return false;
    }
    return true;
  });

  if (productsToProcess.length === 0) {
    return {
      total: rawProducts.length,
      processed: rawProducts.length,
      updated: 0,
      failed: 0,
      cached: 0,
      skippedGeneric,
      results: []
    };
  }

  const results: EanImageResult[] = [];
  let updated = 0;
  let cached = 0;
  let failed = 0;

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
      } else if (res.skippedGeneric) {
        skippedGeneric++;
      } else {
        failed++;
      }

      chunkResults.push(res);
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    results.push(...chunkResults);

    if (i + safeConcurrency < productsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }

  return {
    total: rawProducts.length,
    processed: results.length + skippedGeneric,
    updated,
    failed,
    cached,
    skippedGeneric,
    results
  };
}

/**
 * ROTINA DE LIMPEZA DE IMAGENS CORROMPIDAS NO BANCO E NO SUPABASE STORAGE:
 * 1. Remove fotos salvas em produtos que sejam Medicamentos Genéricos (para restaurar a caixa automática do fabricante).
 * 2. Remove URLs que contenham termos de banners (Meli+), ícones de martelo/leilão (gavel/flaticon/4668502) ou placeholders.
 * 3. Inspeciona as imagens salvas em `/storage/v1/object/public/products/ean/{ean}.jpg`: se o arquivo binário
 *    tiver proporção de banner horizontal (`width > height * 1.5`, típico do banner "meli+ Por apenas R$ 74,90/mês")
 *    ou ícone inválido, exclui o arquivo do Supabase Storage e limpa a coluna `image = null` no banco de dados!
 */
export async function cleanupCorruptedEanImages(
  supabaseAdmin: SupabaseClient,
  tenantId?: string
): Promise<CleanupCorruptedImagesSummary> {
  const summary: CleanupCorruptedImagesSummary = {
    success: true,
    scannedProducts: 0,
    cleanedTotal: 0,
    cleanedGenericOverwrites: 0,
    cleanedPlaceholdersAndIcons: 0,
    cleanedBannersInStorage: 0,
    deletedStorageFiles: [],
    cleanedProductIds: []
  };

  try {
    // 1. Carrega configurações de fabricantes dos tenants
    const tenantLogosMap = new Map<string, Record<string, string>>();
    const tenantCustomMfgsMap = new Map<string, string[]>();
    try {
      let tQuery = supabaseAdmin.from('tenants').select('id, manufacturer_logos, custom_manufacturers');
      if (tenantId) tQuery = tQuery.eq('id', tenantId);
      const { data: tenantsData } = await tQuery;
      if (tenantsData) {
        for (const t of tenantsData) {
          if (t.id) {
            tenantLogosMap.set(t.id, t.manufacturer_logos || {});
            tenantCustomMfgsMap.set(t.id, t.custom_manufacturers || []);
          }
        }
      }
    } catch (_) {}

    // 2. Busca todos os produtos que possuem alguma imagem preenchida
    let allProductsWithImage: any[] = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
      let pQuery = supabaseAdmin
        .from('products')
        .select('id, tenant_id, barcode, name, image, drug_type, category, manufacturer')
        .not('image', 'is', null)
        .neq('image', '')
        .order('id', { ascending: true })
        .range(from, from + step - 1);

      if (tenantId) {
        pQuery = pQuery.eq('tenant_id', tenantId);
      }

      const { data, error } = await pQuery;
      if (error || !data || data.length === 0) {
        hasMore = false;
      } else {
        allProductsWithImage = allProductsWithImage.concat(data);
        if (data.length < step) {
          hasMore = false;
        } else {
          from += step;
        }
      }
    }

    summary.scannedProducts = allProductsWithImage.length;
    if (allProductsWithImage.length === 0) {
      return summary;
    }

    const idsToResetNull = new Set<string>();
    const storageUrlsToInspect = new Map<string, { ean: string; productIds: string[] }>();

    for (const prod of allProductsWithImage) {
      const imgUrl = String(prod.image || '').trim();
      if (!imgUrl) continue;

      const tLogos = tenantLogosMap.get(prod.tenant_id) || null;
      const tCustomMfgs = tenantCustomMfgsMap.get(prod.tenant_id) || null;

      // Verifica se a imagem atual é exatamente um logo oficial de fabricante cadastrado pelo lojista
      const isRegisteredMfgLogo =
        tLogos &&
        Object.values(tLogos)
          .filter(Boolean)
          .some(logoUrl => String(logoUrl).trim() === imgUrl);

      if (isRegisteredMfgLogo) {
        continue;
      }

      // Regra A: URL contém termos de placeholder, flaticon, gavel/martelo, meli+, banner, svg, etc.
      if (isPlaceholderImageUrl(imgUrl)) {
        idsToResetNull.add(prod.id);
        summary.cleanedPlaceholdersAndIcons++;
        continue;
      }

      // Regra B: Produto é Medicamento Genérico e teve sua foto sobrescrita por busca de EAN
      // (qualquer foto em /products/ean/ ou externa que não seja o logo oficial do fabricante)
      const isEanScrapedOrExternal =
        imgUrl.includes('/products/ean/') ||
        imgUrl.includes('mlstatic.com') ||
        imgUrl.includes('cosmos.bluesoft') ||
        imgUrl.includes('openbeautyfacts') ||
        imgUrl.includes('openfoodfacts') ||
        imgUrl.includes('bing.com') ||
        imgUrl.includes('flaticon.com');

      if (isEanScrapedOrExternal && isGenericMedicationProduct(prod, tLogos, tCustomMfgs)) {
        idsToResetNull.add(prod.id);
        summary.cleanedGenericOverwrites++;
        continue;
      }

      // Regra C: Se a imagem aponta para `/products/ean/{ean}.jpg` no Supabase Storage, agenda inspeção binária
      // para detectar e expurgar banners horizontais do Meli+ ("meli+ Por apenas R$ 74,90/mês")
      const eanStorageMatch = imgUrl.match(/\/products\/ean\/(\d{8,14})\.(?:jpg|jpeg|png|webp)/i);
      if (eanStorageMatch) {
        const baseCleanUrl = imgUrl.split('?')[0];
        const eanDigits = eanStorageMatch[1];
        const entry = storageUrlsToInspect.get(baseCleanUrl) || { ean: eanDigits, productIds: [] };
        entry.productIds.push(prod.id);
        storageUrlsToInspect.set(baseCleanUrl, entry);
      }
    }

    // 3. Inspeciona os arquivos únicos no Supabase Storage em lotes paralelos rápidos
    const storageEntries = Array.from(storageUrlsToInspect.entries());
    const INSPECT_CONCURRENCY = 8;

    for (let i = 0; i < storageEntries.length; i += INSPECT_CONCURRENCY) {
      const batch = storageEntries.slice(i, i + INSPECT_CONCURRENCY);
      await Promise.all(
        batch.map(async ([url, info]) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(url, { method: 'GET', signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) {
              // Arquivo quebrado (404/400) no Storage -> limpa do banco
              info.productIds.forEach(id => idsToResetNull.add(id));
              summary.cleanedBannersInStorage += info.productIds.length;
              return;
            }

            const arr = await res.arrayBuffer();
            const buf = Buffer.from(arr);
            const check = isValidProductImageBuffer(buf);

            if (!check.valid) {
              console.log(
                `[EanCleanup] Expurgando imagem inválida do Storage (ean/${info.ean}.jpg): ${check.reason}`
              );
              info.productIds.forEach(id => idsToResetNull.add(id));
              summary.cleanedBannersInStorage += info.productIds.length;
              summary.deletedStorageFiles.push(`ean/${info.ean}.jpg`);

              try {
                await supabaseAdmin.storage.from('products').remove([`ean/${info.ean}.jpg`]);
              } catch (_) {}

              try {
                await supabaseAdmin.from('ean_master_catalog').delete().eq('ean', info.ean);
              } catch (_) {}
            }
          } catch (_) {}
        })
      );
    }

    // 4. Também limpa entradas corrompidas na tabela ean_master_catalog (se existir)
    try {
      const { data: masterRows } = await supabaseAdmin
        .from('ean_master_catalog')
        .select('ean, image_url')
        .limit(1000);
      if (masterRows && masterRows.length > 0) {
        const badEans = masterRows
          .filter((r: any) => isPlaceholderImageUrl(r.image_url))
          .map((r: any) => r.ean);
        if (badEans.length > 0) {
          await supabaseAdmin.from('ean_master_catalog').delete().in('ean', badEans);
        }
      }
    } catch (_) {}

    // 5. Atualiza em lote os produtos afetados definindo `image: null`
    const allIdsToClean = Array.from(idsToResetNull);
    summary.cleanedProductIds = allIdsToClean;
    summary.cleanedTotal = allIdsToClean.length;

    const UPDATE_CHUNK = 100;
    for (let i = 0; i < allIdsToClean.length; i += UPDATE_CHUNK) {
      const chunkIds = allIdsToClean.slice(i, i + UPDATE_CHUNK);
      const { error: updErr } = await supabaseAdmin
        .from('products')
        .update({
          image: null,
          updated_at: new Date().toISOString()
        })
        .in('id', chunkIds);

      if (updErr) {
        console.warn('[EanCleanup] Aviso ao limpar lote de produtos:', updErr.message);
      }
    }

    if (summary.cleanedTotal > 0) {
      console.log(
        `[EanCleanup] Limpeza concluída: ${summary.cleanedTotal} produtos restaurados (${summary.cleanedGenericOverwrites} genéricos, ${summary.cleanedPlaceholdersAndIcons} ícones/placeholders, ${summary.cleanedBannersInStorage} banners Meli+/Storage).`
      );
    }
  } catch (err: any) {
    console.error('[EanCleanup] Erro durante limpeza de imagens corrompidas:', err);
    summary.success = false;
  }

  return summary;
}
