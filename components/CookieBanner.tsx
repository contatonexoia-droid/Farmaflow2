import React, { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';

export const CookieBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);

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
    <>
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
            Utilizamos cookies para garantir melhor navegação, analisar o uso do site e personalizar ofertas. Para saber mais, consulte nossa <button onClick={() => setIsPolicyOpen(true)} className="text-emerald-600 hover:underline font-medium">Política de Privacidade (LGPD)</button>.
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

      {isPolicyOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Política de Privacidade</h2>
              <button
                onClick={() => setIsPolicyOpen(false)}
                className="text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 p-2 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="prose prose-sm text-gray-600 space-y-4">
                <p>
                  <strong>1. Coleta de Dados</strong><br />
                  Coletamos informações estritamente necessárias para o processamento de seus pedidos, como nome, endereço, e-mail e telefone de contato, além de dados de navegação por meio de cookies.
                </p>
                <p>
                  <strong>2. Uso das Informações</strong><br />
                  Seus dados são utilizados exclusivamente para:
                  <ul className="list-disc pl-5 mt-2 space-y-1">
                    <li>Processar e entregar seus pedidos.</li>
                    <li>Fornecer suporte e atendimento ao cliente.</li>
                    <li>Melhorar sua experiência de navegação e personalizar ofertas (quando autorizado).</li>
                  </ul>
                </p>
                <p>
                  <strong>3. Compartilhamento de Dados</strong><br />
                  A farmácia não vende, aluga ou compartilha seus dados pessoais com terceiros para fins de marketing. O compartilhamento ocorre apenas com parceiros logísticos e de pagamento essenciais para a conclusão da sua compra.
                </p>
                <p>
                  <strong>4. Proteção e Segurança</strong><br />
                  Adotamos medidas de segurança técnicas e organizacionais para proteger seus dados contra acesso não autorizado, alteração, divulgação ou destruição.
                </p>
                <p>
                  <strong>5. Seus Direitos (LGPD)</strong><br />
                  De acordo com a Lei Geral de Proteção de Dados, você tem o direito de solicitar o acesso, correção, atualização ou exclusão de suas informações pessoais a qualquer momento, entrando em contato através de nossos canais oficiais de atendimento.
                </p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setIsPolicyOpen(false)}
                className="px-6 py-2.5 font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-xl transition-colors"
              >
                Entendi e Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
