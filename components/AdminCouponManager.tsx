import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Product, PharmacyConfig, CouponRule } from '../types';
import { Plus, Trash2, Edit2, Save, X, Tag, Calendar, Package, Layers, Factory, CheckCircle2, AlertCircle, ChevronRight, Percent, ShoppingBag, Search, Filter, DollarSign, Check, MinusCircle } from 'lucide-react';
import { saveCoupon, deleteCoupon, getCouponsByTenant, getTenants } from '../services/storage';
import { SmartNumberInput } from './SmartNumberInput';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';

// Helper to convert an ISO date string (UTC) to a local datetime-local string (YYYY-MM-DDTHH:mm) safely
const toLocalDateTimeString = (isoString: string | undefined | null): string => {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch (err) {
    return '';
  }
};

// Helper to parse a local datetime-local string (YYYY-MM-DDTHH:mm) to a UTC ISO string safely
const toUtcIsoString = (localString: string | undefined | null): string | undefined => {
  if (!localString) return undefined;
  try {
    const parts = localString.split('T');
    if (parts.length !== 2) return undefined;
    const [datePart, timePart] = parts;
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hours) || isNaN(minutes)) return undefined;
    
    const localDate = new Date(year, month - 1, day, hours, minutes);
    return localDate.toISOString();
  } catch (err) {
    return undefined;
  }
};


// Memoized Product Row to prevent unnecessary re-renders
const ProductRow = React.memo(({ 
  product, 
  isSelected, 
  onToggle,
  style
}: { 
  product: Product; 
  isSelected: boolean; 
  onToggle: (id: string) => void;
  style?: React.CSSProperties;
}) => {
  return (
    <div 
      style={style}
      className={`flex items-center border-b border-gray-50 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/30' : ''}`}
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
        <img src={product.image} alt="" className="w-8 h-8 rounded-lg object-cover bg-gray-100" referrerPolicy="no-referrer" />
      </div>
      <div className="p-3 flex-1 min-w-0">
        <div className="text-xs font-bold text-gray-900 truncate">{product.name}</div>
        <div className="text-[9px] text-gray-400 font-medium truncate">{product.category} | {product.manufacturer}</div>
      </div>
      <div className="p-3 w-32 flex-shrink-0 text-[10px] font-mono text-gray-500 truncate">{product.barcode || product.internalCode}</div>
      <div className="p-3 w-20 flex-shrink-0 text-xs font-black text-gray-900 text-right">R$ {product.price.toFixed(2)}</div>
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
});

ProductRow.displayName = 'ProductRow';

const SearchableSelect = ({
  options,
  value,
  onChange,
  placeholder = "Selecione...",
  className = "w-full px-4 py-3 rounded-xl border-2 border-white focus-within:border-blue-500 transition-all font-medium bg-white"
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizeString = (str: string) => 
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = normalizeString(searchTerm);
    return options.filter(opt => normalizeString(opt.label).includes(term));
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
        <span className="bg-yellow-200 text-yellow-900 font-bold rounded-sm px-0.5">{text.substring(index, index + searchTerm.length)}</span>
        {text.substring(index + searchTerm.length)}
      </>
    );
  };

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div className="relative" ref={wrapperRef}>
      <div 
        className={`${className} flex items-center justify-between cursor-pointer`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`truncate ${value ? "text-gray-900" : "text-gray-400"}`}>
          {selectedOption ? selectedOption.label : (value || placeholder)}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          {value && (
            <button 
              onClick={(e) => { e.stopPropagation(); onChange(''); setSearchTerm(''); }}
              className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
              title="Limpar seleção"
            >
              <X size={14} />
            </button>
          )}
          <ChevronRight size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-60">
          <div className="p-2 border-b border-gray-50">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-100 text-sm focus:border-blue-500 focus:ring-0"
                onClick={e => e.stopPropagation()}
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
              filteredOptions.slice(0, 100).map(opt => (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                  className={`px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors truncate ${value === opt.value ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-gray-50 text-gray-700'}`}
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
  className = "w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white focus-within:border-blue-500 transition-all"
}: {
  options: { label: string; value: string }[];
  values: string[];
  onChange: (vals: string[]) => void;
  placeholder?: string;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const normalizeString = (str: string) => 
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const term = normalizeString(searchTerm);
    return options.filter(opt => normalizeString(opt.label).includes(term));
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
        <span className="bg-yellow-200 text-yellow-900 font-bold rounded-sm px-0.5">{text.substring(index, index + searchTerm.length)}</span>
        {text.substring(index + searchTerm.length)}
      </>
    );
  };

  const toggleOption = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter(v => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  const toggleAll = () => {
    if (filteredOptions.every(opt => values.includes(opt.value))) {
      // Deselect all filtered
      const filteredValues = filteredOptions.map(o => o.value);
      onChange(values.filter(v => !filteredValues.includes(v)));
    } else {
      // Select all filtered
      const newValues = new Set([...values, ...filteredOptions.map(o => o.value)]);
      onChange(Array.from(newValues));
    }
  };

  const removeValue = (e: React.MouseEvent, valueToRemove: string) => {
    e.stopPropagation();
    onChange(values.filter(v => v !== valueToRemove));
  };

  const selectedOptions = options.filter(opt => values.includes(opt.value));

  return (
    <div className="relative" ref={wrapperRef}>
      <div 
        className={`${className} flex items-center justify-between cursor-pointer min-h-[38px]`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex flex-wrap gap-1 flex-1 overflow-hidden">
          {selectedOptions.length > 0 ? (
            selectedOptions.map(opt => (
              <span key={opt.value} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold">
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
              onClick={(e) => { e.stopPropagation(); onChange([]); setSearchTerm(''); }}
              className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
              title="Limpar tudo"
            >
              <X size={14} />
            </button>
          )}
          <ChevronRight size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden flex flex-col max-h-60">
          <div className="p-2 border-b border-gray-50">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-100 text-sm focus:border-blue-500 focus:ring-0"
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            </div>
            {filteredOptions.length > 0 && (
              <div className="mt-2 px-1">
                <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer hover:bg-gray-50 p-1.5 rounded-lg">
                  <input 
                    type="checkbox" 
                    checked={filteredOptions.length > 0 && filteredOptions.every(opt => values.includes(opt.value))}
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
              filteredOptions.slice(0, 100).map(opt => {
                const isSelected = values.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => toggleOption(opt.value)}
                    className={`px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors flex items-center gap-2 ${isSelected ? 'bg-blue-50 text-blue-700 font-bold' : 'hover:bg-gray-50 text-gray-700'}`}
                  >
                    <input 
                      type="checkbox" 
                      checked={isSelected}
                      readOnly
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 pointer-events-none"
                    />
                    <span className="truncate flex-1">{highlightMatch(opt.label)}</span>
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

interface AdminCouponManagerProps {
  tenant: PharmacyConfig;
  products: Product[];
  coupons: CouponRule[];
  onCouponsUpdate: (coupons: CouponRule[]) => void;
}

const AdminCouponManager: React.FC<AdminCouponManagerProps> = ({ tenant, products, coupons, onCouponsUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Partial<CouponRule> | null>(null);
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

  // Trava de Saída: Prevent leaving if there are unsaved changes or saving is in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditing || isSaving) {
        e.preventDefault();
        e.returnValue = ''; // Standard way to show the browser's default warning
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isEditing, isSaving]);

  // Filter states for product selection
  const [filters, setFilters] = useState<{
    categories: string[];
    manufacturers: string[];
    search: string;
    minPrice: string;
    maxPrice: string;
  }>({
    categories: [],
    manufacturers: [],
    search: '',
    minPrice: '',
    maxPrice: ''
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
    const unique = Array.from(new Set(products.map(p => p.manufacturer).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [products]);
  
  const categories = useMemo(() => {
    const unique = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
    return unique.sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  }, [products]);

  const handleNewCoupon = () => {
    setEditingCoupon({
      tenantId: tenant.id,
      code: '',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      targetType: 'ALL',
      targetValue: '',
      isActive: true,
      specificProductIds: [],
      filtersMetadata: { categories: [], manufacturers: [], search: '', minPrice: undefined, maxPrice: undefined }
    });
    setSelectedProductIds([]);
    setFilters({ categories: [], manufacturers: [], search: '', minPrice: '', maxPrice: '' });
    setIsEditing(true);
  };

  const handleEdit = (coupon: CouponRule) => {
    setEditingCoupon({ ...coupon });
    setSelectedProductIds(coupon.specificProductIds || []);
    
    // Restore filters from metadata if available
    if (coupon.filtersMetadata) {
      setFilters({
        categories: coupon.filtersMetadata.categories || [],
        manufacturers: coupon.filtersMetadata.manufacturers || [],
        search: coupon.filtersMetadata.search || '',
        minPrice: coupon.filtersMetadata.minPrice?.toString() || '',
        maxPrice: coupon.filtersMetadata.maxPrice?.toString() || ''
      });
    } else {
      setFilters({ categories: [], manufacturers: [], search: '', minPrice: '', maxPrice: '' });
    }
    
    setIsEditing(true);
  };

  // Filtered products for the preview grid - using debounced filters
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (debouncedFilters.categories.length > 0 && !debouncedFilters.categories.includes(p.category)) return false;
      if (debouncedFilters.manufacturers.length > 0 && !debouncedFilters.manufacturers.includes(p.manufacturer || '')) return false;
      if (debouncedFilters.search) {
        const s = debouncedFilters.search.toLowerCase();
        if (!p.name.toLowerCase().includes(s) && !p.barcode?.includes(s) && !p.internalCode?.includes(s)) return false;
      }
      if (debouncedFilters.minPrice && p.price < parseFloat(debouncedFilters.minPrice)) return false;
      if (debouncedFilters.maxPrice && p.price > parseFloat(debouncedFilters.maxPrice)) return false;
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
    setSelectedProductIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }, []);

  const selectAllFiltered = useCallback(() => {
    const filteredIds = filteredProducts.map(p => p.id);
    setSelectedProductIds(prev => Array.from(new Set([...prev, ...filteredIds])));
  }, [filteredProducts]);

  const deselectAllFiltered = useCallback(() => {
    const filteredIds = filteredProducts.map(p => p.id);
    setSelectedProductIds(prev => prev.filter(id => !filteredIds.includes(id)));
  }, [filteredProducts]);

  const handleSaveAttempt = () => {
    if (!editingCoupon?.code) {
      toast.error('Por favor, preencha o código do cupom.');
      return;
    }
    if (!editingCoupon?.discountValue || editingCoupon.discountValue <= 0) {
      toast.error('Por favor, preencha um valor de desconto válido.');
      return;
    }
    if (editingCoupon.targetType === 'SPECIFIC_SELECTION' && selectedProductIds.length === 0) {
      toast.error('Por favor, selecione ao menos um produto para o cupom.');
      return;
    }
    if (editingCoupon.targetType !== 'SPECIFIC_SELECTION' && editingCoupon.targetType !== 'ALL' && !editingCoupon.targetValue) {
      toast.error('Por favor, selecione o alvo do cupom.');
      return;
    }
    setShowConfirmation(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const couponToSave = {
        ...editingCoupon,
        id: editingCoupon.id || `coupon_${Date.now()}`,
        code: editingCoupon.code?.toUpperCase(),
        targetType: editingCoupon.couponScope === 'GLOBAL' ? 'ALL' : editingCoupon.targetType,
        targetValue: (editingCoupon.couponScope !== 'GLOBAL' && (editingCoupon.targetType === 'CATEGORY' || editingCoupon.targetType === 'MANUFACTURER')) ? editingCoupon.targetValue : undefined,
        specificProductIds: (editingCoupon.couponScope !== 'GLOBAL' && editingCoupon.targetType === 'SPECIFIC_SELECTION') ? selectedProductIds : [],
        filtersMetadata: {
          ...(editingCoupon.filtersMetadata || {}),
          ...(editingCoupon.targetType === 'SPECIFIC_SELECTION' ? {
            categories: filters.categories,
            manufacturers: filters.manufacturers,
            search: filters.search,
            minPrice: filters.minPrice ? parseFloat(filters.minPrice) : undefined,
            maxPrice: filters.maxPrice ? parseFloat(filters.maxPrice) : undefined
          } : {})
        },
        startDate: editingCoupon.startDate || new Date().toISOString(),
        endDate: editingCoupon.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        scope: editingCoupon.scope || 'SINGLE_STORE',
      } as CouponRule;

      await saveCoupon(couponToSave);
      
      const updatedCoupons = await getCouponsByTenant(tenant.id);
      
      onCouponsUpdate(updatedCoupons);
      setIsEditing(false);
      setEditingCoupon(null);
      setShowConfirmation(false);
      
      toast.success('Cupom cadastrado com sucesso!');
    } catch (error: any) {
      console.error('Error saving coupon:', error);
      toast.error(error.message || 'Erro ao conectar ao banco. O cupom não foi salvo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este cupom?')) return;

    const backup = [...coupons];
    onCouponsUpdate(coupons.filter(c => c.id !== id));
    const loadingToastId = toast.loading('Excluindo cupom...');

    try {
      await deleteCoupon(id);
      const updatedCoupons = await getCouponsByTenant(tenant.id);
      onCouponsUpdate(updatedCoupons);
      toast.success('Cupom excluído com sucesso!', { id: loadingToastId });
    } catch (error: any) {
      console.error('Error deleting coupon:', error);
      onCouponsUpdate(backup);
      toast.error(error.message || 'Erro ao excluir cupom.', { id: loadingToastId });
    }
  };

  const getTargetName = (type: string, value: string, coupon?: CouponRule) => {
    if (type === 'ALL') return 'Todos os Produtos';
    if (type === 'SPECIFIC_SELECTION') return `${coupon?.specificProductIds?.length || 0} Produtos Selecionados`;
    if (type === 'PRODUCT') return products.find(p => p.id === value)?.name || value;
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
            Cupons de Desconto
          </h2>
          <p className="text-gray-500 mt-1 font-medium">Gerencie os cupons de desconto da sua loja.</p>
        </div>
        <button
          onClick={handleNewCoupon}
          className="bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-gray-900/20 hover:shadow-gray-900/40 hover:-translate-y-0.5"
        >
          <Plus size={20} />
          Novo Cupom
        </button>
      </div>

      {isEditing && editingCoupon ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 text-red-600 rounded-xl">
                  <Tag size={24} />
                </div>
                <h3 className="text-xl font-black text-gray-900">
                  {editingCoupon.id ? 'Editar Cupom' : 'Novo Cupom'}
                </h3>
              </div>
              <button 
                onClick={() => setIsEditing(false)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar bg-gray-50/50">
              {/* Basic Info */}
              <section className="mb-10 space-y-6">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <div className="w-1 h-4 bg-red-500 rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Informações Básicas</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Código do Cupom</label>
                    <input
                      type="text"
                      value={editingCoupon.code || ''}
                      onChange={e => setEditingCoupon({ ...editingCoupon, code: e.target.value.toUpperCase() })}
                      placeholder="Ex: VERAO10"
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-blue-500 outline-none font-bold text-gray-900 bg-white shadow-sm transition-all uppercase"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Tipo de Desconto</label>
                    <select
                      value={editingCoupon.discountType}
                      onChange={e => setEditingCoupon({ ...editingCoupon, discountType: e.target.value as any })}
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-blue-500 outline-none font-bold text-gray-900 bg-white shadow-sm transition-all appearance-none"
                    >
                      <option value="PERCENTAGE">Desconto Percentual (%)</option>
                      <option value="FIXED">Desconto em Valor Fixo (R$)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Valor do Desconto</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none z-10">
                        <span className="text-gray-400 font-bold">
                          {editingCoupon.discountType === 'PERCENTAGE' ? '%' : 'R$'}
                        </span>
                      </div>
                      <SmartNumberInput
                        value={editingCoupon.discountValue || ''}
                        onChangeValue={val => setEditingCoupon({ ...editingCoupon, discountValue: val })}
                        isFloat={editingCoupon.discountType !== 'PERCENTAGE'}
                        className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-white focus:border-blue-500 outline-none font-bold text-gray-900 bg-white shadow-sm transition-all relative z-0"
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Network Configuration (Centralizado) */}
              {tenant.isNetworkMaster && (
                <section className="mb-10 p-5 bg-gradient-to-r from-purple-50/50 to-indigo-50/50 border border-purple-100 rounded-2xl space-y-4">
                  <div className="flex items-center gap-2 text-purple-700">
                    <div className="w-1 h-4 bg-purple-600 rounded-full" />
                    <span className="text-[11px] font-black uppercase tracking-widest">Configuração da Rede</span>
                  </div>
                  <div className="text-xs text-gray-500 leading-relaxed">
                    Você é administrador de rede. Pode optar por criar este cupom de forma centralizada para todas as filiais.
                  </div>
                  <div className="flex gap-4 items-center">
                    <label className="relative flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="coupon_network_scope"
                        checked={!editingCoupon.scope || editingCoupon.scope === 'SINGLE_STORE'}
                        onChange={() => setEditingCoupon({ ...editingCoupon, scope: 'SINGLE_STORE' })}
                        className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                      />
                      <span className="text-xs font-bold text-gray-700">Apenas esta filial</span>
                    </label>
                    <label className="relative flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="radio"
                        name="coupon_network_scope"
                        checked={editingCoupon.scope === 'NETWORK'}
                        onChange={() => setEditingCoupon({ ...editingCoupon, scope: 'NETWORK' })}
                        className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                      />
                      <span className="text-xs font-bold text-purple-700">Compartilhar com toda a rede (Filiais)</span>
                    </label>
                  </div>

                  {editingCoupon.scope === 'NETWORK' && networkBranches.length > 0 && (
                    <div className="mt-4 p-4 bg-white rounded-xl border border-purple-100 space-y-3">
                      <span className="text-xs font-bold text-gray-700 block">Selecionar filiais específicas (opcional):</span>
                      <div className="text-[11px] text-gray-500 mb-2">Por padrão, aplica-se a todas as filiais se nenhuma for selecionada.</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                        {networkBranches.map(branch => {
                          const branchIds: string[] = editingCoupon.filtersMetadata?.branchIds || [];
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
                                  setEditingCoupon({
                                    ...editingCoupon,
                                    filtersMetadata: {
                                      ...(editingCoupon.filtersMetadata || {}),
                                      branchIds: newBranchIds
                                    }
                                  });
                                }}
                                className="rounded text-purple-600 focus:ring-purple-500 w-4 h-4"
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

              {/* Coupon Scope Config */}
              <section className="mb-10 space-y-6">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <div className="w-1 h-4 bg-purple-500 rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Escopo do Cupom</span>
                </div>

                <div className="flex gap-2 p-1 bg-gray-200/50 rounded-xl w-fit">
                  <button
                    onClick={() => setEditingCoupon({ ...editingCoupon, couponScope: 'SPECIFIC_PRODUCT' })}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      (!editingCoupon.couponScope || editingCoupon.couponScope === 'SPECIFIC_PRODUCT')
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Itens Específicos
                  </button>
                  <button
                    onClick={() => setEditingCoupon({ ...editingCoupon, couponScope: 'GLOBAL' })}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      editingCoupon.couponScope === 'GLOBAL'
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Total da Compra (Geral)
                  </button>
                </div>

                {editingCoupon.couponScope === 'GLOBAL' && (
                  <div className="space-y-2 max-w-md">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Valor Mínimo da Compra (R$)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editingCoupon.minPurchaseValue || ''}
                        onChange={e => setEditingCoupon({ ...editingCoupon, minPurchaseValue: parseFloat(e.target.value) || undefined })}
                        placeholder="0.00"
                        className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-white focus:border-purple-500 outline-none font-bold text-gray-900 bg-white shadow-sm transition-all"
                      />
                    </div>
                  </div>
                )}
              </section>

              {/* Target Config */}
              {(!editingCoupon.couponScope || editingCoupon.couponScope === 'SPECIFIC_PRODUCT') && (
              <section className="mb-10 space-y-6">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <div className="w-1 h-4 bg-blue-500 rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Segmentação de Produtos</span>
                </div>

                <div className="flex gap-2 p-1 bg-gray-200/50 rounded-xl w-fit">
                  <button
                    onClick={() => setEditingCoupon({ ...editingCoupon, targetType: 'ALL' })}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      editingCoupon.targetType === 'ALL'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Todos os Produtos
                  </button>
                  <button
                    onClick={() => setEditingCoupon({ ...editingCoupon, targetType: 'SPECIFIC_SELECTION' })}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      editingCoupon.targetType === 'SPECIFIC_SELECTION'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Seleção Manual
                  </button>
                  <button
                    onClick={() => setEditingCoupon({ ...editingCoupon, targetType: 'CATEGORY' })}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      editingCoupon.targetType === 'CATEGORY'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Por Categoria
                  </button>
                  <button
                    onClick={() => setEditingCoupon({ ...editingCoupon, targetType: 'MANUFACTURER' })}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                      editingCoupon.targetType === 'MANUFACTURER'
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Por Marca
                  </button>
                </div>

                {editingCoupon.targetType === 'CATEGORY' && (
                  <div className="space-y-2 max-w-md">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Selecione a Categoria</label>
                    <SearchableSelect
                      options={categories.map(c => ({ label: c, value: c }))}
                      value={editingCoupon.targetValue || ''}
                      onChange={val => setEditingCoupon({ ...editingCoupon, targetValue: val })}
                      placeholder="Selecione uma categoria..."
                    />
                  </div>
                )}

                {editingCoupon.targetType === 'MANUFACTURER' && (
                  <div className="space-y-2 max-w-md">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Selecione a Marca</label>
                    <SearchableSelect
                      options={manufacturers.map(m => ({ label: m, value: m }))}
                      value={editingCoupon.targetValue || ''}
                      onChange={val => setEditingCoupon({ ...editingCoupon, targetValue: val })}
                      placeholder="Selecione uma marca..."
                    />
                  </div>
                )}

                {editingCoupon.targetType === 'SPECIFIC_SELECTION' && (
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1">Categoria</label>
                          <MultiSelect
                            options={categories.map(c => ({ label: c, value: c }))}
                            values={filters.categories}
                            onChange={vals => setFilters({ ...filters, categories: vals })}
                            placeholder="Todas"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1">Marca</label>
                          <MultiSelect
                            options={manufacturers.map(m => ({ label: m, value: m }))}
                            values={filters.manufacturers}
                            onChange={vals => setFilters({ ...filters, manufacturers: vals })}
                            placeholder="Todas"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1">Busca</label>
                          <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={filters.search}
                              onChange={e => setFilters({ ...filters, search: e.target.value })}
                              placeholder="Nome, EAN..."
                              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white focus:border-blue-500 outline-none transition-all"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1">Preço Mín</label>
                            <SmartNumberInput
                              value={filters.minPrice}
                              onChangeValue={val => setFilters({ ...filters, minPrice: val ? val.toString() : '' })}
                              isFloat={true}
                              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white focus:border-blue-500 outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1">Preço Máx</label>
                            <SmartNumberInput
                              value={filters.maxPrice}
                              onChangeValue={val => setFilters({ ...filters, maxPrice: val ? val.toString() : '' })}
                              isFloat={true}
                              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold bg-white focus:border-blue-500 outline-none transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col">
                      <div className="p-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2 cursor-pointer hover:bg-gray-200/50 p-1.5 rounded-lg transition-colors">
                            <input 
                              type="checkbox" 
                              checked={filteredProducts.length > 0 && filteredProducts.every(p => selectedProductIds.includes(p.id))}
                              onChange={e => e.target.checked ? selectAllFiltered() : deselectAllFiltered()}
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

                      {/* Header */}
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

                          <div ref={parentRef} className="h-[400px] overflow-y-auto custom-scrollbar relative bg-white">
                            <div 
                              style={{ 
                                height: `${rowVirtualizer.getTotalSize()}px`, 
                                width: '100%',
                                position: 'relative' 
                              }}
                            >
                              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                const product = filteredProducts[virtualRow.index];
                                return (
                                  <ProductRow 
                                    key={virtualRow.key}
                                    product={product}
                                    isSelected={selectedProductIds.includes(product.id)}
                                    onToggle={toggleProductSelection}
                                    style={{
                                      position: 'absolute',
                                      top: 0,
                                      left: 0,
                                      width: '100%',
                                      height: `${virtualRow.size}px`,
                                      transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                  />
                                );
                              })}
                            </div>
                            {filteredProducts.length === 0 && (
                              <div className="p-8 text-center text-gray-400 text-xs font-bold">
                                Nenhum produto encontrado com os filtros aplicados.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
              )}

              {/* Validity and Status */}
              <section className="space-y-6">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                  <div className="w-1 h-4 bg-green-500 rounded-full" />
                  <span className="text-[10px] font-black uppercase tracking-widest">Validade e Status</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Início da Validade</label>
                    <input
                      type="datetime-local"
                      value={toLocalDateTimeString(editingCoupon.startDate)}
                      onChange={e => setEditingCoupon({ ...editingCoupon, startDate: toUtcIsoString(e.target.value) })}
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-blue-500 outline-none font-bold text-gray-900 bg-white shadow-sm transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-black uppercase text-gray-400 tracking-widest ml-1">Fim da Validade</label>
                    <input
                      type="datetime-local"
                      value={toLocalDateTimeString(editingCoupon.endDate)}
                      onChange={e => setEditingCoupon({ ...editingCoupon, endDate: toUtcIsoString(e.target.value) })}
                      className="w-full px-4 py-3 rounded-xl border-2 border-white focus:border-blue-500 outline-none font-bold text-gray-900 bg-white shadow-sm transition-all"
                    />
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={editingCoupon.isActive}
                    onChange={e => setEditingCoupon({ ...editingCoupon, isActive: e.target.checked })}
                    className="w-6 h-6 rounded-lg border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="isActive" className="text-sm font-bold text-gray-900 cursor-pointer select-none">
                    Cupom Ativo
                  </label>
                </div>
              </section>
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-4">
              <button
                onClick={() => setIsEditing(false)}
                className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-200 transition-colors"
                disabled={isSaving}
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAttempt}
                disabled={isSaving}
                className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-gray-900/20 hover:shadow-gray-900/40"
              >
                {isSaving ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 size={20} />
                )}
                Revisar e Ativar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmation Modal */}
      {showConfirmation && editingCoupon && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} />
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-2">Confirmar Cupom</h3>
              <p className="text-sm text-gray-500 mb-6">
                Você está prestes a ativar o cupom <strong className="text-gray-900">{editingCoupon.code}</strong>.
                Deseja continuar?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmation(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors"
                  disabled={isSaving}
                >
                  Voltar
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-600/20"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Confirmar'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* List of Coupons */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {coupons.map(coupon => {
          const isExpired = coupon.endDate ? (
            coupon.endDate.includes('T')
              ? new Date() > new Date(coupon.endDate)
              : new Date() > new Date(new Date(coupon.endDate).setHours(23, 59, 59, 999))
          ) : false;
          const statusText = isExpired ? 'Expirado' : (coupon.isActive ? 'Ativo' : 'Inativo');
          const statusColor = isExpired ? 'bg-gray-100 text-gray-500' : (coupon.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500');
          const StatusIcon = isExpired ? AlertCircle : (coupon.isActive ? CheckCircle2 : AlertCircle);

          return (
            <div key={coupon.id} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 hover:shadow-xl hover:border-blue-100 transition-all group flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 ${statusColor}`}>
                      <StatusIcon size={12} />
                      {statusText}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-600">
                      {coupon.discountType === 'PERCENTAGE' ? 'Percentual' : 'Fixo'}
                    </span>
                  </div>
                  <h3 className="font-black text-gray-900 text-lg leading-tight group-hover:text-blue-600 transition-colors">
                    {coupon.code}
                  </h3>
                  <p className="text-sm font-bold text-blue-600 mt-1">
                    {coupon.discountType === 'PERCENTAGE' ? `${coupon.discountValue}% OFF` : `R$ ${coupon.discountValue.toFixed(2)} OFF`}
                  </p>
                </div>
                <div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleEdit(coupon)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button 
                    onClick={() => handleDelete(coupon.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-3 flex-1">
                <div className="flex items-start gap-3 text-sm">
                  <div className="p-1.5 bg-gray-50 text-gray-400 rounded-lg shrink-0">
                    <Package size={14} />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Aplica-se a</span>
                    <span className="font-medium text-gray-700">
                      {getTargetName(coupon.targetType, coupon.targetValue || '', coupon)}
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-sm">
                  <div className="p-1.5 bg-gray-50 text-gray-400 rounded-lg shrink-0">
                    <Calendar size={14} />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Validade</span>
                    <span className="font-medium text-gray-700">
                      {new Date(coupon.startDate).toLocaleDateString('pt-BR')} até {new Date(coupon.endDate).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {coupons.length === 0 && (
          <div className="col-span-full p-12 text-center bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
            <Tag size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-black text-gray-900 mb-2">Nenhum cupom ativo</h3>
            <p className="text-gray-500 font-medium max-w-md mx-auto">
              Crie cupons de desconto para impulsionar suas vendas e fidelizar clientes.
            </p>
            <button
              onClick={handleNewCoupon}
              className="mt-6 bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-900 hover:text-gray-900 px-6 py-2 rounded-xl font-bold transition-all"
            >
              Criar Primeiro Cupom
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminCouponManager;
