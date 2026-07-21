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
} from "../types";
import {
  Plus,
  Trash2,
  X,
  Tag,
  CheckCircle2,
  ChevronRight,
  Search,
  Filter,
  MinusCircle,
} from "lucide-react";
import { SmartNumberInput } from "./SmartNumberInput";
import { ScheduleEditor } from "./ScheduleEditor";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";

// Helpers
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

// Isolated Text Input
const IsolatedTextInput = React.memo(({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [localVal, setLocalVal] = useState(value || "");

  useEffect(() => {
    setLocalVal(value || "");
  }, [value]);

  return (
    <input
      type="text"
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={() => {
        if (localVal !== value) {
          onChange(localVal);
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  );
});
IsolatedTextInput.displayName = "IsolatedTextInput";

// Isolated Number Input
const IsolatedNumberInput = React.memo(({
  value,
  onChangeValue,
  isFloat = false,
  className,
}: {
  value: number | string | undefined;
  onChangeValue: (val: number) => void;
  isFloat?: boolean;
  className?: string;
}) => {
  const [localValue, setLocalValue] = useState<string>(value?.toString() || "0");

  useEffect(() => {
    if (value !== undefined) {
      setLocalValue(value.toString());
    }
  }, [value]);

  const parseToNumber = (val: string) => {
    const sanitized = val.replace(",", ".");
    return isFloat ? parseFloat(sanitized) : parseInt(sanitized, 10);
  };

  const handleBlur = () => {
    let finalValue = localValue.trim();
    if (finalValue === "" || isNaN(parseToNumber(finalValue))) {
      finalValue = "0";
      setLocalValue("0");
    }

    const parsed = parseToNumber(finalValue);
    onChangeValue(parsed);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let rawValue = e.target.value.replace(/[^0-9.,-]/g, "");
    setLocalValue(rawValue);
  };

  return (
    <input
      type="text"
      inputMode={isFloat ? "decimal" : "numeric"}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={(e) => {
        const numericForm = Number(localValue.replace(",", "."));
        if (numericForm === 0 || isNaN(numericForm)) {
          setLocalValue("");
        }
        e.target.select();
      }}
      className={className}
    />
  );
});
IsolatedNumberInput.displayName = "IsolatedNumberInput";

// Standard MultiSelect used for filters
const MultiSelect = React.memo(({
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
      const filteredValues = filteredOptions.map((o) => o.value);
      onChange(values.filter((v) => !filteredValues.includes(v)));
    } else {
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
                  type="button"
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
              type="button"
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
});
MultiSelect.displayName = "MultiSelect";

// SearchableSelect
const SearchableSelect = React.memo(({
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
              type="button"
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
});
SearchableSelect.displayName = "SearchableSelect";

// Product Row
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
              type="button"
              onClick={() => onToggle(product.id)}
              className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-all"
              title="Remover da seleção"
            >
              <MinusCircle size={14} />
            </button>
          ) : (
            <button
              type="button"
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

// SlotMultiSelect: Highly optimized MultiSelect for combo slots with 300ms debounce & 20 item limits
const SlotMultiSelect = React.memo(({
  options,
  values,
  onChange,
  placeholder = "Selecione...",
  className = "w-full px-3 py-2 rounded-lg border border-pink-100 text-xs font-bold bg-white focus-within:border-pink-400 transition-all",
}: {
  options: { label: string; value: string }[];
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
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

  // Debounce search term to 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const normalizeString = (str: string) =>
    str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const filteredOptions = useMemo(() => {
    if (!debouncedSearchTerm) return options;
    const term = normalizeString(debouncedSearchTerm);
    return options.filter((opt) => normalizeString(opt.label).includes(term));
  }, [options, debouncedSearchTerm]);

  const highlightMatch = (text: string) => {
    if (!debouncedSearchTerm) return <>{text}</>;
    const term = normalizeString(debouncedSearchTerm);
    const normalizedText = normalizeString(text);

    const index = normalizedText.indexOf(term);
    if (index === -1) return <>{text}</>;

    return (
      <>
        {text.substring(0, index)}
        <span className="bg-yellow-200 text-yellow-900 font-bold rounded-sm px-0.5">
          {text.substring(index, index + debouncedSearchTerm.length)}
        </span>
        {text.substring(index + debouncedSearchTerm.length)}
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
      const filteredValues = filteredOptions.map((o) => o.value);
      onChange(values.filter((v) => !filteredValues.includes(v)));
    } else {
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

  const valuesSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(() => options.filter((opt) => valuesSet.has(opt.value)), [options, valuesSet]);

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
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-pink-100 text-pink-800 text-[10px] font-bold"
              >
                <span className="truncate max-w-[120px]">{opt.label}</span>
                <button
                  type="button"
                  onClick={(e) => removeValue(e, opt.value)}
                  className="hover:bg-pink-200 rounded-full p-0.5 transition-colors"
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
              type="button"
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
        <div className="absolute z-[100] w-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-60">
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
                placeholder="Buscar por nome ou EAN..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-100 text-xs focus:border-pink-500 focus:ring-0 outline-none"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
            {filteredOptions.length > 0 && (
              <div className="mt-2 px-1">
                <label className="flex items-center gap-2 text-[10px] font-bold text-gray-600 cursor-pointer hover:bg-gray-50 p-1 rounded-lg">
                  <input
                    type="checkbox"
                    checked={
                      filteredOptions.length > 0 &&
                      filteredOptions.every((opt) => valuesSet.has(opt.value))
                    }
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                  />
                  Selecionar Todos ({filteredOptions.length})
                </label>
              </div>
            )}
          </div>
          <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-gray-500 font-medium">
                Nenhum item encontrado
              </div>
            ) : (
              // EXTREME OPTIMIZATION: ONLY render first 20 results as per user request!
              filteredOptions.slice(0, 20).map((opt) => {
                const isSelected = valuesSet.has(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => toggleOption(opt.value)}
                    className={`px-3 py-1.5 text-xs rounded-lg cursor-pointer transition-colors flex items-center gap-2 ${isSelected ? "bg-pink-50 text-pink-700 font-bold" : "hover:bg-gray-50 text-gray-700"}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="rounded border-gray-300 text-pink-600 focus:ring-pink-500 pointer-events-none w-3.5 h-3.5"
                    />
                    <span className="truncate flex-1">
                      {highlightMatch(opt.label)}
                    </span>
                  </div>
                );
              })
            )}
            {filteredOptions.length > 20 && (
              <div className="p-2 text-center text-[10px] text-pink-400 font-bold uppercase tracking-wider bg-pink-50/50">
                Mostrando os 20 primeiros resultados. Refine sua busca.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
SlotMultiSelect.displayName = "SlotMultiSelect";

// ComboSlotItem Component (Enhanced with Search, Category/Manufacturer Filters, Mass Actions & Selected Chips)
interface ComboSlotItemProps {
  index: number;
  slot: string[];
  products: Product[];
  categories?: string[];
  manufacturers?: string[];
  filteredProductIdsSet?: Set<string>;
  onRemoveSlot: (idx: number) => void;
  onUpdateSlot: (idx: number, vals: string[]) => void;
}

const ComboSlotItem = React.memo(({
  index,
  slot,
  products,
  categories = [],
  manufacturers = [],
  onRemoveSlot,
  onUpdateSlot,
}: ComboSlotItemProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("TODAS");
  const [selectedManufacturer, setSelectedManufacturer] = useState("TODOS");
  const [showSelectedChips, setShowSelectedChips] = useState(true);

  // Debounce search term to 200ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Derived unique categories
  const categoryOptions = useMemo(() => {
    const set = new Set<string>(categories.filter(Boolean));
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort();
  }, [categories, products]);

  // Derived unique manufacturers
  const manufacturerOptions = useMemo(() => {
    const set = new Set<string>(manufacturers.filter(Boolean));
    products.forEach((p) => {
      if (p.manufacturer) set.add(p.manufacturer);
    });
    return Array.from(set).sort();
  }, [manufacturers, products]);

  // Map of products by ID
  const productMap = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Set of selected product IDs in this slot
  const slotSet = useMemo(() => new Set(slot), [slot]);

  // Array of selected product objects
  const selectedProducts = useMemo(() => {
    return slot.map((id) => productMap.get(id)).filter(Boolean) as Product[];
  }, [slot, productMap]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    const normalize = (str: string) =>
      (str || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    return products.filter((p) => {
      // Category filter
      if (selectedCategory !== "TODAS" && p.category !== selectedCategory) {
        return false;
      }
      // Manufacturer filter
      if (selectedManufacturer !== "TODOS" && p.manufacturer !== selectedManufacturer) {
        return false;
      }
      // Search term filter (Name, Barcode/EAN, Active Principle)
      if (debouncedSearchTerm.trim()) {
        const term = normalize(debouncedSearchTerm);
        const nameMatch = normalize(p.name).includes(term);
        const barcodeMatch = p.barcode ? normalize(p.barcode).includes(term) : false;
        const eanMatch = (p as any).ean ? normalize(String((p as any).ean)).includes(term) : false;
        const internalCodeMatch = p.internalCode ? normalize(p.internalCode).includes(term) : false;
        const activePrincipleMatch = p.activePrinciple ? normalize(p.activePrinciple).includes(term) : false;

        return nameMatch || barcodeMatch || eanMatch || internalCodeMatch || activePrincipleMatch;
      }

      return true;
    });
  }, [products, selectedCategory, selectedManufacturer, debouncedSearchTerm]);

  // Toggle single product selection
  const toggleProduct = useCallback((id: string) => {
    if (slotSet.has(id)) {
      onUpdateSlot(index, slot.filter((v) => v !== id));
    } else {
      onUpdateSlot(index, [...slot, id]);
    }
  }, [slot, slotSet, index, onUpdateSlot]);

  // Remove single product
  const removeProduct = useCallback((id: string) => {
    onUpdateSlot(index, slot.filter((v) => v !== id));
  }, [slot, index, onUpdateSlot]);

  // Select all currently filtered products
  const selectAllFiltered = useCallback(() => {
    const filteredIds = filteredProducts.map((p) => p.id);
    const updated = Array.from(new Set([...slot, ...filteredIds]));
    onUpdateSlot(index, updated);
    toast.success(`${filteredIds.length} produto(s) adicionados ao Slot ${index + 1}`);
  }, [filteredProducts, slot, index, onUpdateSlot]);

  // Deselect all currently filtered products
  const deselectFiltered = useCallback(() => {
    const filteredIdsSet = new Set(filteredProducts.map((p) => p.id));
    const updated = slot.filter((id) => !filteredIdsSet.has(id));
    onUpdateSlot(index, updated);
    toast.info(`Produtos filtrados removidos do Slot ${index + 1}`);
  }, [filteredProducts, slot, index, onUpdateSlot]);

  // Clear entire slot
  const clearSlot = useCallback(() => {
    onUpdateSlot(index, []);
    toast.info(`Slot ${index + 1} limpo`);
  }, [index, onUpdateSlot]);

  // Check if all filtered are selected
  const isAllFilteredSelected = useMemo(() => {
    if (filteredProducts.length === 0) return false;
    return filteredProducts.every((p) => slotSet.has(p.id));
  }, [filteredProducts, slotSet]);

  return (
    <div className="bg-white p-5 rounded-2xl border-2 border-pink-100 shadow-sm space-y-4 transition-all">
      {/* Header with Slot name, Count badge, Clear & Delete buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pink-50 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-black uppercase tracking-wider text-pink-600 bg-pink-50 px-3 py-1 rounded-xl border border-pink-100">
            Slot {index + 1}
          </span>
          <span className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${
            slot.length > 0 
              ? "bg-emerald-100 text-emerald-800 border border-emerald-200" 
              : "bg-gray-100 text-gray-500 border border-gray-200"
          }`}>
            <CheckCircle2 size={13} className={slot.length > 0 ? "text-emerald-600" : "text-gray-400"} />
            {slot.length} produto{slot.length !== 1 ? "s" : ""} selecionado{slot.length !== 1 ? "s" : ""} no Slot {index + 1}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {slot.length > 0 && (
            <button
              type="button"
              onClick={clearSlot}
              className="text-xs font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1"
              title="Limpar seleção do slot"
            >
              <X size={14} />
              Limpar Seleção
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemoveSlot(index)}
            className="text-gray-400 hover:text-red-600 p-1.5 hover:bg-gray-100 rounded-xl transition-colors"
            title="Remover Slot"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Selected Products Chips Area */}
      {selectedProducts.length > 0 && (
        <div className="bg-pink-50/50 p-3.5 rounded-xl border border-pink-100 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-pink-900">
            <span className="flex items-center gap-1">
              Itens Adicionados ao Slot ({selectedProducts.length}):
            </span>
            <button
              type="button"
              onClick={() => setShowSelectedChips(!showSelectedChips)}
              className="text-[11px] text-pink-600 hover:underline font-bold"
            >
              {showSelectedChips ? "Ocultar lista de selecionados" : `Ver selecionados (${selectedProducts.length})`}
            </button>
          </div>

          {showSelectedChips && (
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto custom-scrollbar p-1">
              {selectedProducts.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-pink-200 text-pink-950 text-xs font-medium shadow-xs hover:border-pink-300 transition-all"
                >
                  <span className="truncate max-w-[200px] font-bold">{p.name}</span>
                  {(p.barcode || (p as any).ean) && (
                    <span className="text-[10px] text-gray-400 font-mono">
                      ({p.barcode || (p as any).ean})
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeProduct(p.id)}
                    className="text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full p-0.5 transition-colors ml-0.5"
                    title="Remover produto do slot"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inline Search & Category / Manufacturer Filters */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {/* Campo de Busca (Nome, EAN, Princípio Ativo) */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-pink-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por Nome, EAN ou P.A..."
              className="w-full pl-9 pr-8 py-2 bg-gray-50 border border-pink-100 rounded-xl text-xs font-bold text-gray-800 placeholder:text-gray-400 focus:bg-white focus:border-pink-500 focus:ring-0 outline-none transition-all"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Filtro de Categoria */}
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-pink-100 rounded-xl text-xs font-bold text-gray-800 focus:bg-white focus:border-pink-500 outline-none transition-all cursor-pointer"
            >
              <option value="TODAS">Todas as Categorias</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Marca/Laboratório */}
          <div className="relative">
            <select
              value={selectedManufacturer}
              onChange={(e) => setSelectedManufacturer(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-pink-100 rounded-xl text-xs font-bold text-gray-800 focus:bg-white focus:border-pink-500 outline-none transition-all cursor-pointer"
            >
              <option value="TODOS">Todos os Fabricantes/Marcas</option>
              {manufacturerOptions.map((mfg) => (
                <option key={mfg} value={mfg}>
                  {mfg}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mass Action & Quick Selection Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAllFiltered}
              disabled={filteredProducts.length === 0}
              className="text-xs font-black text-pink-700 bg-pink-100 hover:bg-pink-200 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5"
            >
              <CheckCircle2 size={13} />
              {selectedCategory !== "TODAS"
                ? `Selecionar Todos da Categoria "${selectedCategory}" (${filteredProducts.length})`
                : `Selecionar Todos Filtrados (${filteredProducts.length})`}
            </button>

            {isAllFilteredSelected && filteredProducts.length > 0 && (
              <button
                type="button"
                onClick={deselectFiltered}
                className="text-xs font-bold text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-all"
              >
                Deselecionar Filtrados
              </button>
            )}
          </div>

          <span className="text-[11px] font-bold text-gray-400">
            {filteredProducts.length} produto(s) encontrado(s)
          </span>
        </div>
      </div>

      {/* Available Products Picker List */}
      <div className="border border-pink-100 rounded-xl overflow-hidden bg-gray-50/50">
        <div className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-gray-100">
          {filteredProducts.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-400 font-medium">
              Nenhum produto encontrado com os filtros aplicados.
            </div>
          ) : (
            filteredProducts.slice(0, 60).map((p) => {
              const isSelected = slotSet.has(p.id);
              return (
                <div
                  key={p.id}
                  onClick={() => toggleProduct(p.id)}
                  className={`px-3.5 py-2 text-xs flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected ? "bg-pink-50/90 font-bold text-pink-950" : "hover:bg-white text-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      readOnly
                      className="rounded border-gray-300 text-pink-600 focus:ring-pink-500 pointer-events-none w-4 h-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-gray-900">
                        {p.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-gray-500">
                        {(p.barcode || (p as any).ean) && (
                          <span className="font-mono bg-gray-100 px-1.5 py-0.2 rounded text-gray-600">
                            EAN: {p.barcode || (p as any).ean}
                          </span>
                        )}
                        {p.activePrinciple && (
                          <span className="text-pink-600 font-medium">
                            PA: {p.activePrinciple}
                          </span>
                        )}
                        {p.category && (
                          <span className="bg-pink-100/60 text-pink-800 px-1.5 py-0.2 rounded font-semibold">
                            {p.category}
                          </span>
                        )}
                        {p.manufacturer && (
                          <span className="text-gray-500 font-medium">
                            {p.manufacturer}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-black text-xs text-gray-900">
                      R$ {p.price.toFixed(2).replace(".", ",")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {filteredProducts.length > 60 && (
          <div className="p-2 bg-pink-50/60 text-center text-[10px] font-bold text-pink-700 uppercase tracking-wider">
            Mostrando 60 de {filteredProducts.length} produtos. Refine sua busca por Nome, Categoria ou Fabricante.
          </div>
        )}
      </div>
    </div>
  );
});
ComboSlotItem.displayName = "ComboSlotItem";

// Main PromotionEditModal Component
interface PromotionEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  promo: Partial<PromotionRule>;
  products: Product[];
  categories: string[];
  manufacturers: string[];
  tenant: PharmacyConfig;
  networkBranches: PharmacyConfig[];
  onSave: (promoToSave: PromotionRule) => Promise<void>;
  isSaving: boolean;
}

export const PromotionEditModal: React.FC<PromotionEditModalProps> = ({
  isOpen,
  onClose,
  promo,
  products,
  categories,
  manufacturers,
  tenant,
  networkBranches,
  onSave,
  isSaving: externalIsSaving,
}) => {
  const [editingPromo, setEditingPromo] = useState<Partial<PromotionRule>>(() => ({ ...promo }));
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Sync state if initial promo prop changes
  useEffect(() => {
    setEditingPromo({ ...promo });
  }, [promo]);

  // Filters state for Manual Product Selection inside modal
  const [filters, setFilters] = useState({
    category: [] as string[],
    manufacturer: [] as string[],
    search: "",
    minPrice: "",
    maxPrice: "",
    minStock: "",
  });

  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
    }, 400);
    return () => clearTimeout(timer);
  }, [filters]);

  // Sync filters from metadata if editing existing manual selection
  useEffect(() => {
    if (promo.filtersMetadata && promo.targetType === "SPECIFIC_SELECTION") {
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
    }
  }, [promo]);

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(() => promo.specificProductIds || []);

  useEffect(() => {
    setSelectedProductIds(promo.specificProductIds || []);
  }, [promo.specificProductIds]);

  const parentRef = useRef<HTMLDivElement>(null);

  // Filtered products for specific selection grid
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (
        debouncedFilters.category.length > 0 &&
        !debouncedFilters.category.includes(p.category)
      ) {
        return false;
      }
      if (
        debouncedFilters.manufacturer.length > 0 &&
        !debouncedFilters.manufacturer.includes(p.manufacturer || "")
      ) {
        return false;
      }
      if (debouncedFilters.search) {
        const s = debouncedFilters.search.toLowerCase();
        const matches =
          p.name.toLowerCase().includes(s) ||
          p.barcode?.includes(s) ||
          p.internalCode?.includes(s);
        if (!matches) return false;
      }
      if (debouncedFilters.minPrice) {
        const min = parseFloat(debouncedFilters.minPrice);
        if (!isNaN(min) && p.price < min) return false;
      }
      if (debouncedFilters.maxPrice) {
        const max = parseFloat(debouncedFilters.maxPrice);
        if (!isNaN(max) && p.price > max) return false;
      }
      if (debouncedFilters.minStock) {
        const stock = parseInt(debouncedFilters.minStock, 10);
        if (!isNaN(stock) && p.stock < stock) return false;
      }
      return true;
    });
  }, [products, debouncedFilters]);

  // Virtualizer for product list
  const rowVirtualizer = useVirtualizer({
    count: filteredProducts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const selectedProductIdsSet = useMemo(() => new Set(selectedProductIds), [selectedProductIds]);
  const filteredProductIdsSet = useMemo(() => new Set(filteredProducts.map((p) => p.id)), [filteredProducts]);

  const isAllFilteredSelected = useMemo(() => {
    if (filteredProducts.length === 0) return false;
    return filteredProducts.every((p) => selectedProductIdsSet.has(p.id));
  }, [filteredProducts, selectedProductIdsSet]);

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

  const handleUpdateSlot = useCallback((idx: number, vals: string[]) => {
    setEditingPromo((prev) => {
      const newSlots = [...(prev.bundleSlots || [])];
      newSlots[idx] = vals;
      return { ...prev, bundleSlots: newSlots };
    });
  }, []);

  const handleRemoveSlot = useCallback((idx: number) => {
    setEditingPromo((prev) => {
      const newSlots = [...(prev.bundleSlots || [])];
      newSlots.splice(idx, 1);
      return { ...prev, bundleSlots: newSlots };
    });
  }, []);

  const handleSaveAttempt = () => {
    if (!editingPromo.name) {
      toast.error("Por favor, preencha o nome da promoção.");
      return;
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
      editingPromo.type !== "BUNDLE_FIXED_PRICE" &&
      editingPromo.targetType !== "SPECIFIC_SELECTION" &&
      !editingPromo.targetValue
    ) {
      toast.error("Por favor, selecione o alvo da promoção.");
      return;
    }
    if (editingPromo.type === "BUNDLE_FIXED_PRICE") {
      if (!editingPromo.bundleSlots || editingPromo.bundleSlots.length < 2) {
        toast.error("O combo deve ter pelo menos 2 grupos de produtos (slots).");
        return;
      }
      for (let i = 0; i < editingPromo.bundleSlots.length; i++) {
        if (!editingPromo.bundleSlots[i] || editingPromo.bundleSlots[i].length === 0) {
          toast.error(`O Slot ${i + 1} precisa ter pelo menos um produto selecionado.`);
          return;
        }
      }
      if (!editingPromo.bundlePrice || editingPromo.bundlePrice <= 0) {
        toast.error("Por favor, defina um preço válido para o combo.");
        return;
      }
    }

    setShowConfirmation(true);
  };

  const handleConfirmSave = async () => {
    const promoToSave: PromotionRule = {
      ...editingPromo,
      specificProductIds:
        editingPromo.targetType === "SPECIFIC_SELECTION"
          ? selectedProductIds
          : [],
      filtersMetadata: {
        ...(editingPromo.filtersMetadata || {}),
        ...(editingPromo.targetType === "SPECIFIC_SELECTION" ? filters : {}),
      },
    } as PromotionRule;

    await onSave(promoToSave);
    setShowConfirmation(false);
  };

  const nowState = useMemo(() => new Date(), []);
  const isEditingExpired = useMemo(() => {
    if (!editingPromo.endDate) return false;
    let end: Date;
    if (editingPromo.type === "LIGHTNING_OFFER" || editingPromo.endDate.includes("T")) {
      end = new Date(editingPromo.endDate);
    } else {
      const [year, month, day] = editingPromo.endDate.split("T")[0].split("-");
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
    return nowState > end;
  }, [editingPromo.endDate, editingPromo.type, nowState]);

  if (!isOpen) return null;

  return (
    <>
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
                  onClose();
                }
              }}
              className="p-2 hover:bg-white rounded-full transition-colors"
            >
              <X size={24} className="text-gray-400" />
            </button>
          </div>

          <div className="p-8 overflow-y-auto space-y-8 custom-scrollbar">
            {/* Network Configuration */}
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
                      checked={!editingPromo.scope || editingPromo.scope === "SINGLE_STORE"}
                      onChange={() => setEditingPromo((prev) => ({ ...prev, scope: "SINGLE_STORE" }))}
                      className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                    />
                    <span className="text-xs font-bold text-gray-700">Apenas esta filial</span>
                  </label>
                  <label className="relative flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="radio"
                      name="promo_network_scope"
                      checked={editingPromo.scope === "NETWORK"}
                      onChange={() => setEditingPromo((prev) => ({ ...prev, scope: "NETWORK" }))}
                      className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
                    />
                    <span className="text-xs font-bold text-red-700">Compartilhar com toda a rede (Filiais)</span>
                  </label>
                </div>

                {editingPromo.scope === "NETWORK" && networkBranches.length > 0 && (
                  <div className="mt-4 p-4 bg-white rounded-xl border border-red-100 space-y-3">
                    <span className="text-xs font-bold text-gray-700 block">Selecionar filiais específicas (opcional):</span>
                    <div className="text-[11px] text-gray-500 mb-2">Por padrão, aplica-se a todas as filiais se nenhuma for selecionada.</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                      {networkBranches.map((branch) => {
                        const branchIds: string[] = editingPromo.filtersMetadata?.branchIds || [];
                        const isChecked = branchIds.includes(branch.id);
                        return (
                          <label key={branch.id} className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-700">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                const newBranchIds = isChecked
                                  ? branchIds.filter((id) => id !== branch.id)
                                  : [...branchIds, branch.id];
                                setEditingPromo((prev) => ({
                                  ...prev,
                                  filtersMetadata: {
                                    ...(prev.filtersMetadata || {}),
                                    branchIds: newBranchIds,
                                  },
                                }));
                              }}
                              className="rounded text-red-600 focus:ring-red-500 w-4 h-4"
                            />
                            <span>{branch.name} ({branch.cnpj || "Sem CNPJ"})</span>
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
                  <IsolatedTextInput
                    value={editingPromo.name || ""}
                    onChange={(val) => setEditingPromo((prev) => ({ ...prev, name: val }))}
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
                      const type = e.target.value as any;
                      setEditingPromo((prev) => ({
                        ...prev,
                        type,
                        targetType: type === "BUNDLE_FIXED_PRICE" ? "BUNDLE_SLOTS" : prev.targetType,
                      }));
                    }}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-medium appearance-none bg-white"
                  >
                    <option value="BUY_X_PAY_Y">Leve X Pague Y</option>
                    <option value="PROGRESSIVE_DISCOUNT">Desconto Progressivo</option>
                    <option value="FIXED_COMBO">Combo Fixo Simples</option>
                    <option value="BUNDLE_FIXED_PRICE">Combo c/ Escolha de Variações</option>
                    <option value="LIGHTNING_OFFER">Oferta Relâmpago (Cronômetro na Topbar)</option>
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

                {editingPromo.type !== "BUNDLE_FIXED_PRICE" && (
                  <div className="flex bg-gray-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPromo((prev) => ({
                          ...prev,
                          targetType: "SPECIFIC_SELECTION",
                          targetValue: "SELEÇÃO MANUAL",
                        }))
                      }
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${editingPromo.targetType === "SPECIFIC_SELECTION" ? "bg-white text-blue-600 shadow-sm" : "text-gray-400"}`}
                    >
                      Seleção Manual
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPromo((prev) => ({
                          ...prev,
                          targetType: "CATEGORY",
                          targetValue: "",
                        }))
                      }
                      className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${editingPromo.targetType !== "SPECIFIC_SELECTION" ? "bg-white text-blue-600 shadow-sm" : "text-gray-400"}`}
                    >
                      Regra Automática
                    </button>
                  </div>
                )}
              </div>

              {editingPromo.type !== "BUNDLE_FIXED_PRICE" && editingPromo.targetType !== "SPECIFIC_SELECTION" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-blue-50/50 rounded-2xl border-2 border-blue-100/50">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-blue-400 tracking-widest ml-1">
                      Tipo de Alvo
                    </label>
                    <select
                      value={editingPromo.targetType || "PRODUCT"}
                      onChange={(e) =>
                        setEditingPromo((prev) => ({
                          ...prev,
                          targetType: e.target.value as any,
                          targetValue: "",
                        }))
                      }
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-blue-500 focus:ring-0 transition-all font-medium appearance-none bg-white"
                    >
                      <option value="PRODUCT">Produto Específico</option>
                      <option value="CATEGORY">Por Categoria</option>
                      <option value="MANUFACTURER">Por Marca/Laboratório</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-blue-400 tracking-widest ml-1">
                      Selecionar Alvo
                    </label>
                    <SearchableSelect
                      value={editingPromo.targetValue || ""}
                      onChange={(val) => setEditingPromo((prev) => ({ ...prev, targetValue: val }))}
                      options={
                        editingPromo.targetType === "PRODUCT"
                          ? products.map((p) => ({
                              label: `${p.name} (${p.barcode || p.internalCode})`,
                              value: p.id,
                            }))
                          : editingPromo.targetType === "CATEGORY"
                            ? categories.map((c) => ({ label: c, value: c }))
                            : manufacturers.map((m) => ({ label: m, value: m }))
                      }
                    />
                  </div>
                </div>
              ) : (
                editingPromo.type !== "BUNDLE_FIXED_PRICE" && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 p-6 bg-gray-50 rounded-2xl border-2 border-gray-100">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Categoria
                        </label>
                        <MultiSelect
                          values={filters.category}
                          onChange={(vals) => setFilters((prev) => ({ ...prev, category: vals }))}
                          options={categories.map((c) => ({ label: c, value: c }))}
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
                          onChange={(vals) => setFilters((prev) => ({ ...prev, manufacturer: vals }))}
                          options={manufacturers.map((m) => ({ label: m, value: m }))}
                          placeholder="Todas"
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Busca
                        </label>
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={filters.search}
                            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                            placeholder="Nome, EAN..."
                            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Preço Mín
                        </label>
                        <IsolatedNumberInput
                          value={filters.minPrice}
                          onChangeValue={(val) => setFilters((prev) => ({ ...prev, minPrice: val ? val.toString() : "" }))}
                          isFloat={true}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Preço Máx
                        </label>
                        <IsolatedNumberInput
                          value={filters.maxPrice}
                          onChangeValue={(val) => setFilters((prev) => ({ ...prev, maxPrice: val ? val.toString() : "" }))}
                          isFloat={true}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black uppercase text-gray-400 tracking-widest">
                          Estoque Mín
                        </label>
                        <IsolatedNumberInput
                          value={filters.minStock}
                          onChangeValue={(val) => setFilters((prev) => ({ ...prev, minStock: val ? val.toString() : "" }))}
                          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white"
                        />
                      </div>
                    </div>

                    {(filters.category.length > 0 || filters.manufacturer.length > 0) && (
                      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-medium text-blue-800">
                          <Filter size={14} className="text-blue-500" />
                          <span>
                            Filtros ativos:
                            {filters.category.length > 0 && (
                              <span className="font-bold ml-1">{filters.category.length} Categoria(s)</span>
                            )}
                            {filters.category.length > 0 && filters.manufacturer.length > 0 && (
                              <span> e </span>
                            )}
                            {filters.manufacturer.length > 0 && (
                              <span className="font-bold ml-1">{filters.manufacturer.length} Marca(s)</span>
                            )}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded-md">
                          Total de {filteredProducts.length} produtos encontrados
                        </span>
                      </div>
                    )}

                    <div className="border-2 border-gray-100 rounded-2xl overflow-hidden flex flex-col">
                      <div className="bg-gray-50 p-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isAllFilteredSelected}
                              onChange={(e) =>
                                e.target.checked ? selectAllFiltered() : deselectAllFiltered()
                              }
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-[10px] font-black uppercase text-gray-500">Selecionar Todos</span>
                          </div>
                          <span className="text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                            {selectedProductIds.length} selecionados
                          </span>
                        </div>
                        <span className="text-[10px] font-black uppercase text-gray-400">
                          {filteredProducts.length} encontrados no filtro
                        </span>
                      </div>

                      <div className="overflow-x-auto custom-scrollbar">
                        <div className="min-w-[600px]">
                          <div className="bg-white border-b border-gray-100 flex items-center flex-shrink-0 z-20">
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-10 flex-shrink-0"></div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-12 flex-shrink-0">Foto</div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest flex-1">Produto</div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-32 flex-shrink-0">EAN</div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-20 flex-shrink-0 text-right">Preço</div>
                            <div className="p-3 text-[9px] font-black uppercase text-gray-400 tracking-widest w-16 flex-shrink-0 text-center">Ação</div>
                          </div>

                          <div
                            ref={parentRef}
                            style={{ height: "350px", overflowY: "auto" }}
                            className="custom-scrollbar relative"
                          >
                            <div
                              style={{
                                height: `${rowVirtualizer.getTotalSize()}px`,
                                width: "100%",
                                position: "relative",
                              }}
                            >
                              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                const product = filteredProducts[virtualRow.index];
                                return (
                                  <ProductRow
                                    key={virtualRow.key}
                                    product={product}
                                    isSelected={selectedProductIdsSet.has(product.id)}
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
                              <div className="p-12 text-center text-sm font-medium text-gray-400">
                                Nenhum produto encontrado com os filtros aplicados.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              )}
            </section>

            {/* Rule Details */}
            <section className="space-y-6">
              <div className="flex items-center gap-2 text-gray-400 mb-2">
                <div className="w-1 h-4 bg-red-500 rounded-full" />
                <span className="text-[10px] font-black uppercase tracking-widest">Regras de Desconto</span>
              </div>

              {editingPromo.type === "BUY_X_PAY_Y" && (
                <div className="p-6 bg-red-50 rounded-2xl border-2 border-red-100 grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-red-400 tracking-widest ml-1">Leve (Qtd)</label>
                    <IsolatedNumberInput
                      value={editingPromo.buyX || 0}
                      onChangeValue={(val) => setEditingPromo((prev) => ({ ...prev, buyX: val || 0 }))}
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-red-500 focus:ring-0 transition-all font-bold text-red-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-red-400 tracking-widest ml-1">Pague (Qtd)</label>
                    <IsolatedNumberInput
                      value={editingPromo.payY || 0}
                      onChangeValue={(val) => setEditingPromo((prev) => ({ ...prev, payY: val || 0 }))}
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-red-500 focus:ring-0 transition-all font-bold text-red-600"
                    />
                  </div>
                </div>
              )}

              {editingPromo.type === "PROGRESSIVE_DISCOUNT" && (
                <div className="space-y-4 p-6 bg-blue-50 rounded-2xl border-2 border-blue-100">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-black uppercase text-blue-400 tracking-widest ml-1">Regras de Desconto</label>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPromo((prev) => ({
                          ...prev,
                          discountThresholds: [
                            ...(prev.discountThresholds || []),
                            { qty: 1, discountPercentage: 0 },
                          ],
                        }))
                      }
                      className="text-[10px] font-black uppercase bg-blue-600 text-white px-3 py-1 rounded-lg"
                    >
                      Adicionar Faixa
                    </button>
                  </div>
                  {editingPromo.discountThresholds?.map((d, idx) => (
                    <div key={idx} className="flex items-center gap-4 bg-white p-3 rounded-xl shadow-sm">
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400">Qtd:</span>
                        <IsolatedNumberInput
                          value={d.qty}
                          onChangeValue={(val) => {
                            setEditingPromo((prev) => {
                              const newDiscounts = [...(prev.discountThresholds || [])];
                              newDiscounts[idx] = { ...newDiscounts[idx], qty: val || 0 };
                              return { ...prev, discountThresholds: newDiscounts };
                            });
                          }}
                          className="w-full px-2 py-1 border-b-2 border-gray-100 focus:border-blue-500 outline-none font-bold"
                        />
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400">Desc %:</span>
                        <IsolatedNumberInput
                          value={d.discountPercentage}
                          onChangeValue={(val) => {
                            setEditingPromo((prev) => {
                              const newDiscounts = [...(prev.discountThresholds || [])];
                              newDiscounts[idx] = { ...newDiscounts[idx], discountPercentage: val || 0 };
                              return { ...prev, discountThresholds: newDiscounts };
                            });
                          }}
                          isFloat={true}
                          className="w-full px-2 py-1 border-b-2 border-gray-100 focus:border-blue-500 outline-none font-bold text-blue-600"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPromo((prev) => ({
                            ...prev,
                            discountThresholds: prev.discountThresholds?.filter((_, i) => i !== idx),
                          }));
                        }}
                        className="p-2 text-red-400 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {editingPromo.type === "BUNDLE_FIXED_PRICE" && (
                <div className="p-6 bg-pink-50 rounded-2xl border-2 border-pink-100 flex flex-col gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-pink-400 tracking-widest ml-1">
                      Preço Total do Combo (R$)
                    </label>
                    <IsolatedNumberInput
                      value={editingPromo.bundlePrice || 0}
                      onChangeValue={(val) => setEditingPromo((prev) => ({ ...prev, bundlePrice: val || 0 }))}
                      isFloat={true}
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-pink-500 focus:ring-0 transition-all font-bold text-pink-600"
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black uppercase text-pink-400 tracking-widest ml-1">
                        Slots de Produtos (Grupos)
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPromo((prev) => ({
                            ...prev,
                            bundleSlots: [...(prev.bundleSlots || []), []],
                          }));
                        }}
                        className="text-[10px] font-bold uppercase tracking-wider text-pink-600 bg-pink-100 px-3 py-1.5 rounded-lg hover:bg-pink-200 transition-colors"
                      >
                        + Adicionar Slot
                      </button>
                    </div>

                    {(!editingPromo.bundleSlots || editingPromo.bundleSlots.length === 0) && (
                      <div className="text-sm font-medium text-pink-500/70 p-4 border-2 border-dashed border-pink-200 rounded-xl text-center">
                        Adicione os grupos de produtos (slots) para formar o combo. O cliente precisará escolher 1 produto de cada slot.
                      </div>
                    )}

                    {editingPromo.bundleSlots?.map((slot, index) => (
                      <ComboSlotItem
                        key={index}
                        index={index}
                        slot={slot}
                        products={products}
                        categories={categories}
                        manufacturers={manufacturers}
                        filteredProductIdsSet={filteredProductIdsSet}
                        onRemoveSlot={handleRemoveSlot}
                        onUpdateSlot={handleUpdateSlot}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(editingPromo.type === "FIXED_COMBO" || editingPromo.type === "LIGHTNING_OFFER") && (
                <div className={`p-6 rounded-2xl border-2 grid grid-cols-2 gap-6 ${editingPromo.type === "LIGHTNING_OFFER" ? "bg-orange-50 border-orange-100" : "bg-purple-50 border-purple-100"}`}>
                  <div className="space-y-2">
                    <label className={`text-[11px] font-black uppercase tracking-widest ml-1 ${editingPromo.type === "LIGHTNING_OFFER" ? "text-orange-400" : "text-purple-400"}`}>
                      Quantidade do Combo {editingPromo.type === "LIGHTNING_OFFER" && "(Opcional)"}
                    </label>
                    <IsolatedNumberInput
                      value={editingPromo.buyX || 0}
                      onChangeValue={(val) => setEditingPromo((prev) => ({ ...prev, buyX: val || 0 }))}
                      className={`w-full px-4 py-3 rounded-xl border-2 border-white focus:ring-0 transition-all font-bold ${editingPromo.type === "LIGHTNING_OFFER" ? "focus:border-orange-500 text-orange-600" : "focus:border-purple-500 text-purple-600"}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[11px] font-black uppercase tracking-widest ml-1 ${editingPromo.type === "LIGHTNING_OFFER" ? "text-orange-400" : "text-purple-400"}`}>
                      Valor Fixo (R$) {editingPromo.type === "LIGHTNING_OFFER" && "(Opcional)"}
                    </label>
                    <IsolatedNumberInput
                      value={editingPromo.payY || 0}
                      onChangeValue={(val) => setEditingPromo((prev) => ({ ...prev, payY: val || 0 }))}
                      isFloat={true}
                      className={`w-full px-4 py-3 rounded-xl border-2 border-white focus:ring-0 transition-all font-bold ${editingPromo.type === "LIGHTNING_OFFER" ? "focus:border-orange-500 text-orange-600" : "focus:border-purple-500 text-purple-600"}`}
                    />
                  </div>
                  {editingPromo.type === "LIGHTNING_OFFER" && (
                    <div className="space-y-2">
                      <label className="text-[11px] font-black uppercase text-orange-400 tracking-widest ml-1">
                        Percentual Desconto (%)
                      </label>
                      <IsolatedNumberInput
                        value={editingPromo.lightningDiscountPercentage || 0}
                        onChangeValue={(val) => setEditingPromo((prev) => ({ ...prev, lightningDiscountPercentage: val || 0 }))}
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
                <span className="text-[10px] font-black uppercase tracking-widest">Validade e Status</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">
                    {editingPromo.type === "LIGHTNING_OFFER" ? "Início da Validade (Data e Hora)" : "Início da Validade"}
                  </label>
                  <input
                    type={editingPromo.type === "LIGHTNING_OFFER" ? "datetime-local" : "date"}
                    value={
                      editingPromo.type === "LIGHTNING_OFFER"
                        ? toLocalDateTimeString(editingPromo.startDate)
                        : toLocalDateTimeString(editingPromo.startDate).split("T")[0] || ""
                    }
                    onChange={(e) =>
                      setEditingPromo((prev) => ({
                        ...prev,
                        startDate: e.target.value ? toUtcIsoString(e.target.value) : undefined,
                      }))
                    }
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-medium"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">
                    {editingPromo.type === "LIGHTNING_OFFER" ? "Fim da Validade (Cronômetro) - Data e Hora" : "Fim da Validade"}
                  </label>
                  <input
                    type={editingPromo.type === "LIGHTNING_OFFER" ? "datetime-local" : "date"}
                    value={
                      editingPromo.type === "LIGHTNING_OFFER"
                        ? toLocalDateTimeString(editingPromo.endDate)
                        : toLocalDateTimeString(editingPromo.endDate).split("T")[0] || ""
                    }
                    onChange={(e) =>
                      setEditingPromo((prev) => ({
                        ...prev,
                        endDate: e.target.value ? toUtcIsoString(e.target.value) : undefined,
                      }))
                    }
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-red-500 focus:ring-0 transition-all font-medium"
                  />
                </div>
              </div>

              {editingPromo.type === "LIGHTNING_OFFER" && (
                <div className="space-y-4 bg-orange-50/50 p-6 rounded-2xl border-2 border-orange-100/50">
                  <ScheduleEditor
                    config={editingPromo.scheduleConfig}
                    onChange={(cfg) => setEditingPromo((prev) => ({ ...prev, scheduleConfig: cfg }))}
                  />
                </div>
              )}

              <div className="flex flex-col gap-4 bg-gray-50 p-6 rounded-2xl border-2 border-gray-100/50">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs font-black uppercase text-gray-700 block">Status da Promoção</span>
                    <span className="text-[11px] text-gray-500">Inative se quiser ocultar esta regra temporariamente</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEditingExpired ? false : editingPromo.isActive ?? true}
                      disabled={isEditingExpired}
                      onChange={(e) => setEditingPromo((prev) => ({ ...prev, isActive: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${isEditingExpired ? "opacity-50 cursor-not-allowed" : "peer-checked:bg-emerald-500"}`}></div>
                  </label>
                </div>
                {isEditingExpired && (
                  <div className="text-[10px] text-red-500 font-bold uppercase tracking-wider bg-red-50 p-3 rounded-xl border border-red-100">
                    Atenção: Esta promoção está expirada e continuará inativa. Para reativar, aumente a data de término (Fim da Validade).
                  </div>
                )}
              </div>

              {/* Destaque Visual */}
              <div className="bg-orange-50/30 p-6 rounded-2xl border-2 border-orange-100/30 space-y-4">
                <label className="relative flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editingPromo.highlightInCategoriesBar || false}
                    onChange={(e) => setEditingPromo((prev) => ({ ...prev, highlightInCategoriesBar: e.target.checked }))}
                    className="rounded text-orange-600 focus:ring-orange-500 w-4 h-4"
                  />
                  <div className="space-y-1 ml-1 text-left">
                    <span className="text-xs font-black uppercase text-orange-700 block">Destacar na barra de categorias da loja</span>
                    <span className="text-[10px] text-gray-500 font-medium">Exibe uma etiqueta especial pulsante em cima da categoria ou marca</span>
                  </div>
                </label>

                {editingPromo.highlightInCategoriesBar && (
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="space-y-1">
                      <span className="text-[9px] font-black uppercase text-orange-400 tracking-widest block ml-1">Cor do Destaque</span>
                      <select
                        value={editingPromo.highlightColor || "orange"}
                        onChange={(e) => setEditingPromo((prev) => ({ ...prev, highlightColor: e.target.value }))}
                        className="w-full px-4 py-3 rounded-xl border-2 border-orange-100 focus:border-orange-500 focus:ring-0 transition-all font-medium appearance-none bg-white"
                      >
                        <option value="orange">Laranja Vibrante</option>
                        <option value="red">Vermelho Alerta</option>
                        <option value="pink">Rosa Choque</option>
                        <option value="blue">Azul Elétrico</option>
                        <option value="green">Verde Sucesso</option>
                        <option value="purple">Roxo Nobre</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[9px] font-black uppercase text-orange-400 tracking-widest block ml-1">Ícone de Destaque</span>
                      <select
                        value={editingPromo.highlightIcon || "Flame"}
                        onChange={(e) => setEditingPromo((prev) => ({ ...prev, highlightIcon: e.target.value }))}
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
              </div>
            </section>
          </div>

          <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Tem certeza que deseja cancelar? As alterações não salvas serão perdidas.",
                  )
                ) {
                  onClose();
                }
              }}
              className="px-6 py-3 rounded-2xl font-bold text-gray-500 hover:bg-white transition-all"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveAttempt}
              className="flex items-center gap-2 bg-gray-900 text-white px-8 py-3 rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-lg hover:shadow-xl active:scale-95"
            >
              <CheckCircle2 size={20} />
              Revisar e Ativar
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 size={40} />
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900 tracking-tight">Confirmar Ativação?</h3>
                <p className="text-gray-500 font-medium">
                  Você está aplicando a promoção{" "}
                  <span className="text-gray-900 font-black">"{editingPromo.name}"</span>.
                </p>
              </div>

              <div className="bg-gray-50 rounded-2xl p-6 text-left space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Produtos</span>
                  <span className="font-black text-gray-900">
                    {editingPromo.targetType === "SPECIFIC_SELECTION"
                      ? selectedProductIds.length
                      : "Automático"}{" "}
                    itens
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Tipo</span>
                  <span className="font-black text-gray-900">
                    {editingPromo.type === "BUY_X_PAY_Y"
                      ? "Leve X Pague Y"
                      : editingPromo.type === "PROGRESSIVE_DISCOUNT"
                        ? "Desconto Progressivo"
                        : editingPromo.type === "BUNDLE_FIXED_PRICE"
                          ? "Combo Escolha de Variações"
                          : "Combo / Oferta"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Validade</span>
                  <span className="font-black text-gray-900">
                    {editingPromo.startDate
                      ? new Date(editingPromo.startDate).toLocaleDateString("pt-BR")
                      : "Imediato"}
                  </span>
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowConfirmation(false)}
                  className="flex-1 py-3 rounded-2xl font-bold text-gray-500 hover:bg-gray-100 transition-all"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={externalIsSaving}
                  onClick={handleConfirmSave}
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2"
                >
                  {externalIsSaving ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    "Confirmar"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
