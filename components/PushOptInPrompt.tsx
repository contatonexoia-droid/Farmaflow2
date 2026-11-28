import React, { useState } from 'react';
import { Bell, X, Loader2, CheckCircle2, Share, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { requestAndSubscribePush } from '../lib/webPushClient';
import {
  clearPushPromptCooldown,
  isEmbeddedWebView,
  isIosSafariNonStandalone,
} from '../lib/pushEnvironment';

export type PushOptInContextType =
  | 'storefront'
  | 'cart'
  | 'order_complete'
  | 'promo_product'
  | 'restock_product';

interface PushOptInPromptProps {
  tenantId: string;
  tenantName: string;
  primaryColor?: string;
  context: PushOptInContextType;
  variant?: 'floating' | 'inline';
  customerPhone?: string;
  customerName?: string;
  productName?: string;
  onClose: (dismissedByUser?: boolean) => void;
  onSubscribed?: () => void;
}

export const PushOptInPrompt: React.FC<PushOptInPromptProps> = ({
  tenantId,
  tenantName,
  primaryColor,
  context,
  variant = 'floating',
  customerPhone,
  customerName,
  productName,
  onClose,
  onSubscribed,
}) => {
  const [isActivating, setIsActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const isIosGuide = isIosSafariNonStandalone();
  const isWebView = isEmbeddedWebView();
  const storeName = (tenantName || 'farmácia').trim();

  const handleActivate = async () => {
    if (isActivating || activated) return;
    setIsActivating(true);
    try {
      const res = await requestAndSubscribePush(tenantId, {
        customerPhone,
        customerName,
      });
      if (res.permission === 'granted' && res.ok) {
        setActivated(true);
        clearPushPromptCooldown(tenantId);
        toast.success('Alertas ativados! Você receberá ofertas relâmpago e avisos da entrega.');
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

  let title = 'Ative alertas de Ofertas Relâmpago e entrega';
  let subtitle = `Saiba primeiro quando tiver desconto na ${storeName} e receba aviso quando seu pedido sair para entrega.`;
  let ctaLabel = '🔔 Ativar alertas';

  if (context === 'order_complete') {
    title = 'Quer ser avisado quando seu motoboy sair?';
    subtitle = `Ative os alertas no seu celular para acompanhar cada etapa da sua entrega em tempo real e receber ofertas exclusivas da ${storeName}.`;
    ctaLabel = '🔔 Sim, avisar sobre minha entrega';
  } else if (context === 'promo_product') {
    title = '⚡ Não perca novas Ofertas Relâmpago!';
    subtitle = productName
      ? `Ative os alertas da ${storeName} para saber primeiro quando ${productName} e outros destaques entrarem em oferta.`
      : `Ative os alertas da ${storeName} para saber primeiro quando houver Ofertas Relâmpago e cupons.`;
    ctaLabel = '🔔 Receber ofertas relâmpago';
  } else if (context === 'restock_product') {
    title = '🔔 Avise-me quando voltar ao estoque!';
    subtitle = `Ative os alertas da ${storeName} para receber aviso de reposição, novidades e ofertas exclusivas no celular.`;
    ctaLabel = '🔔 Ativar aviso no celular';
  }

  const cardBody = isIosGuide ? (
    <div className="flex items-start gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
        style={{ backgroundColor: primaryColor || '#059669' }}
      >
        <Bell size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-gray-900 leading-snug">
            Receba alertas da entrega e ofertas no iPhone
          </p>
          <button
            type="button"
            onClick={() => onClose(true)}
            className="p-1 -mr-1 -mt-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors shrink-0 cursor-pointer"
            aria-label="Fechar convite"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1 leading-relaxed">
          No iPhone, toque em{' '}
          <span className="inline-flex items-center gap-1 font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">
            Compartilhar <Share size={11} className="text-blue-600" />
          </span>{' '}
          e depois em <strong className="text-gray-900">Adicionar à Tela de Início</strong> para
          receber alertas da entrega e ofertas.
        </p>
        <div className="mt-2.5 flex justify-end">
          <button
            type="button"
            onClick={() => onClose(true)}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-white cursor-pointer"
            style={{ backgroundColor: primaryColor || '#059669' }}
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  ) : isWebView ? (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white shrink-0">
        <MessageSquare size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-bold text-gray-900 leading-snug">
            Receba avisos e ofertas pelo WhatsApp
          </p>
          <button
            type="button"
            onClick={() => onClose(true)}
            className="p-1 -mr-1 -mt-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors shrink-0 cursor-pointer"
            aria-label="Fechar convite"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1 leading-relaxed">
          Para ativar notificações push no celular, abra esta página no navegador padrão (Chrome ou
          Safari) — ou acompanhe seu pedido direto pelo WhatsApp da {storeName}.
        </p>
      </div>
    </div>
  ) : (
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
            className="p-1 -mr-1 -mt-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors shrink-0 cursor-pointer"
            aria-label="Fechar convite"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1 leading-relaxed">
          {activated
            ? 'Tudo certo! Você receberá ofertas relâmpago e atualizações do seu pedido.'
            : subtitle}
        </p>

        {!activated && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleActivate}
              disabled={isActivating}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-95 disabled:opacity-60 whitespace-nowrap cursor-pointer"
              style={{ backgroundColor: primaryColor || '#059669' }}
            >
              {isActivating ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Ativando...
                </>
              ) : (
                ctaLabel
              )}
            </button>
            <button
              type="button"
              onClick={() => onClose(true)}
              className="px-3 py-2 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors whitespace-nowrap cursor-pointer"
            >
              Agora não
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (variant === 'inline') {
    return (
      <div
        role="region"
        aria-label="Convite para ativar notificações"
        className="bg-emerald-50/70 rounded-2xl border border-emerald-200/80 p-3.5 sm:p-4 animate-in fade-in duration-200"
      >
        {cardBody}
      </div>
    );
  }

  // Posicionamento flutuante acima do botão flutuante do carrinho (#floating-cart-btn z-[100] bottom-6)
  // e acima do botão de avaliação (bottom-6 left-6), evitando sobreposição em qualquer tela.
  const floatingPositionClass =
    context === 'cart'
      ? 'fixed bottom-6 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-sm z-[115]'
      : 'fixed bottom-28 left-3 right-3 sm:left-auto sm:right-6 sm:max-w-sm z-[115]';

  return (
    <div
      role="region"
      aria-label="Convite para ativar notificações"
      className={`${floatingPositionClass} animate-in slide-in-from-bottom-3 fade-in duration-200 pointer-events-auto`}
    >
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-4">
        {cardBody}
      </div>
    </div>
  );
};
