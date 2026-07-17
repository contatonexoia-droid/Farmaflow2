import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

export const PWAInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const dismissed = localStorage.getItem("pwa_prompt_dismissed");
      if (!dismissed) {
          setShowPrompt(true);
      }
    };

    // Listen to our custom event fired from index.html early script
    const handleCustomPromptReady = () => {
       if ((window as any).deferredPWAInstallPrompt) {
          setDeferredPrompt((window as any).deferredPWAInstallPrompt);
          const dismissed = localStorage.getItem("pwa_prompt_dismissed");
          if (!dismissed) {
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
    if (!deferredPrompt) return;
    
    // Hide our user interface that shows our A2HS button
    setShowPrompt(false);
    
    // Show the install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
  };
  
  const handleDismiss = () => {
      setShowPrompt(false);
      localStorage.setItem("pwa_prompt_dismissed", "true");
  };

  if (!showPrompt) return null;

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
