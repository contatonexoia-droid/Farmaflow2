import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { 
  Printer, 
  Search, 
  Tag, 
  Sliders, 
  CheckSquare, 
  Square, 
  Trash2, 
  Plus, 
  Minus, 
  Eye, 
  Sparkles, 
  Layers, 
  FileText, 
  RefreshCw, 
  X, 
  Check, 
  AlertCircle,
  HelpCircle,
  BarChart2,
  Calendar,
  Percent,
  DollarSign,
  ScanLine,
  Camera,
  Volume2,
  AlertTriangle
} from 'lucide-react';
import ProductScanner from './ProductScanner';
import { Product, PharmacyConfig, PromotionRule } from '../types';

export type TagLayoutFormat = 'gondola_pimaco' | 'baiana_destaque' | 'cartaz_a5' | 'cartaz_a4';

export interface PriceTagItem {
  id: string; // product id
  product: Product;
  quantity: number; // quantidade de etiquetas a imprimir
  badgeText: string;
  originalPrice: number;
  promotionalPrice: number;
  showOriginalPrice: boolean;
  unitMeasurementText: string; // ex: "R$ 0,15 por comprimido" ou "R$ 4,50 / 100ml"
  customObservations?: string; // ex: "Validade: 11/2026 - Lote: 4920A"
}

interface AdminPriceTagsProps {
  products: Product[];
  tenant: PharmacyConfig;
  promotions?: PromotionRule[];
}

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

export const AdminPriceTags: React.FC<AdminPriceTagsProps> = ({
  products,
  tenant,
  promotions = []
}) => {
  // --- Estados de Seleção e Busca de Produtos ---
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [onlyPromotions, setOnlyPromotions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- Estados de Escaneamento e Notificações (Feedback Visual e Sonoro) ---
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerToast, setScannerToast] = useState<{
    id: number;
    title: string;
    description: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // --- Web Audio API para Som de Bip sem dependências externas ---
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
        // Bip agudo e positivo característico de leitor óptico comercial
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
      } else {
        // Bip de erro mais grave duplo
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

  // --- Lista de Etiquetas na Fila ---
  const [tagItems, setTagItems] = useState<PriceTagItem[]>([]);

  // --- Configurações Globais da Etiqueta ---
  const [layoutFormat, setLayoutFormat] = useState<TagLayoutFormat>('gondola_pimaco');
  const [showBarcode, setShowBarcode] = useState(true);
  const [showInternalCode, setShowInternalCode] = useState(true);
  const [showPrintDate, setShowPrintDate] = useState(true);
  const [showStoreLogo, setShowStoreLogo] = useState(true);
  const [showUnitMeasurement, setShowUnitMeasurement] = useState(false);
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

  // Filtro de produtos do catálogo
  const filteredCatalog = useMemo(() => {
    return products.filter((p) => {
      // Filtro de promoção
      if (onlyPromotions) {
        const hasPromo = 
          (p.promotionalPrice && p.promotionalPrice < p.price) ||
          (p.promotional_price && p.promotional_price < p.price) ||
          (p.promotionType && p.promotionType !== 'NONE') ||
          p.isFeatured;
        if (!hasPromo) return false;
      }

      // Filtro de categoria
      if (selectedCategory !== 'all' && p.category !== selectedCategory) {
        return false;
      }

      // Filtro de busca (Nome, EAN, Código Interno, Princípio Ativo)
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchName = (p.name || '').toLowerCase().includes(query);
        const matchEan = (p.barcode || '').toLowerCase().includes(query);
        const matchCode = (p.internalCode || '').toLowerCase().includes(query);
        const matchActive = (p.activePrinciple || '').toLowerCase().includes(query);
        const matchManufacturer = (p.manufacturer || '').toLowerCase().includes(query);
        return matchName || matchEan || matchCode || matchActive || matchManufacturer;
      }

      return true;
    });
  }, [products, onlyPromotions, selectedCategory, searchTerm]);

  // Helper para calcular se item já está na fila
  const isProductInQueue = (productId: string) => {
    return tagItems.some((item) => item.id === productId);
  };

  // Adicionar produto à fila (com suporte a aviso sonoro e toast opcional)
  const handleAddProduct = useCallback((product: Product, source: 'manual' | 'scanner' = 'manual') => {
    let updatedQty = 1;
    let wasAlreadyInQueue = false;

    setTagItems((prev) => {
      const exists = prev.some((item) => item.id === product.id);
      if (exists) {
        wasAlreadyInQueue = true;
        return prev.map((item) => {
          if (item.id === product.id) {
            updatedQty = item.quantity + 1;
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
        customObservations: ''
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
    if (!code) return;

    // Normalizar removendo espaços
    const cleanCode = code.replace(/\s+/g, '');

    // Busca exata pelo EAN/Barcode, ou Código Interno
    const matchedProduct = products.find((p) => {
      const pBarcode = (p.barcode || '').trim().replace(/\s+/g, '');
      const pInternal = (p.internalCode || '').trim().replace(/\s+/g, '');
      return pBarcode === cleanCode || pInternal === cleanCode;
    });

    if (matchedProduct) {
      handleAddProduct(matchedProduct, 'scanner');
      setSearchTerm('');
      setIsScannerOpen(false); // Fecha o modal após ler com sucesso
      // Manter foco no campo para o próximo bip do leitor físico
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
      // Manter foco no input para tentar outro ou corrigir
      setTimeout(() => {
        searchInputRef.current?.select();
      }, 50);
      return false;
    }
  }, [products, handleAddProduct, playBeep, showToast]);

  // Adicionar todos os filtrados
  const handleAddAllFiltered = () => {
    const toAdd = filteredCatalog.filter((p) => !isProductInQueue(p.id));
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
        customObservations: ''
      };
    });

    setTagItems((prev) => [...newItems, ...prev]);
  };

  // Remover produto da fila
  const handleRemoveItem = (id: string) => {
    setTagItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Limpar toda a fila
  const handleClearAll = () => {
    if (tagItems.length === 0) return;
    if (confirm('Deseja remover todas as etiquetas selecionadas da fila?')) {
      setTagItems([]);
    }
  };

  // Atualizar campo de um item
  const handleUpdateItem = (id: string, updates: Partial<PriceTagItem>) => {
    setTagItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  // Aplicar badge em massa
  const handleApplyGlobalBadge = (badge: string) => {
    setGlobalBadge(badge);
    if (tagItems.length > 0) {
      setTagItems((prev) =>
        prev.map((item) => ({ ...item, badgeText: badge }))
      );
    }
  };

  // Tecla de atalho global ou no input (Enter no campo de busca aciona busca rápida por EAN)
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const term = searchTerm.trim();
      if (term) {
        // Se for um código de barras / EAN numérico ou código interno exato
        const found = handleBarcodeScanned(term);
        if (found) {
          e.preventDefault();
        }
      }
    }
  };

  // Limpeza de timeout de notificação ao desmontar
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // Executar Impressão Nativa do Navegador
  const handlePrint = () => {
    window.print();
  };

  // Data atual formatada para impressão
  const todayFormatted = new Date().toLocaleDateString('pt-BR');

  // Quantidade total de etiquetas calculando as repetições
  const totalTagsToPrint = useMemo(() => {
    return tagItems.reduce((acc, curr) => acc + (Number(curr.quantity) || 1), 0);
  }, [tagItems]);

  // Lista expandida com repetição de quantidades para renderização fiel da folha
  const expandedTagList = useMemo(() => {
    const list: { item: PriceTagItem; index: number }[] = [];
    tagItems.forEach((item) => {
      const q = Math.max(1, item.quantity || 1);
      for (let i = 0; i < q; i++) {
        list.push({ item, index: i });
      }
    });
    return list;
  }, [tagItems]);

  return (
    <div className="space-y-8 pb-16">
      {/* CABEÇALHO DO MÓDULO */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-100">
            <Tag size={14} />
            Comunicação Visual de Ponto de Venda (PDV)
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
            Gerador de Etiquetas & Cartazeamento
          </h1>
          <p className="text-sm font-medium text-gray-500 max-w-2xl">
            Crie e imprima etiquetas de gôndola, faixas promocionais e cartazes de ofertas para a sua farmácia.
            Personalize chamadas ("Validade Próxima", "Super Oferta") e imprima em folha A4 com precisão.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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

      {/* GRID PRINCIPAL: 2 COLUNAS (Catálogo à esquerda / Fila e Personalização à direita) */}
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

            {/* Campo de Busca e Leitor de Código de Barras (Pistola USB / Câmera) */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Buscar ou bipar EAN / Código com o leitor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  className="w-full pl-10 pr-9 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 placeholder-gray-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 focus:outline-none transition-all"
                />
                {searchTerm ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
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

              {/* Botão de Scanner (Abre o Scanner idêntico ao menu de produtos) */}
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
                Pistola USB ou câmera: bipe o produto para incluir na fila
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

            {/* Lista com Rolagem dos Produtos */}
            <div className="max-h-[500px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {filteredCatalog.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-gray-100 rounded-2xl">
                  <AlertCircle size={28} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-xs font-bold text-gray-500">Nenhum produto encontrado</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Tente alterar os termos de busca ou filtros.</p>
                </div>
              ) : (
                filteredCatalog.map((product) => {
                  const inQueue = isProductInQueue(product.id);
                  const promoPrice = Number(product.promotionalPrice || product.promotional_price || 0);
                  const isPromo = promoPrice > 0 && promoPrice < product.price;

                  return (
                    <div
                      key={product.id}
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
                        onClick={() => handleAddProduct(product)}
                        className={`p-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                          inQueue
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                            : 'bg-gray-50 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 border border-gray-200'
                        }`}
                        title={inQueue ? 'Adicionar mais uma cópia à fila' : 'Adicionar à fila de etiquetas'}
                      >
                        {inQueue ? <Plus size={16} /> : <Plus size={16} />}
                      </button>
                    </div>
                  );
                })
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
                onClick={() => setLayoutFormat('gondola_pimaco')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  layoutFormat === 'gondola_pimaco'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs mb-2">
                    A4
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Gôndola Padrão</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    Folha Pimaco (Grade 3x10 ou similar ~100x30mm)
                  </p>
                </div>
                <span className="text-[9px] font-black uppercase text-emerald-700 mt-3 block">
                  Recomendado para Prateleiras
                </span>
              </button>

              {/* Modelo 2: Etiqueta Baiana / Testeira */}
              <button
                type="button"
                onClick={() => setLayoutFormat('baiana_destaque')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  layoutFormat === 'baiana_destaque'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-black text-xs mb-2">
                    TOP
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Etiqueta Baiana</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    Tarja colorida de cabeçalho DE/POR de alto impacto
                  </p>
                </div>
                <span className="text-[9px] font-black uppercase text-amber-700 mt-3 block">
                  Pontas de Gôndola
                </span>
              </button>

              {/* Modelo 3: Cartaz A5 */}
              <button
                type="button"
                onClick={() => setLayoutFormat('cartaz_a5')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  layoutFormat === 'cartaz_a5'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-800 flex items-center justify-center font-black text-xs mb-2">
                    A5
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Cartaz A5</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    Meia folha A4 para cestos e balcão
                  </p>
                </div>
                <span className="text-[9px] font-black uppercase text-blue-700 mt-3 block">
                  Ilhas e Cestões
                </span>
              </button>

              {/* Modelo 4: Cartaz A4 */}
              <button
                type="button"
                onClick={() => setLayoutFormat('cartaz_a4')}
                className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                  layoutFormat === 'cartaz_a4'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-200 bg-white'
                }`}
              >
                <div>
                  <div className="w-8 h-8 rounded-xl bg-red-100 text-red-800 flex items-center justify-center font-black text-xs mb-2">
                    A4
                  </div>
                  <h4 className="text-xs font-black text-gray-900">Cartaz A4</h4>
                  <p className="text-[10px] font-medium text-gray-500 mt-0.5 leading-tight">
                    Folha inteira para vitrine e entrada da loja
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
                    className="text-[11px] font-bold text-red-600 hover:underline"
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
                  Total de {totalTagsToPrint} etiqueta(s) a ser(em) gerada(s).
                </p>
              </div>

              {tagItems.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>Limpar Fila</span>
                </button>
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
                  <div
                    key={item.id}
                    className="p-4 rounded-2xl border border-gray-100 bg-gray-50/60 hover:bg-white hover:border-gray-200 transition-all space-y-3 shadow-2xs"
                  >
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
                            onClick={() =>
                              handleUpdateItem(item.id, {
                                quantity: Math.max(1, item.quantity - 1)
                              })
                            }
                            className="p-1 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                            title="Diminuir quantidade"
                          >
                            <Minus size={13} />
                          </button>
                          <span className="px-2 text-xs font-black text-gray-900 min-w-[24px] text-center">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateItem(item.id, {
                                quantity: item.quantity + 1
                              })
                            }
                            className="p-1 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors"
                            title="Aumentar quantidade"
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
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
                          onChange={(e) =>
                            handleUpdateItem(item.id, { badgeText: e.target.value.toUpperCase() })
                          }
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
                              onChange={(e) =>
                                handleUpdateItem(item.id, { showOriginalPrice: e.target.checked })
                              }
                              className="rounded text-emerald-600 w-3 h-3"
                            />
                            <span>Exibir</span>
                          </label>
                        </div>
                        <input
                          type="number"
                          step="0.01"
                          value={item.originalPrice}
                          onChange={(e) =>
                            handleUpdateItem(item.id, { originalPrice: parseFloat(e.target.value) || 0 })
                          }
                          className="w-full px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-900 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-black uppercase text-emerald-700 block mb-1">
                          Preço POR (R$)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={item.promotionalPrice}
                          onChange={(e) =>
                            handleUpdateItem(item.id, { promotionalPrice: parseFloat(e.target.value) || 0 })
                          }
                          className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-black text-emerald-700 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Linha 3: Observações Opcionais (ex: Lote/Validade ou Preço por Unidade) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Info extra (ex: Venc: 10/2026 - Lote: 301A)"
                        value={item.customObservations || ''}
                        onChange={(e) =>
                          handleUpdateItem(item.id, { customObservations: e.target.value })
                        }
                        className="w-full px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-[11px] text-gray-600 focus:border-emerald-500 focus:outline-none"
                      />

                      <input
                        type="text"
                        placeholder="Preço fracionado (ex: R$ 0,25/comp)"
                        value={item.unitMeasurementText || ''}
                        onChange={(e) =>
                          handleUpdateItem(item.id, { unitMeasurementText: e.target.value })
                        }
                        className="w-full px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-[11px] text-gray-600 focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE PRÉ-VISUALIZAÇÃO & IMPRESSÃO */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-gray-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-5xl max-h-[95vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100">
            {/* Topbar do Modal (Oculto ao Imprimir via CSS) */}
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
                      {layoutFormat === 'gondola_pimaco' && 'Gôndola Padrão (Folha A4 em Grade)'}
                      {layoutFormat === 'baiana_destaque' && 'Etiqueta Baiana / Testeira Destaque'}
                      {layoutFormat === 'cartaz_a5' && 'Cartaz Promocional A5 (Meia Folha)'}
                      {layoutFormat === 'cartaz_a4' && 'Cartaz Promocional A4 (Folha Inteira)'}
                    </strong>{' '}
                    • {totalTagsToPrint} etiqueta(s)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  <Printer size={16} />
                  <span>Imprimir Agora</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Dica Rápida de Configuração do Navegador */}
            <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 flex items-center gap-2 shrink-0 print:hidden">
              <AlertCircle size={14} className="shrink-0 text-amber-600" />
              <span>
                <strong>Dica de Impressão:</strong> Na caixa de diálogo do navegador, defina as margens como{' '}
                <strong>"Nenhuma"</strong> ou <strong>"Padrão"</strong> e ative a opção{' '}
                <strong>"Gráficos de segundo plano"</strong> para que as cores de destaque e tarjas saiam nítidas.
              </span>
            </div>

            {/* Área de Renderização da Folha / Preview com rolagem */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-gray-100/80 custom-scrollbar print:p-0 print:bg-white print:overflow-visible">
              
              {/* CONTAINER DA FOLHA DE IMPRESSÃO (Folha A4 simulada) */}
              <div 
                id="printable-price-tags-sheet" 
                className="bg-white mx-auto shadow-md print:shadow-none print:m-0 print:w-full"
                style={{
                  maxWidth: '210mm',
                  minHeight: '297mm',
                  padding: layoutFormat === 'gondola_pimaco' ? '8mm' : '10mm',
                  boxSizing: 'border-box'
                }}
              >
                {/* 1. LAYOUT: GÔNDOLA PADRÃO (PIMACO / GRADE 3 COLUNAS) */}
                {layoutFormat === 'gondola_pimaco' && (
                  <div className="grid grid-cols-3 gap-2 sm:gap-2.5 print:grid-cols-3 print:gap-2">
                    {expandedTagList.map(({ item }, idx) => (
                      <div
                        key={`${item.id}-${idx}`}
                        className="border border-gray-300 rounded-lg p-2 flex flex-col justify-between bg-white text-gray-900 break-inside-avoid relative overflow-hidden"
                        style={{ height: '32mm', boxSizing: 'border-box' }}
                      >
                        {/* Tarja Superior se tiver badge */}
                        {item.badgeText && (
                          <div className="absolute top-0 right-0 bg-yellow-400 text-gray-950 font-black text-[9px] px-2 py-0.5 rounded-bl-md uppercase tracking-wider">
                            {item.badgeText}
                          </div>
                        )}

                        <div>
                          {/* Cabeçalho da Etiqueta: Código e Farmácia */}
                          <div className="flex items-center justify-between text-[8px] font-bold text-gray-400 mb-0.5">
                            <span>
                              {showInternalCode && item.product.internalCode
                                ? `CÓD: ${item.product.internalCode}`
                                : ''}
                            </span>
                            <span>{showStoreLogo ? tenant.name : ''}</span>
                          </div>

                          {/* Nome do Produto */}
                          <h4 className="text-[11px] font-black leading-tight line-clamp-2 text-gray-950">
                            {item.product.name}
                          </h4>

                          {/* Apresentação / Princípio Ativo */}
                          <p className="text-[8px] text-gray-500 truncate mt-0.5">
                            {item.product.activePrinciple || item.product.presentation || item.product.category}
                          </p>
                        </div>

                        {/* Bloco de Preço */}
                        <div className="flex items-end justify-between mt-1 pt-1 border-t border-gray-100">
                          <div>
                            {item.showOriginalPrice && item.originalPrice > item.promotionalPrice && (
                              <span className="text-[9px] text-gray-400 line-through block leading-none">
                                DE R$ {item.originalPrice.toFixed(2).replace('.', ',')}
                              </span>
                            )}
                            <div className="flex items-baseline gap-0.5 leading-none mt-0.5">
                              <span className="text-[9px] font-bold text-gray-500">R$</span>
                              <span className="text-lg font-black text-gray-950 tracking-tight">
                                {item.promotionalPrice.toFixed(2).replace('.', ',')}
                              </span>
                            </div>
                            {item.unitMeasurementText && (
                              <span className="text-[7px] text-gray-500 block leading-tight">
                                {item.unitMeasurementText}
                              </span>
                            )}
                          </div>

                          {/* Código de barras simulado em linhas vetoriais ou EAN textual */}
                          {showBarcode && (
                            <div className="text-right">
                              <div className="inline-block tracking-tighter opacity-80 scale-x-90">
                                {/* Simulação vetorial de código de barras para impressão rápida sem dependências pesadas */}
                                <div className="h-4 flex items-end gap-[1px]">
                                  {[3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2].map((w, i) => (
                                    <span
                                      key={i}
                                      className="bg-black inline-block"
                                      style={{ width: `${w}px`, height: '100%' }}
                                    />
                                  ))}
                                </div>
                              </div>
                              <span className="block text-[7px] font-mono text-gray-600">
                                {item.product.barcode || item.product.internalCode || '7890000000000'}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Data de Impressão e Rodapé */}
                        {showPrintDate && (
                          <div className="text-[7px] text-gray-400 text-right mt-0.5 leading-none">
                            {todayFormatted}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 2. LAYOUT: ETIQUETA BAIANA / TESTEIRA DE DESTAQUE */}
                {layoutFormat === 'baiana_destaque' && (
                  <div className="grid grid-cols-2 gap-3 print:grid-cols-2 print:gap-3">
                    {expandedTagList.map(({ item }, idx) => (
                      <div
                        key={`${item.id}-${idx}`}
                        className="border-2 border-gray-950 rounded-xl overflow-hidden bg-white text-gray-900 break-inside-avoid flex flex-col justify-between"
                        style={{ height: '54mm', boxSizing: 'border-box' }}
                      >
                        {/* Tarja Superior Vermelha/Amarela */}
                        <div className="bg-red-600 text-yellow-300 font-black text-center py-1 px-2 text-xs uppercase tracking-wider flex items-center justify-between">
                          <span className="text-[9px] font-bold text-white truncate max-w-[120px]">
                            {showStoreLogo ? tenant.name : 'DROGARIA'}
                          </span>
                          <span className="font-black text-[11px]">
                            {item.badgeText || 'SUPER OFERTA'}
                          </span>
                          <span className="text-[9px] font-mono text-white">
                            {item.product.internalCode || ''}
                          </span>
                        </div>

                        {/* Corpo com Nome e Informações */}
                        <div className="p-2.5 flex-1 flex flex-col justify-between">
                          <div>
                            <h4 className="text-sm font-black leading-tight text-gray-950 line-clamp-2">
                              {item.product.name}
                            </h4>
                            <p className="text-[9px] text-gray-600 mt-0.5 truncate">
                              {item.product.activePrinciple || item.product.presentation || item.product.category}
                            </p>
                            {item.customObservations && (
                              <p className="text-[8px] font-bold text-red-700 mt-0.5">
                                {item.customObservations}
                              </p>
                            )}
                          </div>

                          {/* Bloco de Preço Grande DE / POR */}
                          <div className="flex items-end justify-between mt-2 pt-1 border-t-2 border-dashed border-gray-200">
                            <div>
                              {item.showOriginalPrice && item.originalPrice > item.promotionalPrice && (
                                <span className="text-xs text-gray-500 line-through font-bold block">
                                  DE: R$ {item.originalPrice.toFixed(2).replace('.', ',')}
                                </span>
                              )}
                              <div className="flex items-baseline gap-1">
                                <span className="text-xs font-black text-red-600">POR R$</span>
                                <span className="text-3xl font-black text-gray-950 tracking-tight leading-none">
                                  {item.promotionalPrice.toFixed(2).replace('.', ',')}
                                </span>
                              </div>
                              {item.unitMeasurementText && (
                                <span className="text-[8px] text-gray-500 block font-semibold">
                                  {item.unitMeasurementText}
                                </span>
                              )}
                            </div>

                            {/* Código de barras */}
                            {showBarcode && (
                              <div className="text-right">
                                <div className="h-4 flex items-end gap-[1px] justify-end">
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

                        {/* Rodapé da Etiqueta Baiana */}
                        {showPrintDate && (
                          <div className="bg-gray-100 px-2 py-0.5 text-[8px] text-gray-500 flex justify-between">
                            <span>Preço válido enquanto durarem os estoques</span>
                            <span>{todayFormatted}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 3. LAYOUT: CARTAZ A5 (MEIA FOLHA) */}
                {layoutFormat === 'cartaz_a5' && (
                  <div className="space-y-6 print:space-y-0">
                    {expandedTagList.map(({ item }, idx) => (
                      <div
                        key={`${item.id}-${idx}`}
                        className="border-4 border-gray-950 rounded-2xl overflow-hidden bg-white text-gray-900 break-inside-avoid flex flex-col justify-between print:mb-0"
                        style={{ height: '138mm', boxSizing: 'border-box', pageBreakAfter: 'always' }}
                      >
                        {/* Topo de Impacto Promocional */}
                        <div className="bg-red-600 text-yellow-300 font-black text-center py-2 px-4 text-xl uppercase tracking-wider flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            {showStoreLogo ? tenant.name : 'DROGARIA'}
                          </span>
                          <span className="text-2xl font-black">
                            {item.badgeText || 'OFERTA ESPECIAL'}
                          </span>
                          <span className="text-xs font-mono text-white">
                            #{item.product.internalCode || ''}
                          </span>
                        </div>

                        {/* Centro: Nome e Detalhes */}
                        <div className="p-6 text-center flex-1 flex flex-col justify-center">
                          <h2 className="text-2xl sm:text-3xl font-black text-gray-950 leading-tight">
                            {item.product.name}
                          </h2>
                          <p className="text-sm font-bold text-gray-600 mt-2">
                            {item.product.activePrinciple || item.product.presentation || item.product.category}
                          </p>
                          {item.customObservations && (
                            <p className="text-xs font-black text-red-600 mt-1">
                              {item.customObservations}
                            </p>
                          )}
                        </div>

                        {/* Bloco de Preço Gigante */}
                        <div className="bg-yellow-300 p-4 text-center border-t-4 border-gray-950">
                          {item.showOriginalPrice && item.originalPrice > item.promotionalPrice && (
                            <div className="text-sm font-black text-gray-700 line-through">
                              DE R$ {item.originalPrice.toFixed(2).replace('.', ',')}
                            </div>
                          )}
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-xl font-black text-red-700">POR APENAS R$</span>
                            <span className="text-6xl font-black text-gray-950 tracking-tighter">
                              {item.promotionalPrice.toFixed(2).replace('.', ',')}
                            </span>
                          </div>
                          {item.unitMeasurementText && (
                            <span className="text-xs font-bold text-gray-800 block mt-1">
                              {item.unitMeasurementText}
                            </span>
                          )}
                        </div>

                        {/* Rodapé Informativo */}
                        <div className="p-2 bg-gray-50 flex items-center justify-between text-xs text-gray-500 font-bold border-t border-gray-200">
                          <span>{tenant.name} • Oferta de Ponto de Venda</span>
                          {showBarcode && (
                            <span className="font-mono">
                              EAN: {item.product.barcode || item.product.internalCode}
                            </span>
                          )}
                          <span>Emitido em: {todayFormatted}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 4. LAYOUT: CARTAZ A4 (FOLHA INTEIRA) */}
                {layoutFormat === 'cartaz_a4' && (
                  <div className="space-y-8 print:space-y-0">
                    {expandedTagList.map(({ item }, idx) => (
                      <div
                        key={`${item.id}-${idx}`}
                        className="border-8 border-gray-950 rounded-3xl overflow-hidden bg-white text-gray-900 break-inside-avoid flex flex-col justify-between print:m-0"
                        style={{ height: '277mm', boxSizing: 'border-box', pageBreakAfter: 'always' }}
                      >
                        {/* Topo de Impacto Máximo */}
                        <div className="bg-red-600 text-yellow-300 font-black text-center py-4 px-6 text-3xl uppercase tracking-widest flex items-center justify-between border-b-8 border-gray-950">
                          <span className="text-sm font-bold text-white">
                            {showStoreLogo ? tenant.name : 'DROGARIA'}
                          </span>
                          <span className="text-4xl font-black tracking-tight">
                            {item.badgeText || 'SUPER OFERTA'}
                          </span>
                          <span className="text-sm font-mono text-white">
                            #{item.product.internalCode || ''}
                          </span>
                        </div>

                        {/* Centro: Nome do Produto em Destaque */}
                        <div className="p-8 text-center flex-1 flex flex-col justify-center items-center">
                          <h2 className="text-4xl sm:text-5xl font-black text-gray-950 leading-tight max-w-lg">
                            {item.product.name}
                          </h2>
                          <p className="text-lg font-bold text-gray-600 mt-4 max-w-md">
                            {item.product.activePrinciple || item.product.presentation || item.product.category}
                          </p>
                          {item.customObservations && (
                            <div className="mt-3 px-4 py-1.5 bg-red-100 text-red-800 rounded-xl text-sm font-black uppercase">
                              {item.customObservations}
                            </div>
                          )}
                        </div>

                        {/* Bloco de Preço Gigante da Vitrine */}
                        <div className="bg-yellow-300 p-8 text-center border-t-8 border-b-8 border-gray-950">
                          {item.showOriginalPrice && item.originalPrice > item.promotionalPrice && (
                            <div className="text-2xl font-black text-gray-700 line-through mb-1">
                              DE R$ {item.originalPrice.toFixed(2).replace('.', ',')}
                            </div>
                          )}
                          <div className="flex items-center justify-center gap-3">
                            <span className="text-3xl font-black text-red-700">POR APENAS R$</span>
                            <span className="text-8xl font-black text-gray-950 tracking-tighter">
                              {item.promotionalPrice.toFixed(2).replace('.', ',')}
                            </span>
                          </div>
                          {item.unitMeasurementText && (
                            <span className="text-base font-black text-gray-800 block mt-2">
                              {item.unitMeasurementText}
                            </span>
                          )}
                        </div>

                        {/* Rodapé da Vitrine */}
                        <div className="p-4 bg-gray-100 flex items-center justify-between text-sm text-gray-600 font-black">
                          <span>{tenant.name} • Ofertas válidas enquanto durarem os estoques</span>
                          {showBarcode && (
                            <span className="font-mono">
                              EAN: {item.product.barcode || item.product.internalCode}
                            </span>
                          )}
                          <span>Impressão: {todayFormatted}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Rodapé do Modal com Botões */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between shrink-0 print:hidden">
              <span className="text-xs text-gray-500 font-medium">
                Pressione <strong>Ctrl + P</strong> ou clique no botão de impressão.
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-200 transition-colors cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  <Printer size={16} />
                  <span>Imprimir Folha</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SCANNER DE PRODUTO (CONFIGURAÇÃO IDÊNTICA AO MENU DE PRODUTOS) */}
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

      {/* TOAST OPERACIONAL FLUTUANTE (FEEDBACK VISUAL DE LEITURA) */}
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
                  className="text-white/60 hover:text-white p-0.5"
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
  );
};
