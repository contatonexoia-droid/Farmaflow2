const CACHE_NAME = "farmaflow-v8";
const PUSH_META_CACHE = "farmaflow-push-meta-v1";
const PUSH_META_KEY = "/__farmaflow_push_meta__";
const STATIC_ASSETS = ["/icon-192.svg", "/icon-512.svg"];

async function savePushMeta(partialMeta) {
  try {
    const cache = await caches.open(PUSH_META_CACHE);
    const existing = await loadPushMeta();
    const merged = {
      tenantId: partialMeta.tenantId || existing.tenantId || null,
      vapidPublicKey: partialMeta.vapidPublicKey || existing.vapidPublicKey || null,
    };
    await cache.put(
      PUSH_META_KEY,
      new Response(JSON.stringify(merged), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch (_) {}
}

async function loadPushMeta() {
  try {
    const cache = await caches.open(PUSH_META_CACHE);
    const res = await cache.match(PUSH_META_KEY);
    if (!res) return {};
    return (await res.json()) || {};
  } catch (_) {
    return {};
  }
}

function swUrlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

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
            .filter((name) => name !== CACHE_NAME && name !== PUSH_META_CACHE)
            .map((cacheName) => caches.delete(cacheName))
        );
      } catch (_) {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event?.data;
  if (data && data.type === "SET_PUSH_CONTEXT") {
    event.waitUntil(
      savePushMeta({
        tenantId: data.tenantId || null,
        vapidPublicKey: data.vapidPublicKey || null,
      })
    );
  }
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
    nestedData.link ||
    nestedData.targetUrl ||
    data.url ||
    data.link ||
    data.targetUrl ||
    (tenantSlug ? `/loja/${tenantSlug}` : "/");

  if (
    productId &&
    targetUrl &&
    !String(targetUrl).includes("produto=") &&
    !String(targetUrl).includes("product=") &&
    !String(targetUrl).includes("oferta=")
  ) {
    const sep = String(targetUrl).includes("?") ? "&" : "?";
    targetUrl = `${targetUrl}${sep}produto=${encodeURIComponent(productId)}`;
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
      link: targetUrl,
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
    Promise.all([
      tenantId ? savePushMeta({ tenantId }) : Promise.resolve(),
      self.registration.showNotification(
        data.title || "🔥 Oferta Especial!",
        options
      ),
    ])
  );
});

self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    (async () => {
      try {
        const meta = await loadPushMeta();
        let tenantId = meta.tenantId || null;
        let applicationServerKey =
          event.oldSubscription?.options?.applicationServerKey || null;

        // Busca a chave VAPID pública atual do servidor para garantir alinhamento
        try {
          const query = tenantId
            ? `?tenantId=${encodeURIComponent(tenantId)}`
            : "";
          const keyRes = await fetch(`/api/v1/push/vapid-public-key${query}`, {
            headers: { Accept: "application/json" },
          });
          if (keyRes.ok) {
            const keyData = await keyRes.json();
            if (keyData?.publicKey) {
              applicationServerKey = swUrlBase64ToUint8Array(keyData.publicKey);
              await savePushMeta({
                tenantId,
                vapidPublicKey: keyData.publicKey,
              });
            }
          }
        } catch (_) {}

        if (!applicationServerKey && meta.vapidPublicKey) {
          applicationServerKey = swUrlBase64ToUint8Array(meta.vapidPublicKey);
        }

        let renewedSub = event.newSubscription || null;
        if (!renewedSub && applicationServerKey) {
          renewedSub = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        }
        if (!renewedSub) return;

        const subJson = renewedSub.toJSON();
        const oldEndpoint = event.oldSubscription?.endpoint || null;

        await fetch("/api/v1/push/subscribe", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            tenantId: tenantId || undefined,
            oldEndpoint,
            subscription: subJson,
            userAgent: "FarmaFlow-SW-AutoRenew",
          }),
        });
      } catch (_) {
        // Silencioso: a vitrine também revalida na próxima abertura
      }
    })()
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const rawUrl =
    (typeof notificationData === "string"
      ? notificationData
      : notificationData.url ||
        notificationData.link ||
        notificationData.targetUrl) || "/";
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
    !resolvedUrlObj.searchParams.has("produto") &&
    !resolvedUrlObj.searchParams.has("product") &&
    !resolvedUrlObj.searchParams.has("oferta")
  ) {
    resolvedUrlObj.searchParams.set("produto", String(productId));
  }
  const targetUrl = resolvedUrlObj.href;

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const existingClient = windowClients.find(
        (c) =>
          c.url &&
          c.url.startsWith(self.location.origin) &&
          !c.url.includes("/admin")
      );

      if (existingClient) {
        let navigatedClient = existingClient;
        let didNavigate = false;
        let sameStorePath = false;
        try {
          sameStorePath =
            new URL(existingClient.url).pathname === resolvedUrlObj.pathname;
        } catch (_) {}

        if (typeof existingClient.navigate === "function") {
          try {
            const resClient = await existingClient.navigate(targetUrl);
            if (resClient) navigatedClient = resClient;
            didNavigate = true;
          } catch (_) {}
        }

        const msgPayload = {
          type: "NOTIFICATION_CLICK",
          url: targetUrl,
          productId: productId,
          tenantSlug: tenantSlug,
        };

        try {
          navigatedClient.postMessage(msgPayload);
          navigatedClient.postMessage({
            ...msgPayload,
            type: "PUSH_NOTIFICATION_CLICK",
          });
        } catch (_) {}

        setTimeout(() => {
          try {
            navigatedClient.postMessage(msgPayload);
          } catch (_) {}
        }, 500);

        if (!didNavigate && !sameStorePath && self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
          return;
        }

        if (typeof navigatedClient.focus === "function") {
          try {
            await navigatedClient.focus();
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
