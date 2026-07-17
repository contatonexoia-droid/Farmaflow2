
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <App />
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const path = window.location.pathname;
    const lojaMatch = path.match(/^\/loja\/([^/]+)/);
    const urlTenantSlug = lojaMatch ? lojaMatch[1] : null;
    const swScope = urlTenantSlug ? `/loja/${urlTenantSlug}/` : "/";

    navigator.serviceWorker.register('/sw.js', { scope: swScope }).then((registration) => {
      console.log('SW registered with scope:', registration.scope);
      
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', async () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Limpar todos os caches antigos ao detectar uma nova aba de tenant ou update
              if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
              }
              // Força a recarga para aplicar as novas regras e flush de cache (impede bug de tela do Android sumir)
              window.location.reload();
            }
          });
        }
      });
    }).catch((registrationError) => {
      console.log('SW registration failed: ', registrationError);
    });
    
    // Assegura controle rápido em reloads
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}
