import React, { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  MessageSquare,
  Package,
  RefreshCw,
  Share,
  ShoppingBag,
  Store,
  Truck,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { requestAndSubscribePush } from '../lib/webPushClient';
import {
  RecentTrackedOrder,
  getNotificationPermissionSafe,
  isEmbeddedWebView,
  isIosSafariNonStandalone,
  isNativePushApiAvailable,
} from '../lib/pushEnvironment';

interface OrderConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: RecentTrackedOrder | null;
  tenantName: string;
  tenantWhatsapp?: string;
  primaryColor?: string;
  onSubscribed?: () => void;
}

const normalizeStatusKey = (rawStatus?: string): 'pending' | 'confirmed' | 'dispatched' | 'cancelled' => {
  const s = String(rawStatus || 'pending').toLowerCase().trim();
  if (s === 'cancelled' || s === 'cancelado') return 'cancelled';
  if (s === 'dispatched' || s === 'concluido' || s === 'concluido_no_pdv') return 'dispatched';
  if (s === 'confirmed' || s === 'enviado_ao_pdv' || s === 'impresso_no_pdv' || s === 'pago') {
    return 'confirmed';
  }
  return 'pending';
};

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  isOpen,
  onClose,
  order,
  tenantName,
  tenantWhatsapp,
  primaryColor = '#059669',
  onSubscribed,
}) => {
  const [liveStatus, setLiveStatus] = useState<string>(order?.status || 'pending');
  const [liveDeliveryMode, setLiveDeliveryMode] = useState<'delivery' | 'pickup'>(
    order?.deliveryMode || 'delivery',
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [isActivatingPush, setIsActivatingPush] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);

  const storeDisplayName = (tenantName || 'farmácia').trim();

  useEffect(() => {
    if (!order) return;
    setLiveStatus(order.status || 'pending');
    setLiveDeliveryMode(order.deliveryMode === 'pickup' ? 'pickup' : 'delivery');
  }, [order?.id, order?.status, order?.deliveryMode]);

  useEffect(() => {
    if (!isOpen || !order?.tenantId || typeof window === 'undefined') return;
    try {
      const localFlag =
        localStorage.getItem(`push_subscribed_${order.tenantId}`) === 'true' ||
        localStorage.getItem(`ff_push_subscribed_${order.tenantId}`) === 'true';
      setPushSubscribed(localFlag && getNotificationPermissionSafe() === 'granted');
    } catch {
      setPushSubscribed(false);
    }

    const handleSubscribedEvent = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (!detail?.tenantId || detail.tenantId === order.tenantId) {
        setPushSubscribed(true);
      }
    };
    window.addEventListener('ff_push_subscribed', handleSubscribedEvent);
    return () => window.removeEventListener('ff_push_subscribed', handleSubscribedEvent);
  }, [isOpen, order?.tenantId]);

  const fetchLatestOrderStatus = useCallback(
    async (manual = false) => {
      if (!order?.tenantId || !order?.id) return;
      if (manual) setIsRefreshing(true);
      try {
        const res = await fetch(
          `/api/v1/store/${encodeURIComponent(order.tenantId)}/orders/${encodeURIComponent(order.id)}/status`,
          { headers: { Accept: 'application/json' } },
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.order) {
            setLiveStatus(String(data.order.status || 'pending'));
            setLiveDeliveryMode(data.order.deliveryMode === 'pickup' ? 'pickup' : 'delivery');
            setLastUpdatedAt(new Date());
          }
        }
      } catch {
        // Silencioso em polling
      } finally {
        if (manual) setIsRefreshing(false);
      }
    },
    [order?.tenantId, order?.id],
  );

  useEffect(() => {
    if (!isOpen || !order?.id) return;
    void fetchLatestOrderStatus(false);
    const interval = setInterval(() => {
      void fetchLatestOrderStatus(false);
    }, 15000);
    return () => clearInterval(interval);
  }, [isOpen, order?.id, fetchLatestOrderStatus]);

  if (!isOpen || !order) return null;

  const permission = getNotificationPermissionSafe();
  const isIosGuide = isIosSafariNonStandalone();
  const isWebView = isEmbeddedWebView();
  const nativePushReady = isNativePushApiAvailable();
  const shouldShowPushCard =
    !pushSubscribed &&
    permission !== 'denied' &&
    (isIosGuide || isWebView || nativePushReady);

  const handleActivateDeliveryAlerts = async () => {
    if (isActivatingPush || pushSubscribed) return;
    setIsActivatingPush(true);
    try {
      const res = await requestAndSubscribePush(order.tenantId, {
        customerPhone: order.customerPhone,
        customerName: order.customerName,
      });
      if (res.ok && res.permission === 'granted') {
        setPushSubscribed(true);
        toast.success('Alertas da entrega ativados! Avisaremos assim que sair.');
        onSubscribed?.();
      } else if (res.permission === 'denied') {
        toast.info('Notificações bloqueadas no navegador. Acompanhe aqui ou pelo WhatsApp.');
      } else if (res.reason === 'ios_requires_standalone') {
        toast.info('Adicione a loja à Tela de Início para ativar alertas no iPhone.');
      } else if (res.reason === 'embedded_webview') {
        toast.info('Abra no Chrome ou Safari para receber notificações push.');
      } else {
        toast.info('Não foi possível ativar agora, você pode acompanhar o status abaixo.');
      }
    } catch {
      toast.error('Erro ao ativar alertas. Você pode acompanhar seu pedido aqui mesmo.');
    } finally {
      setIsActivatingPush(false);
    }
  };

  const statusKey = normalizeStatusKey(liveStatus);
  const isPickup = liveDeliveryMode === 'pickup';

  const whatsappHref =
    order.whatsappUrl ||
    (tenantWhatsapp
      ? `https://wa.me/55${String(tenantWhatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(
          `Olá! Gostaria de acompanhar meu pedido #${order.id}.`,
        )}`
      : '');

  const steps = [
    {
      id: 'pending',
      label: 'Pedido Recebido',
      desc: 'Seu pedido já foi registrado na farmácia.',
      icon: ShoppingBag,
      done: statusKey === 'pending' || statusKey === 'confirmed' || statusKey === 'dispatched',
      active: statusKey === 'pending',
    },
    {
      id: 'confirmed',
      label: 'Confirmado & Separando',
      desc: 'Nossa equipe está separando e conferindo seus itens.',
      icon: Package,
      done: statusKey === 'confirmed' || statusKey === 'dispatched',
      active: statusKey === 'confirmed',
    },
    {
      id: 'dispatched',
      label: isPickup ? 'Pronto para Retirada' : 'Saiu com o Motoboy',
      desc: isPickup
        ? 'Já pode retirar seu pedido no balcão da loja!'
        : 'Seu pedido está a caminho do seu endereço!',
      icon: isPickup ? Store : Truck,
      done: statusKey === 'dispatched',
      active: statusKey === 'dispatched',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Acompanhar Pedido"
    >
      <div className="bg-white w-full sm:max-w-lg rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl max-h-[92vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-300">
        {/* Cabeçalho de Sucesso */}
        <div
          className="px-6 pt-6 pb-5 text-white relative rounded-t-[2rem]"
          style={{
            background: `linear-gradient(135deg, ${primaryColor}, #047857)`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar acompanhamento"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
          >
            <X size={20} />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <CheckCircle2 size={26} className="text-white" />
            </div>
            <div>
              <span className="inline-block text-[10px] font-black uppercase tracking-widest bg-white/20 px-2.5 py-0.5 rounded-full mb-1">
                Pedido #{order.id}
              </span>
              <h2 className="text-lg sm:text-xl font-black leading-tight">
                Pedido enviado com sucesso!
              </h2>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Bloco Principal Pós-Pedido (ignora cooldown da vitrine) */}
          {shouldShowPushCard && (
            <div className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-amber-50/40 p-4 sm:p-5 shadow-sm">
              {isIosGuide ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <Bell size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm sm:text-base font-black text-gray-900 leading-snug">
                        Quer ser avisado quando seu motoboy sair?
                      </h3>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        No iPhone, toque em{' '}
                        <span className="inline-flex items-center gap-1 font-bold text-gray-900 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                          Compartilhar <Share size={12} className="text-blue-600" />
                        </span>{' '}
                        e depois em{' '}
                        <strong className="text-gray-900">Adicionar à Tela de Início</strong> para
                        receber alertas da entrega e ofertas.
                      </p>
                    </div>
                  </div>
                </div>
              ) : isWebView ? (
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <MessageSquare size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-gray-900">
                      Acompanhamento garantido no WhatsApp
                    </h3>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                      Como você abriu a loja dentro de um aplicativo, enviaremos as atualizações da
                      entrega pelo WhatsApp da {storeDisplayName} (e você também pode acompanhar
                      abaixo).
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm"
                      style={{ backgroundColor: primaryColor }}
                    >
                      <Bell size={20} className="animate-bounce" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-black text-gray-900 leading-snug">
                        Quer ser avisado quando seu motoboy sair?
                      </h3>
                      <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                        Ative os alertas no seu celular para acompanhar cada etapa da sua entrega em
                        tempo real e receber ofertas exclusivas da {storeDisplayName}.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleActivateDeliveryAlerts}
                    disabled={isActivatingPush}
                    className="w-full py-3.5 px-4 rounded-xl font-black text-sm text-white shadow-md hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {isActivatingPush ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Ativando alertas da entrega...
                      </>
                    ) : (
                      '🔔 Sim, avisar sobre minha entrega'
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {pushSubscribed && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 flex items-center gap-3 text-emerald-900">
              <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
              <div className="text-xs">
                <p className="font-black">Alertas ativados neste celular!</p>
                <p className="text-emerald-700">
                  Você receberá uma notificação assim que seu pedido sair para entrega.
                </p>
              </div>
            </div>
          )}

          {/* Acompanhamento em Tempo Real */}
          <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-emerald-600" />
                <h4 className="text-xs font-black uppercase tracking-wider text-gray-700">
                  Acompanhe sua entrega em tempo real
                </h4>
              </div>
              <button
                type="button"
                onClick={() => fetchLatestOrderStatus(true)}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-500 hover:text-gray-900 px-2 py-1 rounded-lg bg-white border border-gray-200 transition-colors cursor-pointer"
              >
                <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                Atualizar
              </button>
            </div>

            {statusKey === 'cancelled' ? (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-center gap-3 text-red-800">
                <XCircle size={20} className="text-red-500 shrink-0" />
                <div className="text-xs">
                  <p className="font-black">Pedido Cancelado</p>
                  <p>Em caso de dúvidas, fale com a farmácia pelo WhatsApp.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {steps.map((step, idx) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.id} className="flex items-start gap-3 relative">
                      {idx < steps.length - 1 && (
                        <div
                          className={`absolute left-[15px] top-8 bottom-[-12px] w-0.5 ${
                            step.done ? 'bg-emerald-400' : 'bg-gray-200'
                          }`}
                        />
                      )}
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 border-2 transition-colors ${
                          step.done
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-white border-gray-300 text-gray-400'
                        } ${step.active ? 'ring-4 ring-emerald-100' : ''}`}
                      >
                        <Icon size={14} />
                      </div>
                      <div className="pt-0.5 pb-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p
                            className={`text-xs font-black ${
                              step.done ? 'text-gray-900' : 'text-gray-400'
                            }`}
                          >
                            {step.label}
                          </p>
                          {step.active && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                              <Clock size={10} /> Etapa atual
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">{step.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-2 border-t border-gray-200 flex items-center justify-between text-[11px] text-gray-500">
              <span>
                Total do pedido:{' '}
                <strong className="text-gray-900">
                  R$ {Number(order.total || 0).toFixed(2).replace('.', ',')}
                </strong>
              </span>
              {lastUpdatedAt && (
                <span>
                  Atualizado às{' '}
                  {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>

          {/* Ações */}
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 py-3 px-4 rounded-xl font-bold text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 flex items-center justify-center gap-2 transition-colors"
              >
                <MessageSquare size={15} />
                Abrir pedido no WhatsApp
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl font-bold text-xs text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
            >
              Continuar na Loja
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
