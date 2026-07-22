import React, { useState, useMemo } from "react";
import { PromotionRule, Product, CartItem, checkProductMatchesRule } from "../types";
import { Check, ShoppingBag, Sparkles, Tag } from "lucide-react";
import { toast } from "react-hot-toast";

interface BundlePromoCardProps {
  promo: PromotionRule;
  products: Product[];
  matrizProducts?: Product[];
  onAddToCart: (item: CartItem) => void;
}

const GENERIC_PLACEHOLDER = "https://i.imgur.com/fLz8F3X.png";

const fixImageUrl = (url?: string, width: number = 250): string | null => {
  if (!url || url === "IGNORE" || url === "PENDENTE_CURADORIA") return null;
  if (url.startsWith("data:")) return url;
  if (url.includes("cdn-cosmos.bluesoft.com.br")) return url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&q=80&w=${width}&we&default=${encodeURIComponent(GENERIC_PLACEHOLDER)}`;
};

export const BundlePromoCard: React.FC<BundlePromoCardProps> = ({
  promo,
  products,
  matrizProducts = [],
  onAddToCart,
}) => {
  const [selectedProducts, setSelectedProducts] = useState<Record<number, Product>>({});

  const effectiveSlots = useMemo(() => {
    const slots = promo.bundleSlots || (promo as any).bundle_slots;
    if (Array.isArray(slots) && slots.length > 0) {
      return slots;
    }
    const fm = (promo.filtersMetadata as any) || {};
    const fmSlots = fm.bundleSlots || fm.bundle_slots || fm.slots;
    if (Array.isArray(fmSlots) && fmSlots.length > 0) {
      return fmSlots;
    }
    const specIds = promo.specificProductIds || (promo as any).specific_product_ids || (promo as any).product_ids || (promo as any).productIds || promo.comboProducts || [];
    if (Array.isArray(specIds) && specIds.length > 0) {
      return [specIds];
    }
    return [];
  }, [promo]);

  const effectiveSlotsToUse = useMemo(() => {
    if (effectiveSlots.length > 0) return effectiveSlots;
    const matching = products.filter(p => checkProductMatchesRule(promo, p, matrizProducts));
    const ids = matching.map(p => p.id);
    if (ids.length > 0) return [ids];
    return [];
  }, [effectiveSlots, products, promo, matrizProducts]);

  const getProductsForSlot = (slotProductIds: string[]) => {
    let sanitizedIds = new Set<string>();
    if (Array.isArray(slotProductIds)) {
      slotProductIds.forEach(id => {
        const strId = typeof id === "object" ? String((id as any)?.id || (id as any)?.productId || (id as any)?.product_id || (id as any)?.ean || (id as any)?.barcode || "").trim() : String(id).trim();
        if (strId) sanitizedIds.add(strId);
      });
    }

    const targetEans = new Set<string>();
    matrizProducts.forEach(mp => {
      if (mp) {
        const mpId = mp.id ? String(mp.id).trim() : "";
        const mpBarcode = mp.barcode ? String(mp.barcode).trim() : "";
        if (sanitizedIds.has(mpId) || (mpBarcode && sanitizedIds.has(mpBarcode))) {
          if (mpBarcode) targetEans.add(mpBarcode);
        }
      }
    });

    products.forEach(p => {
      if (p) {
        const pId = p.id ? String(p.id).trim() : "";
        const pBarcode = p.barcode ? String(p.barcode).trim() : "";
        if (sanitizedIds.has(pId) || (pBarcode && sanitizedIds.has(pBarcode))) {
          if (pBarcode) targetEans.add(pBarcode);
        }
      }
    });

    const matched = products.filter(p => {
      if (!p) return false;
      const pId = p.id ? String(p.id).trim() : "";
      const pBarcode = p.barcode ? String(p.barcode).trim() : "";
      const pEan = (p as any).ean ? String((p as any).ean).trim() : "";
      if (pId && sanitizedIds.has(pId)) return true;
      if (pBarcode && sanitizedIds.has(pBarcode)) return true;
      if (pEan && sanitizedIds.has(pEan)) return true;
      if (pBarcode && targetEans.has(pBarcode)) return true;
      if (pEan && targetEans.has(pEan)) return true;
      return false;
    });

    if (matched.length > 0) return matched;

    return products.filter(p => checkProductMatchesRule(promo, p, matrizProducts));
  };

  const isComplete = useMemo(() => {
    if (effectiveSlotsToUse.length === 0) return false;
    return effectiveSlotsToUse.every((_, index) => !!selectedProducts[index]);
  }, [effectiveSlotsToUse, selectedProducts]);

  const selectedList = Object.values(selectedProducts);

  const totalIndividualPrice = useMemo(() => {
    return selectedList.reduce((acc, curr) => acc + (curr.price || 0), 0);
  }, [selectedList]);

  const savings = useMemo(() => {
    if (!promo.bundlePrice || totalIndividualPrice <= promo.bundlePrice) return 0;
    return totalIndividualPrice - promo.bundlePrice;
  }, [totalIndividualPrice, promo.bundlePrice]);

  const handleSelectProduct = (slotIndex: number, product: Product) => {
    setSelectedProducts((prev) => ({
      ...prev,
      [slotIndex]: product,
    }));
  };

  const handleAddBundleToCart = () => {
    if (!isComplete) {
      toast.error("Por favor, selecione 1 item de cada grupo para formar o combo.");
      return;
    }
    
    // Add all selected products to cart
    Object.values(selectedProducts).forEach((product) => {
      onAddToCart({
        ...product,
        quantity: 1,
      });
    });
    
    toast.success("Combo adicionado ao carrinho!");
    setSelectedProducts({}); // Reset selection
  };

  if (effectiveSlotsToUse.length === 0 && products.length === 0) {
    return (
      <div className="bg-pink-50 rounded-3xl p-6 border-2 border-pink-200 mb-8 text-center animate-pulse">
        <p className="text-sm font-bold text-pink-700">Carregando itens do combo...</p>
      </div>
    );
  }

  if (effectiveSlotsToUse.length === 0) return null;

  const totalSlots = effectiveSlotsToUse.length;
  const completedSlots = Object.keys(selectedProducts).length;

  return (
    <div className="bg-gradient-to-br from-pink-50/80 via-purple-50/50 to-pink-50/80 rounded-3xl p-5 md:p-6 border-2 border-pink-200/80 shadow-md mb-8 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-pink-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm shadow-pink-200">
              <Sparkles size={12} />
              Combo Especial
            </span>
            {savings > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                <Tag size={10} />
                Economize R$ {savings.toFixed(2).replace('.', ',')}
              </span>
            )}
          </div>
          <h3 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight leading-tight">
            {promo.name || "Monte seu Combo"}
          </h3>
          <p className="text-xs md:text-sm font-semibold text-gray-600 mt-1">
            Escolha 1 item de cada grupo e pague apenas <span className="font-extrabold text-pink-600">R$ {promo.bundlePrice?.toFixed(2).replace('.', ',')}</span>
          </p>
        </div>

        <div className="bg-white px-4 py-3 rounded-2xl border-2 border-pink-100 shadow-sm flex flex-col items-end shrink-0 self-start sm:self-center">
          <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-0.5">Preço do Combo</span>
          <div className="flex items-baseline gap-1.5">
            {totalIndividualPrice > 0 && totalIndividualPrice > (promo.bundlePrice || 0) && (
              <span className="text-xs font-bold text-gray-400 line-through">
                R$ {totalIndividualPrice.toFixed(2).replace('.', ',')}
              </span>
            )}
            <span className="text-2xl font-black text-pink-600 leading-none">
              R$ {promo.bundlePrice?.toFixed(2).replace('.', ',')}
            </span>
          </div>
        </div>
      </div>

      {/* Slots Grid */}
      <div className={`grid grid-cols-1 ${totalSlots === 2 ? 'md:grid-cols-2' : totalSlots >= 3 ? 'md:grid-cols-2 lg:grid-cols-3' : ''} gap-4 mb-6`}>
        {effectiveSlotsToUse.map((slotProductIds, index) => {
          const slotProducts = getProductsForSlot(slotProductIds);
          const selected = selectedProducts[index];
          
          return (
            <div key={index} className="bg-white rounded-2xl p-4 border-2 border-pink-100 shadow-sm flex flex-col h-full">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-pink-100 text-pink-700 font-black text-[10px] flex items-center justify-center">
                    {index + 1}
                  </span>
                  <span className="text-xs font-black uppercase text-gray-700 tracking-wider">
                    Grupo {index + 1}
                  </span>
                </div>
                {selected ? (
                  <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Check size={12} strokeWidth={3} /> Escolhido
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-pink-500 uppercase tracking-wider">
                    Selecione 1
                  </span>
                )}
              </div>
              
              <div className="space-y-2 flex-1 overflow-y-auto max-h-64 pr-1 custom-scrollbar">
                {slotProducts.length === 0 && (
                  <div className="text-xs text-gray-400 font-medium italic text-center py-6">
                    Nenhum produto disponível neste grupo
                  </div>
                )}
                {slotProducts.map((p) => {
                  const isSelected = selected?.id === p.id;
                  const imgUrl = fixImageUrl(p.image);

                  return (
                    <div 
                      key={p.id}
                      onClick={() => handleSelectProduct(index, p)}
                      className={`p-2.5 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${
                        isSelected 
                          ? "border-pink-500 bg-pink-50/70 shadow-sm" 
                          : "border-gray-100 hover:border-pink-200 bg-gray-50/60 hover:bg-white"
                      }`}
                    >
                      <div className="w-12 h-12 bg-white rounded-lg p-1 shrink-0 flex items-center justify-center border border-gray-100 overflow-hidden shadow-2xs">
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={p.name}
                            className="w-full h-full object-contain rounded-md"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-50 rounded-md flex items-center justify-center">
                            <ShoppingBag size={18} className="text-gray-300" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold leading-snug line-clamp-2 ${isSelected ? "text-pink-950" : "text-gray-900"}`}>
                          {p.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.manufacturer && (
                            <span className="text-[10px] font-semibold text-gray-400 truncate max-w-[100px]">
                              {p.manufacturer}
                            </span>
                          )}
                          {p.price > 0 && (
                            <span className="text-[11px] font-black text-emerald-600">
                              R$ {p.price.toFixed(2).replace('.', ',')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? "bg-pink-600 text-white" : "border-2 border-gray-300 text-transparent"
                      }`}>
                        <Check size={12} strokeWidth={3} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between border-t-2 border-pink-100 pt-4 gap-4">
        <div className="text-xs font-semibold text-gray-500 text-center sm:text-left">
          {isComplete ? (
            <span className="text-emerald-600 font-bold flex items-center gap-1.5">
              <Check size={16} className="bg-emerald-100 rounded-full p-0.5" />
              Todos os {totalSlots} grupos selecionados!
            </span>
          ) : (
            <span>
              Progresso: <strong className="text-pink-600">{completedSlots}</strong> de <strong className="text-gray-900">{totalSlots}</strong> itens selecionados
            </span>
          )}
        </div>

        <button
          onClick={handleAddBundleToCart}
          disabled={!isComplete}
          className={`w-full sm:w-auto px-8 py-3.5 rounded-2xl font-black text-xs md:text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-md ${
            isComplete 
              ? "bg-pink-600 text-white shadow-pink-200 hover:bg-pink-700 hover:scale-[1.02] active:scale-95 cursor-pointer"
              : "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none"
          }`}
        >
          {isComplete ? (
            <>
              <Check size={18} /> Adicionar Combo ao Carrinho (R$ {promo.bundlePrice?.toFixed(2).replace('.', ',')})
            </>
          ) : (
            <>
              Selecione 1 item de cada grupo ({completedSlots}/{totalSlots})
            </>
          )}
        </button>
      </div>
    </div>
  );
};
