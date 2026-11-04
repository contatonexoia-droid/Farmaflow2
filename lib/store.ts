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
