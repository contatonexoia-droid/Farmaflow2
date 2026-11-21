export type OrderOrigin =
  | 'google'
  | 'google_shopping'
  | 'story'
  | 'push'
  | 'compartilhamento'
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'direto';

export const ORDER_ORIGIN_STORAGE_KEY = 'farmaflow_order_origin';

export const normalizeOrderOrigin = (raw?: string | null): OrderOrigin | null => {
  if (!raw) return null;
  const cleaned = String(raw)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');

  if (!cleaned) return null;

  if (
    cleaned === 'google_shopping' ||
    cleaned === 'googleshopping' ||
    cleaned === 'shopping' ||
    cleaned === 'gshopping' ||
    cleaned === 'google_merchant'
  ) {
    return 'google_shopping';
  }
  if (
    cleaned === 'google' ||
    cleaned === 'google_ads' ||
    cleaned === 'gads' ||
    cleaned === 'google_organic'
  ) {
    return 'google';
  }
  if (
    cleaned === 'story' ||
    cleaned === 'stories' ||
    cleaned === 'ig_story' ||
    cleaned === 'insta_story' ||
    cleaned === 'status'
  ) {
    return 'story';
  }
  if (
    cleaned === 'push' ||
    cleaned === 'webpush' ||
    cleaned === 'web_push' ||
    cleaned === 'notificacao' ||
    cleaned === 'notification'
  ) {
    return 'push';
  }
  if (
    cleaned === 'compartilhamento' ||
    cleaned === 'compartilhar' ||
    cleaned === 'share' ||
    cleaned === 'shared'
  ) {
    return 'compartilhamento';
  }
  if (cleaned === 'instagram' || cleaned === 'ig' || cleaned === 'insta') {
    return 'instagram';
  }
  if (cleaned === 'facebook' || cleaned === 'fb' || cleaned === 'meta') {
    return 'facebook';
  }
  if (cleaned === 'whatsapp' || cleaned === 'wa' || cleaned === 'wpp' || cleaned === 'zap') {
    return 'whatsapp';
  }
  if (cleaned === 'direto' || cleaned === 'direct') {
    return 'direto';
  }

  return null;
};

export const detectOriginFromReferrer = (referrer?: string | null): OrderOrigin => {
  const ref = String(referrer || '').trim().toLowerCase();
  if (!ref) return 'direto';
  if (ref.includes('google.')) return 'google';
  if (ref.includes('instagram.')) return 'instagram';
  if (ref.includes('facebook.') || ref.includes('fb.')) return 'facebook';
  if (ref.includes('whatsapp.') || ref.includes('wa.me')) return 'whatsapp';
  return 'direto';
};

export const captureAndPersistOrderOrigin = (explicitSearch?: string): OrderOrigin => {
  if (typeof window === 'undefined') return 'direto';

  try {
    const searchStr =
      typeof explicitSearch === 'string' ? explicitSearch : window.location.search || '';
    const params = new URLSearchParams(searchStr);
    const rawParam = params.get('origem') || params.get('utm_source');
    const normalizedParam = normalizeOrderOrigin(rawParam);

    // 1. Parâmetro explícito na URL sempre tem prioridade e atualiza a sessão
    if (normalizedParam) {
      try {
        window.sessionStorage.setItem(ORDER_ORIGIN_STORAGE_KEY, normalizedParam);
      } catch {}
      return normalizedParam;
    }

    // 2. Mantém a origem já capturada na sessão atual durante a navegação
    try {
      const existingRaw = window.sessionStorage.getItem(ORDER_ORIGIN_STORAGE_KEY);
      const existingNormalized = normalizeOrderOrigin(existingRaw);
      if (existingNormalized) {
        return existingNormalized;
      }
    } catch {}

    // 3. Fallback pelo document.referrer no primeiro acesso da sessão
    const refOrigin = detectOriginFromReferrer(
      typeof document !== 'undefined' ? document.referrer : ''
    );
    try {
      window.sessionStorage.setItem(ORDER_ORIGIN_STORAGE_KEY, refOrigin);
    } catch {}
    return refOrigin;
  } catch {
    return 'direto';
  }
};

export const getStoredOrderOrigin = (): OrderOrigin => {
  if (typeof window === 'undefined') return 'direto';
  try {
    const existing = normalizeOrderOrigin(
      window.sessionStorage.getItem(ORDER_ORIGIN_STORAGE_KEY)
    );
    if (existing) return existing;
  } catch {}
  return captureAndPersistOrderOrigin();
};

export const appendOriginParam = (rawUrl: string, origin: OrderOrigin): string => {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return trimmed;

  try {
    const isAbsolute = /^https?:\/\//i.test(trimmed);
    const base =
      isAbsolute
        ? undefined
        : typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://farmaflow.online';
    const parsed = new URL(trimmed, base);
    parsed.searchParams.set('origem', origin);
    if (isAbsolute) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const hashIdx = trimmed.indexOf('#');
    const hash = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';
    const withoutHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
    if (/[?&]origem=/i.test(withoutHash)) {
      return `${withoutHash.replace(/([?&]origem=)[^&]*/i, `$1${encodeURIComponent(origin)}`)}${hash}`;
    }
    const sep = withoutHash.includes('?') ? '&' : '?';
    return `${withoutHash}${sep}origem=${encodeURIComponent(origin)}${hash}`;
  }
};

export interface OrderOriginBadgeMeta {
  origin: OrderOrigin;
  label: string;
  badgeClass: string;
}

export const getOrderOriginMeta = (rawOrigin?: string | null): OrderOriginBadgeMeta => {
  const normalized = normalizeOrderOrigin(rawOrigin) || 'direto';
  switch (normalized) {
    case 'google_shopping':
      return {
        origin: 'google_shopping',
        label: 'Shopping',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
      };
    case 'google':
      return {
        origin: 'google',
        label: 'Google',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    case 'story':
      return {
        origin: 'story',
        label: 'Story',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
      };
    case 'instagram':
      return {
        origin: 'instagram',
        label: 'Instagram',
        badgeClass: 'bg-pink-50 text-pink-700 border-pink-200',
      };
    case 'push':
      return {
        origin: 'push',
        label: 'Push',
        badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
      };
    case 'compartilhamento':
      return {
        origin: 'compartilhamento',
        label: 'Compart.',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'whatsapp':
      return {
        origin: 'whatsapp',
        label: 'WhatsApp',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'facebook':
      return {
        origin: 'facebook',
        label: 'Facebook',
        badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      };
    case 'direto':
    default:
      return {
        origin: 'direto',
        label: 'Direto',
        badgeClass: 'bg-gray-50 text-gray-600 border-gray-200',
      };
  }
};
