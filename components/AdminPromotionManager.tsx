import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  Product,
  PharmacyConfig,
  PromotionRule,
  FlashDealsScheduleConfig,
} from "../types";
import {
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Tag,
  Calendar,
  Package,
  Layers,
  Factory,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Percent,
  ShoppingBag,
  Search,
  Filter,
  DollarSign,
  Check,
  MinusCircle,
  Clock,
  Zap,
  Timer,
} from "lucide-react";
import {
  savePromotion,
  deletePromotion,
  getPromotionsByTenant,
  getTenants,
} from "../services/storage";
import { supabase } from "../services/supabase";
import { SmartNumberInput } from "./SmartNumberInput";
import { ScheduleEditor } from "./ScheduleEditor";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { PromotionEditModal } from "./PromotionEditModal";

// Helper to convert an ISO date string (UTC) to a local datetime-local string (YYYY-MM-DDTHH:mm) safely
const toLocalDateTimeString = (
  isoString: string | undefined | null,
): string => {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch (err) {
    return "";
  }
};

// Helper to parse a local datetime-local string (YYYY-MM-DDTHH:mm) or date string (YYYY-MM-DD) to a UTC ISO string safely
const toUtcIsoString = (
  localString: string | undefined | null,
): string | undefined => {
  if (!localString) return undefined;
  try {
    if (localString.includes("T")) {
      const parts = localString.split("T");
      if (parts.length !== 2) return undefined;
      const [datePart, timePart] = parts;
      const [year, month, day] = datePart.split("-").map(Number);
      const [hours, minutes] = timePart.split(":").map(Number);
      if (
        isNaN(year) ||
        isNaN(month) ||
        isNaN(day) ||
        isNaN(hours) ||
        isNaN(minutes)
      )
        return undefined;

      const localDate = new Date(year, month - 1, day, hours, minutes);
      return localDate.toISOString();
    } else {
      const parts = localString.split("-");
      if (parts.length !== 3) return undefined;
      const [year, month, day] = parts.map(Number);
      if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;

      const localDate = new Date(year, month - 1, day, 0, 0, 0, 0);
      return localDate.toISOString();
    }
  } catch (err) {
    return undefined;
  }
};

// Memoized Product Row to prevent unnecessary re-renders
const ProductRow = React.memo(
  ({
    product,
    isSelected,
    onToggle,
    style,
  }: {
    product: Product;
    isSelected: boolean;
    onToggle: (id: string) => void;
    style?: React.CSSProperties;
  }) => {
    return (
      <div
        style={style}
        className={`flex items-center border-b border-gray-50 hover:bg-gray-50 transition-colors ${isSelected ? "bg-blue-50/30" : ""}`}
      >
        <div className="p-3 w-10 flex-shrink-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(product.id)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
        </div>
        <div className="p-3 w-12 flex-shrink-0">
          <img
            src={product.image}
            alt=""
            className="w-8 h-8 rounded-lg object-cover bg-gray-100"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="p-3 flex-1 min-w-0">
          <div className="text-xs font-bold text-gray-900 truncate">
            {product.name}
          </div>
          <div className="text-[9px] text-gray-400 font-medium truncate">
            {product.category} | {product.manufacturer}
          </div>
        </div>
        <div className="p-3 w-32 flex-shrink-0 text-[10px] font-mono text-gray-500 truncate">
          {product.barcode || product.internalCode}
        </div>
        <div className="p-3 w-24 flex-shrink-0 text-center">
          {product.stock < 3 ? (
            <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-1 rounded-md">
              Estoque: {product.stock}
            </span>
          ) : (
            <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded-md">
              Estoque: {product.stock}
            </span>
          )}
        </div>
        <div className="p-3 w-20 flex-shrink-0 text-xs font-black text-gray-900 text-right">
          R$ {product.price.toFixed(2)}
        </div>
        <div className="p-3 w-16 flex-shrink-0 text-center">
          {isSelected ? (
            <button
              onClick={() => onToggle(product.id)}
              className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-all"
              title="Remover da seleção"
            >
              <MinusCircle size={14} />
            </button>
          ) : (
            <button
              onClick={() => onToggle(product.id)}
              className="p-1.5 text-blue-400 hover:bg-blue-50 rounded-lg transition-all"
              title="Adicionar à seleção"
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>
    );
  },
);

ProductRow.displayName = "ProductRow";

const SearchableSelect = ({
  options,
  value,
  onChange,
  placeholder = "Selecione...",
  className = "w-full px-4 py-3 rounded-xl border-2 border-white focus-within:border-blue-500 transition-all font-medium bg-white",
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const normalizeString = (str: string) =>
    str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = normalizeString(searchTerm);
    return options.filter((opt) => normalizeString(opt.label).includes(term));
  }, [options, searchTerm]);

  const highlightMatch = (text: string) => {
    if (!searchTerm) return <>{text}</>;
    const term = normalizeString(searchTerm);
    const normalizedText = normalizeString(text);

    const index = normalizedText.indexOf(term);
    if (index === -1) return <>{text}</>;

    return (
      <>
        {text.substring(0, index)}
        <span className="bg-yellow-200 text-yellow-900 font-bold rounded-sm px-0.5">
          {text.substring(index, index + searchTerm.length)}
        </span>
        {text.substring(index + searchTerm.length)}
      </>
    );
  };

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className="relative" ref={wrapperRef}>
      <div
        className={`${className} flex items-center justify-between cursor-pointer`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span
          className={`truncate ${value ? "text-gray-900" : "text-gray-400"}`}
        >
          {selectedOption ? selectedOption.label : value || placeholder}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {value && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
                setSearchTerm("");
              }}
              className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
              title="Limpar seleção"
            >
              <X size={14} />
            </button>
          )}
          <ChevronRight
            size={16}
            className={`text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
          />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-60">
          <div className="p-2 border-b border-gray-50">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-100 text-sm focus:border-blue-500 focus:ring-0"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-sm text-gray-500 font-medium">
                Nenhum item encontrado
              </div>
            ) : (
              // Limit to 100 items to avoid performance issues when rendering large lists
              filteredOptions.slice(0, 100).map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchTerm("");
                  }}
                  className={`px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors truncate ${value === opt.value ? "bg-blue-50 text-blue-700 font-bold" : "hover:bg-gray-50 text-gray-700"}`}
                >
                  {highlightMatch(opt.label)}
                </div>
              ))
            )}
            {filteredOptions.length > 100 && (
              <div className="p-2 text-center text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                Mostrando os 100 primeiros resultados. Refine sua busca.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const MultiSelect = ({
  options,
  values,
  onChange,
  placeholder = "Selecione...",
  className = "w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white focus-within:border-blue-500 transition-all",
}: {
  options: { label: string; value: string }[];
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const normalizeString = (str: string) =>
    str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = normalizeString(searchTerm);
    return options.filter((opt) => normalizeString(opt.label).includes(term));
  }, [options, searchTerm]);

  const highlightMatch = (text: string) => {
    if (!searchTerm) return <>{text}</>;
    const term = normalizeString(searchTerm);
    const normalizedText = normalizeString(text);

    const index = normalizedText.indexOf(term);
    if (index === -1) return <>{text}</>;

    return (
      <>
        {text.substring(0, index)}
        <span className="bg-yellow-200 text-yellow-900 font-bold rounded-sm px-0.5">
          {text.substring(index, index + searchTerm.length)}
        </span>
        {text.substring(index + searchTerm.length)}
      </>
    );
  };

  const toggleOption = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const toggleAll = () => {
    if (filteredOptions.every((opt) => values.includes(opt.value))) {
      // Deselect all filtered
      const filteredValues = filteredOptions.map((o) => o.value);
      onChange(values.filter((v) => !filteredValues.includes(v)));
    } else {
      // Select all filtered
      const newValues = new Set([
        ...values,
        ...filteredOptions.map((o) => o.value),
      ]);
      onChange(Array.from(newValues));
    }
  };

  const removeValue = (e: React.MouseEvent, valueToRemove: string) => {
    e.stopPropagation();
    onChange(values.filter((v) => v !== valueToRemove));
  };

  const selectedOptions = options.filter((opt) => values.includes(opt.value));

  return (
    <div className="relative" ref={wrapperRef}>
      <div
        className={`${className} flex items-center justify-between cursor-pointer min-h-[38px]`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex flex-wrap gap-1 flex-1 overflow-hidden">
          {selectedOptions.length > 0 ? (
            selectedOptions.map((opt) => (
              <span
                key={opt.value}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold"
              >
                <span className="truncate max-w-[100px]">{opt.label}</span>
                <button
                  onClick={(e) => removeValue(e, opt.value)}
                  className="hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))
          ) : (
            <span className="text-gray-400 truncate">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {values.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
                setSearchTerm("");
              }}
              className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
              title="Limpar tudo"
            >
              <X size={14} />
            </button>
          )}
          <ChevronRight
            size={16}
            className={`text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
          />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-60">
          <div className="p-2 border-b border-gray-50">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-100 text-sm focus:border-blue-500 focus:ring-0"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
            {filteredOptions.length > 0 && (
              <div className="mt-2 px-1">
                <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer hover:bg-gray-50 p-1.5 rounded-lg">
                  <input
                    type="checkbox"
                    checked={
                      filteredOptions.length > 0 &&
                      filteredOptions.every((opt) => values.includes(opt.value))
                    }
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Selecionar Todos ({filteredOptions.length})
                </label>
              </div>
            )}
          </div>
          <div className="overflow-y-auto flex-1 p-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-sm text-gray-500 font-medium">
                Nenhum item encontrado
              </div>
            ) : (
              filteredOptions.slice(0, 100).map((opt) => {
                const isSelected = values.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => toggleOption(opt.value)}
                    className={`px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors flex items-center gap-2 ${isSelected ? "bg-blue-50 text-blue-700 font-bold" : "hover:bg-gray-50 text-gray-700"}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
                    />
                    <span className="truncate flex-1">
                      {highlightMatch(opt.label)}
                    </span>
                  </div>
                );
              })
            )}
            {filteredOptions.length > 100 && (
              <div className="p-2 text-center text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                Mostrando os 100 primeiros resultados. Refine sua busca.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface AdminPromotionManagerProps {
  tenant: PharmacyConfig;
  products: Product[];
  promotions: PromotionRule[];
  onPromotionsUpdate: (promotions: PromotionRule[]) => void;
}

const AdminPromotionManager: React.FC<AdminPromotionManagerProps> = ({
  tenant,
  products,
  promotions,
  onPromotionsUpdate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editingPromo, setEditingPromo] =
    useState<Partial<PromotionRule> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [networkBranches, setNetworkBranches] = useState<PharmacyConfig[]>([]);

  useEffect(() => {
    if (tenant.isNetworkMaster) {
      getTenants().then(allTenants => {
        const currentNetworkId = tenant.networkId || tenant.id;
        const branches = allTenants.filter(t => t.id !== tenant.id && (t.networkId === currentNetworkId || t.id === currentNetworkId));
        setNetworkBranches(branches);
      });
    }
  }, [tenant]);

  const [nowState, setNowState] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNowState(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const processedPromotions = useMemo(() => {
    return [...promotions]
      .map((promo) => {
        let isExpired = false;
        const start = promo.startDate ? new Date(promo.startDate) : null;
        if (promo.endDate) {
          let end: Date;
          if (promo.type === "LIGHTNING_OFFER" || promo.endDate.includes("T")) {
            end = new Date(promo.endDate);
          } else {
            const [year, month, day] = promo.endDate.split("T")[0].split("-");
            end = new Date(
              Number(year),
              Number(month) - 1,
              Number(day),
              23,
              59,
              59,
              999,
            );
          }
          if (nowState > end || !promo.isActive) isExpired = true;
        }
        return { ...promo, _isExpired: isExpired };
      })
      .sort((a, b) => {
        if (a._isExpired === b._isExpired) return 0;
        return a._isExpired ? 1 : -1;
      });
  }, [promotions, nowState]);

  // Trava de Saída: Prevent leaving if there are unsaved changes or saving is in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditing || isSaving) {
        e.preventDefault();
        e.returnValue = ""; // Standard way to show the browser's default warning
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isEditing, isSaving]);

  // Extract unique manufacturers and categories for targeting
  const manufacturers = useMemo(() => {
    const unique = Array.from(
      new Set(products.map((p) => p.manufacturer).filter(Boolean)),
    );
    return unique.sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
    );
  }, [products]);

  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(products.map((p) => p.category).filter(Boolean)),
    );
    return unique.sort((a, b) =>
      a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
    );
  }, [products]);

  const handleNewPromo = () => {
    setEditingPromo({
      tenantId: tenant.id,
      name: "",
      type: "BUY_X_PAY_Y",
      targetType: "SPECIFIC_SELECTION",
      targetValue: "SELEÇÃO MANUAL",
      isActive: true,
      buyX: 3,
      payY: 2,
      discountThresholds: [],
      comboProducts: [],
      specificProductIds: [],
      filtersMetadata: {
        category: [],
        manufacturer: [],
        search: "",
        minPrice: "",
        maxPrice: "",
        minStock: "",
      },
    });
    setIsEditing(true);
  };

  const handleEdit = (promo: PromotionRule) => {
    setEditingPromo({ ...promo });
    setIsEditing(true);
  };

  const handleSave = async (promoToSave: PromotionRule) => {
    setIsSaving(true);
    try {
      let sanitizedPayY = 0;
      if (promoToSave?.payY !== undefined) {
        if (typeof promoToSave.payY === "string") {
          sanitizedPayY = parseFloat(
            String(promoToSave.payY).replace(",", "."),
          );
        } else {
          sanitizedPayY = Number(promoToSave.payY);
        }
      }

      const rawSlots = promoToSave.bundleSlots || (promoToSave as any).bundle_slots || [];
      let slotProductIds: string[] = [];
      if (Array.isArray(rawSlots)) {
        rawSlots.forEach((slot: any) => {
          if (Array.isArray(slot)) {
            slot.forEach((x: any) => {
              const id = typeof x === "object" ? String(x?.id || x?.productId || x?.product_id || x?.ean || x?.barcode || "").trim() : String(x || "").trim();
              if (id) slotProductIds.push(id);
            });
          }
        });
      }

      const allProductIds = Array.from(
        new Set([
          ...(promoToSave.specificProductIds || []),
          ...((promoToSave as any).product_ids || []),
          ...((promoToSave as any).productIds || []),
          ...(promoToSave.comboProducts || []),
          ...slotProductIds,
        ].map((x) => String(x).trim()).filter(Boolean))
      );

      const finalizedPromo = {
        ...promoToSave,
        id: promoToSave.id || `promo_${Date.now()}`,
        specificProductIds: allProductIds,
        comboProducts: allProductIds,
        bundleSlots: rawSlots,
        payY: isNaN(sanitizedPayY) ? 0 : sanitizedPayY,
        lightningDiscountPercentage: promoToSave.type === "LIGHTNING_OFFER" ? (promoToSave.lightningDiscountPercentage || 0) : promoToSave.lightningDiscountPercentage,
        createdAt: promoToSave.createdAt || new Date().toISOString(),
        startDate: promoToSave.startDate || new Date().toISOString(),
        scope: promoToSave.scope || "SINGLE_STORE",
        endDate:
          promoToSave.endDate ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        filtersMetadata: {
          ...(promoToSave.filtersMetadata || {}),
          bundlePrice: promoToSave.bundlePrice,
          bundleSlots: rawSlots,
          product_ids: allProductIds,
          productIds: allProductIds,
          specificProductIds: allProductIds,
        },
      } as PromotionRule;
      (finalizedPromo as any).product_ids = allProductIds;
      (finalizedPromo as any).productIds = allProductIds;

      await savePromotion(finalizedPromo);

      const updatedPromos = await getPromotionsByTenant(tenant.id);

      onPromotionsUpdate(updatedPromos);
      setIsEditing(false);
      setEditingPromo(null);

      toast.success("Promoção cadastrada com sucesso!");
    } catch (error: any) {
      console.error("Error saving promotion:", error);
      toast.error(
        error.message || "Erro ao conectar ao banco. A promoção não foi salva.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Tem certeza que deseja excluir esta promoção?"))
      return;

    const backup = [...promotions];
    // Fallback de Exclusão Local / Optimistic UI: remove imediatamente do estado para evitar congelar a tela
    onPromotionsUpdate(promotions.filter((p) => p.id !== id));
    const loadingToastId = toast.loading("Excluindo promoção...");

    try {
      await deletePromotion(id);
      try {
        const updatedPromos = await getPromotionsByTenant(tenant.id);
        if (updatedPromos) {
          onPromotionsUpdate(updatedPromos);
        }
      } catch (err) {
        console.warn("Falha ao recarregar lista após exclusão:", err);
      }
      toast.success("Promoção excluída com sucesso!", { id: loadingToastId });
    } catch (error: any) {
      console.error("Error deleting promotion:", error);
      const errMsg = String(error?.message || error?.originalError || error || "");
      const isNetworkOrAuth =
        error?.isNetworkOrAuth ||
        errMsg.includes("sessão expirou") ||
        errMsg.includes("instabilidade de rede") ||
        errMsg.includes("Failed to fetch") ||
        errMsg.includes("net::ERR_FAILED") ||
        errMsg.includes("401") ||
        errMsg.includes("403") ||
        errMsg.includes("JWT");

      if (isNetworkOrAuth) {
        toast.error(
          "Sua sessão expirou ou houve uma instabilidade de rede. Por favor, recarregue a página e tente novamente.",
          { id: loadingToastId, duration: 6000 }
        );

        // Verifica validade da sessão no Supabase e redireciona para login/reload se sessão expirada
        setTimeout(async () => {
          try {
            const { data } = await supabase.auth.getSession();
            if (!data?.session) {
              await supabase.auth.signOut().catch(() => {});
              window.location.reload();
            }
          } catch (e) {
            // Ignora erro
          }
        }, 2500);
      } else {
        // Se foi outro tipo de erro, restaura o backup e avisa o usuário
        onPromotionsUpdate(backup);
        toast.error(error.message || "Erro ao excluir promoção.", {
          id: loadingToastId,
        });
      }
    }
  };

  const getTargetName = (
    type: string,
    value: string,
    promo?: PromotionRule,
  ) => {
    if (type === "SPECIFIC_SELECTION")
      return `${promo?.specificProductIds?.length || 0} Produtos Selecionados`;
    if (type === "PRODUCT")
      return products.find((p) => p.id === value)?.name || value;
    return value;
  };

  return (
    <div className="p-4 md:p-8 mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-red-100 text-red-600 rounded-xl shadow-inner">
              <Tag size={24} />
            </div>
            Gestão de Promoções
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Configure regras de desconto dinâmicas para sua loja.
          </p>
        </div>
        <button
          onClick={handleNewPromo}
          className="flex items-center justify-center gap-2 bg-gray-900 text-white px-6 py-3 rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl active:scale-95"
        >
          <Plus size={20} />
          Nova Promoção
        </button>
      </div>

      {isEditing && editingPromo && (
        <PromotionEditModal
          isOpen={isEditing}
          onClose={() => {
            setIsEditing(false);
            setEditingPromo(null);
          }}
          promo={editingPromo}
          products={products}
          categories={categories}
          manufacturers={manufacturers}
          tenant={tenant}
          networkBranches={networkBranches}
          onSave={handleSave}
          isSaving={isSaving}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {promotions.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
            <div className="inline-flex p-4 bg-white rounded-2xl shadow-sm mb-4 text-gray-300">
              <Tag size={48} />
            </div>
            <h3 className="text-xl font-bold text-gray-900">
              Nenhuma promoção cadastrada
            </h3>
            <p className="text-gray-500 mt-2 max-w-xs mx-auto">
              Comece criando sua primeira regra de desconto para atrair mais
              clientes.
            </p>
          </div>
        ) : (
          processedPromotions.map((promo) => {
            const isExpired = promo._isExpired;

            return (
              <div
                key={promo.id}
                className={`group bg-white rounded-3xl border-2 transition-all overflow-hidden ${!isExpired && promo.isActive ? "border-gray-100 hover:border-red-200 shadow-sm hover:shadow-xl" : "border-gray-50 opacity-60"}`}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`p-3 rounded-2xl shadow-inner ${
                        promo.type === "BUY_X_PAY_Y"
                          ? "bg-red-100 text-red-600"
                          : promo.type === "PROGRESSIVE_DISCOUNT"
                            ? "bg-blue-100 text-blue-600"
                            : promo.type === "LIGHTNING_OFFER"
                              ? "bg-orange-100 text-orange-600"
                              : "bg-purple-100 text-purple-600"
                      }`}
                    >
                      {promo.type === "BUY_X_PAY_Y" ? (
                        <Layers size={24} />
                      ) : promo.type === "PROGRESSIVE_DISCOUNT" ? (
                        <Percent size={24} />
                      ) : promo.type === "LIGHTNING_OFFER" ? (
                        <Clock size={24} />
                      ) : (
                        <ShoppingBag size={24} />
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(promo)}
                        className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-all"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(promo.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  <h4 className="text-lg font-black text-gray-900 tracking-tight mb-1">
                    {promo.name}
                  </h4>
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">
                    {promo.targetType === "PRODUCT" && <Package size={12} />}
                    {promo.targetType === "CATEGORY" && <Layers size={12} />}
                    {promo.targetType === "MANUFACTURER" && (
                      <Factory size={12} />
                    )}
                    {promo.targetType === "SPECIFIC_SELECTION" && (
                      <CheckCircle2 size={12} className="text-blue-500" />
                    )}
                    {getTargetName(promo.targetType, promo.targetValue, promo)}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Regra:</span>
                      <span className="font-bold text-gray-900">
                        {promo.type === "BUY_X_PAY_Y"
                          ? `Leve ${promo.buyX} Pague ${promo.payY}`
                          : promo.type === "PROGRESSIVE_DISCOUNT"
                            ? `${promo.discountThresholds?.length} faixas de desconto`
                            : promo.type === "LIGHTNING_OFFER"
                              ? "Oferta Relâmpago (Topbar)"
                              : "Combo Fixo"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Status:</span>
                      <span
                        className={`flex items-center gap-1 font-bold ${isExpired ? "text-red-600 bg-red-50 px-2 py-0.5 rounded-md text-xs border border-red-100" : promo.isActive ? "text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md text-xs border border-emerald-100" : "text-gray-600 bg-gray-50 px-2 py-0.5 rounded-md text-xs border border-gray-200"}`}
                      >
                        {isExpired ? (
                          <AlertCircle size={14} className="opacity-80" />
                        ) : promo.isActive ? (
                          <CheckCircle2 size={14} className="opacity-80" />
                        ) : (
                          <AlertCircle size={14} className="opacity-80" />
                        )}
                        {isExpired
                          ? "Expirada"
                          : promo.isActive
                            ? "Ativa"
                            : "Inativa"}
                      </span>
                    </div>
                    {(promo.startDate || promo.endDate) && (
                      <div className="pt-3 border-t border-gray-50 flex items-center gap-2 text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                        <Calendar size={12} />
                        {promo.startDate
                          ? new Date(promo.startDate).toLocaleString("pt-BR")
                          : "..."}{" "}
                        -{" "}
                        {promo.endDate
                          ? new Date(promo.endDate).toLocaleString("pt-BR")
                          : "..."}
                      </div>
                    )}
                    {promo.scheduleConfig && (
                      <div className="pt-2 flex items-center gap-2 text-[10px] text-orange-500 font-black uppercase tracking-wider">
                        <Clock size={12} />
                        {promo.scheduleConfig.frequency === "DAILY"
                          ? "Todos os Dias"
                          : promo.scheduleConfig.frequency === "WEEKLY"
                            ? "Semanal"
                            : "Mensal"}
                        <span className="opacity-50">|</span>
                        {promo.scheduleConfig.startTime} -{" "}
                        {promo.scheduleConfig.endTime}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className={`h-1.5 w-full ${
                    promo.type === "BUY_X_PAY_Y"
                      ? "bg-red-500"
                      : promo.type === "PROGRESSIVE_DISCOUNT"
                        ? "bg-blue-500"
                        : promo.type === "LIGHTNING_OFFER"
                          ? "bg-orange-500"
                          : "bg-purple-500"
                  }`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default AdminPromotionManager;
