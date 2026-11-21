import React, { useState } from 'react';
import { Bell, X, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { requestAndSubscribePush } from '../lib/webPushClient';

interface PushOptInPromptProps {
  tenantId: string;
  tenantName: string;
  primaryColor?: string;
  context: 'cart' | 'order_complete';
  onClose: (dismissedByUser?: boolean) => void;
  onSubscribed?: () => void;
}

export const PushOptInPrompt: React.FC<PushOptInPromptProps> = ({
  tenantId,
  tenantName,
  primaryColor,
  context,
  onClose,
  onSubscribed,
}) => {
  const [isActivating, setIsActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const handleActivate = async () => {
    if (isActivating || activated) return;
    setIsActivating(true);
    try {
      const res = await requestAndSubscribePush(tenantId);
      if (res.permission === 'granted' && res.ok) {
        setActivated(true);
        toast.success('Alertas ativados! Você receberá ofertas e novidades da loja.');
        onSubscribed?.();
        setTimeout(() => onClose(false), 1200);
      } else if (res.permission === 'denied') {
        toast.info('As notificações estão bloqueadas nas configurações do navegador.');
        onClose(true);
      } else {
        onClose(true);
      }
    } catch {
      onClose(true);
    } finally {
      setIsActivating(false);
    }
  };

  const title =
    context === 'order_complete'
      ? 'Receba ofertas e avisos da entrega'
      : 'Ativar alertas de ofertas e entrega?';

  const subtitle =
    context === 'order_complete'
      ? `Ative as notificações da ${tenantName || 'farmácia'} para acompanhar promoções exclusivas e novidades do seu pedido.`
      : `Receba alertas de promoções da ${tenantName || 'farmácia'} e avisos sobre sua entrega, sem precisar instalar nada.`;

  return (
    <div
      role="region"
      aria-label="Convite para ativar notificações"
      className="fixed bottom-20 sm:bottom-5 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-sm z-[85] animate-in slide-in-from-bottom-3 fade-in duration-200 pointer-events-auto"
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-4">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{ backgroundColor: primaryColor || '#059669' }}
          >
            {activated ? <CheckCircle2 size={18} /> : <Bell size={18} />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-bold text-gray-900 leading-snug">
                {activated ? 'Alertas ativados!' : title}
              </p>
              <button
                type="button"
                onClick={() => onClose(true)}
                className="p-1 -mr-1 -mt-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors shrink-0"
                aria-label="Fechar convite"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              {activated
                ? 'Tudo certo! Você já está inscrito para receber ofertas e novidades.'
                : subtitle}
            </p>

            {!activated && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleActivate}
                  disabled={isActivating}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60 whitespace-nowrap"
                  style={{ backgroundColor: primaryColor || '#059669' }}
                >
                  {isActivating ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      Ativando...
                    </>
                  ) : (
                    'Ativar alertas'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onClose(true)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors whitespace-nowrap"
                >
                  Agora não
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
