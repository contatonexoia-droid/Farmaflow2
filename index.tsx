
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Build version hash to force cache invalidation across all subdomains and main domain
const APP_BUILD_VERSION = "ff_v2026_08_07_build4";

// Prevenção de quebra por erros de rede transitórios em background ("Failed to fetch")
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason?.message || String(reason || '');
    if (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('Load failed') ||
      msg.includes('aborted')
    ) {
      console.warn('[FarmaFlow] Non-fatal background network rejection intercepted:', msg);
      event.preventDefault();
    }
  });
}

// CACHE BUSTING & SW CLEANUP EXECUTION
(async function purgeStaleCacheAndSW() {
  try {
    const savedVersion = localStorage.getItem('farmaflow_build_version');
    if (savedVersion !== APP_BUILD_VERSION) {
      console.log(`[Cache Busting] New build detected (${APP_BUILD_VERSION}). Purging stale caches and unregistering old Service Workers...`);

      // 1. Unregister all existing Service Workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
          console.log('[Cache Busting] Unregistered SW:', registration.scope);
        }
      }

      // 2. Clear CacheStorage
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
        console.log('[Cache Busting] Cleared CacheStorage keys:', keys);
      }

      // 3. Save new version tag
      localStorage.setItem('farmaflow_build_version', APP_BUILD_VERSION);

      // 4. Force hard reload if an old version was cached
      if (savedVersion) {
        window.location.reload();
      }
    }
  } catch (err) {
    console.warn('[Cache Busting] Non-blocking cache cleanup warning:', err);
  }
})();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <App />
);

if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
  window.addEventListener('load', () => {
    const path = window.location.pathname;
    const lojaMatch = path.match(/^\/loja\/([^/]+)/);
    const urlTenantSlug = lojaMatch ? lojaMatch[1] : null;
    const swScope = urlTenantSlug ? `/loja/${urlTenantSlug}/` : "/";

    navigator.serviceWorker.register('/sw.js', { scope: swScope }).then((registration) => {
      console.log('SW registered with scope:', registration.scope);
      // Non-blocking update check
      registration.update().catch(() => {});
      
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', async () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
              }
              window.location.reload();
            }
          });
        }
      });
    }).catch((registrationError) => {
      console.warn('SW registration info: ', registrationError);
    });
    
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}
