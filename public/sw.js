const CACHE_NAME = "farmaflow-v3";

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

  const targetUrl =
    data.targetUrl ||
    data.url ||
    (data.data && (data.data.targetUrl || data.data.url)) ||
    '/';

  const iconUrl = data.icon || data.iconUrl || '/icon-192.svg';
  const badgeUrl = data.badge || data.icon || data.iconUrl || '/icon-192.svg';
  const imageUrl = data.image || data.imageUrl || undefined;

  const options = {
    body: data.body || 'Confira nossas ofertas especiais no aplicativo!',
    icon: iconUrl,
    badge: badgeUrl,
    ...(imageUrl ? { image: imageUrl } : {}),
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || (data.productId ? `promo-${data.productId}` : undefined),
    renotify: true,
    data: {
      url: targetUrl,
      targetUrl: targetUrl,
      tenantId: data.tenantId || null,
      productId: data.productId || null,
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

  const rawData = event.notification.data;
  const rawUrl =
    (typeof rawData === 'string' ? rawData : rawData?.targetUrl || rawData?.url) ||
    '/';
  const urlToOpen = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client.url === urlToOpen && 'focus' in client) {
            client.postMessage({
              type: 'PUSH_NOTIFICATION_CLICK',
              url: urlToOpen,
              productId: typeof rawData === 'object' ? rawData?.productId : null,
            });
            return client.focus();
          }
        }
        // If there is an existing window on the same origin, navigate it and focus
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (
            client.url.startsWith(self.location.origin) &&
            !client.url.includes('/admin') &&
            'focus' in client
          ) {
            if ('navigate' in client) {
              try {
                await client.navigate(urlToOpen);
              } catch (_) {}
            }
            client.postMessage({
              type: 'PUSH_NOTIFICATION_CLICK',
              url: urlToOpen,
              productId: typeof rawData === 'object' ? rawData?.productId : null,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

