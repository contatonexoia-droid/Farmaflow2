
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

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <App />
);

// Atualização e limpeza de cache/Service Worker 100% em background após o mount inicial (nunca bloqueia o first render no PWA standalone)
if (typeof window !== 'undefined') {
  const runBackgroundSwMaintenance = () => {
    void (async () => {
      try {
        const savedVersion = localStorage.getItem('farmaflow_build_version');
        if (savedVersion !== APP_BUILD_VERSION) {
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(
              keys
                .filter((key) => key !== 'farmaflow-v6')
                .map((key) => caches.delete(key))
            );
          }
          localStorage.setItem('farmaflow_build_version', APP_BUILD_VERSION);
        }
      } catch (_) {}

      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          void registration.update().catch(() => {});
        } catch (_) {}
      }
    })();
  };

  if (document.readyState === 'complete') {
    setTimeout(runBackgroundSwMaintenance, 300);
  } else {
    window.addEventListener('load', () => {
      setTimeout(runBackgroundSwMaintenance, 300);
    }, { once: true });
  }
}

