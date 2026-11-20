import { PharmacyConfig } from '../types';

export const getStoreSlug = (
  tenant?: Partial<PharmacyConfig> & { subdomain?: string; id?: string; name?: string }
): string => {
  if (!tenant) return '';

  const rawIdentifier = (
    tenant.slug ||
    tenant.subdomain ||
    tenant.id ||
    tenant.name ||
    ''
  ).trim();

  if (!rawIdentifier) return '';

  return rawIdentifier
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

export const getStoreUrl = (tenant?: Partial<PharmacyConfig> & { subdomain?: string; id?: string }): string => {
  if (!tenant) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  // 1. Custom Domain if defined
  if (tenant.custom_domain && tenant.custom_domain.trim()) {
    const domain = tenant.custom_domain.replace(/^https?:\/\//, '').trim();
    return `https://${domain}`;
  }

  // 2. Subdomain, Slug, or Tenant ID normalized
  const cleanIdentifier = getStoreSlug(tenant);

  if (!cleanIdentifier) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  return `https://${cleanIdentifier}.farmaflow.online`;
};

export const slugifySeoText = (text: string = '', maxLength = 65): string => {
  const cleaned = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!cleaned || cleaned.length <= maxLength) return cleaned;
  const sliced = cleaned.slice(0, maxLength);
  const lastDash = sliced.lastIndexOf('-');
  return (lastDash > 15 ? sliced.slice(0, lastDash) : sliced).replace(/-+$/g, '');
};

export interface ProductSlugInput {
  id?: string;
  name?: string;
  internalCode?: string;
  internal_code?: string;
  barcode?: string;
  slug?: string;
}

export const getProductShortCode = (product: ProductSlugInput): string => {
  const rawInternal = String(product.internalCode || product.internal_code || '').trim();
  if (rawInternal && /^[a-zA-Z0-9]{1,20}$/.test(rawInternal)) {
    return rawInternal.toLowerCase();
  }

  const rawBarcode = String(product.barcode || '').trim();
  if (rawBarcode && /^[a-zA-Z0-9]{4,20}$/.test(rawBarcode)) {
    return rawBarcode.toLowerCase();
  }

  const rawId = String(product.id || '').trim();
  if (!rawId) return '';

  // UUID -> primeiros 8 caracteres hexadecimais para URL curta e única
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
    return rawId.slice(0, 8).toLowerCase();
  }

  const cleanId = rawId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (cleanId.length <= 16) return cleanId;
  return cleanId.slice(-10);
};

export const buildProductSlug = (product: ProductSlugInput): string => {
  const nameSlug = slugifySeoText(product.name || '', 65);
  const shortCode = getProductShortCode(product);

  if (nameSlug && shortCode) {
    if (nameSlug.endsWith(`-${shortCode}`) || nameSlug === shortCode) {
      return nameSlug;
    }
    return `${nameSlug}-${shortCode}`;
  }
  if (nameSlug) return nameSlug;
  if (shortCode) return shortCode;
  return slugifySeoText(String(product.id || 'produto'), 40) || 'produto';
};

export const extractProductLookupToken = (rawSlugOrId: string): {
  raw: string;
  token: string;
  nameHint: string;
} => {
  const raw = decodeURIComponent(String(rawSlugOrId || '').trim());
  if (!raw) return { raw: '', token: '', nameHint: '' };

  // Se for UUID completo, mantém como token exato
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return { raw, token: raw, nameHint: '' };
  }

  const lastDash = raw.lastIndexOf('-');
  if (lastDash > 0 && lastDash < raw.length - 1) {
    const trailing = raw.slice(lastDash + 1).trim();
    const prefix = raw.slice(0, lastDash).trim();
    return {
      raw,
      token: trailing,
      nameHint: prefix.replace(/-/g, ' ').trim(),
    };
  }

  return { raw, token: raw, nameHint: '' };
};

export const findProductBySlugOrId = <T extends ProductSlugInput>(
  products: T[] | undefined | null,
  rawSlugOrId: string
): T | undefined => {
  if (!Array.isArray(products) || products.length === 0 || !rawSlugOrId) return undefined;
  const { raw, token } = extractProductLookupToken(rawSlugOrId);
  const lowerRaw = raw.toLowerCase();
  const lowerToken = token.toLowerCase();

  // 1. Correspondência exata por ID, slug gerado ou código completo
  const exact = products.find((p) => {
    const pId = String(p.id || '').toLowerCase();
    const pInternal = String(p.internalCode || p.internal_code || '').trim().toLowerCase();
    const pBarcode = String(p.barcode || '').trim().toLowerCase();
    const pSlug = buildProductSlug(p).toLowerCase();
    return (
      pId === lowerRaw ||
      pSlug === lowerRaw ||
      (p.slug && String(p.slug).toLowerCase() === lowerRaw) ||
      (pInternal && pInternal === lowerRaw) ||
      (pBarcode && pBarcode === lowerRaw)
    );
  });
  if (exact) return exact;

  // 2. Correspondência pelo sufixo curto (internalCode, barcode ou prefixo/sufixo de ID)
  if (lowerToken && lowerToken !== lowerRaw) {
    const byCode = products.filter((p) => {
      const pId = String(p.id || '').toLowerCase();
      const pIdClean = pId.replace(/[^a-z0-9]/g, '');
      const pInternal = String(p.internalCode || p.internal_code || '').trim().toLowerCase();
      const pBarcode = String(p.barcode || '').trim().toLowerCase();
      return (
        pId === lowerToken ||
        (lowerToken.length >= 6 && pId.startsWith(lowerToken)) ||
        (lowerToken.length >= 6 && pIdClean.endsWith(lowerToken)) ||
        (pInternal && pInternal === lowerToken) ||
        (pBarcode && pBarcode === lowerToken)
      );
    });

    if (byCode.length === 1) return byCode[0];
    if (byCode.length > 1) {
      const best = byCode.find((p) => buildProductSlug(p).toLowerCase() === lowerRaw);
      return best || byCode[0];
    }
  }

  // 3. Fallback suave por nome
  return products.find((p) => p.name && p.name.toLowerCase().includes(lowerRaw));
};

export const getProductFriendlyPath = (
  tenant?: Partial<PharmacyConfig> & { subdomain?: string; id?: string; name?: string },
  product?: ProductSlugInput | null
): string => {
  const tenantSlug = getStoreSlug(tenant);
  if (!tenantSlug) return '/';
  if (!product) return `/loja/${encodeURIComponent(tenantSlug)}`;
  const productSlug = buildProductSlug(product);
  return `/loja/${encodeURIComponent(tenantSlug)}/produto/${encodeURIComponent(productSlug)}`;
};

export const getProductShareUrl = (
  tenant?: Partial<PharmacyConfig> & { subdomain?: string; id?: string; name?: string },
  product?: ProductSlugInput | null
): string => {
  const path = getProductFriendlyPath(tenant, product);
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  const base = getStoreUrl(tenant).replace(/\/+$/, '');
  return `${base}${path}`;
};

