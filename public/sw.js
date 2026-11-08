const CACHE_NAME = "farmaflow-v6";
const STATIC_ASSETS = ["/icon-192.svg", "/icon-512.svg"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        );
      } catch (_) {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") {
    return;
  }

  const urlStr = req.url || "";
  let url;
  try {
    url = new URL(urlStr);
  } catch (_) {
    return;
  }

  // Ignora imediatamente documento HTML (navigate), chamadas ao Supabase, APIs e rotas dinâmicas
  if (
    req.mode === "navigate" ||
    req.destination === "document" ||
    url.origin !== self.location.origin ||
    urlStr.includes("supabase.co") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/rest/") ||
    url.pathname.startsWith("/s/") ||
    urlStr.includes("version") ||
    urlStr.includes("promos") ||
    urlStr.includes("vouchers") ||
    url.pathname.endsWith("manifest.json") ||
    url.pathname.endsWith("sw.js")
  ) {
    return;
  }

  // Intercepta apenas ícones estáticos do PWA já cacheados
  const isStaticIcon = STATIC_ASSETS.includes(url.pathname);
  if (!isStaticIcon) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

self.addEventListener("push", function (event) {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: "Oferta Especial!", body: event.data.text() };
    }
  }

  const nestedData = data && typeof data.data === "object" ? data.data : {};
  const productId = nestedData.productId || data.productId || null;
  const tenantSlug = nestedData.tenantSlug || data.tenantSlug || null;
  const tenantId = nestedData.tenantId || data.tenantId || null;

  let targetUrl =
    nestedData.url ||
    nestedData.targetUrl ||
    data.url ||
    data.targetUrl ||
    (tenantSlug ? `/loja/${tenantSlug}` : "/");

  if (
    productId &&
    targetUrl &&
    !String(targetUrl).includes("product=") &&
    !String(targetUrl).includes("produto=") &&
    !String(targetUrl).includes("oferta=")
  ) {
    const sep = String(targetUrl).includes("?") ? "&" : "?";
    targetUrl = `${targetUrl}${sep}product=${encodeURIComponent(productId)}`;
  }

  const iconUrl = data.icon || data.iconUrl || "/icon-192.svg";
  const badgeUrl = data.badge || data.icon || data.iconUrl || "/icon-192.svg";
  const imageUrl = data.image || data.imageUrl || undefined;

  const options = {
    body: data.body || "Confira nossas ofertas especiais no aplicativo!",
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
      { action: "view", title: data.actionTitle || "Ver Oferta Agora" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || "🔥 Oferta Especial!",
      options
    )
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const rawUrl =
    (typeof notificationData === "string"
      ? notificationData
      : notificationData.url || notificationData.targetUrl) || "/";
  const productId =
    typeof notificationData === "object"
      ? notificationData.productId || null
      : null;
  const tenantSlug =
    typeof notificationData === "object"
      ? notificationData.tenantSlug || null
      : null;

  const resolvedUrlObj = new URL(rawUrl, self.location.origin);
  if (
    productId &&
    !resolvedUrlObj.searchParams.has("product") &&
    !resolvedUrlObj.searchParams.has("produto") &&
    !resolvedUrlObj.searchParams.has("oferta")
  ) {
    resolvedUrlObj.searchParams.set("product", String(productId));
  }
  const targetUrl = resolvedUrlObj.href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const existingClient =
        windowClients.find(
          (c) =>
            c.url &&
            c.url.startsWith(self.location.origin) &&
            !c.url.includes("/admin")
        ) || windowClients[0];

      if (existingClient) {
        if (
          "navigate" in existingClient &&
          typeof existingClient.navigate === "function"
        ) {
          try {
            await existingClient.navigate(targetUrl);
          } catch (_) {}
        }

        const msgPayload = {
          type: "NOTIFICATION_CLICK",
          url: targetUrl,
          productId: productId,
          tenantSlug: tenantSlug,
        };

        try {
          existingClient.postMessage(msgPayload);
          existingClient.postMessage({
            ...msgPayload,
            type: "PUSH_NOTIFICATION_CLICK",
          });
        } catch (_) {}

        setTimeout(() => {
          try {
            existingClient.postMessage(msgPayload);
          } catch (_) {}
        }, 600);

        if ("focus" in existingClient) {
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
