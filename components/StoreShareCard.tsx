import React, { useState } from 'react';
import { PharmacyConfig } from '../types';
import { getStoreUrl } from '../lib/store';
import { Copy, CheckCircle2, Share2, ExternalLink, Sparkles, MessageCircle, Globe } from 'lucide-react';
import { toast } from 'sonner';

interface StoreShareCardProps {
  tenant?: Partial<PharmacyConfig> & { id?: string; subdomain?: string };
  isDarkMode?: boolean;
  className?: string;
  compact?: boolean;
}

export const StoreShareCard: React.FC<StoreShareCardProps> = ({
  tenant,
  isDarkMode = false,
  className = '',
  compact = false
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  if (!tenant || !tenant.id) {
    return null;
  }

  const storeUrl = getStoreUrl(tenant);
  const storeName = tenant.name || 'Minha Drogaria';
  const location = [tenant.neighborhood, tenant.city, tenant.state].filter(Boolean).join(' - ');
  
  const description =
    tenant.bannerSubtitle ||
    tenant.bannersubtitle ||
    tenant.bannerTitle ||
    tenant.bannertitle ||
    (location
      ? `Peça medicamentos, perfumaria e receba em casa com entrega rápida em ${location}. Compre online com tele-entrega.`
      : 'Peça medicamentos, perfumaria e cuidados diários com tele-entrega rápida e atendimento direto no WhatsApp.');

  const logoSrc =
    tenant.logo && (tenant.logo.startsWith('http') || tenant.logo.startsWith('data:'))
      ? tenant.logo
      : `/preview-share.png`;

  const promoMessage = `🏥 *${storeName} - Sua Farmácia Online!* ✨\n\nOlá! Agora ficou muito mais fácil pedir seus medicamentos, itens de perfumaria e cuidados diários sem sair de casa! 🛵💨\n\n👉 *Acesse nossa loja online e confira nossas ofertas:*\n${storeUrl}\n\nEntrega rápida e atendimento direto pelo WhatsApp! 💬`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(storeUrl);
    setCopiedLink(true);
    toast.success('Link da loja copiado com sucesso!', {
      description: 'Pronto para colar em mensagens, bio do Instagram ou redes sociais.'
    });
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(promoMessage);
    setCopiedText(true);
    toast.success('Texto promocional copiado!', {
      description: 'Mensagem com link formatada para envio em grupos ou clientes.'
    });
    setTimeout(() => setCopiedText(false), 2500);
  };

  const handleShareWhatsApp = () => {
    const waUrl = `https://wa.me/?text=${encodeURIComponent(promoMessage)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  if (compact) {
    return (
      <div className={`p-3 rounded-2xl border transition-all ${isDarkMode ? 'bg-gray-800/90 border-gray-700' : 'bg-emerald-50/60 border-emerald-100'} ${className}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
            <Sparkles size={14} /> Link de Divulgação
          </div>
          <span className="text-[10px] text-gray-400 font-mono truncate max-w-[150px]">
            {storeUrl.replace(/^https?:\/\//, '')}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleCopyLink}
            type="button"
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 transition-all active:scale-95 shadow-sm"
          >
            {copiedLink ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
            {copiedLink ? 'Copiado!' : 'Copiar Link'}
          </button>
          <button
            onClick={handleShareWhatsApp}
            type="button"
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold bg-[#25D366] hover:bg-[#20bd5a] text-white transition-all active:scale-95 shadow-sm"
          >
            <MessageCircle size={14} /> WhatsApp
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-3xl border shadow-sm overflow-hidden transition-all ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} ${className}`}>
      {/* Header */}
      <div className={`p-5 border-b ${isDarkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-gradient-to-r from-emerald-50/50 via-teal-50/30 to-blue-50/40'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
              <Share2 size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className={`font-black text-sm uppercase tracking-wider ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Divulgue sua Drogaria
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Card do WhatsApp
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Compartilhe o link oficial da sua Webloja com pré-visualização personalizada.
              </p>
            </div>
          </div>
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors shrink-0 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 border-gray-600 text-gray-200' : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-700'}`}
          >
            <Globe size={14} className="text-blue-500" />
            <span>Abrir Loja</span>
            <ExternalLink size={12} className="text-gray-400" />
          </a>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* WhatsApp Card Preview Simulator */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
              <Sparkles size={12} className="text-emerald-500" />
              Como seus clientes verão no WhatsApp
            </span>
            <span className="text-[10px] text-gray-400">Prévia em tempo real</span>
          </div>

          <div className="max-w-md mx-auto sm:mx-0 p-3 rounded-2xl bg-[#EFEAE2] dark:bg-[#111B21] border border-black/5 shadow-inner">
            <div className="bg-white dark:bg-[#202C33] rounded-2xl overflow-hidden shadow-sm border border-black/5">
              {/* Image banner / square thumbnail */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-[#182229] border-b border-black/5">
                <img
                  src={logoSrc}
                  alt={storeName}
                  className="w-16 h-16 rounded-xl object-contain bg-white shadow-sm border border-gray-100 dark:border-gray-700 shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/preview-share.png';
                  }}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider block">
                    {storeUrl.replace(/^https?:\/\//, '').split('/')[0]}
                  </span>
                  <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate mt-0.5">
                    {storeName} - Farmácia Online & Delivery
                  </h4>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed mt-0.5">
                    {description}
                  </p>
                </div>
              </div>

              {/* Chat Bubble Bottom */}
              <div className="p-3 bg-white dark:bg-[#202C33]">
                <p className="text-xs text-blue-600 dark:text-blue-400 underline font-medium truncate select-all">
                  {storeUrl}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Store URL Bar */}
        <div className="space-y-2">
          <label className="text-[11px] font-black uppercase tracking-widest text-gray-400 flex items-center justify-between">
            <span>Link Oficial da sua Webloja</span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold lowercase">
              https ativado
            </span>
          </label>
          <div className={`flex items-center justify-between gap-2 p-3 rounded-2xl border-2 border-dashed ${isDarkMode ? 'bg-gray-900/60 border-gray-700 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
            <span className="text-xs font-mono font-medium truncate select-all flex-1">
              {storeUrl}
            </span>
            <button
              onClick={handleCopyLink}
              type="button"
              className={`p-2 rounded-xl transition-all font-bold text-xs flex items-center gap-1.5 shrink-0 ${copiedLink ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200'}`}
              title="Copiar link"
            >
              {copiedLink ? (
                <>
                  <CheckCircle2 size={15} />
                  <span>Copiado!</span>
                </>
              ) : (
                <>
                  <Copy size={15} />
                  <span>Copiar</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            onClick={handleShareWhatsApp}
            type="button"
            className="w-full py-3.5 px-5 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-2xl font-bold flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] shadow-md shadow-emerald-600/20 text-sm"
          >
            <MessageCircle size={18} />
            <span>Compartilhar no WhatsApp</span>
          </button>

          <button
            onClick={handleCopyText}
            type="button"
            className={`w-full py-3.5 px-5 rounded-2xl font-bold flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] text-sm border-2 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 border-gray-600 text-gray-200' : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-800'}`}
          >
            {copiedText ? (
              <>
                <CheckCircle2 size={18} className="text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">Texto Copiado!</span>
              </>
            ) : (
              <>
                <Copy size={18} className="text-gray-500" />
                <span>Copiar Mensagem Pronta</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
