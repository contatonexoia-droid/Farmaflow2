import React, { useState, useMemo } from "react";
import { PromotionRule, Product, CartItem } from "../types";
import { Check, ShoppingBag } from "lucide-react";
import { toast } from "react-hot-toast";

interface BundlePromoCardProps {
  promo: PromotionRule;
  products: Product[];
  matrizProducts?: Product[];
  onAddToCart: (item: CartItem) => void;
}

export const BundlePromoCard: React.FC<BundlePromoCardProps> = ({
  promo,
  products,
  matrizProducts = [],
  onAddToCart,
}) => {
  const [selectedProducts, setSelectedProducts] = useState<Record<number, Product>>({});

  const isNetworkScope = promo.scope === "NETWORK" || (promo.tenantId && products.length > 0 && products[0].tenantId !== promo.tenantId);

  const getProductsForSlot = (slotProductIds: string[]) => {
    return products.filter(p => {
      if (slotProductIds.includes(p.id)) return true;
      if (isNetworkScope && p.barcode) {
        const targetEans = matrizProducts
          .filter(mp => slotProductIds.includes(mp.id) && mp.barcode)
          .map(mp => mp.barcode);
        if (targetEans.includes(p.barcode)) return true;
      }
      return false;
    });
  };

  const isComplete = useMemo(() => {
    if (!promo.bundleSlots) return false;
    return promo.bundleSlots.every((_, index) => !!selectedProducts[index]);
  }, [promo.bundleSlots, selectedProducts]);

  const handleSelectProduct = (slotIndex: number, product: Product) => {
    setSelectedProducts((prev) => ({
      ...prev,
      [slotIndex]: product,
    }));
  };

  const handleAddBundleToCart = () => {
    if (!isComplete) {
      toast.error("Por favor, selecione um produto de cada grupo para formar o combo.");
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

  if (!promo.bundleSlots || promo.bundleSlots.length === 0) return null;

  return (
    <div className="bg-gradient-to-br from-pink-50 to-purple-50 rounded-3xl p-6 border-2 border-pink-100 shadow-sm mb-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-pink-100 text-pink-700 text-[10px] font-black uppercase tracking-widest mb-2">
            <ShoppingBag size={12} />
            Combo Especial
          </div>
          <h3 className="text-xl font-black text-gray-900 tracking-tight leading-tight">
            {promo.name || "Monte seu Combo"}
          </h3>
          <p className="text-sm font-medium text-gray-500 mt-1">
            Escolha 1 item de cada grupo e pague apenas <span className="font-bold text-pink-600">R$ {promo.bundlePrice?.toFixed(2)}</span>
          </p>
        </div>
        <div className="bg-white px-4 py-3 rounded-2xl border-2 border-pink-100 shadow-sm flex flex-col items-end shrink-0">
          <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-0.5">Total do Combo</span>
          <span className="text-2xl font-black text-pink-600 leading-none">R$ {promo.bundlePrice?.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {promo.bundleSlots.map((slotProductIds, index) => {
          const slotProducts = getProductsForSlot(slotProductIds);
          const selected = selectedProducts[index];
          
          return (
            <div key={index} className="bg-white rounded-2xl p-4 border border-gray-100 flex flex-col h-full">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-black uppercase text-gray-400 tracking-widest">Grupo {index + 1}</span>
                {selected && (
                  <span className="bg-emerald-100 text-emerald-600 p-1 rounded-full">
                    <Check size={12} strokeWidth={4} />
                  </span>
                )}
              </div>
              
              <div className="space-y-2 flex-1 overflow-y-auto max-h-48 pr-1 custom-scrollbar">
                {slotProducts.length === 0 && (
                  <div className="text-xs text-gray-400 font-medium italic text-center py-4">
                    Nenhum produto disponível
                  </div>
                )}
                {slotProducts.map((p) => (
                  <div 
                    key={p.id}
                    onClick={() => handleSelectProduct(index, p)}
                    className={`p-2 rounded-xl border-2 cursor-pointer transition-all flex items-center gap-3 ${
                      selected?.id === p.id 
                        ? "border-pink-500 bg-pink-50" 
                        : "border-gray-50 hover:border-pink-200 bg-gray-50 hover:bg-white"
                    }`}
                  >
                      <div className="w-10 h-10 bg-white rounded-lg p-1 shrink-0">
                        <div className="w-full h-full bg-gray-100 rounded-md flex items-center justify-center">
                          <ShoppingBag size={14} className="text-gray-300" />
                        </div>
                      </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold truncate ${selected?.id === p.id ? "text-pink-900" : "text-gray-900"}`}>
                        {p.name}
                      </p>
                      <p className="text-[10px] font-medium text-gray-400">
                        {p.category}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end border-t-2 border-pink-100/50 pt-6">
        <button
          onClick={handleAddBundleToCart}
          disabled={!isComplete}
          className={`px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-wider transition-all flex items-center gap-2 ${
            isComplete 
              ? "bg-pink-600 text-white shadow-lg shadow-pink-200 hover:bg-pink-700 hover:scale-[1.02] active:scale-95"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          {isComplete ? (
            <>
              <Check size={18} /> Adicionar Combo ao Carrinho
            </>
          ) : (
            <>
              Selecione 1 item de cada grupo
            </>
          )}
        </button>
      </div>
    </div>
  );
};
