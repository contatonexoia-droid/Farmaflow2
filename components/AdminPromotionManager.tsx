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
import { SmartNumberInput } from "./SmartNumberInput";
import { ScheduleEditor } from "./ScheduleEditor";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";

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
  const [showConfirmation, setShowConfirmation] = useState(false);
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

  // Filter states for product selection
  const [filters, setFilters] = useState<{
    category: string[];
    manufacturer: string[];
    search: string;
    minPrice: string;
    maxPrice: string;
    minStock?: string;
  }>({
    category: [],
    manufacturer: [],
    search: "",
    minPrice: "",
    maxPrice: "",
    minStock: "",
  });

  // Debounced filters to avoid lag during typing
  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 400); // 400ms debounce
    return () => clearTimeout(timer);
  }, [filters]);

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);

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
    setSelectedProductIds([]);
    setFilters({
      category: [],
      manufacturer: [],
      search: "",
      minPrice: "",
      maxPrice: "",
      minStock: "",
    });
    setIsEditing(true);
  };

  const handleEdit = (promo: PromotionRule) => {
    setEditingPromo({ ...promo });
    setSelectedProductIds(
      promo.comboProducts && promo.comboProducts.length > 0
        ? promo.comboProducts
        : promo.specificProductIds || [],
    );

    // Restore filters from metadata if available
    if (promo.filtersMetadata) {
      setFilters({
        category: Array.isArray(promo.filtersMetadata.category)
          ? promo.filtersMetadata.category
          : promo.filtersMetadata.category
            ? [promo.filtersMetadata.category]
            : [],
        manufacturer: Array.isArray(promo.filtersMetadata.manufacturer)
          ? promo.filtersMetadata.manufacturer
          : promo.filtersMetadata.manufacturer
            ? [promo.filtersMetadata.manufacturer]
            : [],
        search: promo.filtersMetadata.search || "",
        minPrice: promo.filtersMetadata.minPrice || "",
        maxPrice: promo.filtersMetadata.maxPrice || "",
        minStock: promo.filtersMetadata.minStock || "",
      });
    } else {
      setFilters({
        category: [],
        manufacturer: [],
        search: "",
        minPrice: "",
        maxPrice: "",
        minStock: "",
      });
    }

    setIsEditing(true);
  };

  // Filtered products for the preview grid - using debounced filters
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (
        debouncedFilters.category.length > 0 &&
        !debouncedFilters.category.includes(p.category)
      )
        return false;
      if (
        debouncedFilters.manufacturer.length > 0 &&
        !debouncedFilters.manufacturer.includes(p.manufacturer || "")
      )
        return false;
      if (debouncedFilters.search) {
        const s = debouncedFilters.search.toLowerCase();
        if (
          !p.name.toLowerCase().includes(s) &&
          !p.barcode?.includes(s) &&
          !p.internalCode?.includes(s)
        )
          return false;
      }
      if (
        debouncedFilters.minPrice &&
        p.price < parseFloat(debouncedFilters.minPrice)
      )
        return false;
      if (
        debouncedFilters.maxPrice &&
        p.price > parseFloat(debouncedFilters.maxPrice)
      )
        return false;
      if (
        debouncedFilters.minStock &&
        p.stock < parseInt(debouncedFilters.minStock, 10)
      )
        return false;
      return true;
    });
  }, [products, debouncedFilters]);

  // Virtualizer for the product list
  const rowVirtualizer = useVirtualizer({
    count: filteredProducts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52, // Estimated height of each row
    overscan: 10,
  });

  const toggleProductSelection = useCallback((id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  }, []);

  const selectAllFiltered = useCallback(() => {
    const filteredIds = filteredProducts.map((p) => p.id);
    setSelectedProductIds((prev) =>
      Array.from(new Set([...prev, ...filteredIds])),
    );
  }, [filteredProducts]);

  const deselectAllFiltered = useCallback(() => {
    const filteredIds = filteredProducts.map((p) => p.id);
    setSelectedProductIds((prev) =>
      prev.filter((id) => !filteredIds.includes(id)),
    );
  }, [filteredProducts]);

  const selectedProductsList = useMemo(() => {
    return products.filter((p) => selectedProductIds.includes(p.id));
  }, [products, selectedProductIds]);

  const comboOriginalSum = useMemo(() => {
    return selectedProductsList.reduce((sum, p) => sum + (p.price || 0), 0);
  }, [selectedProductsList]);

  const handleSaveAttempt = () => {
    if (!editingPromo?.name) {
      toast.error("Por favor, preencha o nome da promoção.");
      return;
    }
    if (editingPromo.type === "VARIABLE_COMBO") {
      if (selectedProductIds.length < 2) {
        toast.error("O Combo Variável precisa de pelo menos 2 produtos selecionados.");
        return;
      }
      const comboPriceNum = Number(editingPromo.comboPrice ?? editingPromo.payY);
      if (isNaN(comboPriceNum) || comboPriceNum <= 0) {
        toast.error("Por favor, informe um preço promocional válido para o combo.");
        return;
      }
      if (comboOriginalSum > 0 && comboPriceNum >= comboOriginalSum) {
        toast.error(
          `O preço do combo (R$ ${comboPriceNum.toFixed(2).replace(".", ",")}) deve ser menor que a soma dos produtos (R$ ${comboOriginalSum.toFixed(2).replace(".", ",")}).`,
        );
        return;
      }
    }
    if (editingPromo.type === "LIGHTNING_OFFER") {
      const hasCombo = (editingPromo.buyX || 0) > 0 && (editingPromo.payY || 0) > 0;
      const rawPerc = editingPromo.lightningDiscountPercentage;
      const percNum = Number(rawPerc);
      const hasPercentage = !isNaN(percNum) && percNum > 0 && percNum < 100;
      
      if (!hasCombo && !hasPercentage) {
        toast.error("Defina um percentual de desconto ou configure as regras do combo (Quantidade e Valor Fixo).");
        return;
      }
      
      if (rawPerc !== undefined && rawPerc !== null && !isNaN(percNum) && percNum !== 0) {
        if (percNum >= 100 || percNum < 0) {
          toast.error("O percentual de desconto deve ser entre 1% e 99%.");
          return;
        }
      }
    }
    if (
      editingPromo.targetType === "SPECIFIC_SELECTION" &&
      selectedProductIds.length === 0
    ) {
      toast.error("Por favor, selecione ao menos um produto para a promoção.");
      return;
    }
    if (
      editingPromo.targetType !== "SPECIFIC_SELECTION" &&
      editingPromo.type !== "VARIABLE_COMBO" &&
      !editingPromo.targetValue
    ) {
      toast.error("Por favor, selecione o alvo da promoção.");
      return;
    }
    setShowConfirmation(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const isVarCombo = editingPromo?.type === "VARIABLE_COMBO";
      const varComboPrice = isVarCombo
        ? Number(editingPromo?.comboPrice ?? editingPromo?.payY)
        : undefined;

      let sanitizedBuyX = 3;
      if (editingPromo?.buyX !== undefined && editingPromo.buyX !== null) {
        if (typeof editingPromo.buyX === "string") {
          sanitizedBuyX = parseInt(
            String(editingPromo.buyX), 10
          );
        } else {
          sanitizedBuyX = Number(editingPromo.buyX);
        }
      }

      let sanitizedPayY = 2;
      if (editingPromo?.payY !== undefined && editingPromo.payY !== null) {
        if (typeof editingPromo.payY === "string") {
          sanitizedPayY = parseFloat(
            String(editingPromo.payY).replace(",", "."),
          );
        } else {
          sanitizedPayY = Number(editingPromo.payY);
        }
      }

      const finalBuyX = isVarCombo
        ? selectedProductIds.length
        : isNaN(sanitizedBuyX) || sanitizedBuyX <= 0
          ? (editingPromo?.type === "BUY_X_PAY_Y" ? 3 : 0)
          : sanitizedBuyX;

      const finalPayY = isVarCombo
        ? (varComboPrice || 0)
        : isNaN(sanitizedPayY) || sanitizedPayY <= 0
          ? (editingPromo?.type === "BUY_X_PAY_Y" ? 2 : 0)
          : sanitizedPayY;

      const promoToSave = {
        ...editingPromo,
        id: editingPromo?.id || `promo_${Date.now()}`,
        type: editingPromo?.type,
        buyX: finalBuyX,
        payY: finalPayY,
        comboPrice: isVarCombo ? varComboPrice : editingPromo?.comboPrice,
        bundle_price: isVarCombo ? varComboPrice : editingPromo?.bundle_price,
        comboProducts: isVarCombo ? selectedProductIds : editingPromo?.comboProducts,
        targetType: isVarCombo ? "SPECIFIC_SELECTION" : editingPromo?.targetType,
        targetValue: isVarCombo ? "COMBO VARIÁVEL" : editingPromo?.targetValue,
        lightningDiscountPercentage: editingPromo?.type === "LIGHTNING_OFFER" ? (editingPromo?.lightningDiscountPercentage || 0) : editingPromo?.lightningDiscountPercentage,
        specificProductIds: selectedProductIds,
        filtersMetadata: {
          ...(editingPromo?.filtersMetadata || {}),
          buyX: finalBuyX,
          payY: finalPayY,
          comboPrice: isVarCombo ? varComboPrice : editingPromo?.comboPrice,
          comboProducts: isVarCombo ? selectedProductIds : editingPromo?.comboProducts,
          ...(editingPromo?.targetType === "SPECIFIC_SELECTION" || isVarCombo ? filters : {})
        },
        createdAt: editingPromo?.createdAt || new Date().toISOString(),
        startDate: editingPromo?.startDate || new Date().toISOString(),
        scope: editingPromo?.scope || "SINGLE_STORE",
        endDate:
          editingPromo?.endDate ||
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      } as PromotionRule;

      await savePromotion(promoToSave);

      // Fetch fresh data from the database to ensure it was saved correctly and update the UI
      const updatedPromos = await getPromotionsByTenant(tenant.id);

      onPromotionsUpdate(updatedPromos);
      setIsEditing(false);
      setEditingPromo(null);
      setShowConfirmation(false);

      toast.success("Promoção cadastrada com sucesso!");

      // Note: In a real Next.js environment, we would call revalidatePath here.
      // For this Vite app, the state update above handles the immediate UI refresh.
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

    try {
      await deletePromotion(id, tenant.id);
      const updatedPromos = await getPromotionsByTenant(tenant.id);
      onPromotionsUpdate(updatedPromos);
      toast.success("Promoção excluída com sucesso!");
    } catch (error: any) {
      console.error("Error deleting promotion:", error);
      toast.error(error.message || "Erro ao excluir promoção.");
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-h-[95vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 text-red-600 rounded-xl">
                  <Tag size={20} />
                </div>
                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                  {editingPromo.id ? "Editar Promoção" : "Nova Promoção"}
                </h3>
              </div>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Tem certeza que deseja sair? As alterações não salvas serão perdidas.",
                    )
                  ) {
                    setIsEditing(false);
                  }
                }}
                className="p-2 hover:bg-white rounded-full transition-colors"
              >
                <X size={24} className="text-gray-400" />
              </button>
            </div>

            <div className="p-8 overflow-y-auto space-y-8 custom-scrollbar">
              {/* Network Configuration (Centralizado) */}
              {tenant.isNetworkMaster && (
                <section className="p-5 bg-gradient-to-r from-red-50/50 to-rose-50/50 border border-red-100 rounded-2xl space-y-4">
                  <div className="flex items-center gap-2 text-rose-700">
                    <div className="w-1 h-4 bg-red-600 rounded-full" />
                    <span className="text-[11px] font-black uppercase tracking-widest">Configuração da Rede</span>
                  </div>
                  <div className="text-xs text-gray-500 leading-relaxed">
                    Você é administrador de rede. Pode optar por criar esta promoção de forma centralizada para todas as filiais.
                  </div>
                  <div className="flex gap-4 items-center">
                    <label className="relative flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="promo_network_scope"
                        checked={!editingPromo.scope || editingPromo.scope === 'SINGLE_STORE'}
                        onChange={() => setEditingPromo({ ...editingPromo, scope: 'SINGLE_STORE' })}
                        className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                      />
                      <span className="text-xs font-bold text-gray-700">Apenas esta filial</span>
                    </label>
                    <label className="relative flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="promo_network_scope"
                        checked={editingPromo.scope === 'NETWORK'}
                        onChange={() => setEditingPromo({ ...editingPromo, scope: 'NETWORK' })}
                        className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                      />
                      <span className="text-xs font-bold text-red-700">Compartilhar com toda a rede (Filiais)</span>
                    </label>
                  </div>

                  {editingPromo.scope === 'NETWORK' && networkBranches.length > 0 && (
                    <div className="mt-4 p-4 bg-white rounded-xl border border-red-100 space-y-3">
                      <span className="text-xs font-bold text-gray-700 block">Selecionar filiais específicas (opcional):</span>
                      <div className="text-[11px] text-gray-500 mb-2">Por padrão, aplica-se a todas as filiais se nenhuma for selecionada.</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                        {networkBranches.map(branch => {
                          const branchIds: string[] = editingPromo.filtersMetadata?.branchIds || [];
                          const isChecked = branchIds.includes(branch.id);
                          return (
                            <label key={branch.id} className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-700">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  const newBranchIds = isChecked
                                    ? branchIds.filter(id => id !== branch.id)
                                    : [...branchIds, branch.id];
                                  setEditingPromo({
                                    ...editingPromo,
                                    filtersMetadata: {
                                      ...(editingPromo.filtersMetadata || {}),
                                      branchIds: newBranchIds
                                    }
                                  });
                                }}
                                className="rounded text-red-600 focus:ring-red-500 w-4 h-4"
                              />
                              <span>{branch.name} ({branch.cnpj || 'Sem CNPJ'})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Basic Info */}
              <section className="space-y-6">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <div className="w-1 h-4 bg-red-500 rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Informações Básicas
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">
                      Nome da Promoção
                    </label>
                    <input
                      type="text"
                      value={editingPromo.name || ""}
                      onChange={(e) =>
                        setEditingPromo({
                          ...editingPromo,
                          name: e.target.value,
                        })
                      }
                      placeholder="Ex: Festival Rexona - Leve 3 Pague 2"
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-medium"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">
                      Tipo de Regra
                    </label>
                    <select
                      value={editingPromo.type || "BUY_X_PAY_Y"}
                      onChange={(e) => {
                        const newType = e.target.value as any;
                        setEditingPromo({
                          ...editingPromo,
                          type: newType,
                          ...(newType === "VARIABLE_COMBO"
                            ? { targetType: "SPECIFIC_SELECTION", targetValue: "SELEÇÃO MANUAL" }
                            : {}),
                        });
                      }}
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-medium appearance-none bg-white"
                    >
                      <option value="BUY_X_PAY_Y">Leve X Pague Y</option>
                      <option value="VARIABLE_COMBO">
                        Combo Variável (2 ou mais produtos com preço único)
                      </option>
                      <option value="PROGRESSIVE_DISCOUNT">
                        Desconto Progressivo
                      </option>
                      <option value="FIXED_COMBO">Combo Fixo</option>
                      <option value="LIGHTNING_OFFER">
                        Oferta Relâmpago (Cronômetro na Topbar)
                      </option>
                    </select>
                  </div>
                </div>
              </section>

              {/* Targeting & Filters */}
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400">
                    <div className="w-1 h-4 bg-blue-500 rounded-full" />
                    <span className="text-[10px] font-black uppercase tracking-widest">
                      Segmentação de Produtos
                    </span>
                  </div>
                  <div className="flex bg-gray-100 p-1 rounded-xl">
                    <button
                      onClick={() =>
                        setEditingPromo({
                          ...editingPromo,
                          targetType: "SPECIFIC_SELECTION",
                          targetValue: "SELEÇÃO MANUAL",
                        })
                      }
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${editingPromo.targetType === "SPECIFIC_SELECTION" ? "bg-white text-blue-600 shadow-sm" : "text-gray-400"}`}
                    >
                      Seleção Manual
                    </button>
                    <button
                      onClick={() =>
                        setEditingPromo({
                          ...editingPromo,
                          targetType: "CATEGORY",
                          targetValue: "",
                        })
                      }
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${editingPromo.targetType !== "SPECIFIC_SELECTION" ? "bg-white text-blue-600 shadow-sm" : "text-gray-400"}`}
                    >
                      Regra Automática
                    </button>
                  </div>
                </div>

                {editingPromo.targetType !== "SPECIFIC_SELECTION" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-blue-50/50 rounded-2xl border-2 border-blue-100/50">
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-blue-400 tracking-widest ml-1">
                        Tipo de Alvo
                      </label>
                      <select
                        value={editingPromo.targetType || "PRODUCT"}
                        onChange={(e) =>
                          setEditingPromo({
                            ...editingPromo,
                            targetType: e.target.value as any,
                            targetValue: "",
                          })
                        }
                        className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-blue-500 focus:ring-0 transition-all font-medium appearance-none bg-white"
                      >
                        <option value="PRODUCT">Produto Específico</option>
                        <option value="CATEGORY">Por Categoria</option>
                        <option value="MANUFACTURER">
                          Por Marca/Laboratório
                        </option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-blue-400 tracking-widest ml-1">
                        Selecionar Alvo
                      </label>
                      <SearchableSelect
                        value={editingPromo.targetValue || ""}
                        onChange={(val) =>
                          setEditingPromo({ ...editingPromo, targetValue: val })
                        }
                        options={
                          editingPromo.targetType === "PRODUCT"
                            ? products.map((p) => ({
                                label: `${p.name} (${p.barcode || p.internalCode})`,
                                value: p.id,
                              }))
                            : editingPromo.targetType === "CATEGORY"
                              ? categories.map((c) => ({ label: c, value: c }))
                              : manufacturers.map((m) => ({
                                  label: m,
                                  value: m,
                                }))
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 p-6 bg-gray-50 rounded-2xl border-2 border-gray-100">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Categoria
                        </label>
                        <MultiSelect
                          values={filters.category}
                          onChange={(vals) =>
                            setFilters({ ...filters, category: vals })
                          }
                          options={categories.map((c) => ({
                            label: c,
                            value: c,
                          }))}
                          placeholder="Todas"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Marca
                        </label>
                        <MultiSelect
                          values={filters.manufacturer}
                          onChange={(vals) =>
                            setFilters({ ...filters, manufacturer: vals })
                          }
                          options={manufacturers.map((m) => ({
                            label: m,
                            value: m,
                          }))}
                          placeholder="Todas"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Busca
                        </label>
                        <div className="relative">
                          <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                          />
                          <input
                            type="text"
                            value={filters.search}
                            onChange={(e) =>
                              setFilters({ ...filters, search: e.target.value })
                            }
                            placeholder="Nome, EAN..."
                            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Preço Mín
                        </label>
                        <SmartNumberInput
                          value={filters.minPrice}
                          onChangeValue={(val) =>
                            setFilters({
                              ...filters,
                              minPrice: val ? val.toString() : "",
                            })
                          }
                          isFloat={true}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Preço Máx
                        </label>
                        <SmartNumberInput
                          value={filters.maxPrice}
                          onChangeValue={(val) =>
                            setFilters({
                              ...filters,
                              maxPrice: val ? val.toString() : "",
                            })
                          }
                          isFloat={true}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Estoque Mín
                        </label>
                        <SmartNumberInput
                          value={filters.minStock}
                          onChangeValue={(val) =>
                            setFilters({
                              ...filters,
                              minStock: val ? val.toString() : "",
                            })
                          }
                          isFloat={false}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                    </div>

                    {/* Summary */}
                    {(filters.category.length > 0 ||
                      filters.manufacturer.length > 0) && (
                      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-medium text-blue-800">
                          <Filter size={14} className="text-blue-500" />
                          <span>
                            Filtros ativos:
                            {filters.category.length > 0 && (
                              <span className="font-bold ml-1">
                                {filters.category.length} Categoria(s)
                              </span>
                            )}
                            {filters.category.length > 0 &&
                              filters.manufacturer.length > 0 && (
                                <span> e </span>
                              )}
                            {filters.manufacturer.length > 0 && (
                              <span className="font-bold ml-1">
                                {filters.manufacturer.length} Marca(s)
                              </span>
                            )}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-md">
                          Total de {filteredProducts.length} produtos
                          encontrados
                        </span>
                      </div>
                    )}

                    {/* Preview Grid */}
                    <div className="border-2 border-gray-100 rounded-2xl overflow-hidden flex flex-col">
                      <div className="bg-gray-50 p-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={
                                filteredProducts.length > 0 &&
                                filteredProducts.every((p) =>
                                  selectedProductIds.includes(p.id),
                                )
                              }
                              onChange={(e) =>
                                e.target.checked
                                  ? selectAllFiltered()
                                  : deselectAllFiltered()
                              }
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-[10px] font-black uppercase text-gray-500">
                              Selecionar Todos
                            </span>
                          </div>
                          <span className="text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                            {selectedProductIds.length} selecionados
                          </span>
                        </div>
                        <span className="text-[10px] font-black uppercase text-gray-400">
                          {filteredProducts.length} encontrados no filtro
                        </span>
                      </div>

                      {/* Header */}
                      <div className="overflow-x-auto custom-scrollbar">
                        <div className="min-w-[600px]">
                          <div className="bg-white border-b border-gray-100 flex items-center flex-shrink-0 z-20">
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-10 flex-shrink-0"></div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-12 flex-shrink-0">
                              Foto
                            </div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest flex-1">
                              Produto
                            </div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-32 flex-shrink-0">
                              EAN
                            </div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-20 flex-shrink-0 text-right">
                              Preço
                            </div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-16 flex-shrink-0 text-center">
                              Ação
                            </div>
                          </div>

                          <div
                            ref={parentRef}
                            className="h-[400px] overflow-y-auto custom-scrollbar relative bg-white"
                          >
                            <div
                              style={{
                                height: `${rowVirtualizer.getTotalSize()}px`,
                                width: "100%",
                                position: "relative",
                              }}
                            >
                              {rowVirtualizer
                                .getVirtualItems()
                                .map((virtualRow) => {
                                  const product =
                                    filteredProducts[virtualRow.index];
                                  return (
                                    <ProductRow
                                      key={virtualRow.key}
                                      product={product}
                                      isSelected={selectedProductIds.includes(
                                        product.id,
                                      )}
                                      onToggle={toggleProductSelection}
                                      style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        height: `${virtualRow.size}px`,
                                        transform: `translateY(${virtualRow.start}px)`,
                                      }}
                                    />
                                  );
                                })}
                            </div>
                            {filteredProducts.length === 0 && (
                              <div className="p-8 text-center text-gray-400 text-xs font-bold">
                                Nenhum produto encontrado com os filtros
                                aplicados.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Rule Config */}
              <section className="space-y-6">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <div className="w-1 h-4 bg-red-500 rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Configuração da Regra
                  </span>
                </div>
                {editingPromo.type === "BUY_X_PAY_Y" && (
                  <div className="p-6 bg-red-50 rounded-2xl border-2 border-red-100 grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-red-400 tracking-widest ml-1">
                        Leve (Qtd)
                      </label>
                      <SmartNumberInput
                        value={editingPromo.buyX || 0}
                        onChangeValue={(val) =>
                          setEditingPromo({ ...editingPromo, buyX: val || 0 })
                        }
                        className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-red-500 focus:ring-0 transition-all font-bold text-red-600"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-red-400 tracking-widest ml-1">
                        Pague (Qtd)
                      </label>
                      <SmartNumberInput
                        value={editingPromo.payY || 0}
                        onChangeValue={(val) =>
                          setEditingPromo({ ...editingPromo, payY: val || 0 })
                        }
                        className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-red-500 focus:ring-0 transition-all font-bold text-red-600"
                      />
                    </div>
                  </div>
                )}

                {editingPromo.type === "VARIABLE_COMBO" && (
                  <div className="space-y-6 p-6 bg-gradient-to-br from-indigo-50/80 via-purple-50/50 to-pink-50/30 rounded-2xl border-2 border-indigo-100">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-indigo-100 pb-4">
                      <div>
                        <h4 className="text-sm font-black text-indigo-950 uppercase tracking-wider flex items-center gap-2">
                          <ShoppingBag size={18} className="text-indigo-600" />
                          Configuração do Combo Variável
                        </h4>
                        <p className="text-xs text-indigo-700/80 font-medium mt-0.5">
                          Selecione 2 ou mais produtos na tabela acima e defina o preço fixo promocional do conjunto.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-black px-3 py-1.5 rounded-xl border ${
                            selectedProductIds.length >= 2
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {selectedProductIds.length}{" "}
                          {selectedProductIds.length === 1
                            ? "produto selecionado"
                            : "produtos selecionados"}
                        </span>
                      </div>
                    </div>

                    {/* Selected Products Preview List */}
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-indigo-400 tracking-widest ml-1">
                        Itens Inclusos no Combo ({selectedProductsList.length})
                      </label>
                      {selectedProductsList.length === 0 ? (
                        <div className="p-6 bg-white rounded-xl border-2 border-dashed border-indigo-200 text-center text-xs font-bold text-indigo-400">
                          Nenhum produto selecionado ainda. Marque os produtos na tabela de seleção acima.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-56 overflow-y-auto custom-scrollbar p-1">
                          {selectedProductsList.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between gap-3 p-3 bg-white rounded-xl border border-indigo-100 shadow-sm hover:border-indigo-300 transition-all"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {p.image ? (
                                  <img
                                    src={p.image}
                                    alt={p.name}
                                    className="w-10 h-10 object-contain rounded-lg border border-gray-100 bg-gray-50 flex-shrink-0"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0 text-indigo-400">
                                    <Package size={18} />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-gray-900 truncate" title={p.name}>
                                    {p.name}
                                  </p>
                                  <p className="text-[11px] font-black text-indigo-600">
                                    R$ {(p.price || 0).toFixed(2).replace(".", ",")}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleProductSelection(p.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all flex-shrink-0"
                                title="Remover do combo"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Pricing Calculation Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                      {/* Original sum */}
                      <div className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm flex flex-col justify-between">
                        <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">
                          Preço Original Total (De)
                        </span>
                        <div className="mt-2 flex items-baseline gap-1">
                          <span className="text-2xl font-black text-gray-700">
                            R$ {comboOriginalSum.toFixed(2).replace(".", ",")}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-semibold mt-1">
                          Soma de todos os {selectedProductsList.length} itens
                        </span>
                      </div>

                      {/* Combo Promotional Price Input */}
                      <div className="bg-white p-4 rounded-xl border-2 border-indigo-300 shadow-sm flex flex-col justify-between focus-within:border-indigo-600 transition-all">
                        <label className="text-[10px] font-black uppercase text-indigo-600 tracking-wider">
                          Preço Promocional do Combo (Por) *
                        </label>
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-lg font-black text-indigo-600">R$</span>
                          <SmartNumberInput
                            value={editingPromo.comboPrice ?? editingPromo.payY ?? 0}
                            onChangeValue={(val) =>
                              setEditingPromo({
                                ...editingPromo,
                                comboPrice: val || 0,
                                payY: val || 0,
                              })
                            }
                            isFloat={true}
                            className="w-full px-2 py-1 text-2xl font-black text-indigo-700 border-b-2 border-indigo-200 focus:border-indigo-600 outline-none"
                            placeholder="0,00"
                          />
                        </div>
                        <span className="text-[10px] text-indigo-500 font-semibold mt-1">
                          Preço único pelo conjunto
                        </span>
                      </div>

                      {/* Calculated Savings Card */}
                      {(() => {
                        const promoPrice = Number(editingPromo.comboPrice ?? editingPromo.payY ?? 0);
                        const savings差异 = Math.max(0, comboOriginalSum - promoPrice);
                        const discountPct =
                          comboOriginalSum > 0 && promoPrice > 0
                            ? Math.round((savings差异 / comboOriginalSum) * 100)
                            : 0;
                        const isValidDiscount = promoPrice > 0 && promoPrice < comboOriginalSum;

                        return (
                          <div
                            className={`p-4 rounded-xl border shadow-sm flex flex-col justify-between ${
                              isValidDiscount
                                ? "bg-emerald-50/80 border-emerald-200"
                                : "bg-gray-50 border-gray-200"
                            }`}
                          >
                            <span
                              className={`text-[10px] font-black uppercase tracking-wider ${
                                isValidDiscount ? "text-emerald-700" : "text-gray-400"
                              }`}
                            >
                              Economia do Cliente
                            </span>
                            <div className="mt-2 flex items-baseline gap-2">
                              <span
                                className={`text-2xl font-black ${
                                  isValidDiscount ? "text-emerald-700" : "text-gray-400"
                                }`}
                              >
                                R$ {savings差异.toFixed(2).replace(".", ",")}
                              </span>
                              {isValidDiscount && (
                                <span className="text-xs font-black bg-emerald-600 text-white px-2 py-0.5 rounded-md">
                                  {discountPct}% OFF
                                </span>
                              )}
                            </div>
                            <span
                              className={`text-[10px] font-semibold mt-1 ${
                                isValidDiscount ? "text-emerald-600" : "text-gray-400"
                              }`}
                            >
                              {isValidDiscount
                                ? `Cliente economiza R$ ${savings差异.toFixed(2).replace(".", ",")} no combo`
                                : "Defina o preço promocional abaixo do total"}
                            </span>
                          </div>
                        );
                      })()}
                    </div>

                    {selectedProductIds.length < 2 && (
                      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-bold">
                        <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
                        <span>Selecione pelo menos 2 produtos na tabela acima para compor este combo promocional.</span>
                      </div>
                    )}
                  </div>
                )}

                {editingPromo.type === "PROGRESSIVE_DISCOUNT" && (
                  <div className="space-y-4 p-6 bg-blue-50 rounded-2xl border-2 border-blue-100">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[11px] font-black uppercase text-blue-400 tracking-widest ml-1">
                        Regras de Desconto
                      </label>
                      <button
                        onClick={() =>
                          setEditingPromo({
                            ...editingPromo,
                            discountThresholds: [
                              ...(editingPromo.discountThresholds || []),
                              { qty: 1, discountPercentage: 0 },
                            ],
                          })
                        }
                        className="text-[10px] font-black uppercase bg-blue-600 text-white px-3 py-1 rounded-lg"
                      >
                        Adicionar Faixa
                      </button>
                    </div>
                    {editingPromo.discountThresholds?.map((d, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-4 bg-white p-3 rounded-xl shadow-sm"
                      >
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-400">
                            Qtd:
                          </span>
                          <SmartNumberInput
                            value={d.qty}
                            onChangeValue={(val) => {
                              const newDiscounts = [
                                ...(editingPromo.discountThresholds || []),
                              ];
                              newDiscounts[idx].qty = val || 0;
                              setEditingPromo({
                                ...editingPromo,
                                discountThresholds: newDiscounts,
                              });
                            }}
                            className="w-full px-2 py-1 border-b-2 border-gray-100 focus:border-blue-500 outline-none font-bold"
                          />
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-400">
                            Desc %:
                          </span>
                          <SmartNumberInput
                            value={d.discountPercentage}
                            onChangeValue={(val) => {
                              const newDiscounts = [
                                ...(editingPromo.discountThresholds || []),
                              ];
                              newDiscounts[idx].discountPercentage = val || 0;
                              setEditingPromo({
                                ...editingPromo,
                                discountThresholds: newDiscounts,
                              });
                            }}
                            isFloat={true}
                            className="w-full px-2 py-1 border-b-2 border-gray-100 focus:border-blue-500 outline-none font-bold text-blue-600"
                          />
                        </div>
                        <button
                          onClick={() => {
                            const newDiscounts =
                              editingPromo.discountThresholds?.filter(
                                (_, i) => i !== idx,
                              );
                            setEditingPromo({
                              ...editingPromo,
                              discountThresholds: newDiscounts,
                            });
                          }}
                          className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {(editingPromo.type === "FIXED_COMBO" ||
                  editingPromo.type === "LIGHTNING_OFFER") && (
                  <div
                    className={`p-6 rounded-2xl border-2 grid grid-cols-2 gap-6 ${editingPromo.type === "LIGHTNING_OFFER" ? "bg-orange-50 border-orange-100" : "bg-purple-50 border-purple-100"}`}
                  >
                    <div className="space-y-2">
                      <label
                        className={`text-[11px] font-black uppercase tracking-widest ml-1 ${editingPromo.type === "LIGHTNING_OFFER" ? "text-orange-400" : "text-purple-400"}`}
                      >
                        Quantidade do Combo{" "}
                        {editingPromo.type === "LIGHTNING_OFFER" &&
                          "(Opcional)"}
                      </label>
                      <SmartNumberInput
                        value={editingPromo.buyX || 0}
                        onChangeValue={(val) =>
                          setEditingPromo({ ...editingPromo, buyX: val || 0 })
                        }
                        className={`w-full px-4 py-3 rounded-xl border-2 border-white focus:ring-0 transition-all font-bold ${editingPromo.type === "LIGHTNING_OFFER" ? "focus:border-orange-500 text-orange-600" : "focus:border-purple-500 text-purple-600"}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <label
                        className={`text-[11px] font-black uppercase tracking-widest ml-1 ${editingPromo.type === "LIGHTNING_OFFER" ? "text-orange-400" : "text-purple-400"}`}
                      >
                        Valor Fixo (R$){" "}
                        {editingPromo.type === "LIGHTNING_OFFER" &&
                          "(Opcional)"}
                      </label>
                      <SmartNumberInput
                        value={editingPromo.payY || 0}
                        onChangeValue={(val) =>
                          setEditingPromo({ ...editingPromo, payY: val || 0 })
                        }
                        isFloat={true}
                        className={`w-full px-4 py-3 rounded-xl border-2 border-white focus:ring-0 transition-all font-bold ${editingPromo.type === "LIGHTNING_OFFER" ? "focus:border-orange-500 text-orange-600" : "focus:border-purple-500 text-purple-600"}`}
                      />
                    </div>
                    {editingPromo.type === "LIGHTNING_OFFER" && (
                      <div className="space-y-2">
                        <label className="text-[11px] font-black uppercase text-orange-400 tracking-widest ml-1">
                          Percentual Desconto (%)
                        </label>
                        <SmartNumberInput
                          value={editingPromo.lightningDiscountPercentage || 0}
                          onChangeValue={(val) =>
                            setEditingPromo({
                              ...editingPromo,
                              lightningDiscountPercentage: val || 0,
                            })
                          }
                          isFloat={true}
                          className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-orange-500 focus:ring-0 transition-all font-bold text-orange-600"
                        />
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Validity & Status */}
              <section className="space-y-6">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <div className="w-1 h-4 bg-emerald-500 rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">
                    Validade e Status
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">
                      {editingPromo.type === "LIGHTNING_OFFER"
                        ? "Início da Validade (Data e Hora)"
                        : "Início da Validade"}
                    </label>
                    <input
                      type={
                        editingPromo.type === "LIGHTNING_OFFER"
                          ? "datetime-local"
                          : "date"
                      }
                      value={
                        editingPromo.type === "LIGHTNING_OFFER"
                          ? toLocalDateTimeString(editingPromo.startDate)
                          : toLocalDateTimeString(editingPromo.startDate).split(
                              "T",
                            )[0] || ""
                      }
                      onChange={(e) =>
                        setEditingPromo({
                          ...editingPromo,
                          startDate: e.target.value
                            ? toUtcIsoString(e.target.value)
                            : undefined,
                        })
                      }
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-medium"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">
                      {editingPromo.type === "LIGHTNING_OFFER"
                        ? "Fim da Validade (Cronômetro) - Data e Hora"
                        : "Fim da Validade"}
                    </label>
                    <input
                      type={
                        editingPromo.type === "LIGHTNING_OFFER"
                          ? "datetime-local"
                          : "date"
                      }
                      value={
                        editingPromo.type === "LIGHTNING_OFFER"
                          ? toLocalDateTimeString(editingPromo.endDate)
                          : toLocalDateTimeString(editingPromo.endDate).split(
                              "T",
                            )[0] || ""
                      }
                      onChange={(e) =>
                        setEditingPromo({
                          ...editingPromo,
                          endDate: e.target.value
                            ? toUtcIsoString(e.target.value)
                            : undefined,
                        })
                      }
                      className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-medium"
                    />
                  </div>
                </div>

                {editingPromo.type === "LIGHTNING_OFFER" && (
                  <div className="mt-4">
                    <ScheduleEditor
                      config={editingPromo.scheduleConfig}
                      onChange={(config) =>
                        setEditingPromo({
                          ...editingPromo,
                          scheduleConfig: config,
                        })
                      }
                    />
                  </div>
                )}

                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl flex-1 mr-4">
                    {(() => {
                      let isEditingExpired = false;
                      if (editingPromo.endDate) {
                        let end: Date;
                        if (
                          editingPromo.type === "LIGHTNING_OFFER" ||
                          editingPromo.endDate.includes("T")
                        ) {
                          end = new Date(editingPromo.endDate);
                        } else {
                          const [year, month, day] = editingPromo.endDate
                            .split("T")[0]
                            .split("-");
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
                        if (nowState > end) isEditingExpired = true;
                      }

                      return (
                        <>
                          <input
                            type="checkbox"
                            id="isActive"
                            checked={
                              isEditingExpired ? false : editingPromo.isActive
                            }
                            disabled={isEditingExpired}
                            onChange={(e) =>
                              setEditingPromo({
                                ...editingPromo,
                                isActive: e.target.checked,
                              })
                            }
                            className="w-5 h-5 rounded border-gray-300 text-red-600 focus:ring-red-500 disabled:opacity-50"
                          />
                          <label
                            htmlFor="isActive"
                            className={`text-sm font-bold cursor-pointer flex items-center gap-2 ${isEditingExpired ? "text-gray-400" : "text-gray-700"}`}
                          >
                            Promoção Ativa
                            {isEditingExpired && (
                              <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                Expirada
                              </span>
                            )}
                          </label>
                        </>
                      );
                    })()}
                  </div>

                  <div className="flex items-center gap-3 p-4 bg-orange-50 rounded-2xl flex-1 border border-orange-100">
                    <input
                      type="checkbox"
                      id="highlight"
                      checked={editingPromo.highlightInCategoriesBar || false}
                      onChange={(e) =>
                        setEditingPromo({
                          ...editingPromo,
                          highlightInCategoriesBar: e.target.checked,
                        })
                      }
                      className="w-5 h-5 rounded border-orange-300 text-orange-600 focus:ring-orange-500"
                    />
                    <div className="flex flex-col">
                      <label
                        htmlFor="highlight"
                        className="text-sm font-bold text-orange-900 cursor-pointer"
                      >
                        Destacar na Barra de Categorias
                      </label>
                      <span className="text-xs text-orange-700/70">
                        Aparece no topo da loja online
                      </span>
                    </div>
                  </div>
                </div>

                {editingPromo.highlightInCategoriesBar && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 p-4 border border-orange-100 bg-orange-50/30 rounded-2xl animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-orange-600 tracking-widest ml-1">
                        Cor de Destaque
                      </label>
                      <select
                        value={editingPromo.highlightColor || "orange"}
                        onChange={(e) =>
                          setEditingPromo({
                            ...editingPromo,
                            highlightColor: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 rounded-xl border-2 border-orange-100 focus:border-orange-500 focus:ring-0 transition-all font-medium appearance-none bg-white"
                      >
                        <option value="orange">Laranja (Padrão)</option>
                        <option value="red">Vermelho (Urgência)</option>
                        <option value="purple">Roxo (Premium)</option>
                        <option value="emerald">Verde (Economia)</option>
                        <option value="blue">Azul (Tranquilidade)</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-orange-600 tracking-widest ml-1">
                        Ícone
                      </label>
                      <select
                        value={editingPromo.highlightIcon || "Flame"}
                        onChange={(e) =>
                          setEditingPromo({
                            ...editingPromo,
                            highlightIcon: e.target.value,
                          })
                        }
                        className="w-full px-4 py-3 rounded-xl border-2 border-orange-100 focus:border-orange-500 focus:ring-0 transition-all font-medium appearance-none bg-white"
                      >
                        <option value="Flame">Fogo (Flame)</option>
                        <option value="Gift">Presente (Gift)</option>
                        <option value="Tag">Etiqueta (Tag)</option>
                        <option value="Sparkles">Estrelas (Sparkles)</option>
                        <option value="Clock">Relógio (Clock)</option>
                        <option value="Percent">Porcentagem (Percent)</option>
                      </select>
                    </div>
                  </div>
                )}
              </section>
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-4">
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      "Tem certeza que deseja cancelar? As alterações não salvas serão perdidas.",
                    )
                  ) {
                    setIsEditing(false);
                  }
                }}
                className="px-6 py-3 rounded-2xl font-bold text-gray-500 hover:bg-white transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAttempt}
                className="flex items-center gap-2 bg-gray-900 text-white px-8 py-3 rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl active:scale-95"
              >
                <CheckCircle2 size={20} />
                Revisar e Ativar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmation && editingPromo && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 size={40} />
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">
                  Confirmar Ativação?
                </h3>
                <p className="text-gray-500 font-medium">
                  Você está aplicando a promoção{" "}
                  <span className="text-gray-900 font-black">
                    "{editingPromo.name}"
                  </span>
                  .
                </p>
              </div>

              <div className="bg-gray-50 rounded-2xl p-6 text-left space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                    Produtos
                  </span>
                  <span className="font-black text-gray-900">
                    {editingPromo.targetType === "SPECIFIC_SELECTION"
                      ? selectedProductIds.length
                      : "Automático"}{" "}
                    itens
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                    Tipo
                  </span>
                  <span className="font-black text-gray-900">
                    {editingPromo.type === "BUY_X_PAY_Y"
                      ? "Leve X Pague Y"
                      : editingPromo.type === "VARIABLE_COMBO"
                        ? `Combo Variável (R$ ${Number(editingPromo.comboPrice ?? editingPromo.payY ?? 0).toFixed(2).replace(".", ",")})`
                        : editingPromo.type === "LIGHTNING_OFFER"
                          ? "Oferta Relâmpago"
                          : editingPromo.type === "FIXED_COMBO"
                            ? "Combo Fixo"
                            : "Desconto Progressivo"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">
                    Validade
                  </span>
                  <span className="font-black text-gray-900">
                    {editingPromo.startDate
                      ? new Date(editingPromo.startDate).toLocaleDateString(
                          "pt-BR",
                        )
                      : "Hoje"}{" "}
                    até{" "}
                    {editingPromo.endDate
                      ? new Date(editingPromo.endDate).toLocaleDateString(
                          "pt-BR",
                        )
                      : "Indefinido"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? "Ativando..." : "Confirmar e Ativar"}
                </button>
                <button
                  onClick={() => setShowConfirmation(false)}
                  className="w-full py-4 rounded-2xl font-bold text-gray-400 hover:bg-gray-50 transition-all"
                >
                  Voltar e Ajustar
                </button>
              </div>
            </div>
          </div>
        </div>
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
                              : promo.type === "VARIABLE_COMBO"
                                ? "bg-indigo-100 text-indigo-600"
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
                          ? `Leve ${promo.buyX ?? (promo.filtersMetadata?.buyX || 3)} Pague ${promo.payY ?? (promo.filtersMetadata?.payY || 2)}`
                          : promo.type === "VARIABLE_COMBO"
                            ? `Combo por R$ ${Number(promo.comboPrice ?? promo.payY ?? 0).toFixed(2).replace(".", ",")} (${(promo.comboProducts || promo.specificProductIds || []).length} itens)`
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
