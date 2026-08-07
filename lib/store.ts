import { PharmacyConfig } from '../types';

export const getStoreUrl = (tenant?: Partial<PharmacyConfig> & { subdomain?: string; id?: string }): string => {
  if (!tenant) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  // 1. Custom Domain if defined
  if (tenant.custom_domain && tenant.custom_domain.trim()) {
    const domain = tenant.custom_domain.replace(/^https?:\/\//, '').trim();
    return `https://${domain}`;
  }

  // 2. Subdomain, Slug, or Tenant ID
  const rawIdentifier = (
    tenant.subdomain ||
    tenant.slug ||
    tenant.id ||
    ''
  ).trim();

  if (!rawIdentifier) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  // Normalize: lowercase, remove accents, convert spaces and invalid characters to single hyphens
  const cleanIdentifier = rawIdentifier
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `https://${cleanIdentifier}.farmaflow.online`;
};
