import React, { useState, useMemo } from 'react';
import { Copy, Check, ExternalLink, Rss } from 'lucide-react';
import { toast } from 'sonner';
import { PharmacyConfig } from '../types';
import { getStoreUrl } from '../lib/store';

interface GoogleShoppingFeedCardProps {
  tenant?: Partial<PharmacyConfig> & { id?: string; subdomain?: string };
  className?: string;
}

export const GoogleShoppingFeedCard: React.FC<GoogleShoppingFeedCardProps> = ({
  tenant,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  const feedUrl = useMemo(() => {
    const base = getStoreUrl(tenant).replace(/\/+$/, '');
    return `${base}/google-shopping.xml`;
  }, [tenant]);

  if (!tenant || !tenant.id) {
    return null;
  }

  const handleCopyFeed = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      toast.success('Link do feed copiado!', {
        description: 'Cole no Google Merchant Center ou no Gerenciador de Comércio do Meta/Instagram.',
      });
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      toast.error('Não foi possível copiar o link do feed automaticamente.');
    }
  };

  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white p-5 space-y-4 ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-900 text-white flex items-center justify-center shrink-0 mt-0.5">
            <Rss size={17} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              Feed Google Shopping &amp; Catálogo Instagram
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              XML padrão Google Merchant Center (RSS 2.0) atualizado automaticamente com produtos ativos, em estoque e com foto.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center">
          <span className="text-xs font-mono text-gray-700 truncate select-all">
            {feedUrl}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyFeed}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold transition-colors whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check size={14} className="text-emerald-400" />
                <span>Copiado!</span>
              </>
            ) : (
              <>
                <Copy size={14} />
                <span>Copiar Link do Feed</span>
              </>
            )}
          </button>

          <a
            href={feedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 text-xs font-bold transition-colors whitespace-nowrap"
          >
            <span>Abrir XML</span>
            <ExternalLink size={13} className="text-gray-500" />
          </a>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Compatível com Listagens Gratuitas do Google Shopping, aba de Produtos no Google Maps e Catálogo do Meta/Instagram · Cache automático de 1h.
      </p>
    </div>
  );
};
