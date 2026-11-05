const CACHE_NAME = "farmaflow-v4";

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map((cacheName) => {
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Pass-through strategy to satisfy PWA requirements with graceful error handling
  event.respondWith(
    fetch(event.request).catch((err) => {
      const url = new URL(event.request.url);
      
      // For API requests, return a clean offline JSON response with 503 Service Unavailable
      if (url.pathname.startsWith('/api/')) {
        return new Response(
          JSON.stringify({ 
            error: "offline", 
            message: "Você está offline. Verifique sua conexão com a internet." 
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          }
        );
      }
      
      // For page navigation, return a simple offline page
      if (event.request.mode === 'navigate') {
        return new Response(
          "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'><title>Você está offline</title></head><body style='font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:48px 24px;background:#fcfdfe;color:#1f2937;'><h1>Você está offline</h1><p>Por favor, verifique sua conexão com a internet.</p></body></html>",
          {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          }
        );
      }
      
      // For static assets, modules, and other files, return a clean offline fallback instead of throwing
      return new Response('', {
        status: 504,
        statusText: 'Gateway Timeout (Offline)'
      });
    })
  );
});

self.addEventListener('push', function(event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Oferta Especial!', body: event.data.text() };
    }
  }

  const nestedData = data && typeof data.data === 'object' ? data.data : {};
  const productId = nestedData.productId || data.productId || null;
  const tenantSlug = nestedData.tenantSlug || data.tenantSlug || null;
  const tenantId = nestedData.tenantId || data.tenantId || null;

  let targetUrl =
    nestedData.url ||
    nestedData.targetUrl ||
    data.url ||
    data.targetUrl ||
    (tenantSlug ? `/loja/${tenantSlug}` : '/');

  if (
    productId &&
    targetUrl &&
    !String(targetUrl).includes('product=') &&
    !String(targetUrl).includes('produto=') &&
    !String(targetUrl).includes('oferta=')
  ) {
    const sep = String(targetUrl).includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}product=${encodeURIComponent(productId)}`;
  }

  const iconUrl = data.icon || data.iconUrl || '/icon-192.svg';
  const badgeUrl = data.badge || data.icon || data.iconUrl || '/icon-192.svg';
  const imageUrl = data.image || data.imageUrl || undefined;

  const options = {
    body: data.body || 'Confira nossas ofertas especiais no aplicativo!',
    icon: iconUrl,
    badge: badgeUrl,
    ...(imageUrl ? { image: imageUrl } : {}),
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || (productId ? `promo-${productId}` : undefined),
    renotify: true,
    data: {
      url: targetUrl,
      targetUrl: targetUrl,
      tenantId: tenantId,
      tenantSlug: tenantSlug,
      productId: productId,
    },
    requireInteraction: true,
    actions: [
      { action: 'view', title: data.actionTitle || 'Ver Oferta Agora' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || '🔥 Oferta Especial!',
      options
    )
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const rawUrl =
    (typeof notificationData === 'string'
      ? notificationData
      : notificationData.url || notificationData.targetUrl) || '/';
  const productId =
    typeof notificationData === 'object' ? notificationData.productId || null : null;
  const tenantSlug =
    typeof notificationData === 'object' ? notificationData.tenantSlug || null : null;

  const resolvedUrlObj = new URL(rawUrl, self.location.origin);
  if (
    productId &&
    !resolvedUrlObj.searchParams.has('product') &&
    !resolvedUrlObj.searchParams.has('produto') &&
    !resolvedUrlObj.searchParams.has('oferta')
  ) {
    resolvedUrlObj.searchParams.set('product', String(productId));
  }
  const targetUrl = resolvedUrlObj.href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      const existingClient =
        windowClients.find(
          (c) =>
            c.url &&
            c.url.startsWith(self.location.origin) &&
            !c.url.includes('/admin')
        ) || windowClients[0];

      if (existingClient) {
        if ('navigate' in existingClient && typeof existingClient.navigate === 'function') {
          try {
            await existingClient.navigate(targetUrl);
          } catch (_) {}
        }

        const msgPayload = {
          type: 'NOTIFICATION_CLICK',
          url: targetUrl,
          productId: productId,
          tenantSlug: tenantSlug,
        };

        try {
          existingClient.postMessage(msgPayload);
          existingClient.postMessage({
            ...msgPayload,
            type: 'PUSH_NOTIFICATION_CLICK',
          });
        } catch (_) {}

        setTimeout(() => {
          try {
            existingClient.postMessage(msgPayload);
          } catch (_) {}
        }, 600);

        if ('focus' in existingClient) {
          try {
            await existingClient.focus();
          } catch (_) {}
        }
        return;
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

