import React, { useState, useMemo, useRef, useEffect, useCallback, useDeferredValue } from 'react';
import { 
  Printer, 
  Search, 
  Tag, 
  Sliders, 
  Trash2, 
  Plus, 
  Minus, 
  Eye, 
  FileText, 
  X, 
  Check, 
  AlertCircle,
  Percent, 
  ScanLine, 
  Volume2,
  History,
  RotateCcw,
  Clock,
  Save
} from 'lucide-react';
import ProductScanner from './ProductScanner';
import { PriceTagBatchesHistoryModal } from './PriceTagBatchesHistoryModal';
import { 
  PriceTagBatch,
  savePriceTagBatch,
  fetchRecentPriceTagBatches,
  deletePriceTagBatch,
  deserializeSnapshotToTagItems
} from '../services/priceTagBatchService';
import { Product, PharmacyConfig, PromotionRule } from '../types';

export const TAG_LAYOUTS = {
  gondola: {
    itemsPerPage: 30,
    gridClass: "grid-cols-3 grid-rows-10 gap-x-[2.5mm] gap-y-[2mm]",
    tagHeight: "h-[26mm] min-h-[26mm] max-h-[26mm]",
    orientation: "portrait",
  },
  baiana: {
    itemsPerPage: 8, // 2 colunas x 4 linhas
    gridClass: "grid-cols-2 grid-rows-4 gap-x-[4mm] gap-y-[3mm]",
    tagHeight: "h-[65mm]",
    orientation: "portrait",
  },
  cartaz_a5: {
    itemsPerPage: 2, // 2 cartazes por folha A4
    gridClass: "grid-cols-1 grid-rows-2 gap-y-[6mm]",
    tagHeight: "h-[135mm]",
    orientation: "portrait",
  },
  cartaz_a4: {
    itemsPerPage: 1, // 1 cartaz preenchendo a folha inteira
    gridClass: "grid-cols-1 grid-rows-1",
    tagHeight: "h-[282mm] max-h-[282mm]",
    orientation: "portrait",
  },
} as const;

export const FORMAT_CONFIG = TAG_LAYOUTS;

export type TagLayoutKey = keyof typeof TAG_LAYOUTS;
export type TagLayoutFormat = TagLayoutKey | 'gondola_pimaco' | 'baiana_destaque';

export const normalizeLayoutKey = (format: TagLayoutFormat): TagLayoutKey => {
  if (format === 'gondola_pimaco') return 'gondola';
  if (format === 'baiana_destaque') return 'baiana';
  if (format in TAG_LAYOUTS) return format as TagLayoutKey;
  return 'gondola';
};

export const getPagePaddingStyle = (key: TagLayoutKey) => {
  switch (key) {
    case 'gondola':
      // 10 linhas x 26mm = 260mm + 9 x 2mm gaps = 278mm. Folha A4 tem 297mm.
      // Margens verticais: 8mm (278mm + 16mm = 294mm < 297mm, trava de página única)
      // Margens horizontais: 6mm (210mm - 12mm margens - 5mm gaps = 193mm / 3 colunas = ~64.3mm)
      return {
        paddingTop: '8mm',
        paddingBottom: '8mm',
        paddingLeft: '6mm',
        paddingRight: '6mm',
      };
    case 'baiana':
      return {
        paddingTop: '14mm',
        paddingBottom: '14mm',
        paddingLeft: '5mm',
        paddingRight: '5mm',
      };
    case 'cartaz_a5':
      return {
        paddingTop: '10.5mm',
        paddingBottom: '10.5mm',
        paddingLeft: '8mm',
        paddingRight: '8mm',
      };
    case 'cartaz_a4':
      return {
        paddingTop: '5mm',
        paddingBottom: '5mm',
        paddingLeft: '5mm',
        paddingRight: '5mm',
      };
    default:
      return {
        paddingTop: '8mm',
        paddingBottom: '8mm',
        paddingLeft: '6mm',
        paddingRight: '6mm',
      };
  }
};

export const parsePrice = (val: number | string | undefined | null, fallback = 0): number => {
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  if (val === undefined || val === null) return fallback;
  const str = String(val).trim();
  if (!str) return fallback;
  let normalized = str;
  if (normalized.includes('.') && normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }
  const num = parseFloat(normalized);
  return isNaN(num) ? fallback : num;
};

export interface PriceTagItem {
  id: string;
  product: Product;
  quantity: number;
  badgeText: string;
  originalPrice: number | string;
  promotionalPrice: number | string;
  showOriginalPrice: boolean;
  unitMeasurementText: string;
  customObservations?: string;
  expiryDate?: string;
  customStoreName?: string;
}

export const getTagDetails = (item: PriceTagItem) => {
  const exp = (item.expiryDate || '').trim();
  const obs = (item.customObservations || '').trim();
  const unit = (item.unitMeasurementText || '').trim();

  let formattedValidity = '';
  if (exp) {
    formattedValidity = /^(val|venc|validade|vencimento)/i.test(exp)
      ? exp.toUpperCase()
      : `VAL: ${exp}`;
  } else if (obs && (/^(val|venc|validade|vencimento)/i.test(obs) || /^\d{1,2}\/\d{2,4}$/.test(obs))) {
    formattedValidity = /^(val|venc|validade|vencimento)/i.test(obs)
      ? obs.toUpperCase()
      : `VAL: ${obs}`;
  } else if (unit && (/^(val|venc|validade|vencimento)/i.test(unit) || /^\d{1,2}\/\d{2,4}$/.test(unit))) {
    formattedValidity = /^(val|venc|validade|vencimento)/i.test(unit)
      ? unit.toUpperCase()
      : `VAL: ${unit}`;
  }

  let auxText = unit;
  if (!auxText && obs) {
    const cleanObs = obs.replace(/^(val|venc|validade|vencimento)[:\s]*/i, '').trim();
    const cleanVal = formattedValidity.replace(/^(val|venc|validade|vencimento)[:\s]*/i, '').trim();
    if (cleanObs !== cleanVal) {
      auxText = obs;
    }
  } else if (auxText && obs) {
    const cleanObs = obs.replace(/^(val|venc|validade|vencimento)[:\s]*/i, '').trim();
    const cleanVal = formattedValidity.replace(/^(val|venc|validade|vencimento)[:\s]*/i, '').trim();
    if (cleanObs !== cleanVal && !auxText.includes(obs)) {
      auxText = `${auxText} • ${obs}`;
    }
  }

  return { formattedValidity, auxText };
};

export const chunkArray = <T,>(array: T[], size: number): T[][] => {
  if (!array || array.length === 0 || size <= 0) return [];
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

export interface TagRenderOptions {
  showBarcode: boolean;
  showInternalCode: boolean;
  showPrintDate: boolean;
  showStoreLogo: boolean;
  tenant: PharmacyConfig;
  todayFormatted: string;
}

// Renderizador sob demanda das etiquetas de impressão
export const renderTagCard = (
  item: PriceTagItem,
  layoutKey: TagLayoutKey,
  uniqueKey: string,
  options: TagRenderOptions
) => {
  const { showBarcode, showInternalCode, showPrintDate, showStoreLogo, tenant, todayFormatted } = options;
  const currentLayoutConfig = TAG_LAYOUTS[layoutKey];
  const { formattedValidity, auxText } = getTagDetails(item);
  const storeName = item.customStoreName || (showStoreLogo ? tenant.name : '');
  const origPrice = parsePrice(item.originalPrice, Number(item.product.price) || 0);
  const promoPrice = parsePrice(item.promotionalPrice, origPrice);

  // 1. MODELO: GÔNDOLA PADRÃO (30 por folha • Grade 3x10 • h: 26mm)
  if (layoutKey === 'gondola') {
    return (
      <div
        key={uniqueKey}
        className={`border border-slate-300 rounded-[3px] p-1.5 flex flex-col justify-between bg-white text-slate-900 break-inside-avoid relative overflow-hidden ${currentLayoutConfig.tagHeight}`}
        style={{ boxSizing: 'border-box' }}
      >
        <div>
          {/* Cabeçalho */}
          <div className="flex items-start justify-between gap-1 w-full border-b border-slate-100 pb-0.5 leading-none">
            <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
              {showInternalCode && item.product.internalCode && (
                <span className="text-[6.5px] font-bold text-slate-400 shrink-0">
                  CÓD: {item.product.internalCode}
                </span>
              )}
              {storeName && (
                <span className="text-[7px] text-slate-500 font-medium truncate max-w-[55%]">
                  {storeName}
                </span>
              )}
            </div>
            {item.badgeText && (
              <span className="bg-amber-400 text-slate-900 font-extrabold text-[6.5px] px-1 py-0.5 rounded-sm uppercase tracking-tight whitespace-nowrap shrink-0 leading-none">
                {item.badgeText}
              </span>
            )}
          </div>

          {/* Nome do Produto */}
          <h4 className="text-[8px] font-black leading-[1.1] line-clamp-2 text-slate-950 mt-0.5">
            {item.product.name}
          </h4>

          {/* Apresentação / Princípio Ativo */}
          <p className="text-[6px] text-slate-500 truncate leading-none mt-0.5">
            {item.product.activePrinciple || item.product.presentation || item.product.category}
          </p>
        </div>

        {/* Bloco Inferior: Preço e Barras */}
        <div className="flex items-end justify-between gap-1 mt-auto pt-0.5 border-t border-slate-100">
          <div className="flex flex-col min-w-0 flex-1">
            {item.showOriginalPrice && origPrice > promoPrice && (
              <span className="text-[6px] text-slate-400 line-through leading-none">
                DE R$ {origPrice.toFixed(2).replace('.', ',')}
              </span>
            )}
            <div className="flex items-baseline gap-0.5 leading-none">
              <span className="text-[6.5px] font-bold text-slate-500">R$</span>
              <span className="text-[12.5px] font-black text-slate-950 tracking-tight leading-none">
                {promoPrice.toFixed(2).replace('.', ',')}
              </span>
            </div>
            <div className="flex flex-col gap-[0.5px] mt-0.5">
              {auxText && (
                <span className="text-[6px] font-bold text-slate-700 leading-tight truncate max-w-[100px]" title={auxText}>
                  {auxText}
                </span>
              )}
              {formattedValidity && (
                <span className="text-[6px] font-extrabold text-red-700 leading-tight tracking-tight truncate max-w-[100px]">
                  {formattedValidity}
                </span>
              )}
            </div>
          </div>

          {showBarcode && (
            <div className="flex flex-col items-end shrink-0 text-right">
              <div className="inline-block tracking-tighter opacity-90 scale-x-95">
                <div className="h-2 flex items-end gap-[1px] justify-end">
                  {[2, 1, 2, 3, 1, 2, 1, 3, 1, 2, 3, 1, 2].map((w, i) => (
                    <span
                      key={i}
                      className="bg-black inline-block"
                      style={{ width: `${w}px`, height: '100%' }}
                    />
                  ))}
                </div>
              </div>
              <span className="block text-[6px] font-mono font-bold text-slate-700 leading-none mt-0.5">
                {item.product.barcode || item.product.internalCode || '7890000000000'}
              </span>
              {showPrintDate && (
                <span className="block text-[5.5px] text-slate-400 leading-none mt-0.5">
                  {todayFormatted}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. MODELO: ETIQUETA BAIANA (8 por folha • Grade 2x4 • h: 65mm)
  if (layoutKey === 'baiana') {
    return (
      <div
        key={uniqueKey}
        className={`border-2 border-gray-950 rounded-lg overflow-hidden bg-white text-gray-900 break-inside-avoid flex flex-col justify-between ${currentLayoutConfig.tagHeight}`}
        style={{ boxSizing: 'border-box' }}
      >
        <div className="bg-red-600 text-yellow-300 font-black text-center py-1 px-2 text-xs uppercase tracking-wider flex items-center justify-between">
          <span className="text-[9px] font-bold text-white truncate max-w-[110px]">
            {showStoreLogo ? tenant.name : 'DROGARIA'}
          </span>
          <span className="font-black text-[11px]">
            {item.badgeText || 'SUPER OFERTA'}
          </span>
          <span className="text-[9px] font-mono text-white">
            {item.product.internalCode || ''}
          </span>
        </div>

        <div className="p-2 flex-1 flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-black leading-tight text-gray-950 line-clamp-2">
              {item.product.name}
            </h4>
            <p className="text-[8.5px] text-gray-600 mt-0.5 truncate">
              {item.product.activePrinciple || item.product.presentation || item.product.category}
            </p>
            {formattedValidity && (
              <p className="text-[8px] font-black text-red-700 mt-0.5 truncate">
                {formattedValidity}
              </p>
            )}
            {auxText && (
              <p className="text-[7.5px] font-bold text-gray-700 mt-0.5 truncate">
                {auxText}
              </p>
            )}
          </div>

          <div className="flex items-end justify-between mt-1 pt-1 border-t-2 border-dashed border-gray-200">
            <div>
              {item.showOriginalPrice && origPrice > promoPrice && (
                <span className="text-[9.5px] text-gray-500 line-through font-bold block">
                  DE: R$ {origPrice.toFixed(2).replace('.', ',')}
                </span>
              )}
              <div className="flex items-baseline gap-1">
                <span className="text-xs font-black text-red-600">POR R$</span>
                <span className="text-2xl font-black text-gray-950 tracking-tight leading-none">
                  {promoPrice.toFixed(2).replace('.', ',')}
                </span>
              </div>
              {item.unitMeasurementText && (
                <span className="text-[8px] text-gray-500 block font-semibold">
                  {item.unitMeasurementText}
                </span>
              )}
            </div>

            {showBarcode && (
              <div className="text-right">
                <div className="h-3.5 flex items-end gap-[1px] justify-end">
                  {[2, 1, 3, 1, 4, 1, 2, 3, 1, 2, 4, 1].map((w, i) => (
                    <span key={i} className="bg-black" style={{ width: `${w}px`, height: '100%' }} />
                  ))}
                </div>
                <span className="text-[8px] font-mono font-bold text-gray-700 block mt-0.5">
                  {item.product.barcode || item.product.internalCode || '7890000000000'}
                </span>
              </div>
            )}
          </div>
        </div>

        {showPrintDate && (
          <div className="bg-gray-100 px-2 py-0.5 text-[7.5px] text-gray-500 flex justify-between">
            <span>Preço válido enquanto durarem os estoques</span>
            <span>{todayFormatted}</span>
          </div>
        )}
      </div>
    );
  }

  // 3. MODELO: CARTAZ A5 (2 por folha • Grade 1x2 • h: 135mm)
  if (layoutKey === 'cartaz_a5') {
    return (
      <div
        key={uniqueKey}
        className={`border-4 border-gray-950 rounded-xl overflow-hidden bg-white text-gray-900 break-inside-avoid flex flex-col justify-between ${currentLayoutConfig.tagHeight}`}
        style={{ boxSizing: 'border-box' }}
      >
        <div className="bg-red-600 text-yellow-300 font-black text-center py-2 px-3 text-base uppercase tracking-wider flex items-center justify-between">
          <span className="text-xs font-bold text-white">
            {showStoreLogo ? tenant.name : 'DROGARIA'}
          </span>
          <span className="text-lg font-black">
            {item.badgeText || 'OFERTA ESPECIAL'}
          </span>
          <span className="text-xs font-mono text-white">
            #{item.product.internalCode || ''}
          </span>
        </div>

        <div className="p-4 text-center flex-1 flex flex-col justify-center">
          <h2 className="text-2xl font-black text-gray-950 leading-tight">
            {item.product.name}
          </h2>
          <p className="text-xs font-bold text-gray-600 mt-1">
            {item.product.activePrinciple || item.product.presentation || item.product.category}
          </p>
          {formattedValidity && (
            <p className="text-xs font-black text-red-600 mt-0.5">
              {formattedValidity}
            </p>
          )}
          {auxText && (
            <p className="text-[11px] font-bold text-gray-700 mt-0.5">
              {auxText}
            </p>
          )}
        </div>

        <div className="bg-yellow-300 p-3 text-center border-t-4 border-gray-950">
          {item.showOriginalPrice && origPrice > promoPrice && (
            <div className="text-xs font-black text-gray-700 line-through">
              DE R$ {origPrice.toFixed(2).replace('.', ',')}
            </div>
          )}
          <div className="flex items-center justify-center gap-2">
            <span className="text-base font-black text-red-700">POR APENAS R$</span>
            <span className="text-5xl font-black text-gray-950 tracking-tighter">
              {promoPrice.toFixed(2).replace('.', ',')}
            </span>
          </div>
          {item.unitMeasurementText && (
            <span className="text-xs font-bold text-gray-800 block mt-0.5">
              {item.unitMeasurementText}
            </span>
          )}
        </div>

        <div className="p-1.5 bg-gray-50 flex items-center justify-between text-[9px] text-gray-500 font-bold border-t border-gray-200">
          <span>{tenant.name} • PDV</span>
          {showBarcode && (
            <span className="font-mono">
              EAN: {item.product.barcode || item.product.internalCode}
            </span>
          )}
          <span>{todayFormatted}</span>
        </div>
      </div>
    );
  }

  // 4. MODELO: CARTAZ A4 (1 por folha • Grade 1x1 • w-full h-[282mm] max-h-[282mm])
  return (
    <div
      key={uniqueKey}
      className="w-full h-[282mm] max-h-[282mm] border-[3px] border-black rounded-lg overflow-hidden bg-white text-gray-900 break-inside-avoid flex flex-col justify-between"
      style={{ boxSizing: 'border-box' }}
    >
      {/* Cabeçalho Vermelho: Altura fixa h-[38mm] */}
      <div className="h-[38mm] min-h-[38mm] max-h-[38mm] bg-red-600 text-yellow-300 font-black px-6 flex items-center justify-between shrink-0 overflow-hidden">
        <span className="text-xl font-black text-white tracking-wide truncate max-w-[35%]">
          {showStoreLogo ? tenant.name : 'DROGARIA POPULAR'}
        </span>
        <span className="text-3xl font-black uppercase tracking-wider text-center flex-1 px-2 animate-pulse truncate">
          {item.badgeText || 'SUPER OFERTA'}
        </span>
        <span className="text-lg font-mono text-white text-right shrink-0">
          {item.product.internalCode ? `CÓD: ${item.product.internalCode}` : ''}
        </span>
      </div>

      {/* Corpo Central: flex-1 com alinhamento vertical e nomes seguros */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center overflow-hidden">
        <h1 className="text-4xl sm:text-5xl font-black text-gray-950 leading-tight uppercase line-clamp-3 max-w-xl">
          {item.product.name}
        </h1>
        <p className="text-base font-bold text-gray-600 mt-2 max-w-lg line-clamp-2">
          {item.product.activePrinciple || item.product.presentation || item.product.category}
        </p>
        {formattedValidity && (
          <div className="mt-2 px-3 py-1 bg-red-100 text-red-800 rounded-lg text-xs font-black uppercase">
            {formattedValidity}
          </div>
        )}
        {auxText && (
          <div className="mt-1 text-sm font-bold text-gray-700">
            {auxText}
          </div>
        )}
      </div>

      {/* Bloco Amarelo de Preço: Altura fixa h-[50mm] */}
      <div className="h-[50mm] min-h-[50mm] max-h-[50mm] bg-yellow-300 px-6 py-2 text-center border-t-[3px] border-b-[3px] border-black flex flex-col justify-center items-center shrink-0 overflow-hidden">
        {item.showOriginalPrice && origPrice > promoPrice && (
          <div className="text-lg font-black text-gray-700 line-through leading-none mb-1">
            DE R$ {origPrice.toFixed(2).replace('.', ',')}
          </div>
        )}
        <div className="flex items-center justify-center gap-3 leading-none">
          <span className="text-2xl font-black text-red-700">POR APENAS R$</span>
          <span className="text-7xl sm:text-8xl font-black text-gray-950 tracking-tighter leading-none">
            {promoPrice.toFixed(2).replace('.', ',')}
          </span>
        </div>
        {item.unitMeasurementText && (
          <span className="text-xs font-black text-gray-800 block mt-1 uppercase">
            {item.unitMeasurementText}
          </span>
        )}
      </div>

      {/* Rodapé Legal: Altura fixa h-[9mm] anti-corte */}
      <div className="h-[9mm] min-h-[9mm] max-h-[9mm] px-3 bg-white border-t border-slate-300 flex items-center justify-between text-[9px] text-gray-600 font-bold shrink-0 overflow-hidden">
        <span className="truncate max-w-[45%]">
          {tenant.name} • Ofertas válidas enquanto durarem os estoques
        </span>
        {showBarcode && (
          <span className="font-mono text-center truncate px-2">
            EAN: {item.product.barcode || item.product.internalCode || 'N/A'}
          </span>
        )}
        <span className="shrink-0 text-right">Data: {todayFormatted}</span>
      </div>
    </div>
  );
};

// ==========================================
// SUBCOMPONENTES MEMOIZADOS (HIGH PERFORMANCE)
// ==========================================

// Item do Catálogo de Produtos
interface CatalogProductItemProps {
  product: Product;
  inQueue: boolean;
  onAdd: (product: Product) => void;
}

const CatalogProductItem = React.memo<CatalogProductItemProps>(({ product, inQueue, onAdd }) => {
  const promoPrice = Number(product.promotionalPrice || product.promotional_price || 0);
  const isPromo = promoPrice > 0 && promoPrice < product.price;

  return (
    <div
      className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
        inQueue
          ? 'bg-emerald-50/40 border-emerald-200/80 shadow-2xs'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-2xs'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-mono font-bold text-gray-400">
            {product.internalCode || 'SEM CÓD'}
          </span>
          {product.barcode && (
            <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
              {product.barcode}
            </span>
          )}
          {isPromo && (
            <span className="text-[10px] font-black uppercase px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
              Oferta
            </span>
          )}
        </div>
        <h4 className="text-xs font-bold text-gray-900 truncate mt-0.5" title={product.name}>
          {product.name}
        </h4>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-xs font-black text-emerald-700">
            R$ {(isPromo ? promoPrice : product.price).toFixed(2).replace('.', ',')}
          </span>
          {isPromo && (
            <span className="text-[10px] text-gray-400 line-through">
              R$ {product.price.toFixed(2).replace('.', ',')}
            </span>
          )}
          {product.manufacturer && (
            <span className="text-[10px] text-gray-400 truncate">
              • {product.manufacturer}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onAdd(product)}
        className={`p-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
          inQueue
            ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
            : 'bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 border border-gray-200'
        }`}
        title={inQueue ? 'Adicionar mais uma cópia à fila' : 'Adicionar à fila de etiquetas'}
      >
        <Plus size={16} />
      </button>
    </div>
  );
});

// Card de Edição de Item da Fila de Impressão
interface SelectedTagItemProps {
  item: PriceTagItem;
  onUpdate: (id: string, updates: Partial<PriceTagItem>) => void;
  onRemove: (id: string) => void;
}

export const SelectedTagItem = React.memo<SelectedTagItemProps>(({ item, onUpdate, onRemove }) => {
  return (
    <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/60 hover:bg-white hover:border-gray-200 transition-all space-y-3 shadow-2xs">
      {/* Linha 1: Dados do Produto e Controles de Qtd */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono font-black text-emerald-700">
              #{item.product.internalCode || 'S/C'}
            </span>
            {item.product.barcode && (
              <span className="text-[10px] font-mono text-gray-400 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                {item.product.barcode}
              </span>
            )}
            <span className="text-[10px] font-bold text-gray-400">
              {item.product.category}
            </span>
          </div>
          <h4 className="text-sm font-black text-gray-900 truncate mt-0.5">
            {item.product.name}
          </h4>
        </div>

        {/* Controle de Cópias */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-white rounded-xl border border-gray-200 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => onUpdate(item.id, { quantity: Math.max(1, Number(item.quantity) - 1) })}
              className="p-1 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors cursor-pointer"
              title="Diminuir quantidade"
            >
              <Minus size={13} />
            </button>
            <span className="px-2 text-xs font-black text-gray-900 min-w-[24px] text-center">
              {item.quantity}
            </span>
            <button
              type="button"
              onClick={() => onUpdate(item.id, { quantity: Number(item.quantity) + 1 })}
              className="p-1 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors cursor-pointer"
              title="Aumentar quantidade"
            >
              <Plus size={13} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
            title="Remover produto da fila"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Linha 2: Personalização Rápida (Preço DE/POR e Badge) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-gray-200/60">
        <div>
          <label className="text-[10px] font-black uppercase text-gray-400 block mb-1">
            Chamada / Badge
          </label>
          <input
            type="text"
            placeholder="Ex: OFERTA, VALIDADE..."
            value={item.badgeText}
            onChange={(e) => onUpdate(item.id, { badgeText: e.target.value.toUpperCase() })}
            className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-black uppercase text-gray-400">
              Preço DE (R$)
            </label>
            <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={item.showOriginalPrice}
                onChange={(e) => onUpdate(item.id, { showOriginalPrice: e.target.checked })}
                className="rounded text-emerald-600 w-3 h-3"
              />
              <span>Exibir</span>
            </label>
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={item.originalPrice ?? ''}
            onChange={(e) => {
              let val = e.target.value;
              val = val.replace(/[^\d.,]/g, '');
              val = val.replace(/^0+(?=[1-9])/, '');
              onUpdate(item.id, { originalPrice: val });
            }}
            onBlur={() => {
              const raw = item.originalPrice;
              if (raw === '' || raw === null || raw === undefined) {
                const fallback = Number(item.product.price) || 0;
                onUpdate(item.id, { originalPrice: fallback });
              } else {
                const parsed = parsePrice(raw, Number(item.product.price) || 0);
                onUpdate(item.id, { originalPrice: parsed });
              }
            }}
            className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-900 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[10px] font-black uppercase text-emerald-700 block mb-1">
            Preço POR (R$)
          </label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={item.promotionalPrice ?? ''}
            onChange={(e) => {
              let val = e.target.value;
              val = val.replace(/[^\d.,]/g, '');
              val = val.replace(/^0+(?=[1-9])/, '');
              onUpdate(item.id, { promotionalPrice: val });
            }}
            onBlur={() => {
              const raw = item.promotionalPrice;
              if (raw === '' || raw === null || raw === undefined) {
                const promoFallback =
                  Number(item.product.promotionalPrice || item.product.promotional_price) ||
                  parsePrice(item.originalPrice, Number(item.product.price) || 0);
                onUpdate(item.id, { promotionalPrice: promoFallback });
              } else {
                const fallback = parsePrice(item.originalPrice, Number(item.product.price) || 0);
                const parsed = parsePrice(raw, fallback);
                onUpdate(item.id, { promotionalPrice: parsed });
              }
            }}
            className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-black text-emerald-700 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Linha 3: Validade/Lote e Observações/Preço Fracionado */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-bold uppercase text-gray-500 block mb-0.5">
            Validade / Lote
          </label>
          <input
            type="text"
            placeholder="Ex: 11/2026 ou Lote: 4902A"
            value={item.expiryDate ?? item.customObservations ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              onUpdate(item.id, {
                expiryDate: val,
                customObservations: val
              });
            }}
            className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-800 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase text-gray-500 block mb-0.5">
            Obs / Fórmula / Fracionado
          </label>
          <input
            type="text"
            placeholder="Ex: Saindo por 12,99"
            value={item.unitMeasurementText || ''}
            onChange={(e) => onUpdate(item.id, { unitMeasurementText: e.target.value })}
            className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-800 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
});

// Modal de Pré-Visualização das Folhas A4 (Recalcula páginas e layouts apenas sob demanda)
interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  tagItems: PriceTagItem[];
  activeLayoutKey: TagLayoutKey;
  showBarcode: boolean;
  showInternalCode: boolean;
  showPrintDate: boolean;
  showStoreLogo: boolean;
  tenant: PharmacyConfig;
  todayFormatted: string;
  onPrint: () => void;
}

export const PrintPreviewModal = React.memo<PrintPreviewModalProps>(({
  isOpen,
  onClose,
  tagItems,
  activeLayoutKey,
  showBarcode,
  showInternalCode,
  showPrintDate,
  showStoreLogo,
  tenant,
  todayFormatted,
  onPrint,
}) => {
  if (!isOpen) return null;

  const currentLayoutConfig = TAG_LAYOUTS[activeLayoutKey];

  // Expansão e paginação isoladas (não bloqueiam busca nem seleção)
  const paginatedPages = useMemo(() => {
    const list: { item: PriceTagItem; index: number }[] = [];
    tagItems.forEach((item) => {
      const q = Math.max(1, Number(item.quantity) || 1);
      for (let i = 0; i < q; i++) {
        list.push({ item, index: i });
      }
    });
    return chunkArray(list, currentLayoutConfig.itemsPerPage);
  }, [tagItems, currentLayoutConfig.itemsPerPage]);

  const totalSheets = paginatedPages.length;
  const pagePadding = getPagePaddingStyle(activeLayoutKey);
  const tagOptions: TagRenderOptions = {
    showBarcode,
    showInternalCode,
    showPrintDate,
    showStoreLogo,
    tenant,
    todayFormatted,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-gray-950/70 backdrop-blur-xs animate-in fade-in duration-150 print:hidden">
      <div className="bg-white w-full max-w-5xl max-h-[95vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100 print:hidden">
        {/* Topbar do Modal */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-white shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Printer size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-gray-900">
                Pré-Visualização de Impressão
              </h3>
              <p className="text-xs text-gray-400 font-medium">
                Modelo selecionado:{' '}
                <strong className="text-gray-700">
                  {activeLayoutKey === 'gondola' && 'Gôndola Padrão (Grade 3x10 • 30 por folha)'}
                  {activeLayoutKey === 'baiana' && 'Etiqueta Baiana / Testeira (Grade 2x4 • 8 por folha)'}
                  {activeLayoutKey === 'cartaz_a5' && 'Cartaz Promocional A5 (Grade 1x2 • 2 por folha)'}
                  {activeLayoutKey === 'cartaz_a4' && 'Cartaz Vitrine A4 (1 por folha)'}
                </strong>{' '}
                • Total de folhas A4: <span className="text-emerald-700 font-bold">{totalSheets} folha(s)</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrint}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all active:scale-95 cursor-pointer"
            >
              <Printer size={15} />
              <span>Imprimir Agora</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Área com as Folhas A4 */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-gray-100/80 custom-scrollbar">
          <div className="max-w-[210mm] mx-auto space-y-8">
            {paginatedPages.map((pageItems, pageIdx) => {
              return (
                <div key={`preview-page-${pageIdx}`} className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-gray-500 px-1">
                    <span>
                      Folha {pageIdx + 1} de {totalSheets}
                      <span className="text-gray-400 font-normal ml-1">
                        ({pageItems.length} de {currentLayoutConfig.itemsPerPage} posições preenchidas)
                      </span>
                    </span>
                    <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-100">
                      {currentLayoutConfig.itemsPerPage} por folha • Anti-Corte
                    </span>
                  </div>

                  <div
                    className="bg-white mx-auto shadow-md border border-gray-200 box-border relative overflow-hidden"
                    style={{
                      width: '210mm',
                      height: '297mm',
                      maxHeight: '297mm',
                      minHeight: '297mm',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      ...pagePadding,
                    }}
                  >
                    <div className={`grid ${currentLayoutConfig.gridClass} w-full h-full`}>
                      {pageItems.map(({ item, index: itemRepIndex }, itemIdx) => {
                        const uniqueKey = `modal-preview-${item.id}-${pageIdx}-${itemIdx}-${itemRepIndex}`;
                        return renderTagCard(item, activeLayoutKey, uniqueKey, tagOptions);
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rodapé do Modal */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between shrink-0 print:hidden">
          <span className="text-xs text-gray-500 font-medium">
            Pressione <strong>Ctrl + P</strong> ou clique no botão de impressão.
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-200 transition-colors cursor-pointer"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md transition-all active:scale-95 cursor-pointer"
            >
              <Printer size={16} />
              <span>Imprimir Folha</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// Container Oficial de Impressão (Isolado no DOM para disparo nativo @media print)
interface PrintContainerProps {
  tagItems: PriceTagItem[];
  activeLayoutKey: TagLayoutKey;
  showBarcode: boolean;
  showInternalCode: boolean;
  showPrintDate: boolean;
  showStoreLogo: boolean;
  tenant: PharmacyConfig;
  todayFormatted: string;
}

export const PrintContainer = React.memo<PrintContainerProps>(({
  tagItems,
  activeLayoutKey,
  showBarcode,
  showInternalCode,
  showPrintDate,
  showStoreLogo,
  tenant,
  todayFormatted,
}) => {
  if (tagItems.length === 0) return null;

  const currentLayoutConfig = TAG_LAYOUTS[activeLayoutKey];

  const paginatedPages = useMemo(() => {
    const list: { item: PriceTagItem; index: number }[] = [];
    tagItems.forEach((item) => {
      const q = Math.max(1, Number(item.quantity) || 1);
      for (let i = 0; i < q; i++) {
        list.push({ item, index: i });
      }
    });
    return chunkArray(list, currentLayoutConfig.itemsPerPage);
  }, [tagItems, currentLayoutConfig.itemsPerPage]);

  const pagePadding = getPagePaddingStyle(activeLayoutKey);
  const tagOptions: TagRenderOptions = {
    showBarcode,
    showInternalCode,
    showPrintDate,
    showStoreLogo,
    tenant,
    todayFormatted,
  };

  return (
    <div id="price-tags-print-container" className="hidden print:block w-full bg-white">
      {paginatedPages.map((pageItems, pageIdx) => {
        const isLastPage = pageIdx === paginatedPages.length - 1;
        return (
          <div
            key={`print-page-${pageIdx}`}
            className={`print-page price-tag-sheet w-[210mm] h-[296mm] max-h-[296mm] mx-auto bg-white overflow-hidden ${
              !isLastPage ? 'page-break-after-always break-after-page' : ''
            }`}
            style={{
              width: '210mm',
              height: '296mm',
              maxHeight: '296mm',
              minHeight: '296mm',
              boxSizing: 'border-box',
              overflow: 'hidden',
              ...pagePadding,
            }}
          >
            <div className={`grid ${currentLayoutConfig.gridClass} w-full h-full`}>
              {pageItems.map(({ item, index: itemRepIndex }, itemIdx) => {
                const uniqueKey = `print-${activeLayoutKey}-${item.id}-${pageIdx}-${itemIdx}-${itemRepIndex}`;
                return renderTagCard(item, activeLayoutKey, uniqueKey, tagOptions);
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================

const MAX_SEARCH_RESULTS = 30;

const QUICK_BADGES = [
  'SUPER OFERTA',
  'VALIDADE PRÓXIMA',
  'DESTAQUE DA SEMANA',
  'LEVE + POR MENOS',
  'PREÇO BAIXO',
  'OFERTA ESPECIAL',
  'LANÇAMENTO',
  'GENÉRICO EM CONTA',
];

interface AdminPriceTagsProps {
  products: Product[];
  tenant: PharmacyConfig;
  promotions?: PromotionRule[];
}

export const AdminPriceTags: React.FC<AdminPriceTagsProps> = ({
  products,
  tenant,
}) => {
  // --- Estados de Busca e Filtros com Debounce e DeferredValue ---
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const deferredSearch = useDeferredValue(debouncedSearch);

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [onlyPromotions, setOnlyPromotions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce de 250ms para desacoplar a digitação do filtro pesado de catálogo
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 250);
    return () => clearTimeout(handler);
  }, [searchInput]);

  // --- Estados de Escaneamento e Notificações ---
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerToast, setScannerToast] = useState<{
    id: number;
    title: string;
    description: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // Web Audio API para Som de Bip
  const playBeep = useCallback((type: 'success' | 'error' = 'success') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch {
      // Navegadores que bloqueiam áudio automático
    }
  }, []);

  const showToast = useCallback((title: string, description: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setScannerToast({
      id: Date.now(),
      title,
      description,
      type
    });
    toastTimeoutRef.current = setTimeout(() => {
      setScannerToast(null);
    }, 3500);
  }, []);

  // --- Fila de Etiquetas ---
  const [tagItems, setTagItems] = useState<PriceTagItem[]>([]);

  // --- Configurações Globais da Etiqueta ---
  const [layoutFormat, setLayoutFormat] = useState<TagLayoutFormat>('gondola');
  const [showBarcode, setShowBarcode] = useState(true);
  const [showInternalCode, setShowInternalCode] = useState(true);
  const [showPrintDate, setShowPrintDate] = useState(true);
  const [showStoreLogo, setShowStoreLogo] = useState(true);
  const [globalBadge, setGlobalBadge] = useState('');

  // --- Modal de Pré-Visualização / Impressão ---
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Categorias únicas para filtro
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [products]);

  // Filtro de produtos do catálogo acionado pelo deferredSearch desacoplado
  const filteredCatalog = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();

    return products.filter((p) => {
      if (onlyPromotions) {
        const hasPromo = 
          (p.promotionalPrice && p.promotionalPrice < p.price) ||
          (p.promotional_price && p.promotional_price < p.price) ||
          (p.promotionType && p.promotionType !== 'NONE') ||
          p.isFeatured;
        if (!hasPromo) return false;
      }

      if (selectedCategory !== 'all' && p.category !== selectedCategory) {
        return false;
      }

      if (query) {
        const matchName = (p.name || '').toLowerCase().includes(query);
        const matchEan = (p.barcode || '').toLowerCase().includes(query);
        const matchCode = (p.internalCode || '').toLowerCase().includes(query);
        const matchActive = (p.activePrinciple || '').toLowerCase().includes(query);
        const matchManufacturer = (p.manufacturer || '').toLowerCase().includes(query);
        return matchName || matchEan || matchCode || matchActive || matchManufacturer;
      }

      return true;
    });
  }, [products, onlyPromotions, selectedCategory, deferredSearch]);

  // Limite rígido de resultados para máxima fluidez do DOM
  const visibleProducts = useMemo(() => {
    return filteredCatalog.slice(0, MAX_SEARCH_RESULTS);
  }, [filteredCatalog]);

  // Set O(1) de produtos na fila
  const tagItemIdsSet = useMemo(() => {
    return new Set(tagItems.map((item) => item.id));
  }, [tagItems]);

  // Adicionar produto à fila (memoizado)
  const handleAddProduct = useCallback((product: Product, source: 'manual' | 'scanner' = 'manual') => {
    let wasAlreadyInQueue = false;

    setTagItems((prev) => {
      const exists = prev.some((item) => item.id === product.id);
      if (exists) {
        wasAlreadyInQueue = true;
        return prev.map((item) => {
          if (item.id === product.id) {
            return { ...item, quantity: item.quantity + 1 };
          }
          return item;
        });
      }

      const currentPrice = Number(product.price) || 0;
      const promo = Number(product.promotionalPrice || product.promotional_price || 0);
      const hasPromo = promo > 0 && promo < currentPrice;

      const newItem: PriceTagItem = {
        id: product.id,
        product,
        quantity: 1,
        badgeText: globalBadge || (hasPromo ? 'SUPER OFERTA' : ''),
        originalPrice: hasPromo ? currentPrice : currentPrice,
        promotionalPrice: hasPromo ? promo : currentPrice,
        showOriginalPrice: hasPromo,
        unitMeasurementText: '',
        customObservations: '',
        expiryDate: ''
      };

      return [newItem, ...prev];
    });

    if (source === 'scanner') {
      playBeep('success');
      showToast(
        wasAlreadyInQueue ? 'Quantidade incrementada (+1)' : 'Produto adicionado à fila',
        `${product.name} • ${product.barcode || product.internalCode || ''}`,
        'success'
      );
    }
  }, [globalBadge, playBeep, showToast]);

  // Função para processar código de barras (Leitor Físico USB/Bluetooth ou Câmera)
  const handleBarcodeScanned = useCallback((rawBarcode: string) => {
    const code = rawBarcode.trim();
    if (!code) return false;

    const cleanCode = code.replace(/\s+/g, '');

    const matchedProduct = products.find((p) => {
      const pBarcode = (p.barcode || '').trim().replace(/\s+/g, '');
      const pInternal = (p.internalCode || '').trim().replace(/\s+/g, '');
      return pBarcode === cleanCode || pInternal === cleanCode;
    });

    if (matchedProduct) {
      handleAddProduct(matchedProduct, 'scanner');
      setSearchInput('');
      setDebouncedSearch('');
      setIsScannerOpen(false);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return true;
    } else {
      playBeep('error');
      showToast(
        'Produto não cadastrado',
        `Nenhum produto encontrado com o código: ${code}`,
        'error'
      );
      setTimeout(() => {
        searchInputRef.current?.select();
      }, 50);
      return false;
    }
  }, [products, handleAddProduct, playBeep, showToast]);

  // Adicionar todos os filtrados em lote (memoizado)
  const handleAddAllFiltered = useCallback(() => {
    const toAdd = filteredCatalog.filter((p) => !tagItemIdsSet.has(p.id));
    if (toAdd.length === 0) return;

    const newItems: PriceTagItem[] = toAdd.map((product) => {
      const currentPrice = Number(product.price) || 0;
      const promo = Number(product.promotionalPrice || product.promotional_price || 0);
      const hasPromo = promo > 0 && promo < currentPrice;

      return {
        id: product.id,
        product,
        quantity: 1,
        badgeText: globalBadge || (hasPromo ? 'SUPER OFERTA' : ''),
        originalPrice: hasPromo ? currentPrice : currentPrice,
        promotionalPrice: hasPromo ? promo : currentPrice,
        showOriginalPrice: hasPromo,
        unitMeasurementText: '',
        customObservations: '',
        expiryDate: ''
      };
    });

    setTagItems((prev) => [...newItems, ...prev]);
  }, [filteredCatalog, tagItemIdsSet, globalBadge]);

  // Remover produto da fila (memoizado)
  const handleRemoveItem = useCallback((id: string) => {
    setTagItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Limpeza de estado atômica e instantânea da fila
  const handleClearAll = useCallback(() => {
    setTagItems([]);
  }, []);

  // Atualizar campo de um item (memoizado)
  const handleUpdateItem = useCallback((id: string, updates: Partial<PriceTagItem>) => {
    setTagItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  }, []);

  // Aplicar badge em massa
  const handleApplyGlobalBadge = useCallback((badge: string) => {
    setGlobalBadge(badge);
    if (tagItems.length > 0) {
      setTagItems((prev) =>
        prev.map((item) => ({ ...item, badgeText: badge }))
      );
    }
  }, [tagItems.length]);

  // Tecla de atalho Enter no campo de busca (EAN ou Código Interno)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const term = searchInput.trim();
      if (term) {
        const found = handleBarcodeScanned(term);
        if (found) {
          e.preventDefault();
        }
      }
    }
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // Estado e controle do Histórico de Lotes (48h)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [recentBatches, setRecentBatches] = useState<PriceTagBatch[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [isSavingBatch, setIsSavingBatch] = useState(false);

  const loadBatches = useCallback(async () => {
    setIsLoadingBatches(true);
    try {
      const list = await fetchRecentPriceTagBatches(tenant.id);
      setRecentBatches(list);
    } catch (err) {
      console.warn('[AdminPriceTags] Erro ao carregar histórico de lotes:', err);
    } finally {
      setIsLoadingBatches(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const activeLayoutKey = normalizeLayoutKey(layoutFormat);

  // Salvamento assíncrono do lote atual
  const handleSaveCurrentBatch = useCallback(async (showNotification: boolean = true) => {
    if (tagItems.length === 0) return;
    setIsSavingBatch(true);
    try {
      const saved = await savePriceTagBatch(tenant.id, activeLayoutKey, tagItems);
      if (saved) {
        setRecentBatches((prev) => [saved, ...prev.filter((b) => b.id !== saved.id)]);
        if (showNotification) {
          showToast('Lote de etiquetas salvo no histórico (válido por 48h)', 'success');
        }
      }
    } catch (err) {
      console.warn('[AdminPriceTags] Erro ao salvar lote:', err);
    } finally {
      setIsSavingBatch(false);
    }
  }, [tenant.id, activeLayoutKey, tagItems, showToast]);

  // Impressão nativa imediata com persistência em background
  const handlePrint = useCallback(() => {
    if (tagItems.length > 0) {
      // Disparo em background sem travar o diálogo window.print()
      savePriceTagBatch(tenant.id, activeLayoutKey, tagItems)
        .then((saved) => {
          if (saved) {
            setRecentBatches((prev) => [saved, ...prev.filter((b) => b.id !== saved.id)]);
          }
        })
        .catch((err) => {
          console.warn('[AdminPriceTags] Erro em background ao registrar lote impresso:', err);
        });
    }
    window.print();
  }, [tagItems, tenant.id, activeLayoutKey]);

  // Reimpressão com 1 clique a partir de um lote do histórico
  const handleReprintBatch = useCallback((batch: PriceTagBatch) => {
    const restoredItems = deserializeSnapshotToTagItems(batch.items, products);
    setTagItems(restoredItems);
    setLayoutFormat(batch.model);
    setIsHistoryOpen(false);
    setIsPreviewOpen(true);
    playBeep();
    showToast(`Lote restaurado! ${batch.total_tags} etiquetas carregadas para reimpressão.`, 'success');
  }, [products, showToast, playBeep]);

  // Exclusão manual de um lote
  const handleDeleteBatch = useCallback(async (batchId: string) => {
    const success = await deletePriceTagBatch(batchId, tenant.id);
    if (success) {
      setRecentBatches((prev) => prev.filter((b) => b.id !== batchId));
      showToast('Lote removido do histórico com sucesso.', 'info');
    }
  }, [tenant.id, showToast]);

  const todayFormatted = useMemo(() => new Date().toLocaleDateString('pt-BR'), []);

  const totalTagsToPrint = useMemo(() => {
    return tagItems.reduce((acc, curr) => acc + (Number(curr.quantity) || 1), 0);
  }, [tagItems]);

  return (
    <>
      {/* 1. TODA A INTERFACE DO USUÁRIO (Oculta sumariamente na impressão) */}
      <div className="space-y-8 pb-16 print:hidden">
        {/* CABEÇALHO DO MÓDULO */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
            <Tag size={14} />
            <span>Gerador e Impressão de Etiquetas</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
            Etiquetas de Preço & Gôndola
          </h1>
          <p className="text-sm text-gray-500 max-w-2xl font-medium">
            Selecione produtos para imprimir folhas A4 padrão varejo farmacêutico com corte milimétrico, chamadas promocionais e códigos de barras nítidos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Botão de Histórico e Reimpressão de Lotes (48h) */}
          <button
            type="button"
            onClick={() => {
              loadBatches();
              setIsHistoryOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 shadow-xs transition-all active:scale-95 cursor-pointer relative"
            title="Ver lotes gerados nas últimas 48 horas para reimpressão imediata"
          >
            <History size={18} className="text-emerald-600" />
            <span>Histórico / Reimpressão (48h)</span>
            {recentBatches.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                {recentBatches.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            disabled={tagItems.length === 0}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black text-white shadow-lg transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            style={{ backgroundColor: tenant.primaryColor || '#059669' }}
          >
            <Eye size={18} />
            <span>Pré-visualizar & Imprimir ({totalTagsToPrint})</span>
          </button>
        </div>
      </div>

      {/* GRID PRINCIPAL: 2 COLUNAS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* COLUNA 1: CATÁLOGO & SELEÇÃO DE PRODUTOS (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Search size={18} className="text-emerald-600" />
                Catálogo de Produtos
              </h2>
              <span className="text-xs font-bold text-gray-400">
                {filteredCatalog.length} encontrados
              </span>
            </div>

            {/* Campo de Busca Desacoplado */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Buscar ou bipar EAN / Código com o leitor..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-10 pr-9 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 placeholder-gray-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 focus:outline-none transition-all"
                />
                {searchInput ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput('');
                      setDebouncedSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => searchInputRef.current?.focus()}
                    title="Pronto para leitura contínua com pistola óptica USB/Bluetooth"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-emerald-600 transition-colors cursor-pointer"
                  >
                    <ScanLine size={15} />
                  </button>
                )}
              </div>

              {/* Botão de Scanner de Câmera */}
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                title="Escanear Código de Barras (Câmera ou Leitor USB)"
                className="px-3 py-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 active:scale-95 border border-emerald-200 rounded-xl flex items-center justify-center gap-1.5 text-xs font-black transition-all shrink-0 cursor-pointer shadow-2xs"
              >
                <ScanLine size={16} />
                <span className="hidden sm:inline">Escanear</span>
              </button>
            </div>

            {/* Dica do leitor óptico */}
            <div className="flex items-center justify-between px-1 text-[11px] text-gray-400">
              <span className="flex items-center gap-1">
                <ScanLine size={12} className="text-emerald-600" />
                Pistola USB ou câmera: bipe para incluir na fila
              </span>
              <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                Auto-adiciona ao bipar
              </span>
            </div>

            {/* Filtros Secundários */}
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="flex-1 min-w-[140px] px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 focus:bg-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">Todas as Categorias</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setOnlyPromotions(!onlyPromotions)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  onlyPromotions
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                <Percent size={13} />
                <span>Em Promoção</span>
              </button>
            </div>

            {/* Ações em Lote do Catálogo */}
            <div className="flex items-center justify-between pt-1 border-t border-gray-100 text-xs">
              <button
                type="button"
                onClick={handleAddAllFiltered}
                disabled={filteredCatalog.length === 0}
                className="font-black text-emerald-600 hover:text-emerald-700 transition-colors disabled:opacity-40 cursor-pointer"
              >
                + Adicionar todos os {filteredCatalog.length} filtrados
              </button>
            </div>

            {/* Aviso de Limite de Resultados */}
            {filteredCatalog.length > MAX_SEARCH_RESULTS && (
              <div className="px-3 py-2 bg-amber-50/80 border border-amber-200/70 rounded-xl text-[11px] font-medium text-amber-800 flex items-center justify-between">
                <span>Exibindo os primeiros {MAX_SEARCH_RESULTS} resultados (refine a busca se necessário)</span>
                <span className="font-bold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded text-[10px]">
                  {filteredCatalog.length} no total
                </span>
              </div>
            )}

            {/* Lista com Rolagem dos Produtos (Limitada aos primeiros 30 para 60 FPS) */}
            <div className="max-h-[500px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {filteredCatalog.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-gray-100 rounded-2xl">
                  <AlertCircle size={28} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-xs font-bold text-gray-500">Nenhum produto encontrado</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Tente alterar os termos de busca ou filtros.</p>
                </div>
              ) : (
                visibleProducts.map((product) => (
                  <CatalogProductItem
                    key={product.id}
                    product={product}
                    inQueue={tagItemIdsSet.has(product.id)}
                    onAdd={handleAddProduct}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* COLUNA 2: CONFIGURAÇÃO DE MODELO E FILA DE IMPRESSÃO (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* SELETOR VISUAL DO MODELO DE ETIQUETA */}
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Sliders size={18} className="text-emerald-600" />
                Modelo & Formato da Etiqueta
              </h2>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-100">
                Padrão Varejo Farma
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Modelo 1: Gôndola Padrão */}
              <button
                type="button"
                onClick={() => setLayoutFormat('gondola')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  activeLayoutKey === 'gondola'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs">
                      30
                    </div>
                    <span className="text-[10px] font-black uppercase text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-full">
                      3x10
                    </span>
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Gôndola Padrão</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    30 por folha A4 com área de corte (h: 26mm)
                  </p>
                </div>
                <span className="text-[9px] font-black uppercase text-emerald-700 mt-3 block">
                  Mais Usado na Farmácia
                </span>
              </button>

              {/* Modelo 2: Etiqueta Baiana / Testeira */}
              <button
                type="button"
                onClick={() => setLayoutFormat('baiana')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  activeLayoutKey === 'baiana'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-black text-xs">
                      8
                    </div>
                    <span className="text-[10px] font-black uppercase text-amber-700 bg-amber-100/60 px-2 py-0.5 rounded-full">
                      2x4
                    </span>
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Etiqueta Baiana</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    8 por folha A4 (h: 65mm). Destaque em ponta de gôndola.
                  </p>
                </div>
                <span className="text-[9px] font-black uppercase text-amber-700 mt-3 block">
                  Médio Impacto
                </span>
              </button>

              {/* Modelo 3: Cartaz Promocional A5 */}
              <button
                type="button"
                onClick={() => setLayoutFormat('cartaz_a5')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  activeLayoutKey === 'cartaz_a5'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center font-black text-xs">
                      2
                    </div>
                    <span className="text-[10px] font-black uppercase text-purple-700 bg-purple-100/60 px-2 py-0.5 rounded-full">
                      1x2
                    </span>
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Cartaz A5</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    2 cartazes por folha A4 (h: 135mm)
                  </p>
                </div>
                <span className="text-[9px] font-black uppercase text-purple-700 mt-3 block">
                  Ilhas & Cestões
                </span>
              </button>

              {/* Modelo 4: Cartaz A4 Inteiro */}
              <button
                type="button"
                onClick={() => setLayoutFormat('cartaz_a4')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  activeLayoutKey === 'cartaz_a4'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-8 h-8 rounded-xl bg-red-100 text-red-800 flex items-center justify-center font-black text-xs">
                      1
                    </div>
                    <span className="text-[10px] font-black uppercase text-red-700 bg-red-100/60 px-2 py-0.5 rounded-full">
                      1x1
                    </span>
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Cartaz A4</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    1 cartaz folha inteira A4 (h: 277mm)
                  </p>
                </div>
                <span className="text-[9px] font-black uppercase text-red-700 mt-3 block">
                  Vitrine e Fachada
                </span>
              </button>
            </div>

            {/* Checkboxes de Elementos Opcionais */}
            <div className="pt-3 border-t border-gray-100">
              <label className="text-[11px] font-black uppercase text-gray-400 block mb-2">
                Opções de Exibição nas Etiquetas
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showBarcode}
                    onChange={(e) => setShowBarcode(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Código de Barras (EAN)</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showInternalCode}
                    onChange={(e) => setShowInternalCode(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Código Interno</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showStoreLogo}
                    onChange={(e) => setShowStoreLogo(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Logo da Farmácia</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPrintDate}
                    onChange={(e) => setShowPrintDate(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Data de Impressão</span>
                </label>
              </div>
            </div>

            {/* Chamada Promocional Rápida em Massa */}
            <div className="pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-black uppercase text-gray-400">
                  Aplicar Chamada Promocional em Todos
                </label>
                {globalBadge && (
                  <button
                    type="button"
                    onClick={() => handleApplyGlobalBadge('')}
                    className="text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
                  >
                    Limpar Chamadas
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_BADGES.map((badge) => (
                  <button
                    key={badge}
                    type="button"
                    onClick={() => handleApplyGlobalBadge(badge)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-black uppercase transition-all cursor-pointer ${
                      globalBadge === badge
                        ? 'bg-amber-500 text-white shadow-2xs'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {badge}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* FILA DE PRODUTOS SELECIONADOS PARA IMPRESSÃO */}
          <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                  <FileText size={18} className="text-emerald-600" />
                  Itens Selecionados para Impressão ({tagItems.length})
                </h3>
                <p className="text-xs text-gray-400 font-medium">
                  {totalTagsToPrint} etiqueta(s) serão impressas no total calculando as repetições
                </p>
              </div>

              {tagItems.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSaveCurrentBatch(true)}
                    disabled={isSavingBatch}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors cursor-pointer border border-emerald-200 disabled:opacity-50"
                    title="Salvar lote atual para reimpressão posterior (48h)"
                  >
                    <Save size={14} />
                    <span>{isSavingBatch ? 'Salvando...' : 'Salvar Lote'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                    <span>Limpar Fila</span>
                  </button>
                </div>
              )}
            </div>

            {tagItems.length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed border-gray-200 rounded-3xl bg-gray-50/50">
                <Tag size={36} className="mx-auto text-gray-300 mb-3" />
                <h4 className="text-sm font-black text-gray-700">Nenhum produto na fila de impressão</h4>
                <p className="text-xs text-gray-400 max-w-sm mx-auto mt-1">
                  Selecione os produtos na lista ao lado para personalizar preços, chamadas promocionais e imprimir etiquetas.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1 custom-scrollbar">
                {tagItems.map((item) => (
                  <SelectedTagItem
                    key={item.id}
                    item={item}
                    onUpdate={handleUpdateItem}
                    onRemove={handleRemoveItem}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE PRÉ-VISUALIZAÇÃO & IMPRESSÃO (CARREGADO APENAS QUANDO ABERTO) */}
      <PrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        tagItems={tagItems}
        activeLayoutKey={activeLayoutKey}
        showBarcode={showBarcode}
        showInternalCode={showInternalCode}
        showPrintDate={showPrintDate}
        showStoreLogo={showStoreLogo}
        tenant={tenant}
        todayFormatted={todayFormatted}
        onPrint={handlePrint}
      />

      {/* MODAL DE HISTÓRICO & REIMPRESSÃO DE LOTES (48 HORAS) */}
      <PriceTagBatchesHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        batches={recentBatches}
        isLoading={isLoadingBatches}
        onRefresh={loadBatches}
        onReprintBatch={handleReprintBatch}
        onDeleteBatch={handleDeleteBatch}
      />

      {/* MODAL SCANNER DE PRODUTO */}
      {isScannerOpen && (
        <ProductScanner
          title="Entrada de Produto"
          description="Escolha como deseja ler o código de barras do produto."
          onScan={(code) => {
            handleBarcodeScanned(code);
          }}
          onClose={() => setIsScannerOpen(false)}
        />
      )}

      {/* TOAST OPERACIONAL FLUTUANTE */}
      {scannerToast && (
        <div className="fixed bottom-6 right-6 z-[10000] max-w-sm w-full animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div
            className={`p-4 rounded-2xl shadow-xl border flex items-start gap-3 backdrop-blur-md ${
              scannerToast.type === 'success'
                ? 'bg-emerald-900/95 text-white border-emerald-700 shadow-emerald-950/20'
                : scannerToast.type === 'error'
                ? 'bg-red-900/95 text-white border-red-700 shadow-red-950/20'
                : 'bg-gray-900/95 text-white border-gray-700 shadow-gray-950/20'
            }`}
          >
            <div
              className={`p-2 rounded-xl shrink-0 ${
                scannerToast.type === 'success'
                  ? 'bg-emerald-800 text-emerald-300'
                  : scannerToast.type === 'error'
                  ? 'bg-red-800 text-red-300'
                  : 'bg-gray-800 text-gray-300'
              }`}
            >
              {scannerToast.type === 'success' ? (
                <Check size={18} />
              ) : scannerToast.type === 'error' ? (
                <AlertCircle size={18} />
              ) : (
                <ScanLine size={18} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black uppercase tracking-wide">{scannerToast.title}</h4>
                <button
                  type="button"
                  onClick={() => setScannerToast(null)}
                  className="text-white/60 hover:text-white p-0.5 cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
              <p className="text-xs text-white/80 font-medium truncate mt-0.5">
                {scannerToast.description}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/60 font-mono">
                <span>Fila: {totalTagsToPrint} etiqueta(s)</span>
                <span className="flex items-center gap-1">
                  <Volume2 size={10} /> Bip ativo
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* 2. CONTAINER EXCLUSIVO DE IMPRESSÃO (Só aparece ao imprimir/salvar PDF) */}
      <PrintContainer
        tagItems={tagItems}
        activeLayoutKey={activeLayoutKey}
        showBarcode={showBarcode}
        showInternalCode={showInternalCode}
        showPrintDate={showPrintDate}
        showStoreLogo={showStoreLogo}
        tenant={tenant}
        todayFormatted={todayFormatted}
      />
    </>
  );
};
