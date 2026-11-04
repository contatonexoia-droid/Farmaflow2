import React, { useState, useEffect, useMemo } from 'react';
import { Product, PharmacyConfig } from '../types';
import { getStoreSlug } from '../lib/store';
import {
  Bell,
  X,
  Send,
  Smartphone,
  Sparkles,
  Search,
  Package,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
  Users,
  ExternalLink
} from 'lucide-react';

interface PushNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: PharmacyConfig;
  products: Product[];
  initialProduct?: Product | null;
  getProductDisplayImage?: (product: Product) => string | null;
}

const formatPriceBR = (value: number): string => {
  return Number(value || 0).toFixed(2).replace('.', ',');
};

const parseJsonResponse = async (response: Response) => {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    const rawText = await response.text().catch(() => '');
    throw new Error(
      response.status === 404
        ? 'Rota de notificações Push não encontrada no servidor (/api/v1/push).'
        : `Resposta inesperada do servidor (HTTP ${response.status}). Verifique se o servidor backend está atualizado.${
            rawText && !rawText.trim().startsWith('<') ? ` Detalhe: ${rawText.slice(0, 120)}` : ''
          }`
    );
  }
  return response.json();
};

export const buildDefaultPushText = (product: Product | null, storeName: string) => {
  const cleanStoreName = (storeName || 'Nossa Farmácia').trim();
  const defaultTitle = `🔥 Oferta Especial na ${cleanStoreName}!`;

  if (!product) {
    return {
      title: defaultTitle,
      body: `Confira nossas ofertas especiais no aplicativo da ${cleanStoreName}! Peça agora pelo celular.`
    };
  }

  const rawPrice = Number(product.price || 0);
  const rawPromo = Number((product as any).promotionalPrice || (product as any).promotional_price || 0);
  const rawOriginal = Number(product.originalPrice || (product as any).original_price || 0);

  let hasPromo = false;
  let fromPrice = rawPrice;
  let toPrice = rawPrice;

  if (rawPromo > 0 && rawPromo < rawPrice) {
    hasPromo = true;
    fromPrice = rawPrice;
    toPrice = rawPromo;
  } else if (rawOriginal > 0 && rawOriginal > rawPrice) {
    hasPromo = true;
    fromPrice = rawOriginal;
    toPrice = rawPrice;
  }

  const defaultBody = hasPromo
    ? `${product.name} de R$ ${formatPriceBR(fromPrice)} por apenas R$ ${formatPriceBR(toPrice)}! Aproveite antes que acabe.`
    : `${product.name} por apenas R$ ${formatPriceBR(toPrice)}! Peça agora pelo app.`;

  return {
    title: defaultTitle,
    body: defaultBody
  };
};

export const PushNotificationModal: React.FC<PushNotificationModalProps> = ({
  isOpen,
  onClose,
  tenant,
  products,
  initialProduct = null,
  getProductDisplayImage
}) => {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(initialProduct);
  const [productSearch, setProductSearch] = useState('');
  const [isSelectingProduct, setIsSelectingProduct] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{
    success: boolean;
    sentCount: number;
    failedCount: number;
    removedCount: number;
    totalSubscribers: number;
    error?: string;
  } | null>(null);

  const storeName = (tenant?.name || 'Nossa Farmácia').trim();
  const cleanSlug = useMemo(() => getStoreSlug(tenant), [tenant]);

  // Load subscriber count when modal opens
  useEffect(() => {
    if (!isOpen || !tenant?.id) return;
    setSendResult(null);
    setIsLoadingStats(true);
    fetch(`/api/v1/push/stats?tenantId=${encodeURIComponent(tenant.id)}`)
      .then((res) => parseJsonResponse(res))
      .then((data) => {
        if (typeof data?.subscriberCount === 'number') {
          setSubscriberCount(data.subscriberCount);
        } else {
          setSubscriberCount(0);
        }
      })
      .catch(() => {
        setSubscriberCount(0);
      })
      .finally(() => {
        setIsLoadingStats(false);
      });
  }, [isOpen, tenant?.id]);

  // Sync initialProduct when modal opens or changes
  useEffect(() => {
    if (!isOpen) return;
    setSelectedProduct(initialProduct || null);
    setIsSelectingProduct(!initialProduct);
    setProductSearch('');
    const defaults = buildDefaultPushText(initialProduct || null, storeName);
    setTitle(defaults.title);
    setBody(defaults.body);
  }, [isOpen, initialProduct, storeName]);

  const handleSelectProduct = (prod: Product) => {
    setSelectedProduct(prod);
    setIsSelectingProduct(false);
    setSendResult(null);
    const defaults = buildDefaultPushText(prod, storeName);
    setTitle(defaults.title);
    setBody(defaults.body);
  };

  const handleResetToDefault = () => {
    const defaults = buildDefaultPushText(selectedProduct, storeName);
    setTitle(defaults.title);
    setBody(defaults.body);
  };

  const filteredProducts = useMemo(() => {
    const list = (products || []).filter((p) => Number(p.stock ?? 1) > 0);
    if (!productSearch.trim()) {
      return list.slice(0, 30);
    }
    const q = productSearch.toLowerCase().trim();
    return list
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q) ||
          p.internalCode?.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [products, productSearch]);

  const resolvedProductImage = useMemo(() => {
    if (!selectedProduct) return '';
    if (getProductDisplayImage) {
      const customImg = getProductDisplayImage(selectedProduct);
      if (customImg) return customImg;
    }
    if (selectedProduct.image && !selectedProduct.image.includes('placeholder')) {
      return selectedProduct.image;
    }
    return '';
  }, [selectedProduct, getProductDisplayImage]);

  const targetUrl = useMemo(() => {
    const baseStorePath = cleanSlug ? `/loja/${cleanSlug}` : '/loja';
    if (selectedProduct?.id) {
      return `${baseStorePath}?product=${encodeURIComponent(selectedProduct.id)}`;
    }
    return baseStorePath;
  }, [cleanSlug, selectedProduct]);

  const handleSendPush = async () => {
    if (!tenant?.id) return;
    if (!title.trim() || !body.trim()) return;

    setIsSending(true);
    setSendResult(null);

    try {
      const response = await fetch('/api/v1/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          tenantId: tenant.id,
          productId: selectedProduct?.id || undefined,
          title: title.trim(),
          body: body.trim(),
          imageUrl: resolvedProductImage || undefined,
          iconUrl: tenant.logoUrl || undefined,
          targetUrl
        })
      });

      const data = await parseJsonResponse(response);
      if (!response.ok || data?.error) {
        setSendResult({
          success: false,
          sentCount: 0,
          failedCount: 0,
          removedCount: 0,
          totalSubscribers: subscriberCount || 0,
          error: data?.error || `Falha ao disparar notificação Web Push (HTTP ${response.status}).`
        });
      } else {
        setSendResult({
          success: true,
          sentCount: Number(data.sentCount || 0),
          failedCount: Number(data.failedCount || 0),
          removedCount: Number(data.removedCount || 0),
          totalSubscribers: Number(data.totalSubscribers || 0)
        });
        if (typeof data.totalSubscribers === 'number' && typeof data.removedCount === 'number') {
          setSubscriberCount(Math.max(0, data.totalSubscribers - data.removedCount));
        }
      }
    } catch (err: any) {
      setSendResult({
        success: false,
        sentCount: 0,
        failedCount: 0,
        removedCount: 0,
        totalSubscribers: subscriberCount || 0,
        error: err?.message || 'Erro de conexão com o servidor ao disparar push.'
      });
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-gray-100 overflow-hidden my-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-inner">
              <Bell size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-black tracking-tight flex items-center gap-2">
                🔔 Notificar Promoção no Celular (Web Push)
              </h2>
              <p className="text-xs text-white/90 font-medium">
                Dispare alertas instantâneos para os clientes com o aplicativo da <strong>{storeName}</strong> instalado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 bg-white/20 backdrop-blur-md px-3 py-1.5 rounded-xl text-xs font-bold">
              <Users size={14} />
              {isLoadingStats ? (
                <span>Carregando...</span>
              ) : (
                <span>
                  {subscriberCount ?? 0} {subscriberCount === 1 ? 'celular inscrito' : 'celulares inscritos'}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-colors"
              title="Fechar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-h-[82vh] overflow-y-auto">
          {/* Coluna Esquerda: Seleção do Produto e Edição da Mensagem */}
          <div className="lg:col-span-7 space-y-5">
            {/* Mobile subscriber badge */}
            <div className="flex sm:hidden items-center justify-between bg-amber-50 border border-amber-200 px-3.5 py-2.5 rounded-xl text-xs font-bold text-amber-900">
              <span className="flex items-center gap-1.5">
                <Users size={15} className="text-amber-600" />
                Dispositivos inscritos nesta loja:
              </span>
              <span className="bg-amber-600 text-white px-2.5 py-0.5 rounded-lg font-black">
                {isLoadingStats ? '...' : subscriberCount ?? 0}
              </span>
            </div>

            {/* Produto Selecionado */}
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-200/80">
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Package size={14} className="text-orange-500" />
                  1. Produto em Destaque na Notificação
                </label>
                {selectedProduct && !isSelectingProduct && (
                  <button
                    type="button"
                    onClick={() => setIsSelectingProduct(true)}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700 underline"
                  >
                    Trocar produto
                  </button>
                )}
              </div>

              {selectedProduct && !isSelectingProduct ? (
                <div className="flex items-center gap-3.5 bg-white p-3 rounded-xl border border-gray-200 shadow-xs">
                  <div className="w-14 h-14 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center p-1.5 shrink-0 overflow-hidden">
                    {resolvedProductImage ? (
                      <img
                        src={resolvedProductImage}
                        alt={selectedProduct.name}
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Package size={24} className="text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs md:text-sm font-black text-gray-900 truncate">
                      {selectedProduct.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {selectedProduct.originalPrice && selectedProduct.originalPrice > selectedProduct.price ? (
                        <>
                          <span className="text-xs text-gray-400 line-through font-semibold">
                            R$ {formatPriceBR(selectedProduct.originalPrice)}
                          </span>
                          <span className="text-sm font-black text-emerald-600">
                            Por R$ {formatPriceBR(selectedProduct.price)}
                          </span>
                        </>
                      ) : (selectedProduct as any).promotionalPrice &&
                        (selectedProduct as any).promotionalPrice > 0 &&
                        (selectedProduct as any).promotionalPrice < selectedProduct.price ? (
                        <>
                          <span className="text-xs text-gray-400 line-through font-semibold">
                            R$ {formatPriceBR(selectedProduct.price)}
                          </span>
                          <span className="text-sm font-black text-emerald-600">
                            Por R$ {formatPriceBR((selectedProduct as any).promotionalPrice)}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm font-black text-gray-900">
                          R$ {formatPriceBR(selectedProduct.price)}
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 ml-auto">
                        Estoque: {selectedProduct.stock} un
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="relative">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Buscar produto por nome, código ou EAN..."
                      className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-xs md:text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                    {filteredProducts.length === 0 ? (
                      <div className="p-4 text-center text-xs text-gray-400 font-medium">
                        Nenhum produto com estoque encontrado para esta busca.
                      </div>
                    ) : (
                      filteredProducts.map((prod) => (
                        <button
                          key={prod.id}
                          type="button"
                          onClick={() => handleSelectProduct(prod)}
                          className="w-full px-3.5 py-2.5 text-left hover:bg-orange-50/70 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-gray-900 truncate">{prod.name}</p>
                            <p className="text-[10px] text-gray-400 font-semibold">
                              {prod.category} {prod.internalCode ? `• #${prod.internalCode}` : ''}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-black text-emerald-600">
                              R$ {formatPriceBR(prod.price)}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Edição do Título e Mensagem */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-orange-500" />
                  2. Personalizar Texto da Notificação
                </span>
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="text-xs font-bold text-gray-500 hover:text-orange-600 flex items-center gap-1 transition-colors"
                  title="Restaurar texto sugerido automaticamente"
                >
                  <RotateCcw size={13} />
                  Restaurar texto padrão
                </button>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-gray-700">Título da Notificação</label>
                  <span className="text-[10px] font-semibold text-gray-400">{title.length}/65 caracteres</span>
                </div>
                <input
                  type="text"
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`🔥 Oferta Especial na ${storeName}!`}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-gray-700">Mensagem Promocional</label>
                  <span className="text-[10px] font-semibold text-gray-400">{body.length}/160 caracteres</span>
                </div>
                <textarea
                  rows={3}
                  value={body}
                  maxLength={240}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Digite o texto promocional que aparecerá no celular do cliente..."
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none"
                />
              </div>

              {/* Destino do Clique */}
              <div className="bg-blue-50/70 border border-blue-100 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wider text-blue-600">
                    Link de Destino ao Tocar na Notificação
                  </p>
                  <p className="text-xs font-mono text-blue-900 truncate">{targetUrl}</p>
                </div>
                <ExternalLink size={15} className="text-blue-500 shrink-0" />
              </div>
            </div>

            {/* Resultado do Disparo */}
            {sendResult && (
              <div
                className={`p-4 rounded-2xl border flex items-start gap-3 animate-in fade-in duration-200 ${
                  sendResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                {sendResult.success ? (
                  <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
                )}
                <div className="text-xs space-y-1">
                  {sendResult.success ? (
                    <>
                      <p className="font-black text-sm text-emerald-900">
                        {sendResult.sentCount > 0
                          ? `Notificação enviada com sucesso para ${sendResult.sentCount} ${
                              sendResult.sentCount === 1 ? 'dispositivo móvel' : 'dispositivos móveis'
                            }!`
                          : 'Nenhum dispositivo ativo encontrado para receber esta notificação.'}
                      </p>
                      <p className="text-emerald-700 font-medium">
                        Total de inscritos na loja: <strong>{sendResult.totalSubscribers}</strong>
                        {sendResult.removedCount > 0 && (
                          <> • Inscrições antigas/desinstaladas limpas: <strong>{sendResult.removedCount}</strong></>
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-black text-sm text-red-900">Erro ao enviar notificação</p>
                      <p className="text-red-700 font-medium">{sendResult.error}</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Coluna Direita: Preview Visual da Notificação no Celular */}
          <div className="lg:col-span-5 flex flex-col">
            <label className="text-[11px] font-black uppercase tracking-wider text-gray-500 flex items-center gap-1.5 mb-2.5">
              <Smartphone size={14} className="text-orange-500" />
              3. Pré-visualização no Celular do Cliente
            </label>

            <div className="flex-1 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-5 flex flex-col justify-between text-white shadow-xl border border-slate-700 relative overflow-hidden min-h-[340px]">
              {/* Barra de Status do Celular */}
              <div className="flex items-center justify-between text-[11px] font-bold text-white/70 px-2 mb-4">
                <span>09:41</span>
                <div className="w-20 h-4 bg-black/50 rounded-full mx-auto" />
                <span>5G • 100%</span>
              </div>

              {/* Card da Notificação Mobile (Android / iOS PWA style) */}
              <div className="my-auto">
                <div className="bg-white/95 backdrop-blur-md text-gray-900 rounded-2xl p-4 shadow-2xl border border-white/40 transition-all">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {tenant?.logoUrl ? (
                        <img
                          src={tenant.logoUrl}
                          alt={storeName}
                          className="w-5 h-5 rounded-md object-contain bg-gray-100 p-0.5 shrink-0"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-md bg-orange-500 text-white flex items-center justify-center text-[10px] font-black shrink-0">
                          {storeName.charAt(0)}
                        </div>
                      )}
                      <span className="text-[11px] font-extrabold text-gray-600 truncate">
                        {storeName}
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold text-gray-400 shrink-0">agora</span>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs md:text-sm font-black text-gray-900 leading-snug break-words">
                        {title || `🔥 Oferta Especial na ${storeName}!`}
                      </p>
                      <p className="text-xs text-gray-700 font-medium leading-relaxed mt-1 break-words">
                        {body || 'Selecione um produto para gerar o texto da promoção...'}
                      </p>
                    </div>
                    {resolvedProductImage && (
                      <img
                        src={resolvedProductImage}
                        alt="Preview"
                        className="w-12 h-12 rounded-xl object-contain bg-gray-50 border border-gray-100 p-1 shrink-0"
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>

                  {resolvedProductImage && (
                    <div className="mt-3 rounded-xl bg-gray-50 border border-gray-100 h-32 flex items-center justify-center p-2 overflow-hidden">
                      <img
                        src={resolvedProductImage}
                        alt={selectedProduct?.name || 'Produto'}
                        className="max-h-full max-w-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-orange-600">
                    <span>Ver Oferta no App</span>
                    <span>Abrir →</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-center text-white/60 font-medium mt-4">
                Ao tocar na notificação, o cliente abre direto o produto no app da sua farmácia.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-500 font-medium">
            🔒 Isolamento Multi-Loja ativo: apenas clientes inscritos em <strong>{storeName}</strong> receberão este alerta.
          </p>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-5 py-3 rounded-xl font-bold text-xs uppercase tracking-wider text-gray-600 bg-white border border-gray-200 hover:bg-gray-100 transition-colors"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={handleSendPush}
              disabled={isSending || !title.trim() || !body.trim()}
              className="flex-1 sm:flex-none px-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 disabled:opacity-50 shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 transition-all"
            >
              {isSending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Disparando...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Disparar Notificação
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
