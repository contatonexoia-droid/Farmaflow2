import React, { useState, useEffect } from 'react';
import { Download, X, Smartphone, Share } from 'lucide-react';

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isQrHighlightMode, setIsQrHighlightMode] = useState(false);
  const [showManualFallbackHint, setShowManualFallbackHint] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQrApp = params.get('baixar') === 'app';

    if (fromQrApp) {
      localStorage.removeItem("pwa_prompt_dismissed");
      setIsQrHighlightMode(true);
      setShowPrompt(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const dismissed = localStorage.getItem("pwa_prompt_dismissed");
      if (!dismissed || fromQrApp) {
          setShowPrompt(true);
      }
    };

    // Listen to our custom event fired from index.html early script
    const handleCustomPromptReady = () => {
       if ((window as any).deferredPWAInstallPrompt) {
          setDeferredPrompt((window as any).deferredPWAInstallPrompt);
          const dismissed = localStorage.getItem("pwa_prompt_dismissed");
          if (!dismissed || fromQrApp) {
              setShowPrompt(true);
          }
       }
    };

    // Check if it already fired before this component mounted
    if ((window as any).deferredPWAInstallPrompt) {
        handleCustomPromptReady();
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-prompt-ready', handleCustomPromptReady);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-prompt-ready', handleCustomPromptReady);
    };
  }, []);

  const handleInstallClick = async () => {
    const promptEvent = deferredPrompt || (window as any).deferredPWAInstallPrompt;
    if (!promptEvent) {
      if (isQrHighlightMode) {
        setShowManualFallbackHint(true);
      }
      return;
    }
    
    // Hide our user interface that shows our A2HS button
    setShowPrompt(false);
    setIsQrHighlightMode(false);
    
    // Show the install prompt
    promptEvent.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await promptEvent.userChoice;
    
    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
  };
  
  const handleDismiss = () => {
      setShowPrompt(false);
      setIsQrHighlightMode(false);
      setShowManualFallbackHint(false);
      localStorage.setItem("pwa_prompt_dismissed", "true");
  };

  if (!showPrompt) return null;

  if (isQrHighlightMode) {
    return (
      <div className="fixed inset-0 z-[180] bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-300">
        <div className="bg-white rounded-3xl shadow-2xl border border-emerald-100 p-6 max-w-md w-full relative animate-in zoom-in-95 duration-300">
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 w-9 h-9 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-full flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>

          <div className="flex flex-col items-center text-center space-y-4 pt-2">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-sm border border-emerald-100">
              <Smartphone size={32} />
            </div>

            <div className="space-y-1.5">
              <span className="inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-800">
                Aplicativo Oficial
              </span>
              <h3 className="text-xl font-black text-gray-900 leading-tight">
                Baixe Nosso Aplicativo!
              </h3>
              <p className="text-xs sm:text-sm font-medium text-gray-500 leading-relaxed">
                Instale nossa drogaria na tela inicial do seu celular para fazer pedidos com muito mais rapidez.
              </p>
            </div>

            {showManualFallbackHint && !deferredPrompt && (
              <div className="w-full bg-blue-50 border border-blue-100 rounded-2xl p-3.5 text-left text-xs text-blue-900 space-y-1.5">
                <p className="font-black flex items-center gap-1.5">
                  <Share size={14} className="text-blue-600 shrink-0" />
                  Como adicionar no seu aparelho:
                </p>
                <p className="text-blue-800 leading-relaxed">
                  Toque no menu do navegador (<strong>⋮</strong> ou botão <strong>Compartilhar</strong> no iPhone) e selecione <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à Tela de Início"</strong>.
                </p>
              </div>
            )}

            <button
              onClick={handleInstallClick}
              className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-base rounded-2xl shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2.5 transition-all active:scale-95 cursor-pointer"
            >
              <Download size={20} />
              <span>Instalar Aplicativo Agora</span>
            </button>

            <button
              onClick={handleDismiss}
              className="text-xs font-bold text-gray-400 hover:text-gray-600 py-1 cursor-pointer"
            >
              Continuar navegando no catálogo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[150] p-4 animate-in slide-in-from-bottom duration-500">
        <div className="bg-white rounded-3xl shadow-[0_15px_50px_-10px_rgba(0,0,0,0.25)] border border-gray-100 p-4 pr-6 max-w-md mx-auto flex items-center justify-between gap-4 relative">
            {/* Circular Close Button on Top Right Edge */}
            <button 
                onClick={handleDismiss}
                className="absolute -top-2.5 -right-2.5 w-9 h-9 bg-white border border-gray-200 text-gray-400 hover:text-gray-600 rounded-full shadow-md hover:shadow-lg transition-all z-20 touch-manipulation hover:bg-gray-50 flex items-center justify-center cursor-pointer"
                aria-label="Fechar"
            >
                <X size={18} className="stroke-[2.5]" />
            </button>

            <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center shrink-0">
                    <Download size={24} />
                </div>
                <div>
                    <h4 className="font-black text-gray-900 leading-tight">Instale o App</h4>
                    <p className="text-xs font-medium text-gray-500 mt-0.5">Acesso rápido e fácil na sua tela inicial.</p>
                </div>
            </div>
            
            <div className="flex items-center shrink-0">
                <button 
                    onClick={handleInstallClick}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
                >
                    Instalar
                </button>
            </div>
        </div>
    </div>
  );
};

