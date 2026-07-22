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

  // Normalize: lowercase, remove accents and invalid characters
  const cleanIdentifier = rawIdentifier
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // 3. If running on farmaflow.online domain
  if (typeof window !== 'undefined' && window.location.hostname.includes('farmaflow.online')) {
    return `https://${cleanIdentifier}.farmaflow.online`;
  }

  // 4. In Cloud Run / dev / local environment (e.g. run.app, localhost)
  if (typeof window !== 'undefined' && window.location.origin) {
    if (
      window.location.origin.includes('run.app') ||
      window.location.origin.includes('localhost') ||
      window.location.origin.includes('3000')
    ) {
      return `${window.location.origin}/loja/${cleanIdentifier}`;
    }
  }

  // 5. Default fallback
  return `https://${cleanIdentifier}.farmaflow.online`;
};
