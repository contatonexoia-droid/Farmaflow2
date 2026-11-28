export interface RecentTrackedOrder {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantWhatsapp?: string;
  customerName?: string;
  customerPhone?: string;
  total: number;
  status: string;
  deliveryMode: 'delivery' | 'pickup';
  date: string;
  whatsappUrl?: string;
}

const PUSH_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias
const TRACKED_ORDER_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas

export const isIosDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = (navigator as any).platform || '';
  const maxTouchPoints = Number((navigator as any).maxTouchPoints || 0);
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  if (platform === 'MacIntel' && maxTouchPoints > 1) return true;
  return false;
};

export const isStandalonePwa = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    if ((window.navigator as any).standalone === true) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};

export const isEmbeddedWebView = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Twitter|TikTok|BytedanceWebview|Snapchat|; wv\)/i.test(
    ua,
  );
};

export const isIosSafariNonStandalone = (): boolean => {
  return isIosDevice() && !isStandalonePwa();
};

export const isNativePushApiAvailable = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return (
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
};

export const canUseWebPushHere = (): boolean => {
  if (!isNativePushApiAvailable()) return false;
  if (isEmbeddedWebView()) return false;
  if (isIosSafariNonStandalone()) return false;
  return true;
};

export const getNotificationPermissionSafe = (): NotificationPermission | 'unsupported' => {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
};

export const setPushPromptCooldown = (tenantId: string, days = 3): void => {
  if (typeof localStorage === 'undefined' || !tenantId) return;
  try {
    const until = Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000;
    localStorage.setItem(`ff_push_cooldown_until_${tenantId}`, String(until));
    // Remove bloqueio legado eterno para aplicar o novo cooldown inteligente de 3 dias
    localStorage.removeItem(`push_dismissed_${tenantId}`);
  } catch {
    // ignore
  }
};

export const isPushPromptInCooldown = (tenantId: string): boolean => {
  if (typeof localStorage === 'undefined' || !tenantId) return false;
  try {
    const raw = localStorage.getItem(`ff_push_cooldown_until_${tenantId}`);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) return false;
    if (Date.now() < until) return true;
    localStorage.removeItem(`ff_push_cooldown_until_${tenantId}`);
    return false;
  } catch {
    return false;
  }
};

export const clearPushPromptCooldown = (tenantId: string): void => {
  if (typeof localStorage === 'undefined' || !tenantId) return;
  try {
    localStorage.removeItem(`ff_push_cooldown_until_${tenantId}`);
    localStorage.removeItem(`push_dismissed_${tenantId}`);
  } catch {
    // ignore
  }
};

export const saveStorefrontCustomerHint = (
  tenantId: string,
  info: { phone?: string; name?: string },
): void => {
  if (typeof localStorage === 'undefined' || !tenantId) return;
  try {
    const cleanPhone = String(info.phone || '').replace(/\D/g, '').slice(0, 20);
    const cleanName = String(info.name || '').trim().slice(0, 120);
    if (cleanPhone) {
      localStorage.setItem(`ff_customer_phone_${tenantId}`, cleanPhone);
      localStorage.setItem('ff_last_customer_phone', cleanPhone);
    }
    if (cleanName) {
      localStorage.setItem(`ff_customer_name_${tenantId}`, cleanName);
      localStorage.setItem('ff_last_customer_name', cleanName);
    }
  } catch {
    // ignore
  }
};

export const getStorefrontCustomerHint = (
  tenantId: string,
): { phone: string; name: string } => {
  if (typeof localStorage === 'undefined') return { phone: '', name: '' };
  try {
    let phone =
      (tenantId ? localStorage.getItem(`ff_customer_phone_${tenantId}`) : '') ||
      localStorage.getItem('ff_last_customer_phone') ||
      '';
    let name =
      (tenantId ? localStorage.getItem(`ff_customer_name_${tenantId}`) : '') ||
      localStorage.getItem('ff_last_customer_name') ||
      '';

    if ((!phone || !name) && tenantId) {
      const lastOrderRaw = localStorage.getItem(`ff_last_order_${tenantId}`);
      if (lastOrderRaw) {
        const parsed = JSON.parse(lastOrderRaw);
        if (!phone && parsed?.customerPhone) phone = String(parsed.customerPhone);
        if (!name && parsed?.customerName) name = String(parsed.customerName);
      }
    }

    if (!phone || !name) {
      const legacyRaw = localStorage.getItem('farmaflow_customer');
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (!phone && parsed?.phone) phone = String(parsed.phone);
        if (!name && parsed?.name) name = String(parsed.name);
      }
    }

    return {
      phone: String(phone || '').replace(/\D/g, '').slice(0, 20),
      name: String(name || '').trim().slice(0, 120),
    };
  } catch {
    return { phone: '', name: '' };
  }
};

export const saveRecentOrderForTracking = (
  tenantId: string,
  order: RecentTrackedOrder,
): void => {
  if (typeof localStorage === 'undefined' || !tenantId || !order?.id) return;
  try {
    localStorage.setItem(`ff_last_order_${tenantId}`, JSON.stringify(order));
    saveStorefrontCustomerHint(tenantId, {
      phone: order.customerPhone,
      name: order.customerName,
    });
  } catch {
    // ignore
  }
};

export const getRecentOrderForTracking = (
  tenantId: string,
): RecentTrackedOrder | null => {
  if (typeof localStorage === 'undefined' || !tenantId) return null;
  try {
    const raw = localStorage.getItem(`ff_last_order_${tenantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecentTrackedOrder;
    if (!parsed?.id || parsed.tenantId !== tenantId) return null;
    const orderTime = new Date(parsed.date).getTime();
    if (Number.isFinite(orderTime) && Date.now() - orderTime > TRACKED_ORDER_MAX_AGE_MS) {
      localStorage.removeItem(`ff_last_order_${tenantId}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const dispatchPushSubscribedEvent = (tenantId: string): void => {
  if (typeof window === 'undefined' || !tenantId) return;
  try {
    window.dispatchEvent(
      new CustomEvent('ff_push_subscribed', { detail: { tenantId } }),
    );
  } catch {
    // ignore
  }
};

export const PUSH_COOLDOWN_DEFAULT_DAYS = Math.round(
  PUSH_COOLDOWN_MS / (24 * 60 * 60 * 1000),
);
