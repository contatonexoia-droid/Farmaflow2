export interface SilentSyncResult {
  synced: boolean;
  renewed: boolean;
  endpoint?: string;
}

const lastSyncTimestampByTenant = new Map<string, number>();

export const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const isRealPushEndpoint = (endpoint?: string | null): boolean => {
  const clean = String(endpoint || '').trim();
  if (!clean || !clean.startsWith('https://')) return false;
  const lower = clean.toLowerCase();
  if (
    lower.includes('preview-fallback.farmaflow.local') ||
    /^https:\/\/[^/]+\.local(\/|$)/i.test(lower)
  ) {
    return false;
  }
  return true;
};

export const areApplicationServerKeysEqual = (
  sub: PushSubscription | null,
  expectedKeyBytes: Uint8Array,
  expectedPublicKeyBase64?: string,
  tenantId?: string,
): boolean => {
  if (!sub) return false;
  try {
    const currentKeyBuffer = sub.options?.applicationServerKey;
    if (currentKeyBuffer) {
      const currentBytes = new Uint8Array(currentKeyBuffer);
      if (currentBytes.byteLength !== expectedKeyBytes.byteLength) {
        return false;
      }
      for (let i = 0; i < expectedKeyBytes.byteLength; i++) {
        if (currentBytes[i] !== expectedKeyBytes[i]) return false;
      }
      return true;
    }

    // Fallback para navegadores que omitem sub.options.applicationServerKey
    if (expectedPublicKeyBase64 && tenantId && typeof localStorage !== 'undefined') {
      const savedKey = localStorage.getItem(`ff_push_vapid_key_${tenantId}`);
      if (savedKey && savedKey === expectedPublicKeyBase64) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};

export const notifyServiceWorkerPushContext = (
  registration: ServiceWorkerRegistration | null,
  tenantId: string,
  vapidPublicKey: string,
): void => {
  try {
    const target =
      registration?.active ||
      registration?.waiting ||
      registration?.installing ||
      navigator.serviceWorker?.controller;
    if (target) {
      target.postMessage({
        type: 'SET_PUSH_CONTEXT',
        tenantId,
        vapidPublicKey,
      });
    }
  } catch {
    // silencioso
  }
};

const getReadyServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const swReg = await navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => null);
    if (swReg) {
      void swReg.update().catch(() => {});
    }
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration | null>((resolve) =>
        setTimeout(() => resolve(null), 4500),
      ),
    ]);
  } catch {
    return null;
  }
};

const fetchCurrentVapidPublicKey = async (tenantId: string): Promise<string | null> => {
  try {
    const res = await Promise.race([
      fetch(`/api/v1/push/vapid-public-key?tenantId=${encodeURIComponent(tenantId)}`, {
        headers: { Accept: 'application/json' },
      }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => reject(new Error('VAPID_TIMEOUT')), 4500),
      ),
    ]);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !ct.includes('application/json')) return null;
    const data = await res.json();
    const publicKey = String(data?.publicKey || '').trim();
    return publicKey || null;
  } catch {
    return null;
  }
};

const subscribeWithKey = async (
  registration: ServiceWorkerRegistration,
  expectedKeyBytes: Uint8Array,
): Promise<PushSubscription | null> => {
  try {
    return await Promise.race([
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedKeyBytes,
      }),
      new Promise<PushSubscription | null>((resolve) =>
        setTimeout(() => resolve(null), 5000),
      ),
    ]);
  } catch (err: any) {
    if (
      err?.name === 'InvalidStateError' ||
      String(err?.message || '').toLowerCase().includes('different')
    ) {
      const stale = await registration.pushManager.getSubscription().catch(() => null);
      if (stale) {
        await stale.unsubscribe().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return await Promise.race([
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedKeyBytes,
        }),
        new Promise<PushSubscription | null>((resolve) =>
          setTimeout(() => resolve(null), 5000),
        ),
      ]);
    }
    return null;
  }
};

const postSubscriptionUpsert = async (
  tenantId: string,
  sub: PushSubscription,
  vapidPublicKey: string,
  oldEndpoint?: string | null,
): Promise<boolean> => {
  const subJson = sub.toJSON();
  if (
    !isRealPushEndpoint(subJson?.endpoint) ||
    !subJson?.keys?.p256dh ||
    !subJson?.keys?.auth
  ) {
    return false;
  }

  const res = await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      tenantId,
      oldEndpoint: oldEndpoint && oldEndpoint !== subJson.endpoint ? oldEndpoint : undefined,
      subscription: subJson,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'FarmaFlow-PWA',
    }),
  });

  if (!res.ok) return false;

  try {
    if (subJson.endpoint) {
      (window as any).currentPushEndpoint = subJson.endpoint;
      localStorage.setItem(`ff_push_endpoint_${tenantId}`, subJson.endpoint);
      localStorage.setItem('ff_push_endpoint', subJson.endpoint);
    }
    localStorage.setItem(`ff_push_vapid_key_${tenantId}`, vapidPublicKey);
    localStorage.setItem(`push_subscribed_${tenantId}`, 'true');
    localStorage.setItem(`ff_push_subscribed_${tenantId}`, 'true');
  } catch {
    // ignore storage quota
  }

  return true;
};

/**
 * Auto-renovação 100% silenciosa em segundo plano (sem abrir popup).
 * Executa apenas quando Notification.permission === 'granted'.
 * Se a assinatura estiver ausente ou com VAPID key diferente da atual, renova e faz upsert no Supabase.
 */
export const silentSyncPushSubscription = async (
  tenantId: string,
  options?: { force?: boolean },
): Promise<SilentSyncResult> => {
  if (
    typeof window === 'undefined' ||
    !tenantId ||
    !('Notification' in window) ||
    Notification.permission !== 'granted' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return { synced: false, renewed: false };
  }

  const now = Date.now();
  const lastSync = lastSyncTimestampByTenant.get(tenantId) || 0;
  if (!options?.force && now - lastSync < 30_000) {
    return { synced: true, renewed: false };
  }
  lastSyncTimestampByTenant.set(tenantId, now);

  try {
    const [registration, vapidPublicKey] = await Promise.all([
      getReadyServiceWorkerRegistration(),
      fetchCurrentVapidPublicKey(tenantId),
    ]);

    if (!registration || !registration.pushManager || !vapidPublicKey) {
      return { synced: false, renewed: false };
    }

    notifyServiceWorkerPushContext(registration, tenantId, vapidPublicKey);

    const expectedKeyBytes = urlBase64ToUint8Array(vapidPublicKey);
    const currentSub = await registration.pushManager.getSubscription();
    const oldEndpoint = currentSub?.endpoint || null;

    const needsRenewal =
      !currentSub ||
      !isRealPushEndpoint(currentSub.endpoint) ||
      !areApplicationServerKeysEqual(currentSub, expectedKeyBytes, vapidPublicKey, tenantId);

    if (needsRenewal) {
      if (currentSub) {
        await currentSub.unsubscribe().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const freshSub = await subscribeWithKey(registration, expectedKeyBytes);
      if (!freshSub || !isRealPushEndpoint(freshSub.endpoint)) {
        return { synced: false, renewed: false };
      }
      const ok = await postSubscriptionUpsert(tenantId, freshSub, vapidPublicKey, oldEndpoint);
      return { synced: ok, renewed: ok, endpoint: freshSub.endpoint };
    }

    // Assinatura atual já usa a VAPID_PUBLIC_KEY correta: garante upsert silencioso no Supabase
    const ok = await postSubscriptionUpsert(tenantId, currentSub, vapidPublicKey);
    return { synced: ok, renewed: false, endpoint: currentSub.endpoint };
  } catch {
    return { synced: false, renewed: false };
  }
};

/**
 * Solicita permissão explicitamente (chamado apenas em clique do cliente no convite discreto)
 * e registra/atualiza a assinatura no Supabase com a VAPID_PUBLIC_KEY atual.
 */
export const requestAndSubscribePush = async (
  tenantId: string,
): Promise<{ ok: boolean; permission: NotificationPermission | 'unsupported'; reason?: string }> => {
  if (
    typeof window === 'undefined' ||
    !tenantId ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return { ok: false, permission: 'unsupported', reason: 'unsupported' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, permission };
    }

    const result = await silentSyncPushSubscription(tenantId, { force: true });
    return { ok: result.synced, permission };
  } catch {
    return { ok: false, permission: Notification.permission };
  }
};
