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
    } catch(e) {
      data = { title: 'Notificação', body: event.data.text() };
    }
  }

  const options = {
    body: data.body || 'Novo pedido recebido!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    data: data.url || '/',
    requireInteraction: true,
    actions: [
      { action: 'view', title: 'Visualizar Agora' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '📦 Novo Pedido Recebido!', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const urlToOpen = new URL(event.notification.data, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          client.postMessage({ type: 'ORDER_OPEN' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
