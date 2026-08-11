import React, { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';

export const CookieBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('farmaflow_cookie_consent');
    if (!consent) {
      // Delay slightly for better UX (doesn't pop up instantly on fast load)
      const timer = setTimeout(() => setIsVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    setIsClosing(true);
    setTimeout(() => {
      localStorage.setItem('farmaflow_cookie_consent', 'accepted');
      setIsVisible(false);
    }, 300); // Wait for fade-out animation
  };

  const handleDecline = () => {
    setIsClosing(true);
    setTimeout(() => {
      localStorage.setItem('farmaflow_cookie_consent', 'declined');
      setIsVisible(false);
    }, 300);
  };

  if (!isVisible) return null;

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-[100] p-4 sm:p-6 sm:max-w-[420px] sm:left-auto sm:right-6 sm:bottom-6 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'opacity-100'}`}>
      <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 p-5 flex flex-col gap-4 transform transition-transform duration-500 translate-y-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-600">
              <Cookie className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-gray-900">Sua privacidade importa</h3>
          </div>
          <button 
            onClick={handleDecline} 
            className="text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 p-1.5 rounded-full transition-colors"
            aria-label="Fechar e recusar cookies"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <p className="text-sm text-gray-600 leading-relaxed">
          Utilizamos cookies para garantir melhor navegação, analisar o uso do site e personalizar ofertas. Para saber mais, consulte nossa <a href="#" className="text-emerald-600 hover:underline font-medium">Política de Privacidade (LGPD)</a>.
        </p>
        
        <div className="flex items-center gap-3 w-full mt-1">
          <button
            onClick={handleDecline}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
          >
            Recusar
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm shadow-emerald-200"
          >
            Aceitar Todos
          </button>
        </div>
      </div>
    </div>
  );
};
