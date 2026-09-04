
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Product, PharmacyConfig } from '../types';
import { 
  Search, Plus, Edit3, Trash2, X, Save, Image as ImageIcon, 
  Loader2, Sparkles, Wand2, Upload, FileSpreadsheet, Factory, 
  Package, CheckSquare, Square, ListChecks, CheckCircle2, Star, ChevronDown, Filter,
  RefreshCw, Info, AlertCircle, CheckCircle, ArrowRight, History, FileText, Printer, FileImage, Link as LinkIcon, Store, ShoppingCart, ArrowDown, Minus, Download, Tag, RotateCcw, ImageOff, ScanLine, Layers
} from 'lucide-react';
import { fetchProductDetails, generateAiProductImage } from '../services/gemini';
import { processAiEnrichmentQueue, AiEnrichmentReport } from '../services/aiProcessor';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { domToJpeg } from 'modern-screenshot';
import Select from 'react-select';
import Fuse from 'fuse.js';
import ProductScanner from './ProductScanner';
import { SmartNumberInput } from './SmartNumberInput';
import { getDepartmentForCategory, DEPARTMENT_MAPPING, OFFICIAL_DEPARTMENTS, OFFICIAL_TAXONOMY, classifyProductTaxonomy } from '../lib/departments';
import { getStoreUrl } from '../lib/store';
import { AdminDepartmentManager } from './AdminDepartmentManager';
import { DynamicFlyerGenerator } from './DynamicFlyerGenerator';
import { getTenants, getProductsByTenant, saveProductsByTenant } from '../services/storage';
import { supabase } from '../services/supabase';

const GENERIC_PLACEHOLDER = 'https://cdn-icons-png.flaticon.com/512/4668/4668502.png';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface AuditItem {
    name: string;
    code: string;
    status: 'updated' | 'created' | 'no-change' | 'deleted';
    details: string;
}

interface ImportSummary {
    totalItems: number;
    ignoredItems: number;
    enrichedItems: number;
    imagesValidated: number;
    newImageSearches: number;
    tokensSaved: number;
}

interface AdminProductManagerProps {
  products: Product[];
  tenant: PharmacyConfig;
  isLoading?: boolean;
  onProductsUpdate: (products: Product[]) => Promise<void> | void;
  onProductsStateUpdate: (products: Product[]) => void;
  onProductDelete: (productId: string) => Promise<void> | void;
  onBulkDelete: (productIds: string[]) => Promise<void> | void;
  onTenantUpdate: (config: PharmacyConfig) => Promise<void> | void;
}

const InputLabel = ({ label }: { label: string }) => (
  <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1 mb-1 block">{label}</label>
);

const parseNumberSafe = (val: any): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;

  let str = String(val).trim().replace(/[R$\s]/g, '');
  if (!str) return 0;

  // Tratar formato contábil (ex: "(9)" para negativo)
  if (str.startsWith('(') && str.endsWith(')')) {
    str = '-' + str.slice(1, -1);
  }
  // Tratar sinais de menos unicode (que o parseFloat não entende)
  str = str.replace(/[−–—]/g, '-');

  if (str.includes('.') && str.includes(',')) {
    const lastDotIndex = str.lastIndexOf('.');
    const lastCommaIndex = str.lastIndexOf(',');
    if (lastCommaIndex > lastDotIndex) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    str = str.replace(/,/g, '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

const fixImageUrl = (url?: string, width: number = 200): string | null => {
    try {
        if (!url || url === 'IGNORE' || url === 'PENDENTE_CURADORIA') return null;
        if (url.startsWith('data:')) {
            if (!url.includes(',') || !url.startsWith('data:image/')) {
                return GENERIC_PLACEHOLDER;
            }
            return url;
        }
        
        // Bypass proxy for known CDNs that work well and might block proxies
        if (url.includes('cdn-cosmos.bluesoft.com.br')) {
            return url;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            if (url.startsWith('/') || url.startsWith('.')) {
                return url;
            }
            return GENERIC_PLACEHOLDER;
        }

        // Otimização de Imagem: Utilizamos o proxy Weserv.nl para converter para WebP e garantir HTTPS
        return `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=webp&q=80&w=${width}&we&default=${encodeURIComponent(GENERIC_PLACEHOLDER)}`;
    } catch (e) {
        return GENERIC_PLACEHOLDER;
    }
};

const normalizeManufacturerName = (name: string): string => {
    if (!name) return '';
    return name.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/\b(generico|farma|ltda|s\.a\.|s\/a|sa|laboratorio|lab)\b/g, '') // remove noise words
        .replace(/[^a-z0-9]/g, ' ') // remove special chars
        .replace(/\s+/g, ' ') // remove extra spaces
        .trim();
};

const findMatchingManufacturer = (
    rawName: string, 
    existingManufacturers: string[], 
    synonyms: Record<string, string>
): string => {
    if (!rawName) return 'Outros';
    
    const normalizedRaw = normalizeManufacturerName(rawName);
    if (!normalizedRaw) return rawName.trim();
    
    // 1. Check synonyms first
    if (synonyms[normalizedRaw]) {
        return synonyms[normalizedRaw];
    }
    
    // 2. Exact match on normalized existing
    for (const existing of existingManufacturers) {
        if (normalizeManufacturerName(existing) === normalizedRaw) {
            return existing;
        }
    }
    
    // 3. Containment check
    for (const existing of existingManufacturers) {
        const normalizedExisting = normalizeManufacturerName(existing);
        if (normalizedExisting && normalizedExisting.length > 2 && normalizedRaw.length > 2) {
            if (normalizedRaw.includes(normalizedExisting) || normalizedExisting.includes(normalizedRaw)) {
                return existing;
            }
        }
    }
    
    // 4. Return original raw name if no match
    return rawName.trim();
};

const customSelectStyles = {
  control: (provided: any, state: any) => ({
    ...provided,
    backgroundColor: state.isFocused ? 'white' : '#f9fafb',
    borderColor: state.isFocused ? '#10b981' : 'transparent',
    borderWidth: '2px',
    borderRadius: '1rem',
    paddingLeft: '2.5rem',
    boxShadow: 'none',
    '&:hover': {
      borderColor: state.isFocused ? '#10b981' : 'transparent',
    },
    minHeight: '56px',
    cursor: 'pointer',
    fontWeight: '700',
    color: '#111827',
  }),
  valueContainer: (provided: any) => ({
    ...provided,
    padding: '0',
  }),
  input: (provided: any) => ({
    ...provided,
    margin: '0',
    padding: '0',
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  dropdownIndicator: (provided: any) => ({
    ...provided,
    color: '#9ca3af',
    paddingRight: '1rem',
  }),
  menu: (provided: any) => ({
    ...provided,
    borderRadius: '1rem',
    overflow: 'hidden',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    zIndex: 50,
  }),
  option: (provided: any, state: any) => ({
    ...provided,
    backgroundColor: state.isSelected ? '#10b981' : state.isFocused ? '#ecfdf5' : 'white',
    color: state.isSelected ? 'white' : '#111827',
    fontWeight: '700',
    cursor: 'pointer',
    '&:active': {
      backgroundColor: '#10b981',
    },
  }),
  singleValue: (provided: any) => ({
    ...provided,
    color: '#111827',
  }),
};

const readFileAsArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
  try {
    return await file.arrayBuffer();
  } catch (arrayBufferError: any) {
    console.warn("file.arrayBuffer() falhou, tentando fallback com FileReader...", arrayBufferError);
    try {
      return await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(reader.result);
          } else {
            reject(new Error("Formato inválido retornado pelo FileReader"));
          }
        };
        reader.onerror = () => reject(reader.error || new Error("Erro desconhecido ao ler o arquivo via FileReader."));
        reader.readAsArrayBuffer(file);
      });
    } catch (fileReaderError: any) {
      console.error("Ambos os métodos de leitura falharam.", fileReaderError);
      const isIframe = window.self !== window.top;
      let customMsg = "Não foi possível ler o arquivo de planilha selecionado. Isso geralmente ocorre devido a restrições de segurança ou permissão de acesso local do seu navegador.";
      if (isIframe) {
        customMsg += "\n\n💡 RECOMENDAÇÃO DE PREVIEW:\nComo você está utilizando a aplicação dentro do frame de visualização (Iframe) do AI Studio, políticas rígidas de segurança do navegador podem bloquear a leitura direta de arquivos do seu disco local.\n\nPara solucionar e realizar seus testes perfeitamente, clique no link de visualização externa ou abra a aplicação em uma NOVA ABA no topo direito do AI Studio, e tente novamente.";
      } else {
        customMsg += "\n\n💡 Dica: Verifique se o arquivo não está aberto ou bloqueado por outro aplicativo (como o Microsoft Excel) e certifique-se de que ele esteja salvo localmente em uma pasta comum (como 'Documentos' ou 'Downloads') em vez de um pendrive ou pasta na rede.";
      }
      throw new Error(customMsg);
    }
  }
};

const readSpreadsheetToJSON = async (file: File): Promise<any[]> => {
  // 1. Tentar ler localmente primeiro
  try {
    let aoa: any[][] = [];

    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await file.text();
      aoa = await new Promise<any[][]>((resolve, reject) => {
        Papa.parse(text, {
          header: false,
          skipEmptyLines: true,
          complete: (results) => {
            resolve(results.data as any[][]);
          },
          error: (err: any) => {
            reject(err);
          }
        });
      });
    } else {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', codepage: 65001 });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    }

    const keywords = ['nome', 'produto', 'descricao', 'ean', 'codigo', 'barras', 'preco', 'valor', 'estoque', 'quantidade', 'ativo', 'unidade', 'un', 'fabricante', 'laboratorio', 'marca', 'fornecedor', 'empresa', 'logo', 'imagem'];
    const normalize = (str: any) => String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

    let bestHeaderIdx = 0;
    let maxScore = -1;

    for (let i = 0; i < Math.min(20, aoa.length); i++) {
        const row = aoa[i];
        if (!row || !Array.isArray(row)) continue;
        let score = 0;
        for (const cell of row) {
            if (!cell) continue;
            const norm = normalize(cell);
            for (const kw of keywords) {
                if (norm.includes(kw)) score++;
            }
        }
        if (score > maxScore) {
            maxScore = score;
            bestHeaderIdx = i;
        }
    }

    const headers = aoa[bestHeaderIdx] || [];
    const result = [];
    for (let i = bestHeaderIdx + 1; i < aoa.length; i++) {
        const row = aoa[i];
        if (!row || row.length === 0) continue;
        
        const isEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
        if (isEmpty) continue;
        
        const obj: any = {};
        for (let j = 0; j < headers.length; j++) {
            const header = headers[j];
            if (header !== undefined && header !== null && String(header).trim() !== '') {
                obj[String(header)] = row[j];
            }
        }
        result.push(obj);
    }

    return result;
  } catch (localError) {
    console.warn("Leitura local falhou. Tentando processamento via API do servidor...", localError);
    // 2. Se falhar, enviar para o endpoint do servidor que fará o parse de forma segura
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const response = await fetch("/api/v1/parse-excel", {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Erro de resposta HTTP ${response.status}`);
      }
      
      const result = await response.json();
      if (result && Array.isArray(result.data)) {
        console.log(`Planilha processada com sucesso via servidor: ${result.data.length} linhas.`);
        return result.data;
      }
      throw new Error("Resposta inválida do servidor de processamento.");
    } catch (apiError: any) {
      console.error("Erro no processamento local e da API do servidor:", apiError);
      const isIframe = window.self !== window.top;
      let customMsg = "Não foi possível processar o arquivo de planilha. Isso ocorre devido a restrições de segurança ou permissão do navegador.";
      if (isIframe) {
        customMsg += "\n\n💡 SOLUÇÃO RÁPIDA (RECOMENDAÇÃO):\nComo a aplicação está rodando em um frame de visualização, políticas rígidas do Chrome impedem o acesso a arquivos locais.\n\nPara corrigir isso facilmente e fazer sua importação:\n1. Clique no link para abrir o app em uma NOVA ABA no topo direito do AI Studio e tente novamente; OU\n2. Use o campo 'Copiar & Colar' para colar os dados diretamente sem precisar enviar arquivos!";
      } else {
        customMsg += `\nDetalhes do erro: ${apiError.message || apiError}`;
      }
      throw new Error(customMsg);
    }
  }
};

const parsePastedData = (text: string): any[] => {
  if (!text || !text.trim()) return [];
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return [];

  const firstLine = lines[0];
  let delimiter = '\t';
  if (!firstLine.includes('\t')) {
    if (firstLine.includes(';')) {
      delimiter = ';';
    } else if (firstLine.includes(',')) {
      delimiter = ',';
    }
  }

  // Parse headers
  const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delimiter).map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (cells.length === 0 || (cells.length === 1 && !cells[0])) continue;
    
    const row: any = {};
    headers.forEach((header, index) => {
      if (header) {
        row[header] = cells[index] !== undefined && cells[index] !== "" ? cells[index] : null;
      }
    });
    rows.push(row);
  }
  return rows;
};

export const AdminProductManager: React.FC<AdminProductManagerProps> = ({
  products,
  tenant,
  isLoading,
  onProductsUpdate,
  onProductsStateUpdate,
  onProductDelete,
  onBulkDelete,
  onTenantUpdate
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('Todos');
  const [filterCategory, setFilterCategory] = useState('Todos');
  const [filterManufacturer, setFilterManufacturer] = useState('Todos');
  const [filterPromotion, setFilterPromotion] = useState('Todos');
  const [filterZeroStock, setFilterZeroStock] = useState(false);
  const [filterFeatured, setFilterFeatured] = useState(false);
  const [filterNoImage, setFilterNoImage] = useState(false);
  const [filterPrescription, setFilterPrescription] = useState('Todos');
  
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [selectedDeptForEdit, setSelectedDeptForEdit] = useState<string>('Outros');
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [isManagingLabLogos, setIsManagingLabLogos] = useState(false);
  const [newLabLogo, setNewLabLogo] = useState<{name: string, logo: string, originalName?: string}>({ name: '', logo: '' });
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importMethod, setImportMethod] = useState<'file' | 'paste'>('file');
  const [pastedText, setPastedText] = useState('');
  const [showManufacturerImport, setShowManufacturerImport] = useState(false);
  const [manufacturerImportMethod, setManufacturerImportMethod] = useState<'file' | 'paste'>('file');
  const [pastedManufacturersText, setPastedManufacturersText] = useState('');
  const [centralPriceImportMethod, setCentralPriceImportMethod] = useState<'file' | 'paste'>('file');
  const [pastedCentralPricesText, setPastedCentralPricesText] = useState('');
  const [isCentralPriceModalOpen, setIsCentralPriceModalOpen] = useState(false);
  const [centralPriceBranches, setCentralPriceBranches] = useState<PharmacyConfig[]>([]);
  const [selectedCentralBranches, setSelectedCentralBranches] = useState<Set<string>>(new Set());
  const [centralPriceScope, setCentralPriceScope] = useState<'ALL' | 'SELECT'>('ALL');
  const [isProcessingCentralPrice, setIsProcessingCentralPrice] = useState(false);
  const [centralPriceProgress, setCentralPriceProgress] = useState(0);
  const [centralPriceLogs, setCentralPriceLogs] = useState<AuditItem[]>([]);
  const centralPriceInputRef = useRef<HTMLInputElement>(null);
  
  const [isBulkFeaturedModalOpen, setIsBulkFeaturedModalOpen] = useState(false);
  const [bulkFeaturedBranches, setBulkFeaturedBranches] = useState<PharmacyConfig[]>([]);
  const [selectedBulkFeaturedBranches, setSelectedBulkFeaturedBranches] = useState<Set<string>>(new Set());
  const [isProcessingBulkFeatured, setIsProcessingBulkFeatured] = useState(false);
  const [bulkFeaturedProgress, setBulkFeaturedProgress] = useState(0);
  const [bulkFeaturedMode, setBulkFeaturedMode] = useState<'append' | 'replace'>('append');

  const [isDepartmentManagerOpen, setIsDepartmentManagerOpen] = useState(false);
  const [importType, setImportType] = useState<'simple' | 'ai'>('simple');
  const [importStockMode, setImportStockMode] = useState<'ADD' | 'SET' | 'SUBTRACT'>('SET'); 
  const [importMode, setImportMode] = useState<'UPDATE' | 'REPLACE'>('UPDATE');
  const [preserveImagesOnImport, setPreserveImagesOnImport] = useState(false);
  const [imageSnapshot, setImageSnapshot] = useState<Record<string, string | undefined> | null>(() => {
      try {
          const stored = localStorage.getItem(`image_snapshot_${tenant.id}`);
          return stored ? JSON.parse(stored) : null;
      } catch (e) {
          return null;
      }
  });
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [auditReport, setAuditReport] = useState<AuditItem[] | null>(null);
  const [isGeneratingInfo, setIsGeneratingInfo] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isPhysicalSaleOpen, setIsPhysicalSaleOpen] = useState(false);
  const [physicalSaleSearch, setPhysicalSaleSearch] = useState('');
  const [physicalSaleQty, setPhysicalSaleQty] = useState(1);
  const [selectedPhysicalProduct, setSelectedPhysicalProduct] = useState<Product | null>(null);
  const [scannerTarget, setScannerTarget] = useState<'MAIN' | 'PDV' | null>(null);
  const [pendingScanResult, setPendingScanResult] = useState<string | null>(null);
  const [isFlyerModalOpen, setIsFlyerModalOpen] = useState(false);
  const [isGeneratingJPG, setIsGeneratingJPG] = useState(false);
  const flyerRef = useRef<HTMLDivElement>(null);
  const [customCategoryMode, setCustomCategoryMode] = useState(false);
  const [customDrugTypeMode, setCustomDrugTypeMode] = useState(false);
  const [customManufacturerMode, setCustomManufacturerMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number | 'all'>(50);
  const [aiJobProgress, setAiJobProgress] = useState<{ processed: number, total: number, report: AiEnrichmentReport } | null>(null);
  const [isBulkPrescriptionModalOpen, setIsBulkPrescriptionModalOpen] = useState(false);
  const [isBulkCategoryModalOpen, setIsBulkCategoryModalOpen] = useState(false);
  const [bulkSelectedCategory, setBulkSelectedCategory] = useState('');
  const [bulkSelectedDepartment, setBulkSelectedDepartment] = useState('Outros');
  const [isUpdatingBulkCategory, setIsUpdatingBulkCategory] = useState(false);
  const [bulkPrescriptionAction, setBulkPrescriptionAction] = useState<'REQUIRE' | 'REMOVE' | null>(null);
  const [isUpdatingBulkPrescription, setIsUpdatingBulkPrescription] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [overwriteExistingData, setOverwriteExistingData] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  
  // Keep a ref to the latest products to avoid stale closures in background queues
  const productsRef = useRef(products);
  useEffect(() => {
      productsRef.current = products;
  }, [products]);

  useEffect(() => {
    if ((!tenant.departments || tenant.departments.length === 0) && Object.keys(DEPARTMENT_MAPPING).length > 0) {
        const defaultDepartments = Object.keys(DEPARTMENT_MAPPING).map(deptName => ({
            id: Math.random().toString(36).substr(2, 9),
            name: deptName,
            categories: [],
            iconName: 'Package',
            priority: 0
        }));
        
        // Populate categories based on mapping
        products.forEach(p => {
             const deptName = getDepartmentForCategory(p.category, []);
             const dept = defaultDepartments.find(d => d.name === deptName);
             if (dept && !dept.categories.includes(p.category)) {
                 dept.categories.push(p.category);
             }
        });
        
        onTenantUpdate({ ...tenant, departments: defaultDepartments });
    }
  }, [tenant.id]);

  const handleBulkDeleteClick = async () => {
      if (!confirm(`Excluir ${selectedProducts.size} produtos?`)) return;
      setIsDeletingBulk(true);
      try {
          await onBulkDelete(Array.from(selectedProducts));
          setSelectedProducts(new Set());
      } finally {
          setIsDeletingBulk(false);
      }
  };

  const handleBulkPrescriptionClick = () => {
      setIsBulkPrescriptionModalOpen(true);
  };

  const handleBulkCategoryClick = () => {
      setIsBulkCategoryModalOpen(true);
  };

  const handleApplyBulkFeatured = async () => {
    if (selectedProducts.size === 0) {
      alert("Selecione pelo menos um produto na Matriz.");
      return;
    }
    if (selectedBulkFeaturedBranches.size === 0) {
      alert("Selecione pelo menos uma filial.");
      return;
    }

    setIsProcessingBulkFeatured(true);
    setBulkFeaturedProgress(20);

    try {
      const response = await fetch("/api/v1/matrix/bulk-featured-products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productIds: Array.from(selectedProducts),
          targetTenantIds: Array.from(selectedBulkFeaturedBranches),
          mode: bulkFeaturedMode,
        }),
      });

      setBulkFeaturedProgress(60);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erro ao definir destaques nas filiais.");
      }

      setBulkFeaturedProgress(100);
      alert(data.message || "Destaques aplicados com sucesso nas filiais selecionadas!");
      
      // Reset selected products/branches
      setSelectedProducts(new Set());
      setSelectedBulkFeaturedBranches(new Set());
      setIsBulkFeaturedModalOpen(false);
    } catch (error: any) {
      console.error("Erro ao aplicar destaques em lote:", error);
      alert(error.message || "Ocorreu um erro ao aplicar destaques em lote.");
    } finally {
      setIsProcessingBulkFeatured(false);
      setBulkFeaturedProgress(0);
    }
  };

  const confirmBulkCategory = async () => {
      if (!bulkSelectedCategory) return;
      setIsUpdatingBulkCategory(true);
      try {
          const updatedProducts = products
              .filter(p => selectedProducts.has(p.id))
              .map(p => ({
                  ...p,
                  category: bulkSelectedCategory
              }));
          
          await onProductsUpdate(updatedProducts);
          setSelectedProducts(new Set());
          setIsBulkCategoryModalOpen(false);
          setBulkSelectedCategory('');
      } catch (e: any) {
          alert('Erro ao atualizar: ' + (e.message || 'Erro desconhecido'));
      } finally {
          setIsUpdatingBulkCategory(false);
      }
  };

  const confirmBulkPrescription = async (action: 'REQUIRE' | 'REMOVE') => {
      setBulkPrescriptionAction(action);
      setIsUpdatingBulkPrescription(true);
      try {
          const updatedProducts = products
              .filter(p => selectedProducts.has(p.id))
              .map(p => ({
                  ...p,
                  requires_prescription: action === 'REQUIRE'
              }));
          
          await onProductsUpdate(updatedProducts);
          setSelectedProducts(new Set());
          setIsBulkPrescriptionModalOpen(false);
      } catch (e: any) {
          alert('Erro ao atualizar: ' + (e.message || 'Erro desconhecido'));
      } finally {
          setIsUpdatingBulkPrescription(false);
          setBulkPrescriptionAction(null);
      }
  };
  
    const fileInputRef = useRef<HTMLInputElement>(null);
  const importManufacturersRef = useRef<HTMLInputElement>(null);
  const importProductsRef = useRef<HTMLInputElement>(null);
  const labLogoFileRef = useRef<HTMLInputElement>(null);

  const defaultCategories = ['Geral', 'Medicamento', 'Antibiótico', 'Anti-inflamotório', 'Analgésico', 'Antigripal', 'Vitamina', 'Higiene', 'Infantil', 'Dermocosmético', 'Perfumaria', 'Suplemento', 'Ortopedia', 'Curativos', 'Diabetes', 'Hipertensão', 'Saúde Sexual', 'Maquiagem', 'Cabelos', 'Unhas', 'Conveniência'];
  const defaultDrugTypes = ['Livre', 'Outros', 'Referência', 'Genérico', 'Similar', 'Fitoterápico', 'Cosmético', 'Suplemento', 'Homeopático', 'Biológico', 'Manipulado', 'Alimento'];

  const categoryOptions = useMemo(() => {
      const allOfficialSubcats = Object.values(OFFICIAL_TAXONOMY).flat();
      const opts = new Set(allOfficialSubcats);
      products.forEach(p => { if (p.category) opts.add(p.category); });
      if (editingProduct?.category) opts.add(editingProduct.category);
      return Array.from(opts).sort();
  }, [products, editingProduct?.category]);

  const departmentOptions = useMemo(() => {
      return [...OFFICIAL_DEPARTMENTS];
  }, []);

  const filteredCategoryOptions = useMemo(() => {
      if (filterDepartment === 'Todos') return categoryOptions;
      if (filterDepartment === 'Sem Departamento') {
          return [];
      }
      if (OFFICIAL_TAXONOMY[filterDepartment]) {
          return OFFICIAL_TAXONOMY[filterDepartment];
      }
      return categoryOptions.filter(c => getDepartmentForCategory(c, tenant.departments) === filterDepartment);
  }, [filterDepartment, categoryOptions, tenant.departments]);

  const managedManufacturers = useMemo(() => {
     const explicit = tenant.customManufacturers || [];
     const withLogos = Object.keys(tenant.manufacturerLogos || {});
     return Array.from(new Set([...explicit, ...withLogos])).sort();
  }, [tenant]);

  const manufacturerOptions = useMemo(() => {
      const opts = new Set<string>();
      products.forEach(p => { if (p.manufacturer) opts.add(p.manufacturer); });
      if (editingProduct?.manufacturer) opts.add(editingProduct.manufacturer);
      managedManufacturers.forEach(m => opts.add(m));
      return Array.from(opts).sort();
  }, [products, editingProduct?.manufacturer, managedManufacturers]);

  const drugTypeOptions = useMemo(() => {
      const opts = new Set(defaultDrugTypes);
      products.forEach(p => { if (p.drugType) opts.add(p.drugType); });
      if (editingProduct?.drugType) opts.add(editingProduct.drugType);
      return Array.from(opts).sort();
  }, [products, editingProduct?.drugType]);

  const getProductDisplayImage = (p: Partial<Product>) => {
    try {
      const rawImg = p.image;
      if (rawImg) {
        const fixed = fixImageUrl(rawImg);
        if (fixed) return fixed;
      }
      const isGeneric = p.drugType?.trim().toLowerCase() === 'genérico' || p.drugType?.trim().toLowerCase() === 'generico';
      if (isGeneric) {
          const mfgKey = p.manufacturer ? Object.keys(tenant.manufacturerLogos || {}).find(k => k.trim().toLowerCase() === p.manufacturer?.trim().toLowerCase()) : null;
          if (mfgKey && tenant.manufacturerLogos?.[mfgKey]) {
              const fixedMfg = fixImageUrl(tenant.manufacturerLogos[mfgKey]);
              if (fixedMfg) return fixedMfg;
          }
          return GENERIC_PLACEHOLDER;
      }
      return GENERIC_PLACEHOLDER;
    } catch (e) {
      return GENERIC_PLACEHOLDER;
    }
  };

  // Debouncing for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const fuse = useMemo(() => new Fuse(products, {
    keys: ['name'],
    threshold: 0.3,
    ignoreLocation: true,
  }), [products]);

  const filteredProducts = useMemo(() => {
    const term = debouncedSearchTerm.trim();
    
    let baseProducts = products;

    if (term) {
        const isPurelyNumeric = /^\d+$/.test(term);
        
        // Exact match for EAN or Internal Code
        const exactMatches = products.filter(p => 
            p.barcode === term || 
            (p.internalCode && p.internalCode.toLowerCase() === term.toLowerCase())
        );

        if (exactMatches.length > 0) {
            baseProducts = exactMatches;
        } else if (isPurelyNumeric) {
            // If purely numeric and no exact match, fallback to partial match for codes
            baseProducts = products.filter(p => 
                (p.barcode && p.barcode.startsWith(term)) || 
                (p.internalCode && p.internalCode.startsWith(term))
            );
        } else {
            // Fuzzy search on name
            const results = fuse.search(term);
            baseProducts = results.map(r => r.item);
        }
    }

    const filtered = baseProducts.filter(p => {
      let matchesDepartment = true;
      if (filterDepartment !== 'Todos') {
          const prodDept = getDepartmentForCategory(p.category, tenant.departments);
          matchesDepartment = prodDept === filterDepartment;
      }
      
      const matchesCategory = filterCategory === 'Todos' || p.category === filterCategory;
      const matchesManufacturer = filterManufacturer === 'Todos' || p.manufacturer === filterManufacturer;
      
      let matchesPromotion = true;
      if (filterPromotion === 'Com Promoção') {
          matchesPromotion = p.promotionType !== 'NONE' && !!p.promotionType;
      } else if (filterPromotion === 'Sem Promoção') {
          matchesPromotion = p.promotionType === 'NONE' || !p.promotionType;
      } else if (filterPromotion !== 'Todos') {
          matchesPromotion = p.promotionType === filterPromotion;
      }

      let matchesPrescription = true;
      if (filterPrescription === 'Retenção de Receita') matchesPrescription = !!p.requires_prescription;
      else if (filterPrescription === 'Venda Livre') matchesPrescription = !p.requires_prescription;
      
      const matchesZeroStock = filterZeroStock ? p.stock <= 0 : true;
      const matchesFeatured = filterFeatured ? !!p.isFeatured : true;
      const matchesNoImage = filterNoImage ? !p.image : true;
      
      return matchesDepartment && matchesCategory && matchesManufacturer && matchesPromotion && matchesZeroStock && matchesFeatured && matchesNoImage && matchesPrescription;
    });

    const sorted = filtered.sort((a, b) => {
      const aInStock = typeof a.stock === 'number' && a.stock > 0;
      const bInStock = typeof b.stock === 'number' && b.stock > 0;
      
      if (aInStock && !bInStock) return -1;
      if (!aInStock && bInStock) return 1;
      
      return 0;
    });

    const uniqueMap = new Map<string, Product>();
    for (const item of sorted) {
      if (item && item.id && !uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }
    return Array.from(uniqueMap.values());
  }, [products, debouncedSearchTerm, filterDepartment, filterCategory, filterManufacturer, filterPromotion, filterPrescription, filterZeroStock, filterFeatured, filterNoImage, fuse, tenant.departments]);

  // Reset category filter when department changes
  useEffect(() => {
     setFilterCategory('Todos');
  }, [filterDepartment]);

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(filteredProducts.length / itemsPerPage);
  
  const paginatedProducts = useMemo(() => {
    if (itemsPerPage === 'all') return filteredProducts;
    const start = (currentPage - 1) * itemsPerPage;
    return filteredProducts.slice(start, start + itemsPerPage);
  }, [filteredProducts, currentPage, itemsPerPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, filterDepartment, filterCategory, filterManufacturer, filterPromotion, filterPrescription, filterZeroStock, filterFeatured, filterNoImage, itemsPerPage]);

  const physicalSaleResults = useMemo(() => {
    if (!physicalSaleSearch) return [];
    const term = physicalSaleSearch.toLowerCase();
    return products.filter(p => 
        p.name.toLowerCase().includes(term) ||
        p.internalCode.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.includes(term))
    ).slice(0, 5); 
  }, [products, physicalSaleSearch]);

  const handleEditProduct = (product: Product) => {
      setCustomCategoryMode(false);
      setCustomDrugTypeMode(false);
      setCustomManufacturerMode(false);
      setSelectedDeptForEdit(getDepartmentForCategory(product.category, tenant.departments));
      const rawPromo = product.promotionalPrice !== undefined && product.promotionalPrice !== null
        ? product.promotionalPrice
        : ((product as any).promotional_price !== undefined && (product as any).promotional_price !== null ? (product as any).promotional_price : undefined);
      const parsedPromo = rawPromo !== '' && rawPromo !== undefined && rawPromo !== null && !isNaN(Number(rawPromo)) && Number(rawPromo) > 0
        ? Number(rawPromo)
        : undefined;
      setEditingProduct({
        ...product,
        promotionalPrice: parsedPromo,
        promotional_price: parsedPromo !== undefined ? parsedPromo : null
      });
  };

  const runAutomaticMapping = async () => {
    if (!confirm("Isso percorrerá TODOS os produtos e criará departamentos automaticamente baseados em categorias. Deseja continuar?")) return;
    
    const newDepartments: PharmacyConfig['departments'] = [];
    
    products.forEach(p => {
        const deptName = getDepartmentForCategory(p.category, []);
        
        let dept = newDepartments.find(d => d.name === deptName);
        if (!dept) {
            dept = {
                id: Math.random().toString(36).substr(2, 9),
                name: deptName,
                categories: [],
                iconName: 'Package',
                priority: 0
            };
            newDepartments.push(dept);
        }
        if (!dept.categories.includes(p.category)) {
            dept.categories.push(p.category);
        }
    });
    
    await onTenantUpdate({ ...tenant, departments: newDepartments });
    alert("Categorias mapeadas com sucesso!");
  };

  const handleCreateProduct = () => {
      setCustomCategoryMode(false);
      setCustomDrugTypeMode(false);
      setCustomManufacturerMode(false);
      setSelectedDeptForEdit('Outros');
      setEditingProduct({
        id: Math.random().toString(36).substr(2, 9),
        tenantId: tenant.id,
        name: '',
        price: 0,
        originalPrice: 0,
        promotionalPrice: undefined,
        promotional_price: null,
        stock: 0,
        category: 'Geral',
        internalCode: '',
        barcode: '',
        manufacturer: 'Outros',
        description: '',
        activePrinciple: '',
        drugType: 'Outros',
        isFeatured: false,
        promotionType: 'NONE',
        buyX: 0,
        payY: 0
      });
  };

  const handleBarcodeScan = (decodedText: string) => {
      if (navigator.vibrate) navigator.vibrate(200);
      
      const exactMatches = products.filter(p => 
          p.barcode === decodedText || 
          p.internalCode === decodedText
      );

      if (scannerTarget === 'MAIN') {
          setSearchTerm(decodedText);
          if (exactMatches.length === 1) {
              handleEditProduct(exactMatches[0]);
          }
      } else if (scannerTarget === 'PDV') {
          setPhysicalSaleSearch(decodedText);
          if (exactMatches.length === 1) {
              setSelectedPhysicalProduct(exactMatches[0]);
          }
      }
      
      setScannerTarget(null);
  };

  const handleSaveProduct = async () => {
    if (!editingProduct || !editingProduct.name || !editingProduct.price || !editingProduct.barcode || !editingProduct.barcode.trim()) {
        alert("Preencha nome, preço e código de barras.");
        return;
    }
    
    const cleanBarcode = editingProduct.barcode.trim();
    const existing = products.find(p => p.barcode === cleanBarcode && p.id !== editingProduct.id);
    if (existing) {
        alert(`O código de barras ${cleanBarcode} já está em uso pelo produto "${existing.name}".`);
        return;
    }

    setIsSavingProduct(true);
    try {
      let finalImage = editingProduct.image;
      if (finalImage && finalImage.startsWith('data:image/')) {
          try {
              const { uploadBase64Image } = await import('../services/storageMedia');
              const fileName = editingProduct.barcode || editingProduct.internalCode || editingProduct.id || 'product';
              const publicUrl = await uploadBase64Image(finalImage, fileName);
              if (publicUrl) {
                  finalImage = publicUrl;
              }
          } catch (e) {
              console.error("Erro ao fazer upload da imagem", e);
          }
      }

      // Tratamento e conversão de preço promocional
      const rawPromo = editingProduct.promotionalPrice !== undefined && editingProduct.promotionalPrice !== null
        ? editingProduct.promotionalPrice
        : (editingProduct as any).promotional_price;
      const numPromo = rawPromo !== '' && rawPromo !== null && rawPromo !== undefined ? Number(rawPromo) : NaN;
      const validPromoPrice = !isNaN(numPromo) && numPromo > 0 ? numPromo : null;

      const productToSave: Product = {
          id: editingProduct.id || Math.random().toString(36).substr(2, 9),
          tenantId: editingProduct.tenantId || tenant.id,
          name: editingProduct.name.trim(),
          barcode: cleanBarcode,
          internalCode: editingProduct.internalCode?.trim() || Math.random().toString(36).substr(2, 6).toUpperCase(),
          activePrinciple: editingProduct.activePrinciple || '',
          drugType: editingProduct.drugType || '',
          manufacturer: editingProduct.manufacturer || 'Outros',
          presentation: editingProduct.presentation || '',
          image: finalImage || undefined,
          description: editingProduct.description || '',
          indications: editingProduct.indications || '',
          usage: editingProduct.usage || '',
          sideEffects: editingProduct.sideEffects || '',
          contraindications: editingProduct.contraindications || '',
          isAiEnriched: Boolean(editingProduct.isAiEnriched),
          price: Number(editingProduct.price) || 0,
          originalPrice: Number(editingProduct.originalPrice) || 0,
          promotionalPrice: validPromoPrice !== null ? validPromoPrice : undefined,
          promotional_price: validPromoPrice,
          stock: Number(editingProduct.stock) || 0,
          category: editingProduct.category || 'Geral',
          groupingSlug: editingProduct.groupingSlug || '',
          variantAttribute: editingProduct.variantAttribute || '',
          isFeatured: Boolean(editingProduct.isFeatured),
          requires_prescription: Boolean(editingProduct.requires_prescription),
          promotionType: (editingProduct.promotionType as any) || 'NONE',
          buyX: Number(editingProduct.buyX) || 0,
          payY: Number(editingProduct.payY) || 0,
          discountQtyThreshold: Number(editingProduct.discountQtyThreshold) || 0,
          discountQtyPercentage: Number(editingProduct.discountQtyPercentage) || 0,
          videoUri: editingProduct.videoUri || undefined,
      };
      
      if (productToSave.category && selectedDeptForEdit) {
          const currentDeptName = getDepartmentForCategory(productToSave.category, tenant.departments);
          if (currentDeptName !== selectedDeptForEdit) {
              const depts = [...(tenant.departments || [])];
              
              if (currentDeptName) {
                  const oldDeptIdx = depts.findIndex(d => d.name === currentDeptName);
                  if (oldDeptIdx !== -1) {
                      depts[oldDeptIdx] = {
                          ...depts[oldDeptIdx],
                          categories: depts[oldDeptIdx].categories.filter(c => c !== productToSave.category)
                      };
                  }
              }

              if (selectedDeptForEdit) {
                  const newDeptIdx = depts.findIndex(d => d.name === selectedDeptForEdit);
                  if (newDeptIdx !== -1) {
                      if (!depts[newDeptIdx].categories.includes(productToSave.category)) {
                          depts[newDeptIdx] = {
                              ...depts[newDeptIdx],
                              categories: [...depts[newDeptIdx].categories, productToSave.category]
                          };
                      }
                  }
              }
              await onTenantUpdate({...tenant, departments: depts});
          }
      }

      await onProductsUpdate([productToSave]);
      setEditingProduct(null);
    } catch (err: any) {
      console.error("Erro ao salvar produto:", err);
      alert("Erro ao salvar produto: " + (err.message || "Tente novamente"));
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleAiInfo = async () => {
    if (!editingProduct?.name) return alert("Preencha o nome.");
    setIsGeneratingInfo(true);
    try {
        const details = await fetchProductDetails(editingProduct.name);
        if (details.department) {
            setSelectedDeptForEdit(details.department);
        }
        setEditingProduct(prev => ({ ...prev, ...details, isAiEnriched: true }));
    } catch (e: any) { alert(e.message); } finally { setIsGeneratingInfo(false); }
  };

  const handleAiImage = async () => {
    if (!editingProduct?.name) return alert("Preencha o nome.");
    setIsGeneratingImage(true);
    try {
        const image = await generateAiProductImage(editingProduct.name);
        setEditingProduct(prev => ({ ...prev, image }));
    } catch (e: any) { alert(e.message); } finally { setIsGeneratingImage(false); }
  };

  const getFlyerItems = () => products.filter(p => selectedProducts.has(p.id));

  const MAX_FLYER_ITEMS = 12;

  const handleToggleSelect = (productId: string) => {
      const newSet = new Set(selectedProducts);
      if (newSet.has(productId)) {
          newSet.delete(productId);
      } else {
          newSet.add(productId);
      }
      setSelectedProducts(newSet);
  };

  const handleToggleSelectAll = () => {
      // Se houver algum produto selecionado, desmarcamos todos
      if (selectedProducts.size > 0) {
          setSelectedProducts(new Set());
      } else {
          // Seleciona todos os produtos filtrados atualmente, sem limite
          const newSet = new Set<string>();
          for(let i = 0; i < filteredProducts.length; i++) {
              newSet.add(filteredProducts[i].id);
          }
          setSelectedProducts(newSet);
      }
  };

  const handleGenerateFlyer = () => {
      if (selectedProducts.size === 0) return alert("Selecione pelo menos um produto para gerar o encarte.");
      if (selectedProducts.size > MAX_FLYER_ITEMS) {
          if (confirm(`Para gerar o encarte, selecione no máximo ${MAX_FLYER_ITEMS} itens. Atualmente você selecionou ${selectedProducts.size}. Deseja usar os primeiros ${MAX_FLYER_ITEMS} selecionados?`)) {
              // Get the first MAX_FLYER_ITEMS elements
              const first12 = Array.from(selectedProducts).slice(0, MAX_FLYER_ITEMS);
              setSelectedProducts(new Set(first12));
              setIsFlyerModalOpen(true);
              return;
          }
          return;
      }
      setIsFlyerModalOpen(true);
  };

  const handleDownloadPDF = () => {
      const itemsToPrint = getFlyerItems();
      const docWindow = window.open('', '_blank', 'width=1000,height=1200');
      if (!docWindow) return alert("Habilite pop-ups para gerar o encarte.");

      const backgroundColor = tenant.accentColor || '#10b981';
      const primaryColor = tenant.primaryColor || '#059669';

      const html = `
        <html>
        <head>
            <title>Encarte Digital - ${tenant.name}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
                body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: #fff; }
                .page { 
                    width: 794px; 
                    min-height: 1123px; 
                    margin: 0 auto; 
                    background: linear-gradient(180deg, ${backgroundColor} 0%, ${backgroundColor} 100%);
                    position: relative;
                    padding-bottom: 60px;
                    box-sizing: border-box;
                }
                .header { 
                    padding: 25px 30px; 
                    display: flex; 
                    align-items: center; 
                    gap: 20px;
                }
                .logo-box {
                    background: white;
                    border-radius: 18px;
                    padding: 8px;
                    width: 80px;
                    height: 80px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .logo-box img { width: 100%; height: 100%; object-fit: contain; }
                .logo-text { font-size: 32px; font-weight: 900; color: ${primaryColor}; }
                
                .header-content { color: white; }
                .badge-offer {
                    background: #fbbf24;
                    color: #78350f;
                    padding: 4px 12px;
                    border-radius: 50px;
                    font-size: 10px;
                    font-weight: 900;
                    text-transform: uppercase;
                    display: inline-block;
                    margin-bottom: 4px;
                }
                .pharmacy-name { font-size: 32px; font-weight: 900; text-transform: uppercase; line-height: 1; margin-bottom: 4px; text-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .slogan { font-size: 12px; font-weight: 500; opacity: 0.9; text-transform: uppercase; letter-spacing: 1px; }

                .grid { 
                    display: grid; 
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 15px; 
                    padding: 10px 30px;
                }
                .card { 
                    background: white; 
                    border-radius: 20px; 
                    padding: 12px; 
                    text-align: center; 
                    position: relative;
                    padding-top: 30px;
                    margin-top: 10px;
                }
                .card-badge {
                    position: absolute;
                    top: -10px;
                    right: 15px;
                    color: white;
                    font-size: 10px;
                    font-weight: 900;
                    padding: 6px 12px;
                    border-radius: 10px;
                    text-transform: uppercase;
                    box-shadow: 0 3px 5px rgba(0,0,0,0.2);
                    z-index: 10;
                }
                .card-img-container {
                    width: 100%;
                    height: 110px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 8px;
                    overflow: hidden;
                }
                .card-img { 
                    max-width: 100%; 
                    max-height: 100%; 
                    object-fit: contain; 
                }
                .card-cat { 
                    font-size: 9px; 
                    text-transform: uppercase; 
                    color: #94a3af; 
                    font-weight: 900; 
                    letter-spacing: 1px; 
                    margin-bottom: 3px; 
                    display: block;
                }
                .card-title { 
                    font-size: 14px; 
                    font-weight: 900; 
                    color: #1e293b; 
                    margin-bottom: 3px; 
                    line-height: 1.1; 
                    height: 32px; 
                    overflow: hidden; 
                    display: -webkit-box; 
                    -webkit-line-clamp: 2; 
                    -webkit-box-orient: vertical; 
                }
                .price-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }
                .old-price {
                    font-size: 10px;
                    color: #9ca3af;
                    text-decoration: line-through;
                    font-weight: 700;
                    margin-bottom: -2px;
                }
                .price-val { 
                    font-size: 32px; 
                    font-weight: 900; 
                    color: #be123c; 
                    letter-spacing: -1px;
                    line-height: 1;
                }
                
                .footer { 
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: #111827;
                    color: white; 
                    padding: 15px 30px; 
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .footer-col h4 { margin: 0 0 2px 0; font-size: 8px; text-transform: uppercase; color: #9ca3af; font-weight: 900; }
                .footer-col p { margin: 0; font-size: 12px; font-weight: 700; }
                .legal-text { font-size: 7px; color: #6b7280; text-align: right; max-width: 200px; line-height: 1.2; }

                @media print {
                    @page { margin: 0; size: A4; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="page">
                <div class="header">
                    <div class="logo-box">
                        ${tenant.logo ? `<img src="${tenant.logo}" referrerPolicy="no-referrer" />` : `<span class="logo-text">${tenant.name.charAt(0)}</span>`}
                    </div>
                    <div class="header-content">
                        <span class="badge-offer">Ofertas Especiais</span>
                        <div class="pharmacy-name">${tenant.bannerTitle || tenant.name}</div>
                        <div class="slogan">${tenant.bannerSubtitle || 'Aqui você encontra saúde e bem estar!'}</div>
                    </div>
                </div>

                <div class="grid">
                    ${itemsToPrint.map(p => {
                        let img = getProductDisplayImage(p);
                        if (!img) img = GENERIC_PLACEHOLDER;

                        const isKit = p.promotionType === 'BUY_X_PAY_Y';
                        const hasDiscount = p.promotionType === 'DISCOUNT';
                        
                        let badgeHtml = '';
                        if (isKit) {
                            badgeHtml = `<div class="card-badge" style="background: #9333ea;">Leve ${p.buyX} Pague ${p.payY}</div>`;
                        } else if (hasDiscount) {
                            badgeHtml = `<div class="card-badge" style="background: #ef4444;">Oferta</div>`;
                        }

                        return `
                        <div class="card">
                            ${badgeHtml}
                            <div class="card-img-container">
                                <img src="${img}" class="card-img" referrerPolicy="no-referrer" />
                            </div>
                            <span class="card-cat">${p.category}</span>
                            <div class="card-title">${p.name}</div>
                            <div class="price-container">
                                ${hasDiscount && p.originalPrice ? `<div class="old-price">De R$ ${p.originalPrice.toFixed(2).replace('.', ',')}</div>` : ''}
                                <div class="price-val" style="${hasDiscount ? 'color: #dc2626;' : 'color: #be123c;'}">R$ ${p.price.toFixed(2).replace('.', ',')}</div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>

                <div class="footer">
                    <div style="display: flex; gap: 40px;">
                        <div class="footer-col">
                            <h4>Whatsapp / Pedidos</h4>
                            <p>${tenant.whatsapp}</p>
                        </div>
                        <div class="footer-col">
                            <h4>Endereço</h4>
                            <p>${tenant.fullAddress || 'Endereço não informado'}</p>
                        </div>
                    </div>
                    <div class="legal-text">
                        Ofertas válidas enquanto durarem os estoques. Imagens meramente ilustrativas. Consulte condições.
                    </div>
                </div>
            </div>
            <script>window.print();</script>
        </body>
        </html>
      `;

      docWindow.document.write(html);
      docWindow.document.close();
  };

  const handleDownloadJPG = async () => {
      if (!flyerRef.current) return;
      
      setIsGeneratingJPG(true);
      try {
          // 1. Garantir que todas as imagens estão carregadas, convertendo para Base64
          // Isso elimina espaços vazios por falhas de CORS no html2canvas/domToJpeg
          const images = flyerRef.current.querySelectorAll('img');
          const imagePromises = Array.from(images).map(async (img) => {
              if (img.src.startsWith('data:')) return;
              
              const originalSrc = img.src;
              try {
                  const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(originalSrc)}`;
                  const response = await fetch(proxyUrl);
                  if (!response.ok) throw new Error("Status " + response.status);
                  const blob = await response.blob();
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onloadend = () => resolve(reader.result as string);
                      reader.onerror = reject;
                      reader.readAsDataURL(blob);
                  });
                  img.removeAttribute('crossorigin');
                  img.src = dataUrl;
              } catch (e: any) {
                  console.warn(`CORS falhou para ${originalSrc}. Tentando carregar via DOM direto...`);
                  // Registra log para acompanhamento
                  console.error("Erro no fetch de imagem do encarte:", e.message, "URL:", originalSrc);
                  
                  // Se o fetch falha (CORS agressivo do domínio de origem), tenta injetar apenas removendo o crossorigin
                  // para não travar a tentativa local do domToJpeg
                  img.removeAttribute('crossorigin');
              }
              
              // Se base64 ou fallback normal não disparar load natural, contornar:
              return new Promise<void>((resolve) => {
                  if (img.complete) {
                      if (img.naturalWidth === 0 && !img.src.startsWith('data:')) {
                           // Imagem genuinamente quebrou, previne ficar vazia:
                           img.src = GENERIC_PLACEHOLDER;
                           img.onload = () => resolve();
                           img.onerror = () => resolve();
                      } else {
                          resolve();
                      }
                  } else {
                      img.onload = () => resolve();
                      img.onerror = () => {
                          img.src = GENERIC_PLACEHOLDER;
                          img.onload = () => resolve();
                          img.onerror = () => resolve();
                      };
                  }
              });
          });
          
          await Promise.all(imagePromises);
          
          // 2. Pequeno delay para garantir renderização final (após troca de srcs e carregamentos do DOM)
          await new Promise(resolve => setTimeout(resolve, 600));

          const dataUrl = await domToJpeg(flyerRef.current, { 
              quality: 0.95,
              scale: 2,
              backgroundColor: 'white',
          });
          
          if (!dataUrl) {
              throw new Error("Falha ao processar o elemento visual. Tente novamente.");
          }

          const link = document.createElement('a');
          link.download = `Encarte-${tenant.name}-${new Date().getTime()}.jpg`;
          link.href = dataUrl;
          link.click();
      } catch (e: any) {
          console.error("Erro detalhado na geração da imagem:", e);
          alert("Erro ao gerar imagem. Tente a opção PDF ou verifique sua conexão. (Erro: " + (e?.message || "Erro desconhecido") + ")");
      } finally {
          setIsGeneratingJPG(false);
      }
  };

  const handleExportAllProducts = () => {
      if (!products || products.length === 0) {
          alert("Não há produtos cadastrados para exportar.");
          return;
      }

      const dataToExport = products.map(p => ({
          'Código Interno': p.internalCode || '',
          'EAN': p.barcode || '',
          'Nome do Produto': p.name,
          'Fabricante': p.manufacturer || '',
          'Categoria': p.category || 'Geral',
          'Preço de Venda': p.price,
          'Preço Original / PMC': p.originalPrice || 0,
          'Preço Promocional': p.promotionalPrice || 0,
          'PRECO_PROMOCIONAL': p.promotionalPrice || 0,
          'PROMOTIONAL_PRICE': p.promotionalPrice || 0,
          'Estoque': p.stock,
          'Princípio Ativo': p.activePrinciple || '',
          'Tipo Legal': p.drugType || '',
          'Apresentação': p.presentation || '',
          'Retenção de Receita': p.requires_prescription ? 'SIM' : 'NÃO',
          'Tipo Promoção': p.promotionType || 'NONE',
          'Destaque': p.isFeatured ? 'SIM' : 'NÃO'
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Produtos");
      
      XLSX.writeFile(workbook, `Catalogo_Produtos_${tenant.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportZeroStock = () => {
      const zeroStockProducts = products.filter(p => p.stock <= 0);
      if (zeroStockProducts.length === 0) {
          alert("Não há produtos com estoque zerado para exportar.");
          return;
      }

      const dataToExport = zeroStockProducts.map(p => ({
          'Código Interno': p.internalCode || '',
          'EAN': p.barcode || '',
          'Nome do Produto': p.name,
          'Fabricante': p.manufacturer || '',
          'Categoria': p.category || '',
          'Preço Atual': p.price,
          'Estoque': p.stock
      }));

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Faltas");
      
      XLSX.writeFile(workbook, `Lista_de_Faltas_${tenant.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleSaveManufacturer = async () => {
    if (!newLabLogo.name) return alert("Digite o nome do fabricante.");
    
    const currentLogos = { ...(tenant.manufacturerLogos || {}) };
    const currentCustom = new Set(tenant.customManufacturers || []);

    if (newLabLogo.originalName && newLabLogo.originalName !== newLabLogo.name) {
        // Renaming: remove old name
        delete currentLogos[newLabLogo.originalName];
        currentCustom.delete(newLabLogo.originalName);
        
        // Update all products that have the old manufacturer name
        const productsToUpdate = products.filter(p => p.manufacturer === newLabLogo.originalName);
        if (productsToUpdate.length > 0) {
            const updatedProducts = productsToUpdate.map(p => ({ ...p, manufacturer: newLabLogo.name }));
            await onProductsUpdate(updatedProducts);
        }
    }

    if (newLabLogo.logo) {
        currentLogos[newLabLogo.name] = newLabLogo.logo;
    } else {
        // If logo is cleared, remove it
        delete currentLogos[newLabLogo.name];
    }
    
    currentCustom.add(newLabLogo.name);

    await onTenantUpdate({
        ...tenant,
        customManufacturers: Array.from(currentCustom),
        manufacturerLogos: currentLogos
    });
    setNewLabLogo({ name: '', logo: '' });
  };

  const handleDeleteManufacturer = async (name: string) => {
    if (!confirm(`Remover fabricante "${name}"?`)) return;
    
    const currentLogos = { ...(tenant.manufacturerLogos || {}) };
    delete currentLogos[name];
    
    const currentCustom = (tenant.customManufacturers || []).filter(m => m !== name);
    
    await onTenantUpdate({
        ...tenant,
        customManufacturers: currentCustom,
        manufacturerLogos: currentLogos
    });
  };

  const handleMergeManufacturers = async () => {
      if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) return;
      
      if (!confirm(`Tem certeza que deseja mesclar "${mergeSource}" em "${mergeTarget}"? Todos os produtos serão atualizados e uma regra de sinônimo será criada.`)) return;
      
      // 1. Update products
      const productsToUpdate = products.filter(p => p.manufacturer === mergeSource);
      if (productsToUpdate.length > 0) {
          const updatedProducts = productsToUpdate.map(p => ({ ...p, manufacturer: mergeTarget }));
          await onProductsUpdate(updatedProducts);
      }
      
      // 2. Add synonym
      const normalizedSource = normalizeManufacturerName(mergeSource);
      const currentSynonyms = tenant.manufacturerSynonyms || {};
      
      await onTenantUpdate({
          ...tenant,
          manufacturerSynonyms: {
              ...currentSynonyms,
              [normalizedSource]: mergeTarget
          }
      });
      
      setMergeSource('');
      setMergeTarget('');
      alert(`Mesclagem concluída! ${productsToUpdate.length} produtos atualizados.`);
  };

  const extractManufacturerRow = (row: any): { name: string; logo?: string } | null => {
      if (!row) return null;
      
      // Se a linha for uma string simples ou número (ex: lista colada de nomes)
      if (typeof row === 'string' || typeof row === 'number') {
          const clean = String(row).trim();
          if (clean && clean.length > 1 && !clean.startsWith('http')) {
              return { name: clean };
          }
          return null;
      }

      // Se for um array de colunas
      if (Array.isArray(row)) {
          const validCells = row.map(c => c !== null && c !== undefined ? String(c).trim() : '').filter(Boolean);
          if (validCells.length === 0) return null;
          
          let foundLogo: string | undefined;
          let foundName: string | undefined;
          for (const cell of validCells) {
              if (/^https?:\/\/|^data:image\//i.test(cell) || /\.(png|jpe?g|webp|svg|gif)$/i.test(cell)) {
                  if (!foundLogo) foundLogo = cell;
              } else if (!foundName && cell.length > 0) {
                  foundName = cell;
              }
          }
          if (foundName) return { name: foundName, logo: foundLogo };
          return null;
      }

      if (typeof row !== 'object') return null;

      const keys = Object.keys(row);
      if (keys.length === 0) return null;

      const normalizeKey = (k: string) => k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

      const nameKeysPriority = [
          'fabricante', 'laboratorio', 'lab', 'marca', 'nome', 'name', 
          'fornecedor', 'empresa', 'razaosocial', 'razao', 'descricao', 'desc', 
          'nomedofabricante', 'nomedolaboratorio', 'nomelaboratorio', 'nomefabricante', 
          'brand', 'producer', 'manufacturer', 'title', 'fabricantes', 'laboratorios', 'marcas'
      ];

      const logoKeysPriority = [
          'logo', 'logotipo', 'imagem', 'image', 'img', 'foto', 'picture', 'url', 'urllogo', 'link', 'icone', 'icon', 'src', 'avatar'
      ];

      let rawName: any = undefined;
      let rawLogo: any = undefined;

      // 1. Procurar chaves prioritárias para o Nome
      for (const pKey of nameKeysPriority) {
          const matchedKey = keys.find(k => {
              const norm = normalizeKey(k);
              return norm === pKey || norm.startsWith(pKey) || norm.includes(pKey);
          });
          if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== '') {
              rawName = row[matchedKey];
              break;
          }
      }

      // 2. Procurar chaves prioritárias para a Logo / Imagem
      for (const pKey of logoKeysPriority) {
          const matchedKey = keys.find(k => {
              const norm = normalizeKey(k);
              return norm === pKey || norm.startsWith(pKey) || norm.includes(pKey);
          });
          if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== '') {
              rawLogo = row[matchedKey];
              break;
          }
      }

      // 3. Fallback inteligente: inspecionar os valores presentes nas colunas
      if (!rawName) {
          for (const k of keys) {
              const val = row[k];
              if (val !== undefined && val !== null) {
                  const strVal = String(val).trim();
                  if (/^https?:\/\/|^data:image\//i.test(strVal) || /\.(png|jpe?g|webp|svg|gif)$/i.test(strVal)) {
                      if (!rawLogo) rawLogo = strVal;
                  } else if (!rawName && strVal.length > 0 && isNaN(Number(strVal))) {
                      rawName = strVal;
                  }
              }
          }
      }

      // 4. Se a primeira coluna veio como chave (ex: tabela sem cabeçalho onde o cabeçalho virou o primeiro valor)
      if (!rawName && keys.length > 0) {
          const firstKey = keys[0];
          const firstVal = row[firstKey];
          if (firstKey && !['id', '_id', '__v'].includes(firstKey.toLowerCase())) {
              if (typeof firstVal === 'string' && (/^https?:\/\//i.test(firstVal) || /\.(png|jpe?g|webp|svg|gif)$/i.test(firstVal))) {
                  rawName = firstKey;
                  rawLogo = firstVal;
              }
          }
      }

      if (rawName) {
          const cleanName = String(rawName).trim();
          const normClean = normalizeKey(cleanName);
          // Ignorar se o valor for apenas a palavra do cabeçalho
          if (normClean === 'fabricante' || normClean === 'laboratorio' || normClean === 'marca' || normClean === 'nomedofabricante' || normClean === 'nome') {
              return null;
          }
          if (cleanName) {
              return {
                  name: cleanName,
                  logo: rawLogo ? String(rawLogo).trim() : undefined
              };
          }
      }

      return null;
  };

  const executeManufacturerImport = async (json: any[]) => {
      const newLogos = { ...(tenant.manufacturerLogos || {}) };
      const newCustom = new Set(tenant.customManufacturers || []);

      let count = 0;
      for (const row of json) {
          const extracted = extractManufacturerRow(row);
          if (extracted && extracted.name) {
              newCustom.add(extracted.name);
              if (extracted.logo) {
                  newLogos[extracted.name] = extracted.logo;
              }
              count++;
          }
      }

      if (count > 0) {
          await onTenantUpdate({
              ...tenant,
              customManufacturers: Array.from(newCustom),
              manufacturerLogos: newLogos
          });
          alert(`${count} fabricantes importados com sucesso!`);
      } else {
          alert("Nenhum fabricante encontrado nos dados. Verifique se o arquivo ou texto contém nomes de fabricantes.");
      }
  };

  const processManufacturerImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
        const json = await readSpreadsheetToJSON(file);
        await executeManufacturerImport(json);
    } catch (err: any) {
        console.error(err);
        alert("Erro ao processar arquivo: " + err.message);
    } finally {
        if (importManufacturersRef.current) importManufacturersRef.current.value = '';
    }
  };

  const importPastedManufacturers = async () => {
    const rawText = pastedManufacturersText.trim();
    if (!rawText) {
        alert("Cole os dados dos fabricantes antes de continuar.");
        return;
    }

    let json = parsePastedData(rawText);
    let extractedCount = json.map(extractManufacturerRow).filter(Boolean).length;

    // Se o parse padrão de tabela não encontrou nada (ex: lista simples de nomes linha por linha), faz o parse por linha
    if (extractedCount === 0) {
        const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        json = lines.map(line => {
            if (line.includes('\t')) {
                return line.split('\t').map(p => p.trim());
            } else if (line.includes(';')) {
                return line.split(';').map(p => p.trim());
            } else if (line.includes(',')) {
                return line.split(',').map(p => p.trim());
            }
            return line;
        });
    }

    try {
        await executeManufacturerImport(json);
        setPastedManufacturersText('');
    } catch (err: any) {
        console.error(err);
        alert("Erro ao processar dados colados: " + err.message);
    }
  };

  const handleConfirmPhysicalSale = async () => {
      if (!selectedPhysicalProduct) return;
      const newStock = selectedPhysicalProduct.stock - physicalSaleQty;
      if (newStock < 0) {
          if(!confirm(`Atenção: O estoque ficará negativo (${newStock}). Deseja continuar?`)) return;
      }
      await onProductsUpdate([{ ...selectedPhysicalProduct, stock: newStock }]);
      setPhysicalSaleQty(1);
      setPhysicalSaleSearch('');
      setSelectedPhysicalProduct(null);
  };

  const handleRestoreImages = async () => {
      if (!imageSnapshot) return;
      if (!confirm("Tem certeza que deseja restaurar as imagens para o estado anterior à última importação? Isso pode levar alguns segundos.")) return;

      setIsImporting(true);
      setImportProgress(0);
      try {
          let count = 0;
          let totalToRestore = 0;

          // Count how many need restoring
          for (const p of products) {
              if (imageSnapshot[p.id] !== undefined && imageSnapshot[p.id] !== p.image) {
                  totalToRestore++;
              }
          }

          if (totalToRestore === 0) {
              alert("Nenhuma imagem precisa ser restaurada.");
              setIsImporting(false);
              return;
          }

          const productsToUpdate: Product[] = [];

          for (const p of products) {
              const oldImage = imageSnapshot[p.id];
              if (oldImage !== undefined && oldImage !== p.image) {
                  productsToUpdate.push({ ...p, image: oldImage });
                  count++;
              }
          }

          if (productsToUpdate.length > 0) {
              await onProductsUpdate(productsToUpdate);
          }

          setImportProgress(100);
          alert(`${count} imagens restauradas com sucesso!`);
      } catch (error) {
          console.error("Erro ao restaurar imagens:", error);
          alert("Erro ao restaurar imagens.");
      } finally {
          setIsImporting(false);
      }
  };

  useEffect(() => {
    if (isCentralPriceModalOpen && tenant?.isNetworkMaster) {
        getTenants().then(t => setCentralPriceBranches(t.filter(br => br.networkId === tenant.id && br.id !== tenant.id)));
    }
  }, [isCentralPriceModalOpen, tenant]);

  useEffect(() => {
    if (isBulkFeaturedModalOpen && tenant?.isNetworkMaster) {
        getTenants().then(t => setBulkFeaturedBranches(t.filter(br => br.networkId === tenant.id && br.id !== tenant.id)));
    }
  }, [isBulkFeaturedModalOpen, tenant]);

  const executeCentralPriceImport = async (rawData: any[]) => {
        const priceMap = new Map<string, number>();

        const getValFromRow = (row: any, keys: string[]) => {
            const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const normalizedKeys = keys.map(k => normalize(k));
            
            for (const key of Object.keys(row)) {
                if (normalizedKeys.includes(normalize(key))) {
                    return row[key];
                }
            }
            return undefined;
        };

        rawData.forEach(row => {
            const getVal = (keys: string[]) => getValFromRow(row, keys);

            const rawEan = getVal(['ean', 'ean_barras', 'barcode', 'codigo_de_barras', 'codigo barras', 'cod barras', 'EAN', 'Barras', 'CodigoBarras', 'EAN_BARRAS']);
            const priceRaw = getVal(['valor', 'preco', 'preco_venda', 'preco venda', 'valor_venda', 'novo_preco', 'Preco', 'Valor', 'Preço', 'Venda', 'PRECO_VENDA']);

            let ean = rawEan !== undefined && rawEan !== null ? String(rawEan).trim() : '';
            if (ean.toLowerCase().includes('e')) {
                const parsed = Number(ean);
                if (!isNaN(parsed)) {
                    ean = parsed.toLocaleString('fullwide', { useGrouping: false });
                }
            }
            if (ean.includes('.')) {
                ean = ean.split('.')[0];
            }
            console.log("[FarmaFlow Debug] EAN Processado da Planilha:", ean);
            
            // Tratamento de Strings Vazias na Leitura:
            if (!ean || ean.trim() === '') {
                return; // Descarta/filtra essa linha específica
            }

            if (priceRaw !== undefined && priceRaw !== null) {
                const parsedPrice = parseNumberSafe(priceRaw);
                if (parsedPrice > 0) {
                    priceMap.set(ean, parsedPrice);
                }
            }
        });

        if (priceMap.size === 0) {
            alert("Nenhum preço/EAN válido encontrado na planilha.");
            setIsProcessingCentralPrice(false);
            if (centralPriceInputRef.current) centralPriceInputRef.current.value = '';
            return;
        }

        const targetBranches = centralPriceScope === 'ALL' ? centralPriceBranches : centralPriceBranches.filter(b => selectedCentralBranches.has(b.id));
        
        let totalBranches = targetBranches.length;
        let processedBranches = 0;
        const newLogs: AuditItem[] = [];
        const historyArr = JSON.parse(localStorage.getItem('ff_import_history') || '[]');

        for (const branch of targetBranches) {
            try {
                // CORREÇÃO CRÍTICA: Força o re-fetch direto do banco de dados (bypassando o IndexedDB/CDN)
                // para que a comparação de preços centralizados use os preços reais mais recentes de cada filial.
                const branchProducts = await getProductsByTenant(branch.id, undefined, true);
                let updatedCount = 0;
                let branchLogItems: AuditItem[] = [];

                const productsToUpdate: Product[] = [];
                const updatedProducts = branchProducts.map(p => {
                    const dbBarcode = p.barcode ? String(p.barcode).trim() : '';
                    if (dbBarcode && priceMap.has(dbBarcode)) {
                        const newPrice = priceMap.get(dbBarcode)!;
                        if (p.price !== newPrice) {
                            branchLogItems.push({
                                name: p.name,
                                code: p.barcode,
                                status: 'updated',
                                details: `EAN: ${p.barcode} | Filial: ${branch.name} | De: R$ ${p.price.toFixed(2)} Para: R$ ${newPrice.toFixed(2)}`
                            });
                            updatedCount++;
                            const updated = { ...p, price: newPrice };
                            productsToUpdate.push(updated);
                            return updated;
                        }
                    }
                    return p;
                });

                if (updatedCount > 0) {
                    // Update the product price directly based on its unique ID to avoid ON CONFLICT constraint errors
                    for (const prod of productsToUpdate) {
                        if (prod.id) {
                            const { error } = await supabase
                                .from('products')
                                .update({ price: prod.price })
                                .eq('id', prod.id);
                                
                            if (error) {
                                console.error(`[FarmaFlow Debug] Erro ao atualizar EAN ${prod.barcode} (ID: ${prod.id}) na filial ${branch.name}:`, error);
                            }
                        }
                    }
                    
                    newLogs.push(...branchLogItems);

                    const sessionLog = {
                        id: `central_price_${Date.now()}_${branch.id}`,
                        tenantId: tenant.id,
                        timestamp: Date.now(),
                        items: branchLogItems
                    };

                    historyArr.push(sessionLog);

                    // Salva de forma persistente no Supabase
                    try {
                        await supabase
                            .from('integration_logs')
                            .insert({
                                tenant_id: tenant.id,
                                endpoint: 'spreadsheet_import',
                                payload: sessionLog,
                                status: 'SUCCESS'
                            });
                    } catch (logErr) {
                        console.error("Erro ao salvar log de importação centralizada no Supabase:", logErr);
                    }
                }
            } catch (err) {
                console.error(`Erro ao atualizar filial ${branch.name}:`, err);
            }

            processedBranches++;
            setCentralPriceProgress(Math.round((processedBranches / totalBranches) * 100));
            await new Promise(r => setTimeout(r, 100)); 
        }

        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const validHistory = historyArr.filter((s: any) => (now - s.timestamp) < oneDay);
        
        try {
            localStorage.setItem('ff_import_history', JSON.stringify(validHistory));
        } catch(e) {
            console.warn("Could not save to localStorage, trying to trim", e);
            localStorage.setItem('ff_import_history', JSON.stringify([historyArr[historyArr.length-1]]));
        }

        setCentralPriceLogs(newLogs);
        
        if (newLogs.length > 0) {
            alert(`Upload concluído! ${newLogs.length} preços atualizados em ${targetBranches.length} filiais.`);
        } else {
            alert("Nenhum preço foi alterado (os EANs não foram encontrados ou os preços já eram iguais).");
        }

  };

  const processCentralPriceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (centralPriceScope === 'SELECT' && selectedCentralBranches.size === 0) {
        alert("Selecione pelo menos uma filial.");
        if (centralPriceInputRef.current) centralPriceInputRef.current.value = '';
        return;
    }

    setIsProcessingCentralPrice(true);
    setCentralPriceProgress(0);
    setCentralPriceLogs([]);

    try {
        const rawData = await readSpreadsheetToJSON(file);
        await executeCentralPriceImport(rawData);
    } catch (err: any) {
        console.error(err);
        alert(`Erro ao processar planilha: ${err.message}`);
    } finally {
        setIsProcessingCentralPrice(false);
        if (centralPriceInputRef.current) centralPriceInputRef.current.value = '';
    }
  };

  const importPastedCentralPrices = async () => {
    if (centralPriceScope === 'SELECT' && selectedCentralBranches.size === 0) {
        alert("Selecione pelo menos uma filial.");
        return;
    }

    if (!pastedCentralPricesText.trim()) {
        alert("Cole os dados dos preços antes de continuar.");
        return;
    }
    const json = parsePastedData(pastedCentralPricesText);
    if (json.length === 0) {
        alert("Nenhum dado válido encontrado. Verifique se copiou os dados da tabela com os cabeçalhos corretamente.");
        return;
    }

    setIsProcessingCentralPrice(true);
    setCentralPriceProgress(0);
    setCentralPriceLogs([]);

    try {
        await executeCentralPriceImport(json);
        setPastedCentralPricesText('');
    } catch (err: any) {
        console.error(err);
        alert(`Erro ao processar preços colados: ${err.message}`);
    } finally {
        setIsProcessingCentralPrice(false);
    }
  };

  const executeProductImport = async (json: any[]) => {
        console.log("[FarmaFlow Debug] executeProductImport start. Total items:", json.length);
        if (json.length > 0) {
            console.log("[FarmaFlow Debug] First item in json:", JSON.stringify(json[0]));
            const getVal = (keys: string[]) => {
                const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
                const normalizedKeys = keys.map(k => normalize(k));
                for (const key of Object.keys(json[0])) {
                    if (normalizedKeys.includes(normalize(key))) {
                        return json[0][key];
                    }
                }
                return undefined;
            };
            console.log("[FarmaFlow Debug] Extracted name for first item:", getVal(['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto']));
            console.log("[FarmaFlow Debug] Extracted code for first item:", getVal(['Código', 'Codigo', 'Cod', 'REF', 'ID', 'Código Interno', 'Codigo Interno', 'COD_INTERNO', 'referencia', 'ref.']));
            console.log("[FarmaFlow Debug] Extracted ean for first item:", getVal(['ean', 'ean_barras', 'barcode', 'codigo_de_barras', 'codigo barras', 'cod barras', 'EAN', 'Barras', 'CodigoBarras', 'EAN_BARRAS']));
        }

        const total = json.length;
        const firstRow = json[0] || {};
        const headers = Object.keys(firstRow);
        const hasImageColumn = headers.some(header => {
            const norm = header.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
            return ['imagem', 'image', 'foto', 'urlimagem', 'imagemurl', 'imagemprincipal'].includes(norm);
        });

        const hasColumn = (keys: string[]) => {
            const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const normalizedKeys = keys.map(k => normalize(k));
            return headers.some(h => normalizedKeys.includes(normalize(h)));
        };

        const hasStockCol = hasColumn(['Estoque', 'Qtd', 'Quantidade', 'ESTOQUE_ATUAL', 'estoque']);
        const hasPriceCol = hasColumn(['valor', 'preco', 'preco_venda', 'preco venda', 'valor_venda', 'novo_preco', 'Preco', 'Valor', 'Preço', 'Venda', 'PRECO_VENDA']);
        const hasOriginalPriceCol = hasColumn(['PrecoOriginal', 'PreçoOriginal', 'De', 'Original', 'PrecoDe', 'PRECO_ORIGINAL', 'Preço original', 'Preco original', 'preco_original', 'pmc', 'PMC', 'preco_pmc', 'PRECO_PMC']);
        const hasPromotionalPriceCol = hasColumn(['PrecoPromocional', 'PreçoPromocional', 'Promocional', 'PrecoPromo', 'PRECO_PROMOCIONAL', 'PROMOTIONAL_PRICE', 'promotional_price', 'promotionalPrice', 'Preço promocional', 'Preco promocional', 'preco_promocional', 'valor_promocional', 'Por', 'PrecoPor', 'PRECO_POR']);
        const hasDescCol = hasColumn(['Descricao', 'Descrição', 'Detalhes', 'Info', 'DESCRICAO_COMERCIAL', 'DescricaoDetalhada', 'Obs']);
        const hasLabCol = hasColumn(['Laboratorio', 'Fabricante', 'Marca', 'FABRICANTE_LAB', 'fabricantes']);
        const hasActivePrincipleCol = hasColumn(['Principio Ativo', 'PrincipioAtivo', 'Princípio Ativo', 'Substancia', 'Formula', 'PRINCIPIO_ATIVO']);
        const hasLegalTypeCol = hasColumn(['Tipo Legal', 'TipoLegal', 'Tipo', 'CategoriaLegal', 'Medicamento', 'TIPO_MEDICAMENTO', 'tipo medicamento']);
        const hasDeptCol = hasColumn(['Departamento', 'DEPARTAMENTO', 'Secao']);
        const hasSubcatCol = hasColumn(['SUBCATEGORIA', 'Subcategoria', 'Categoria', 'CATEGORIA_CLASSE', 'categoria']);
        const hasEanCol = hasColumn(['ean', 'ean_barras', 'barcode', 'codigo_de_barras', 'codigo barras', 'cod barras', 'EAN', 'Barras', 'CodigoBarras', 'EAN_BARRAS']);
        const hasNameCol = hasColumn(['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto']);
        const hasCodeCol = hasColumn(['Código', 'Codigo', 'Cod', 'REF', 'ID', 'Código Interno', 'Codigo Interno', 'COD_INTERNO', 'referencia', 'ref.']);
        const hasPrescriptionCol = hasColumn(['Receita', 'RetencaoReceita', 'Controlado', 'TarjaPreta', 'RequiresPrescription', 'EXIGE_RECEITA']);
        const hasPromoTypeCol = hasColumn(['TipoPromocao', 'Promocao', 'Promo', 'TipoOferta', 'TIPO_PROMOCAO']);
        const hasBuyXCol = hasColumn(['Leve', 'BuyX', 'QtdLeve', 'PROMO_LEVE']);
        const hasPayYCol = hasColumn(['Pague', 'PayY', 'QtdPague', 'PROMO_PAGUE']);


        const audit: AuditItem[] = [];
        const newProducts: Product[] = [];
        const updatedProducts: Product[] = [];
        const importedProducts: Product[] = [];
        
        const productsByEan = new Map<string, Product>();
        const productsByCode = new Map<string, Product>();
        
        products.forEach(p => {
            if (p.barcode && String(p.barcode).trim() !== '') {
                productsByEan.set(String(p.barcode).trim(), p);
            }
            if (p.internalCode && String(p.internalCode).trim() !== '') {
                productsByCode.set(String(p.internalCode).trim().toLowerCase(), p);
            }
        });

        const newProductsByEan = new Map<string, Product>();
        const newProductsByCode = new Map<string, Product>();

        let countUpdated = 0;
        let countCreated = 0;
        let countNoChange = 0;
        let countPromotional = 0;
        let countEmptyRows = 0;
        let countDuplicatesMerged = 0;
        const ignoredDetails: { linha: number; motivo: string; item: string; codigo: string; ean: string }[] = [];

        let trackedDepartments = tenant.departments ? JSON.parse(JSON.stringify(tenant.departments)) : [];
        let departmentsChanged = false;

        const getValFromRow = (row: any, keys: string[]) => {
            const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const normalizedKeys = keys.map(k => normalize(k));
            
            for (const key of Object.keys(row)) {
                if (normalizedKeys.includes(normalize(key))) {
                    return row[key];
                }
            }
            return undefined;
        };

        // Passo 1: Construir/Mapear Departamentos e Subcategorias (Lookup Table em Memória)
        // Mapeamento_Departamentos[ID_Antigo] = ID_Novo_Criado
        const deptIdMap = new Map<string, string>();
        const deptNameMap = new Map<string, string>();
        const subcatIdMap = new Map<string, string>(); // [SUBCATEGORIA_ID] = Nome Subcat Local Resultante
        
        for (const row of json) {
            try {
                const rowDept = getValFromRow(row, ['Departamento', 'DEPARTAMENTO', 'Secao']);
                const rowDeptId = getValFromRow(row, ['DEPARTAMENTO_ID']);
                const providedSubcat = getValFromRow(row, ['SUBCATEGORIA', 'Subcategoria', 'Categoria', 'CATEGORIA_CLASSE', 'categoria']);
                const providedSubcatId = getValFromRow(row, ['SUBCATEGORIA_ID']);

                if (rowDept && String(rowDept).trim() !== '') {
                    const normDept = String(rowDept).trim();
                    
                    // Sanitização Estrita de Strings para Departamentos
                    const lowerNormDept = normDept.toLowerCase();

                    let exactDept = trackedDepartments.find((d: any) => d.name.toLowerCase() === lowerNormDept);
                    if (!exactDept) {
                        exactDept = {
                            id: Math.random().toString(36).substr(2, 9),
                            name: normDept,
                            iconName: lowerNormDept === 'outros' ? 'Layers' : 'Package',
                            priority: trackedDepartments.length,
                            categories: []
                        };
                        trackedDepartments.push(exactDept);
                        departmentsChanged = true;
                    }

                    if (rowDeptId) {
                        deptIdMap.set(String(rowDeptId), exactDept.id);
                    }
                    deptNameMap.set(lowerNormDept, exactDept.id);

                    if (providedSubcat && String(providedSubcat).trim() !== '') {
                        const normSubcat = String(providedSubcat).trim();
                        const lowerNormSubcat = normSubcat.toLowerCase();
                        const existingSub = exactDept.categories.find((c: string) => c.trim().toLowerCase() === lowerNormSubcat);
                        
                        if (!existingSub) {
                            exactDept.categories.push(normSubcat);
                            departmentsChanged = true;
                            if (providedSubcatId) subcatIdMap.set(String(providedSubcatId), normSubcat);
                        } else {
                            if (providedSubcatId) subcatIdMap.set(String(providedSubcatId), existingSub);
                        }
                    }
                }
            } catch (e) {
                console.warn("Aviso ao mapear departamento/subcategoria da linha. Pulando...", e);
            }
        }

        // Passo 2: Subcategorias e Produtos
        for (let i = 0; i < total; i++) {
            const row = json[i];
            setImportProgress(Math.round(((i + 1) / total) * 100));
            
            // Yield to event loop every 50 items to prevent UI freezing
            if (i % 50 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            const getVal = (keys: string[]) => getValFromRow(row, keys);

            const name = getVal(['Nome', 'Produto', 'Descricao', 'NOME_PRODUTO', 'Nome produto']);
            if (!name || String(name).trim() === '') {
                countEmptyRows++;
                ignoredDetails.push({
                    linha: i + 2,
                    motivo: 'Linha vazia ou sem nome de produto',
                    item: 'N/A',
                    codigo: 'N/A',
                    ean: 'N/A'
                });
                continue;
            }

            const rawCode = getVal(['Código', 'Codigo', 'Cod', 'REF', 'ID', 'Código Interno', 'Codigo Interno', 'COD_INTERNO', 'referencia', 'ref.']);
            const rawEan = getVal(['ean', 'ean_barras', 'barcode', 'codigo_de_barras', 'codigo barras', 'cod barras', 'EAN', 'Barras', 'CodigoBarras', 'EAN_BARRAS']);
            
            const code = rawCode !== undefined && rawCode !== null ? String(rawCode).trim() : undefined;
            let ean = rawEan !== undefined && rawEan !== null ? String(rawEan).trim() : '';
            if (ean.toLowerCase().includes('e')) {
                const parsed = Number(ean);
                if (!isNaN(parsed)) {
                    ean = parsed.toLocaleString('fullwide', { useGrouping: false });
                }
            }
            if (ean.includes('.')) {
                ean = ean.split('.')[0];
            }

            const cleanEan = String(ean).trim();
            const cleanCode = code ? String(code).trim() : '';
            let existingProduct: Product | undefined = undefined;
            let isNewProductUpdate = false;
            
            // Cruzamento inteligente: prioritário por EAN, com fallback abrangente por Código Interno
            if (cleanEan) {
                existingProduct = productsByEan.get(cleanEan);
                if (!existingProduct) {
                    existingProduct = newProductsByEan.get(cleanEan);
                    if (existingProduct) {
                        isNewProductUpdate = true;
                        countDuplicatesMerged++;
                        ignoredDetails.push({
                            linha: i + 2,
                            motivo: 'Código de barras duplicado na planilha (dados mesclados com a ocorrência anterior)',
                            item: String(name),
                            codigo: cleanCode || 'N/A',
                            ean: cleanEan
                        });
                    }
                }
            }
            
            // Fallback por Código Interno se não encontrado por EAN
            if (!existingProduct && cleanCode) {
                existingProduct = productsByCode.get(cleanCode.toLowerCase());
                if (!existingProduct) {
                    existingProduct = newProductsByCode.get(cleanCode.toLowerCase());
                    if (existingProduct) {
                        isNewProductUpdate = true;
                        countDuplicatesMerged++;
                        ignoredDetails.push({
                            linha: i + 2,
                            motivo: 'Código interno duplicado na planilha (dados mesclados com a ocorrência anterior)',
                            item: String(name),
                            codigo: cleanCode,
                            ean: cleanEan || 'Sem EAN'
                        });
                    }
                }
            }

            const rowPrice = parseNumberSafe(getVal(['valor', 'preco', 'preco_venda', 'preco venda', 'valor_venda', 'novo_preco', 'Preco', 'Valor', 'Preço', 'Venda', 'PRECO_VENDA']));
            let rowStock = parseNumberSafe(getVal(['Estoque', 'Qtd', 'Quantidade', 'ESTOQUE_ATUAL', 'estoque']));
            if (rowStock < 0) {
                rowStock = Math.abs(rowStock);
            }
            let rowImage = getVal(['Imagem', 'Image', 'Foto', 'UrlImagem', 'ImagemURL', 'IMAGEM_PRINCIPAL']);

            const rowOriginalPrice = parseNumberSafe(getVal(['PrecoOriginal', 'PreçoOriginal', 'De', 'Original', 'PrecoDe', 'PRECO_ORIGINAL', 'Preço original', 'Preco original', 'preco_original', 'pmc', 'PMC', 'preco_pmc', 'PRECO_PMC']));
            const rowPromotionalPrice = parseNumberSafe(getVal(['PrecoPromocional', 'PreçoPromocional', 'Promocional', 'PrecoPromo', 'PRECO_PROMOCIONAL', 'PROMOTIONAL_PRICE', 'promotional_price', 'promotionalPrice', 'Preço promocional', 'Preco promocional', 'preco_promocional', 'valor_promocional', 'Por', 'PrecoPor', 'PRECO_POR']));
            
            // Promotional & Price logic
            let finalPrice = rowPrice || 0;
            let finalOriginalPrice = rowOriginalPrice || 0;
            let finalPromotionalPrice = rowPromotionalPrice || 0;
            let rowPromoType: 'NONE' | 'DISCOUNT' | 'BUY_X_PAY_Y' | undefined = undefined;

            if (finalPromotionalPrice > 0) {
                // Se houver Preço Promocional válido
                if (finalPrice > 0 && finalPromotionalPrice < finalPrice) {
                    finalOriginalPrice = finalOriginalPrice > 0 ? finalOriginalPrice : finalPrice;
                    finalPrice = finalPromotionalPrice;
                    rowPromoType = 'DISCOUNT';
                    countPromotional++;
                } else if (finalOriginalPrice > 0 && finalPromotionalPrice < finalOriginalPrice) {
                    finalPrice = finalPromotionalPrice;
                    rowPromoType = 'DISCOUNT';
                    countPromotional++;
                } else if (finalPrice === 0) {
                    finalPrice = finalPromotionalPrice;
                }
            } else if (finalPrice > 0 && finalOriginalPrice > 0) {
                // Ambos preenchidos: price recebe preco_venda, original_price recebe preco_original / PMC
                if (finalPrice < finalOriginalPrice) {
                    rowPromoType = 'DISCOUNT';
                    countPromotional++;
                } else {
                    rowPromoType = 'NONE';
                }
            } else if (finalOriginalPrice > 0 && finalPrice === 0) {
                // Apenas preco_original preenchido: price recebe preco_original, original_price recebe 0
                finalPrice = finalOriginalPrice;
                finalOriginalPrice = 0;
                rowPromoType = 'NONE';
            } else {
                // Apenas preco_venda preenchido ou nenhum
                finalOriginalPrice = 0;
                rowPromoType = 'NONE';
            }

            const rawPromo = getVal(['TipoPromocao', 'Promocao', 'Promo', 'TipoOferta', 'TIPO_PROMOCAO']);
            if (rawPromo) {
                const s = String(rawPromo).toUpperCase().trim();
                if (s === 'DESCONTO' || s === 'DISCOUNT' || s === 'OFERTA') rowPromoType = 'DISCOUNT';
                else if (s === 'KIT' || s.includes('LEVE') || s === 'BUY_X_PAY_Y') rowPromoType = 'BUY_X_PAY_Y';
                else if (s === 'NENHUMA' || s === 'NONE') rowPromoType = 'NONE';
            }

            const rowBuyX = parseNumberSafe(getVal(['Leve', 'BuyX', 'QtdLeve', 'PROMO_LEVE']));
            const rowPayY = parseNumberSafe(getVal(['Pague', 'PayY', 'QtdPague', 'PROMO_PAGUE']));
            
            const rawRequiresPrescription = getVal(['Receita', 'RetencaoReceita', 'Controlado', 'TarjaPreta', 'RequiresPrescription', 'EXIGE_RECEITA']);
            let rowRequiresPrescription: boolean | undefined = undefined;
            if (rawRequiresPrescription !== undefined) {
                const s = String(rawRequiresPrescription).toLowerCase().trim();
                rowRequiresPrescription = s === 'sim' || s === 'true' || s === '1' || s === 's' || s === 'y' || s === 'yes';
            }

            const providedSubcat = getVal(['SUBCATEGORIA', 'Subcategoria', 'Categoria', 'CATEGORIA_CLASSE', 'categoria']);
            const providedSubcatId = getVal(['SUBCATEGORIA_ID']);
            const rowDept = getVal(['Departamento', 'DEPARTAMENTO', 'Secao']);
            const rowDeptId = getVal(['DEPARTAMENTO_ID']);

            let finalCategoryStr = 'Geral'; // Fallback
            
            // Garantir que a subcategoria está relacionada ao DEPARTAMENTO correto, usando ID Mapping
            try {
                if (providedSubcat && String(providedSubcat).trim() !== '') {
                    const rawSubcat = String(providedSubcat).trim();
                    const lowerRawSubcat = rawSubcat.toLowerCase();
                    let selectedDept: any = null;

                    if (rowDeptId && deptIdMap.has(String(rowDeptId))) {
                        const matchedId = deptIdMap.get(String(rowDeptId));
                        selectedDept = trackedDepartments.find((d: any) => d.id === matchedId);
                    } 
                    
                    if (!selectedDept && rowDept) {
                        const matchedId = deptNameMap.get(String(rowDept).trim().toLowerCase());
                        if (matchedId) {
                            selectedDept = trackedDepartments.find((d: any) => d.id === matchedId);
                        }
                    }

                    if (selectedDept) {
                        // Tenta achar pelo ID de mapeamento exato
                        if (providedSubcatId && subcatIdMap.has(String(providedSubcatId))) {
                            // O valor no mapa já é a string exata salva em categories
                            const mappedSubcat = subcatIdMap.get(String(providedSubcatId)) as string;
                            if(selectedDept.categories.includes(mappedSubcat)) {
                                finalCategoryStr = mappedSubcat;
                            } else {
                                // Fallback
                                finalCategoryStr = rawSubcat;
                            }
                        } else {
                            // Mapeia para a string exata armazenada neste departamento
                            const existingSub = selectedDept.categories.find((c: string) => c.trim().toLowerCase() === lowerRawSubcat);
                            if (existingSub) {
                                finalCategoryStr = existingSub;
                            } else {
                                finalCategoryStr = rawSubcat;
                            }
                        }
                    } else if (!rowDept || String(rowDept).trim().toLowerCase() === 'outros') {
                        // Cenário 2: Movido para Outros somente se explícito ou fallback máximo sem depart
                        finalCategoryStr = rawSubcat; 
                    } else {
                        finalCategoryStr = rawSubcat; // Fallback extremo
                    }
                }
            } catch (e) {
                console.warn("Aviso ao vincular subcategoria no produto. Pulando...", e);
            }

            if (existingProduct) {
                const p = existingProduct;
                let newStock = p.stock;
                let changeTxt = "";
                
                if (hasStockCol && rowStock !== undefined) {
                    if (importStockMode === 'ADD') {
                        newStock += rowStock;
                        changeTxt = `Acrescentado ${rowStock} un.`;
                    }
                    else if (importStockMode === 'SUBTRACT') {
                        newStock = newStock - rowStock;
                        changeTxt = `Baixado ${rowStock} un.`;
                    }
                    else {
                        newStock = rowStock;
                        changeTxt = `Definido como ${rowStock} un.`;
                    }
                }
                const newName = hasNameCol && name ? String(name) : p.name;
                const newCode = hasCodeCol && code !== undefined ? String(code) : (p.internalCode ? String(p.internalCode).trim() : undefined);
                const newEan = hasEanCol && ean ? String(ean).trim() : (p.barcode && String(p.barcode).trim() !== '' ? String(p.barcode).trim() : undefined);
                const newPrice = (hasPriceCol || hasPromotionalPriceCol || hasOriginalPriceCol) && finalPrice > 0 ? finalPrice : p.price;
                const newOriginalPrice = (hasOriginalPriceCol || hasPromotionalPriceCol) ? (finalOriginalPrice > 0 ? finalOriginalPrice : 0) : p.originalPrice;
                const newPromotionalPrice = hasPromotionalPriceCol ? (finalPromotionalPrice > 0 ? finalPromotionalPrice : undefined) : p.promotionalPrice;
                
                let newPromoType = p.promotionType;
                if (hasPromoTypeCol && rowPromoType !== undefined) {
                    newPromoType = rowPromoType;
                } else if (hasOriginalPriceCol || hasPriceCol || hasPromotionalPriceCol) {
                    if ((newOriginalPrice || 0) > 0 && newPrice < (newOriginalPrice || 0)) {
                        newPromoType = 'DISCOUNT';
                    } else if (newPromoType === 'DISCOUNT' && (!(newOriginalPrice || 0) || (newOriginalPrice || 0) <= newPrice)) {
                        newPromoType = 'NONE';
                    }
                }

                const hasChanges = 
                    p.internalCode !== newCode ||
                    p.price !== newPrice ||
                    (p.originalPrice || 0) !== newOriginalPrice ||
                    (p.promotionalPrice || 0) !== (newPromotionalPrice || 0) ||
                    p.promotionType !== newPromoType ||
                    p.stock !== newStock ||
                    p.name !== newName ||
                    p.barcode !== newEan ||
                    (hasDescCol && getVal(['Descricao', 'DescricaoDetalhada', 'Obs', 'DESCRICAO_COMERCIAL'])) ||
                    (hasLabCol && getVal(['Laboratorio', 'Fabricante', 'Marca', 'FABRICANTE_LAB', 'fabricantes'])) ||
                    (hasActivePrincipleCol && getVal(['PrincipioAtivo', 'Formula', 'PRINCIPIO_ATIVO'])) ||
                    (hasLegalTypeCol && getVal(['Tipo', 'TipoLegal', 'TIPO_MEDICAMENTO', 'tipo medicamento'])) ||
                    (hasDeptCol || hasSubcatCol);

                if (hasChanges) {
                    const updatedProductData = {
                        ...p,
                        name: newName,
                        price: newPrice,
                        originalPrice: newOriginalPrice,
                        promotionalPrice: newPromotionalPrice,
                        promotional_price: newPromotionalPrice !== undefined ? newPromotionalPrice : null,
                        promotionType: newPromoType,
                        stock: newStock,
                        internalCode: newCode,
                        barcode: newEan
                    };
                    
                    if (hasDescCol) {
                        const val = getVal(['Descricao', 'DescricaoDetalhada', 'Obs', 'DESCRICAO_COMERCIAL']);
                        if (val !== undefined) updatedProductData.description = String(val);
                    }
                    if (hasLabCol) {
                        const val = getVal(['Laboratorio', 'Fabricante', 'Marca', 'FABRICANTE_LAB', 'fabricantes']);
                        if (val !== undefined) {
                            updatedProductData.manufacturer = findMatchingManufacturer(val, manufacturerOptions, tenant.manufacturerSynonyms || {});
                        }
                    }
                    if (hasActivePrincipleCol) {
                        const val = getVal(['PrincipioAtivo', 'Formula', 'PRINCIPIO_ATIVO']);
                        if (val !== undefined) updatedProductData.activePrinciple = String(val);
                    }
                    if (hasLegalTypeCol) {
                        const val = getVal(['Tipo', 'TipoLegal', 'TIPO_MEDICAMENTO', 'tipo medicamento']);
                        if (val !== undefined) updatedProductData.drugType = String(val);
                    }
                    if (hasDeptCol || hasSubcatCol) {
                        updatedProductData.category = finalCategoryStr !== undefined ? finalCategoryStr : p.category;
                    }
                    if (hasPrescriptionCol && rowRequiresPrescription !== undefined) {
                        updatedProductData.requires_prescription = rowRequiresPrescription;
                    }
                    if (hasImageColumn) {
                        updatedProductData.image = rowImage !== undefined && rowImage !== null && String(rowImage).trim() !== "" && String(rowImage).trim().toLowerCase() !== "null" ? String(rowImage).trim() : p.image;
                    }
                    if (hasBuyXCol && rowBuyX !== undefined) updatedProductData.buyX = rowBuyX;
                    if (hasPayYCol && rowPayY !== undefined) updatedProductData.payY = rowPayY;

                    if (isNewProductUpdate) {
                        const idx = newProducts.findIndex(np => np.id === p.id);
                        if (idx > -1) newProducts[idx] = updatedProductData;
                        if (newEan) newProductsByEan.set(newEan, updatedProductData);
                        importedProducts.push(updatedProductData);
                    } else {
                        const idx = updatedProducts.findIndex(up => up.id === p.id);
                        if (idx > -1) {
                            updatedProducts[idx] = updatedProductData;
                        } else {
                            updatedProducts.push(updatedProductData);
                            countUpdated++;
                        }
                        if (newEan) productsByEan.set(newEan, updatedProductData);
                        importedProducts.push(updatedProductData);
                    }

                    let diffDetails = [];
                    if (p.price !== newPrice) diffDetails.push(`Preço: ${p.price} -> ${newPrice}`);
                    if (p.stock !== newStock) diffDetails.push(`Estoque: ${p.stock} -> ${newStock}`);
                    if (diffDetails.length === 0) diffDetails.push("Outros campos atualizados");

                    audit.push({ name: newName, code: newCode, status: 'updated', details: diffDetails.join(' | ') });
                } else {
                    countNoChange++;
                    importedProducts.push(p);
                }
            } else {
                if (importStockMode === 'SUBTRACT') continue;

                let finalImage = undefined;
                if (!preserveImagesOnImport) {
                    if (rowImage !== undefined && rowImage !== null && String(rowImage).trim() !== '' && String(rowImage).trim().toLowerCase() !== 'null') {
                        finalImage = String(rowImage).trim();
                    }
                }

                let productData: Product = {
                    id: Math.random().toString(36).substr(2, 9),
                    tenantId: tenant.id,
                    name: String(name),
                    price: finalPrice || 0,
                    stock: rowStock || 0,
                    internalCode: code ? String(code) : Math.random().toString(36).substr(2, 6).toUpperCase(),
                    barcode: (ean && ean.trim() !== '') ? String(ean).trim() : undefined,
                    category: finalCategoryStr !== undefined ? finalCategoryStr : 'Geral',
                    manufacturer: findMatchingManufacturer(
                        getVal(['Laboratorio', 'Fabricante', 'Marca', 'FABRICANTE_LAB', 'fabricantes']) || 'Outros',
                        manufacturerOptions,
                        tenant.manufacturerSynonyms || {}
                    ),
                    activePrinciple: getVal(['PrincipioAtivo', 'Formula', 'PRINCIPIO_ATIVO']) || '',
                    drugType: getVal(['Tipo', 'TipoLegal', 'TIPO_MEDICAMENTO', 'tipo medicamento']) || 'Outros',
                    presentation: getVal(['Apresentacao', 'APRESENTACAO']) || '',
                    description: getVal(['Descricao', 'DescricaoDetalhada', 'Obs', 'DESCRICAO_COMERCIAL']) || '',
                    indications: getVal(['Indicacoes', 'INDICACOES']) || '',
                    image: finalImage,
                    isFeatured: false,
                    originalPrice: finalOriginalPrice || 0,
                    promotionalPrice: finalPromotionalPrice > 0 ? finalPromotionalPrice : undefined,
                    promotional_price: finalPromotionalPrice > 0 ? finalPromotionalPrice : null,
                    promotionType: rowPromoType || 'NONE',
                    buyX: rowBuyX || 0,
                    payY: rowPayY || 0,
                    isAiEnriched: false,
                    requires_prescription: rowRequiresPrescription || false
                };

                newProducts.push(productData);
                importedProducts.push(productData);
                if (productData.barcode) newProductsByEan.set(productData.barcode, productData);
                if (productData.internalCode) newProductsByCode.set(productData.internalCode.toLowerCase(), productData);
                countCreated++;

                audit.push({ name: String(name), code: String(productData.internalCode || productData.barcode), status: 'created', details: `Novo item cadastrado (${rowStock} un.)` });
            }
        }

        let finalProducts = [...updatedProducts, ...newProducts];
        
        // Upload base64 images to storage
        const productsWithBase64 = finalProducts.filter(p => p.image && p.image.startsWith('data:image/'));
        if (productsWithBase64.length > 0) {
            setImportProgress(99); // Indicate we are finalizing images
            try {
                const { uploadBase64Image } = await import('../services/storageMedia');
                for (let i = 0; i < productsWithBase64.length; i++) {
                    const p = productsWithBase64[i];
                    const fileName = p.barcode || p.internalCode || p.id || 'product';
                    const publicUrl = await uploadBase64Image(p.image!, fileName);
                    if (publicUrl) {
                        p.image = publicUrl;
                    }
                }
            } catch (e) {
                console.error("Erro ao fazer upload de imagens em lote", e);
            }
        }
        
        let countDeleted = 0;
        if (importMode === 'REPLACE') {
            const importedIds = new Set(importedProducts.map(p => p.id));
            const productsToRemove = products.filter(p => !importedIds.has(p.id));
            if (productsToRemove.length > 0) {
                const idsToRemove = productsToRemove.map(p => p.id);
                try {
                    await onBulkDelete(idsToRemove);
                    countDeleted = idsToRemove.length;
                    audit.push({
                        name: 'REMOÇÃO EM MASSA',
                        code: '---',
                        status: 'deleted',
                        details: `${countDeleted} produtos não presentes no arquivo foram removidos.`
                    });
                } catch (e) {
                    console.error("Erro ao remover produtos não presentes no arquivo", e);
                }
            }
        }
        
        if (departmentsChanged) {
            await onTenantUpdate({ ...tenant, departments: trackedDepartments });
        }

        // Lógica de Persistência em Lote no Banco de Dados (Supabase via API Bulk com fallback resiliente)
        let totalSavedInDb = 0;
        let totalFailedInDb = 0;
        const dbFailures: { name?: string; barcode?: string; code?: string; reason?: string }[] = [];

        try {
            const CHUNK_SIZE = 250;
            const itemsToPersist = finalProducts.map(p => {
                const rawPromo = (p as any).promotional_price !== undefined && (p as any).promotional_price !== null
                    ? (p as any).promotional_price
                    : p.promotionalPrice;
                const numPromo = rawPromo !== '' && rawPromo !== null && rawPromo !== undefined ? Number(rawPromo) : NaN;
                
                return {
                    id: p.id,
                    tenant_id: tenant.id,
                    barcode: (p.barcode && String(p.barcode).trim() !== '') ? String(p.barcode).trim() : null,
                    internal_code: p.internalCode || null,
                    name: p.name,
                    price: Number(p.price) || 0,
                    stock: Number(p.stock) || 0,
                    category: p.category || 'Geral',
                    manufacturer: p.manufacturer || 'Outros',
                    active_principle: p.activePrinciple || '',
                    drug_type: p.drugType || '',
                    presentation: p.presentation || '',
                    image: p.image || null,
                    description: p.description || '',
                    indications: p.indications || '',
                    original_price: Number(p.originalPrice) || 0,
                    promotional_price: !isNaN(numPromo) && numPromo > 0 ? numPromo : null,
                    promotion_type: p.promotionType || 'NONE',
                    buy_x: Number(p.buyX) || 0,
                    pay_y: Number(p.payY) || 0,
                    requires_prescription: Boolean(p.requires_prescription)
                };
            });

            for (let i = 0; i < itemsToPersist.length; i += CHUNK_SIZE) {
                const chunk = itemsToPersist.slice(i, i + CHUNK_SIZE);
                const currentPct = Math.round(50 + ((i + chunk.length) / itemsToPersist.length) * 45);
                setImportProgress(currentPct);

                try {
                    const token = (await supabase.auth.getSession()).data.session?.access_token;
                    const res = await fetch(`/api/v1/tenants/${tenant.id}/products/bulk`, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                            ...(token ? { Authorization: `Bearer ${token}` } : {})
                        },
                        body: JSON.stringify({ products: chunk })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        totalSavedInDb += (data.savedCount || chunk.length);
                        if (data.failedCount > 0 && Array.isArray(data.failedDetails)) {
                            totalFailedInDb += data.failedCount;
                            dbFailures.push(...data.failedDetails);
                        }
                    } else {
                        console.info(`[FarmaFlow Import] Endpoint bulk retornou ${res.status}, acionando sincronização direta com resolução de conflitos...`);
                        
                        const is23505 = (err: any) => {
                            if (!err) return false;
                            return err.code === '23505' ||
                                   String(err.message || '').includes('23505') ||
                                   String(err.message || '').includes('unique constraint') ||
                                   String(err.details || '').includes('already exists');
                        };

                        const { error: upsertErr } = await supabase.from('products').upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
                        if (!upsertErr) {
                            totalSavedInDb += chunk.length;
                        } else {
                            if (!is23505(upsertErr)) {
                                console.warn("[FarmaFlow Import] Ajustando lote de produtos:", upsertErr.message);
                            }
                            // Fallback individual item por item com UPDATE silencioso em caso de 23505
                            for (const item of chunk) {
                                const { error: singleErr } = await supabase.from('products').upsert([item], { onConflict: 'id' });
                                if (!singleErr) {
                                    totalSavedInDb++;
                                    continue;
                                }

                                if (is23505(singleErr)) {
                                    // 23505: produto já existe no banco. Faz UPDATE silencioso dos dados
                                    const { id, tenant_id, ...updatePayload } = item;
                                    let resolved = false;

                                    if (item.barcode) {
                                        const { error: updErr } = await supabase.from('products').update(updatePayload).eq('tenant_id', tenant.id).eq('barcode', item.barcode);
                                        if (!updErr) resolved = true;
                                    }
                                    if (!resolved && item.internal_code) {
                                        const { error: updErr } = await supabase.from('products').update(updatePayload).eq('tenant_id', tenant.id).eq('internal_code', item.internal_code);
                                        if (!updErr) resolved = true;
                                    }

                                    if (resolved) {
                                        totalSavedInDb++;
                                        continue;
                                    }
                                }

                                totalFailedInDb++;
                                dbFailures.push({ name: item.name, barcode: item.barcode || undefined, code: item.internal_code || undefined, reason: singleErr.message });
                            }
                        }
                    }
                } catch (chunkErr: any) {
                    const is23505 = (err: any) => {
                        if (!err) return false;
                        return err.code === '23505' ||
                               String(err.message || '').includes('23505') ||
                               String(err.message || '').includes('unique constraint');
                    };

                    for (const item of chunk) {
                        try {
                            const { error: singleErr } = await supabase.from('products').upsert([item], { onConflict: 'id' });
                            if (!singleErr) {
                                totalSavedInDb++;
                                continue;
                            }

                            if (is23505(singleErr)) {
                                const { id, tenant_id, ...updatePayload } = item;
                                let resolved = false;
                                if (item.barcode) {
                                    const { error: updErr } = await supabase.from('products').update(updatePayload).eq('tenant_id', tenant.id).eq('barcode', item.barcode);
                                    if (!updErr) resolved = true;
                                }
                                if (!resolved && item.internal_code) {
                                    const { error: updErr } = await supabase.from('products').update(updatePayload).eq('tenant_id', tenant.id).eq('internal_code', item.internal_code);
                                    if (!updErr) resolved = true;
                                }
                                if (resolved) {
                                    totalSavedInDb++;
                                    continue;
                                }
                            }

                            totalFailedInDb++;
                            dbFailures.push({ name: item.name, barcode: item.barcode || undefined, code: item.internal_code || undefined, reason: singleErr.message });
                        } catch (e: any) {
                            totalFailedInDb++;
                            dbFailures.push({ name: item.name, barcode: item.barcode || undefined, code: item.internal_code || undefined, reason: e?.message || 'Falha desconhecida' });
                        }
                    }
                }
            }

            // Atualiza o estado da aplicação e o cache localforage
            onProductsStateUpdate(finalProducts);
            await saveProductsByTenant(tenant.id, finalProducts).catch(() => {});
        } catch (dbErr) {
            console.error("[FarmaFlow Debug] Falha geral no processamento do banco de dados:", dbErr);
            await onProductsUpdate(finalProducts);
        }

        // Montagem do Relatório de Auditoria Pós-Salvamento com Dados Verificados
        if (dbFailures.length > 0) {
            dbFailures.forEach(f => {
                audit.push({
                    name: f.name || 'Produto com erro',
                    code: f.code || f.barcode || 'N/A',
                    status: 'deleted',
                    details: `Falha ao gravar no banco: ${f.reason}`
                });
            });
        }

        if (ignoredDetails.length > 0) {
            ignoredDetails.slice(0, 100).forEach(d => {
                audit.push({
                    name: d.item,
                    code: d.codigo || d.ean || 'N/A',
                    status: 'no-change',
                    details: `Linha ${d.linha}: ${d.motivo}`
                });
            });
        }

        audit.unshift({
            name: 'RESUMO DA IMPORTAÇÃO',
            code: '---',
            status: totalFailedInDb === 0 ? 'updated' : 'deleted',
            details: `Total no arquivo: ${total} | Gravados no banco: ${totalSavedInDb} (Novos: ${countCreated}, Atualizados: ${countUpdated}) | Sem alterações: ${countNoChange} | Linhas vazias/unificadas: ${countEmptyRows + countDuplicatesMerged} (Vazias: ${countEmptyRows}, Unificadas: ${countDuplicatesMerged})${totalFailedInDb > 0 ? ` | Erros de gravação: ${totalFailedInDb}` : ''}${importMode === 'REPLACE' ? ` | Removidos: ${countDeleted}` : ''}`
        });

        if (countPromotional > 0) {
            audit.unshift({
                name: 'PROMOÇÕES DETECTADAS',
                code: '---',
                status: 'updated',
                details: `Foram detectados ${countPromotional} produtos com preço promocional (Preço Venda < Preço Original).`
            });
        }

        setAuditReport(audit);

        // Registro detalhado no console do navegador
        console.group("📊 [FarmaFlow Importação] Relatório Detalhado de Processamento");
        console.log(`Linhas lidas do arquivo: ${total}`);
        console.log(`✅ Itens gravados com sucesso no banco: ${totalSavedInDb}`);
        console.log(`🆕 Novos produtos cadastrados: ${countCreated}`);
        console.log(`🔄 Produtos existentes atualizados: ${countUpdated}`);
        console.log(`⏭️ Produtos sem alteração: ${countNoChange}`);
        console.log(`⚠️ Linhas vazias ignoradas: ${countEmptyRows}`);
        console.log(`🔀 Códigos duplicados mesclados na planilha: ${countDuplicatesMerged}`);
        if (totalFailedInDb > 0) {
            console.warn(`❌ Falhas de gravação no banco de dados: ${totalFailedInDb}`);
        }
        if (ignoredDetails.length > 0) {
            console.groupCollapsed(`Detalhes de linhas vazias / duplicadas (${ignoredDetails.length})`);
            console.table(ignoredDetails.slice(0, 500));
            console.groupEnd();
        }
        if (dbFailures.length > 0) {
            console.group(`Detalhes de falhas no banco de dados (${dbFailures.length})`);
            console.table(dbFailures);
            console.groupEnd();
        }
        console.groupEnd();
        
        try {
            // Limitar itens para evitar QuotaExceededError no localStorage
            const MAX_AUDIT_ITEMS = 1000;
            const auditToSave = audit.length > MAX_AUDIT_ITEMS 
                ? [...audit.slice(0, MAX_AUDIT_ITEMS), { name: '...', code: '...', status: 'no-change', details: `+ ${audit.length - MAX_AUDIT_ITEMS} outros itens (ocultos no histórico para economizar memória)` }]
                : audit;

            const sessionLog = {
                id: Math.random().toString(36).substr(2, 6).toUpperCase(),
                tenantId: tenant.id,
                timestamp: Date.now(),
                totalProcessed: total,
                totalSaved: totalSavedInDb,
                newItems: countCreated,
                updatedItems: countUpdated,
                emptyRows: countEmptyRows,
                duplicatesMerged: countDuplicatesMerged,
                failedCount: totalFailedInDb,
                items: auditToSave
            };
            const currentHistoryRaw = localStorage.getItem('ff_import_history');
            let historyArr = currentHistoryRaw ? JSON.parse(currentHistoryRaw) : [];
            
            if (historyArr.length > 5) {
                historyArr = historyArr.slice(-5);
            }
            
            historyArr.push(sessionLog);
            localStorage.setItem('ff_import_history', JSON.stringify(historyArr));

            // Salva de forma persistente no Supabase integration_logs com status real
            (async () => {
                try {
                    const { error } = await supabase
                        .from('integration_logs')
                        .insert({
                            tenant_id: tenant.id,
                            endpoint: 'spreadsheet_import',
                            payload: sessionLog,
                            status: totalFailedInDb === 0 ? 'SUCCESS' : 'WARNING'
                        });
                    if (error) {
                        console.error("Erro ao salvar log de importação no Supabase:", error);
                    }
                } catch (err) {
                    console.error("Erro assíncrono ao salvar log no Supabase:", err);
                }
            })();
        } catch (e) {
            console.warn("Não foi possível salvar o histórico de importação no localStorage.", e);
        }
        
        // Atualização de Cache e Estado Global
        setSearchTerm('');
        setFilterCategory('Todos');
        setFilterDepartment('Todos');
        setSelectedProducts(new Set());
        setImportProgress(100);
        let ignoredItems = 0;
        let enrichedItems = 0;
        let imagesValidated = 0;
        let newImageSearches = 0;

        // Start background AI enrichment queue if selected
        if (importType === 'ai') {
            const productsToEnrich = finalProducts.filter(p => {
                const isComplete = p.description && p.description.length > 10 && 
                                   p.activePrinciple && p.activePrinciple.length > 3 && 
                                   p.category && p.category !== 'Geral';
                
                if (!overwriteExistingData && isComplete) {
                    ignoredItems++;
                    return false;
                }
                
                if (!p.isAiEnriched || overwriteExistingData) {
                    enrichedItems++;
                    return true;
                }
                return false;
            });

            if (productsToEnrich.length > 0) {
                setAiJobProgress({ processed: 0, total: productsToEnrich.length, report: { processed: 0, failed: 0, tokensSaved: 0 } });
                processAiEnrichmentQueue(
                    productsToEnrich,
                    (processed, total, report) => {
                        setAiJobProgress({ processed, total, report });
                    },
                    (updatedProductsBatch) => {
                        const latestProducts = productsRef.current;
                        const mergedBatch = updatedProductsBatch.map(updated => {
                            const latest = latestProducts.find(p => p.id === updated.id);
                            if (!latest) return updated;
                            // Only merge the fields that AI enrichment actually updates
                            return {
                                ...latest,
                                activePrinciple: updated.activePrinciple,
                                drugType: updated.drugType,
                                presentation: updated.presentation,
                                description: updated.description,
                                indications: updated.indications,
                                category: updated.category,
                                manufacturer: updated.manufacturer,
                                isAiEnriched: updated.isAiEnriched
                            };
                        });
                        onProductsStateUpdate(mergedBatch);
                    }
                ).then(finalReport => {
                    console.log("AI enrichment finished", finalReport);
                    setImportSummary(prev => prev ? { ...prev, tokensSaved: finalReport.tokensSaved } : null);
                    setTimeout(() => setAiJobProgress(null), 10000); // Hide after 10s
                });
            }
        }

        setImportSummary({
            totalItems: total,
            ignoredItems: importType === 'ai' ? ignoredItems : countNoChange,
            enrichedItems,
            imagesValidated: 0,
            newImageSearches: 0,
            tokensSaved: 0 // This will be updated asynchronously by the AI job, but we set initial state here
        });
  };

  const importBackupStream = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportProgress(0);
    setAuditReport(null);

    try {
        // Take image snapshot before import
        const snapshot: Record<string, string | undefined> = {};
        products.forEach(p => {
            snapshot[p.id] = p.image;
        });
        localStorage.setItem(`image_snapshot_${tenant.id}`, JSON.stringify(snapshot));
        setImageSnapshot(snapshot);

        const json = await readSpreadsheetToJSON(file);
        await executeProductImport(json);
    } catch (err: any) {
        alert("Erro na importação: " + err.message);
    } finally {
        setIsImporting(false);
        if (importProductsRef.current) importProductsRef.current.value = '';
    }
  };

  const importPastedProducts = async () => {
    if (!pastedText.trim()) {
        alert("Cole os dados da planilha antes de continuar.");
        return;
    }
    const json = parsePastedData(pastedText);
    if (json.length === 0) {
        alert("Nenhum dado válido encontrado. Verifique se copiou os cabeçalhos e as linhas da planilha corretamente.");
        return;
    }

    setIsImporting(true);
    setImportProgress(0);
    setAuditReport(null);

    try {
        // Take image snapshot before import
        const snapshot: Record<string, string | undefined> = {};
        products.forEach(p => {
            snapshot[p.id] = p.image;
        });
        localStorage.setItem(`image_snapshot_${tenant.id}`, JSON.stringify(snapshot));
        setImageSnapshot(snapshot);

        await executeProductImport(json);
        setPastedText('');
    } catch (err: any) {
        alert("Erro na importação: " + err.message);
    } finally {
        setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
        <div className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-gray-100">
            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">Catálogo Farmacêutico</h2>
                    <p className="text-gray-400 font-bold text-xs uppercase tracking-widest mt-1">{tenant.name || 'Portal Master'}</p>
                </div>
                <div className="text-right hidden md:block">
                     <p className="text-3xl font-black text-brand">{products.length}</p>
                     <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Itens Cadastrados</p>
                </div>
            </div>

            <div className="flex flex-col gap-5">
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100">
                    <div className="flex items-center gap-4 flex-wrap">
                        <button 
                            onClick={() => setFilterZeroStock(!filterZeroStock)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wide transition-all border-2 ${filterZeroStock ? 'bg-red-50 text-red-600 border-red-200 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-red-200 hover:text-red-500'}`}
                        >
                            <AlertCircle size={16} className={filterZeroStock ? 'text-red-500' : ''} />
                            Estoque Zerado
                        </button>
                        <button 
                            onClick={() => setFilterFeatured(!filterFeatured)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wide transition-all border-2 ${filterFeatured ? 'bg-yellow-50 text-yellow-600 border-yellow-200 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-yellow-200 hover:text-yellow-500'}`}
                        >
                            <Star size={16} className={filterFeatured ? 'text-yellow-500' : ''} />
                            Destaques
                        </button>
                        <button 
                            onClick={() => setFilterNoImage(!filterNoImage)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wide transition-all border-2 ${filterNoImage ? 'bg-purple-50 text-purple-600 border-purple-200 shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-purple-200 hover:text-purple-500'}`}
                        >
                            <ImageOff size={16} className={filterNoImage ? 'text-purple-500' : ''} />
                            Sem Foto
                        </button>
                        {(filterZeroStock || filterFeatured || filterNoImage) && (
                            <span className="text-xs font-bold text-gray-600 bg-gray-100 px-3 py-1 rounded-lg">
                                Exibindo {filteredProducts.length} itens
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={handleExportAllProducts}
                            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border-2 border-emerald-200 text-emerald-700 rounded-xl font-black text-xs uppercase tracking-wide hover:bg-emerald-100 hover:border-emerald-300 transition-all shadow-sm"
                            title="Exportar planilha Excel com todos os produtos cadastrados da farmácia"
                        >
                            <Download size={16} /> Exportar Produtos ({products.length})
                        </button>
                        <button 
                            onClick={handleExportZeroStock}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-wide hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
                            title="Exportar lista de produtos com estoque zerado (Lista de Compras)"
                        >
                            <Download size={16} /> Exportar Faltas
                        </button>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row md:flex-wrap xl:flex xl:flex-row xl:items-center xl:justify-between gap-4 w-full">
                    <div className="relative group w-full flex-1">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand transition-colors" size={20} />
                        <input 
                            type="text" 
                            placeholder="Pesquisar por nome, código ou fabricante..." 
                            className="w-full pl-14 pr-16 py-4 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-brand transition-all font-bold text-gray-900"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                        <button 
                            onClick={() => setScannerTarget('MAIN')}
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                            title="Escanear Código de Barras"
                        >
                            <ScanLine size={20} />
                        </button>
                    </div>
                    <div className="relative w-full flex-1 xl:min-w-[200px] whitespace-nowrap">
                        <Package className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
                        <Select
                            options={[
                                { value: 'Todos', label: 'Todos os Departamentos' },
                                ...departmentOptions.map(d => ({ value: d, label: d }))
                            ]}
                            value={{ value: filterDepartment, label: filterDepartment === 'Todos' ? 'Todos os Departamentos' : filterDepartment }}
                            onChange={(selected: any) => {
                                setFilterDepartment(selected.value);
                            }}
                            styles={customSelectStyles}
                            isSearchable
                            placeholder="Departamentos..."
                            className="w-full"
                        />
                    </div>
                    <div className="relative w-full flex-1 xl:min-w-[200px] whitespace-nowrap">
                        <Filter className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
                        <Select
                            options={[
                                { value: 'Todos', label: 'Todas as Subcategorias' },
                                ...filteredCategoryOptions.filter(c => c !== 'Todos').map(c => ({ value: c, label: c }))
                            ]}
                            value={{ value: filterCategory, label: filterCategory === 'Todos' ? 'Todas as Subcategorias' : filterCategory }}
                            onChange={(selected: any) => setFilterCategory(selected.value)}
                            styles={customSelectStyles}
                            isSearchable
                            placeholder="Subcategorias..."
                            className="w-full"
                        />
                    </div>
                    <div className="relative w-full flex-1 xl:min-w-[200px] whitespace-nowrap">
                        <Factory className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
                        <Select
                            options={[
                                { value: 'Todos', label: 'Todos os Fabricantes' },
                                ...manufacturerOptions.map(m => ({ value: m, label: m }))
                            ]}
                            value={{ value: filterManufacturer, label: filterManufacturer === 'Todos' ? 'Todos os Fabricantes' : filterManufacturer }}
                            onChange={(selected: any) => setFilterManufacturer(selected.value)}
                            styles={customSelectStyles}
                            isSearchable
                            placeholder="Fabricantes..."
                            className="w-full"
                        />
                    </div>
                    <div className="relative w-full flex-1 xl:min-w-[200px] whitespace-nowrap">
                        <Tag className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                        <select 
                            className="w-full pl-12 pr-10 py-4 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-brand transition-all font-bold text-gray-900 appearance-none cursor-pointer whitespace-nowrap"
                            value={filterPromotion}
                            onChange={e => setFilterPromotion(e.target.value)}
                        >
                            <option value="Todos">Todas as Promoções</option>
                            <option value="Com Promoção">Com Promoção</option>
                            <option value="Sem Promoção">Sem Promoção</option>
                            <option value="DISCOUNT">Desconto Simples</option>
                            <option value="BUY_X_PAY_Y">Kit (Leve X Pague Y)</option>
                            <option value="DISCOUNT_ON_QTY">Desconto na Qtd</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                    </div>
                    <div className="relative w-full flex-1 xl:min-w-[200px] whitespace-nowrap">
                        <AlertCircle className="absolute left-5 top-1/2 -translate-y-1/2 text-amber-500 pointer-events-none" size={18} />
                        <select 
                            className="w-full pl-12 pr-10 py-4 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-amber-500 transition-all font-bold text-gray-900 appearance-none cursor-pointer whitespace-nowrap"
                            value={filterPrescription}
                            onChange={e => setFilterPrescription(e.target.value as any)}
                        >
                            <option value="Todos">Todos os Medicamentos</option>
                            <option value="Venda Livre">Venda Livre</option>
                            <option value="Retenção de Receita">Retenção de Receita</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full mt-4">
                    <button onClick={handleToggleSelectAll} className={`flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 border-2 transition-all whitespace-nowrap ${selectedProducts.size > 0 ? 'bg-gray-800 text-white border-gray-800' : 'bg-white border-gray-100 text-gray-500'}`}>
                        <ListChecks size={18} /> {selectedProducts.size > 0 ? 'Desmarcar' : 'Selecionar'}
                    </button>
                    
                    {tenant?.isNetworkMaster && (
                        <button 
                            onClick={() => {
                                if (selectedProducts.size === 0) {
                                    alert("Selecione pelo menos um produto na Matriz para definir como destaque.");
                                    return;
                                }
                                setIsBulkFeaturedModalOpen(true);
                            }} 
                            className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-purple-600 text-white shadow-md hover:bg-purple-700 transition-all text-center whitespace-nowrap"
                        >
                            <Star size={18} /> Definir como Destaque em Lojas
                        </button>
                    )}
                    
                    {selectedProducts.size > 0 && (
                        <>
                            <button onClick={handleBulkPrescriptionClick} className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-amber-500 text-white shadow-md hover:bg-amber-600 transition-all text-center whitespace-nowrap">
                                <AlertCircle size={18} /> Status de Receita
                            </button>
                            <button onClick={handleBulkCategoryClick} className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-blue-500 text-white shadow-md hover:bg-blue-600 transition-all text-center whitespace-nowrap">
                                <Package size={18} /> Mover
                            </button>
                            <button disabled={isDeletingBulk} onClick={handleBulkDeleteClick} className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-red-600 text-white shadow-md hover:bg-red-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                                {isDeletingBulk ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />} 
                                {isDeletingBulk ? 'Excluindo...' : `Excluir (${selectedProducts.size})`}
                            </button>
                        </>
                    )}

                    <button onClick={() => setIsPhysicalSaleOpen(true)} className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-orange-50 text-orange-600 border border-orange-100 hover:bg-orange-100 whitespace-nowrap">
                        <Store size={18} /> Venda Balcão
                    </button>
                    <button onClick={() => setIsManagingLabLogos(true)} className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-blue-50 text-blue-600 border border-blue-100 whitespace-nowrap">
                        <Factory size={18} /> Fabricantes
                    </button>
                    <button onClick={() => setIsImportModalOpen(true)} className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-emerald-50 text-emerald-600 border border-emerald-100 whitespace-nowrap">
                        <FileSpreadsheet size={18} /> Atualizar / Importar
                    </button>
                    {tenant?.isNetworkMaster && (
                        <button onClick={() => setIsCentralPriceModalOpen(true)} className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-purple-50 text-purple-600 border border-purple-100 whitespace-nowrap">
                            <Upload size={18} /> Preço em Lote (Rede)
                        </button>
                    )}
                    <button onClick={() => setIsDepartmentManagerOpen(true)} title="Aqui você pode criar, renomear ou excluir seus departamentos e subcategorias." className="flex-1 md:flex-none px-5 py-4 rounded-xl font-bold text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-blue-50 text-blue-600 border border-blue-100 text-center leading-tight whitespace-nowrap">
                        <Layers size={18} /> Gerenciar Departamentos
                    </button>
                    <button onClick={handleCreateProduct} className="flex-1 md:flex-none px-8 py-4 rounded-xl font-black text-xs uppercase tracking-wide flex items-center justify-center gap-2 bg-brand text-brand-contrast hover:bg-emerald-700 transition-all shadow-lg w-full md:w-auto md:ml-auto whitespace-nowrap">
                        <Plus size={18} /> Novo Item
                    </button>
                </div>
            </div>
        </div>

        {filterPrescription === 'Retenção de Receita' && (
            <div className="mb-4 bg-amber-50 text-amber-700 p-3 rounded-xl border border-amber-200 flex items-center gap-3">
                <AlertCircle size={20} className="text-amber-500" />
                <span className="font-bold text-sm">Exibindo {filteredProducts.length} {filteredProducts.length === 1 ? 'medicamento' : 'medicamentos'} com retenção de receita</span>
            </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
            {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                    <div key={`skeleton-${i}`} className="bg-gray-100 animate-pulse p-3 rounded-2xl border border-gray-100 flex flex-col min-h-[250px]">
                        <div className="h-32 w-full bg-gray-200 rounded-xl mb-3"></div>
                        <div className="h-4 w-3/4 bg-gray-200 rounded mb-2"></div>
                        <div className="h-4 w-1/2 bg-gray-200 rounded mb-4"></div>
                        <div className="mt-auto h-8 w-full bg-gray-200 rounded-xl"></div>
                    </div>
                ))
            ) : paginatedProducts.map(product => (
                <div key={product.id} className={`bg-white p-3 rounded-2xl border transition-all hover:shadow-lg group relative flex flex-col ${selectedProducts.has(product.id) ? 'border-brand ring-1 ring-brand' : product.stock <= 0 ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
                    <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
                        <button onClick={() => handleToggleSelect(product.id)} className="text-gray-300 hover:text-brand transition-colors p-1 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm">
                            {selectedProducts.has(product.id) ? <CheckSquare size={18} className="text-brand"/> : <Square size={18}/>}
                        </button>
                        <button onClick={() => onProductsUpdate([{ ...product, isFeatured: !product.isFeatured }])} className={`p-1 backdrop-blur-sm rounded-lg shadow-sm transition-all ${product.isFeatured ? 'bg-yellow-400 text-white' : 'bg-white/80 text-gray-300 hover:text-yellow-400'}`}>
                            <Star size={18} fill={product.isFeatured ? "currentColor" : "none"} />
                        </button>
                    </div>
                    <div className="h-32 w-full bg-gray-50 rounded-xl mb-3 flex items-center justify-center p-2 relative overflow-hidden">
                        {getProductDisplayImage(product) ? (
                            <img 
                                src={getProductDisplayImage(product)!} 
                                className="h-full w-full object-contain" 
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                    e.currentTarget.onerror = null;
                                    e.currentTarget.src = GENERIC_PLACEHOLDER;
                                }}
                            />
                        ) : (
                            <Package size={32} className="text-gray-200" />
                        )}
                        {product.stock <= 0 && <div className="absolute inset-0 bg-white/70 flex items-center justify-center"><span className="bg-black text-white px-2 py-0.5 rounded-lg text-[9px] font-black uppercase">Esgotado</span></div>}
                        {product.requires_prescription && (
                            <div className="absolute bottom-1 right-1 bg-amber-500 text-white p-1 rounded items-center flex gap-1 shadow-md" title="Retenção de Receita">
                                <AlertCircle size={12} strokeWidth={3} />
                            </div>
                        )}
                    </div>
                    <div className="flex-1 flex flex-col min-w-0">
                        <div className="flex justify-between items-start mb-1 gap-2">
                            <span className="text-[8px] font-black uppercase text-gray-400 truncate">{product.category}</span>
                            <span className="text-[9px] font-bold text-gray-300">#{product.internalCode}</span>
                        </div>
                        <h3 className="font-bold text-gray-900 leading-snug line-clamp-2 text-xs md:text-sm mb-2">{product.name}</h3>
                        <div className="flex justify-between items-end mt-auto pt-2 border-t border-gray-50">
                            <div>
                                <p className="text-[9px] font-bold text-gray-400 uppercase leading-none">Preço</p>
                                <p className="text-sm md:text-base font-black text-gray-900">R$ {product.price.toFixed(2)}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md transition-all duration-500 ${(product as any)._justUpdated ? 'bg-orange-100 text-orange-600 scale-110' : product.stock > 0 ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-600'}`}>
                                    {product.stock} un
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => handleEditProduct(product as Product)} className="p-1.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-brand hover:text-brand-contrast"><Edit3 size={14}/></button>
                                    <button onClick={() => onProductDelete(product.id)} className="p-1.5 bg-gray-50 text-gray-400 rounded-lg hover:bg-red-50 hover:text-red-500"><Trash2 size={14}/></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>

        {/* Paginação */}
        <div className="flex flex-col md:flex-row justify-between items-center mt-6 gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Itens por página:</span>
                <select 
                    value={itemsPerPage} 
                    onChange={(e) => setItemsPerPage(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-brand focus:border-brand block p-2 font-bold"
                >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={500}>500</option>
                    <option value="all">Ver Todos</option>
                </select>
            </div>
            
            <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Página {currentPage} de {totalPages}
                </span>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold text-xs uppercase disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 transition-colors"
                    >
                        Anterior
                    </button>
                    <button 
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl font-bold text-xs uppercase disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-200 transition-colors"
                    >
                        Próxima
                    </button>
                </div>
            </div>
        </div>

        {/* Modal Opções Encarte - RESTAURADO COM O NOVO GERADOR DINÂMICO */}
        {isFlyerModalOpen && (
            <DynamicFlyerGenerator
                onClose={() => setIsFlyerModalOpen(false)}
                initialConfig={{
                    tenant: tenant,
                    tenantId: tenant.id,
                    tenantSlug: tenant.slug,
                    tenantSubdomain: (tenant as any).subdomain,
                    customDomain: tenant.custom_domain,
                    storeUrl: getStoreUrl(tenant),
                    themeColor: tenant.primaryColor || '#1e40af',
                    themeSecondaryColor: tenant.accentColor || '#1e3a8a',
                    bannerTitle: tenant.bannerTitle || 'OFERTAS ESPECIAIS',
                    subTitle: tenant.bannerSubtitle || 'Aqui você encontra saúde e bem estar!',
                    productsArray: getFlyerItems().map(p => {
                        let badgeText = '';
                        if (p.promotionType === 'BUY_X_PAY_Y' && p.buyX && p.payY) {
                            badgeText = `Leve ${p.buyX} Pague ${p.payY}`;
                        } else if (p.originalPrice && p.originalPrice > p.price) {
                            const percent = Math.round(((p.originalPrice - p.price) / p.originalPrice) * 100);
                            if (percent > 5) {
                                badgeText = `${percent}% OFF`;
                            }
                        }
                        return {
                            id: p.id,
                            name: p.name,
                            category: p.category,
                            price: p.price,
                            originalPrice: p.originalPrice,
                            promotionType: p.promotionType,
                            buyX: p.buyX,
                            payY: p.payY,
                            image: p.image,
                            isHighlight: false,
                            badgeText: badgeText
                        };
                    }),
                    footerInfo: {
                        whatsapp: tenant.whatsapp || '',
                        deliveryLink: 'Levamos até você!',
                        rules: 'Ofertas válidas enquanto durarem os estoques.'
                    },
                    logo: tenant.logo,
                    tenantName: tenant.name || 'Drogaria'
                }}
            />
        )}

        {/* Modal Editar Produto */}
        {editingProduct && (
            <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white w-full rounded-[2.5rem] max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl animate-in zoom-in-95">
                    <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-brand/10 text-brand rounded-xl flex items-center justify-center">
                                {products.find(p => p.id === editingProduct.id) ? <Edit3 size={20}/> : <Plus size={20}/>}
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-gray-900">
                                    {products.find(p => p.id === editingProduct.id) ? 'Editar Produto' : 'Novo Produto'}
                                </h3>
                                <p className="text-xs text-gray-400 font-bold uppercase">ID: {editingProduct.id}</p>
                            </div>
                        </div>
                        <button onClick={() => setEditingProduct(null)} className="p-2 bg-gray-50 rounded-full hover:text-red-500"><X size={24}/></button>
                    </div>
                    
                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <InputLabel label="Imagem do Produto" />
                            <div className="aspect-square bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200 flex flex-col items-center justify-center relative overflow-hidden group">
                                {getProductDisplayImage(editingProduct) ? (
                                    <>
                                        <img src={getProductDisplayImage(editingProduct)!} className="w-full h-full object-contain p-4" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = GENERIC_PLACEHOLDER; }} />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2">
                                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingProduct({...editingProduct, image: 'IGNORE'}); }} className="p-3 bg-red-500 text-white rounded-xl z-10 relative" title="Remover Imagem"><Trash2 size={20}/></button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center p-6"><ImageIcon size={48} className="text-gray-200 mx-auto mb-2" /><p className="text-xs text-gray-400 font-bold">Arraste ou clique</p></div>
                                )}
                                <input type="file" ref={fileInputRef} className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if(f){ const r = new FileReader(); r.onload=(ev)=>setEditingProduct(prev=>({...prev!, image: ev.target!.result as string})); r.readAsDataURL(f); } }} />
                            </div>
                            <div className="space-y-3">
                                <div className="flex gap-2">
                                    <button onClick={handleAiImage} disabled={isGeneratingImage || !editingProduct.name} className="flex-1 py-3 bg-purple-50 text-purple-600 rounded-xl font-black text-xs uppercase hover:bg-purple-100 transition-all flex items-center justify-center gap-2">{isGeneratingImage ? <Loader2 className="animate-spin" size={14}/> : <Wand2 size={14}/>} IA Imagem</button>
                                    <button onClick={() => fileInputRef.current?.click()} className="flex-1 py-3 bg-gray-50 text-gray-600 rounded-xl font-black text-xs uppercase hover:bg-gray-100 transition-all flex items-center justify-center gap-2"><Upload size={14}/> Upload</button>
                                </div>
                                <div className="relative group">
                                    <LinkIcon size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-brand" />
                                    <input type="text" placeholder="Ou cole a URL da Foto aqui..." className="w-full pl-10 pr-4 py-3 bg-gray-50 border-2 border-transparent rounded-xl outline-none focus:bg-white focus:border-brand transition-all text-xs font-bold text-gray-800" value={editingProduct.image?.startsWith('http') ? editingProduct.image : ''} onChange={e => setEditingProduct({...editingProduct, image: e.target.value})} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100"><label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={editingProduct.isFeatured || false} onChange={e => setEditingProduct({...editingProduct, isFeatured: e.target.checked})} className="w-5 h-5 accent-yellow-400" /><div className="flex flex-col"><span className="text-xs font-black uppercase text-blue-800">Destaque na Loja</span><span className="text-[9px] font-bold text-blue-600">Aparece no topo</span></div></label></div>
                                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100"><label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={editingProduct.requires_prescription || false} onChange={e => setEditingProduct({...editingProduct, requires_prescription: e.target.checked})} className="w-5 h-5 accent-amber-500" /><div className="flex flex-col"><span className="text-xs font-black uppercase text-amber-800">Retenção de Receita</span><span className="text-[9px] font-bold text-amber-600">Exige receita original</span></div></label></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-2xl border">
                                <div className="space-y-1"><InputLabel label="Preço de Venda (R$) *" /><SmartNumberInput isFloat={true} className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={Number.isNaN(editingProduct.price) ? '' : (editingProduct.price ?? '')} onChangeValue={val => setEditingProduct({...editingProduct, price: val})} /></div>
                                <div className="space-y-1"><InputLabel label="Preço Original / PMC (De:)" /><SmartNumberInput isFloat={true} className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={Number.isNaN(editingProduct.originalPrice) ? '' : (editingProduct.originalPrice ?? '')} onChangeValue={val => setEditingProduct({...editingProduct, originalPrice: val})} /></div>
                                <div className="space-y-1"><InputLabel label="Preço Promocional (Por:)" /><SmartNumberInput isFloat={true} className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={Number.isNaN(editingProduct.promotionalPrice) ? '' : (editingProduct.promotionalPrice ?? ((editingProduct as any).promotional_price ?? ''))} onChangeValue={val => { const numVal = typeof val === 'number' && !isNaN(val) && val > 0 ? val : null; setEditingProduct({...editingProduct, promotionalPrice: val, promotional_price: numVal}); }} /></div>
                                <div className="space-y-1"><InputLabel label="Estoque" /><SmartNumberInput className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={Number.isNaN(editingProduct.stock) ? '' : (editingProduct.stock ?? '')} onChangeValue={val => setEditingProduct({...editingProduct, stock: val})} /></div>
                                <div className="space-y-1 col-span-2"><InputLabel label="Código de Barras (EAN) *" /><input type="text" className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={editingProduct.barcode || ''} onChange={e => { const newEan = e.target.value; setEditingProduct({...editingProduct, barcode: newEan}); }} /></div>
                                <div className="space-y-1 col-span-2"><InputLabel label="Código Interno (Ref)" /><input type="text" className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={editingProduct.internalCode || ''} onChange={e => setEditingProduct({...editingProduct, internalCode: e.target.value})} /></div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-1"><InputLabel label="Nome do Produto *" /><div className="flex gap-2"><input type="text" className="flex-1 bg-gray-50 p-4 rounded-2xl font-bold border text-gray-900" value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} /><button onClick={handleAiInfo} disabled={isGeneratingInfo || !editingProduct.name} className="px-4 bg-brand text-brand-contrast rounded-2xl shadow-lg">{isGeneratingInfo ? <Loader2 className="animate-spin" size={20}/> : <Sparkles size={20}/>}</button></div></div>
                            <div className="space-y-1"><InputLabel label="Apresentação" /><input type="text" className="w-full bg-gray-50 p-4 rounded-2xl font-bold border text-gray-900" value={editingProduct.presentation || ''} onChange={e => setEditingProduct({...editingProduct, presentation: e.target.value})} placeholder="30 cápsulas, 500mg, etc." /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1 relative">
                                    <InputLabel label="Departamento Oficial" />
                                    <div className="relative">
                                        <select 
                                           className="w-full bg-gray-50 p-4 rounded-2xl font-bold border-2 border-transparent focus:bg-white focus:border-brand outline-none text-gray-900 appearance-none transition-all cursor-pointer"
                                           value={selectedDeptForEdit} 
                                           onChange={(e) => {
                                               const nextDept = e.target.value;
                                               setSelectedDeptForEdit(nextDept);
                                               const availableSubs = OFFICIAL_TAXONOMY[nextDept] || [];
                                               if (availableSubs.length > 0 && !availableSubs.includes(editingProduct.category || '')) {
                                                   setEditingProduct({...editingProduct, category: availableSubs[0]});
                                               }
                                           }}
                                        >
                                            {OFFICIAL_DEPARTMENTS.map(d => (
                                                <option key={d} value={d}>{d}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                                    </div>
                                </div>
                                <div className="space-y-1 relative">
                                    <InputLabel label="Subcategoria Oficial" />
                                    <div className="relative">
                                        <select 
                                            className="w-full bg-gray-50 p-4 rounded-2xl font-bold border-2 border-transparent focus:bg-white focus:border-brand outline-none text-gray-900 appearance-none transition-all cursor-pointer" 
                                            value={editingProduct.category || ''} 
                                            onChange={(e) => { 
                                                setEditingProduct({...editingProduct, category: e.target.value}); 
                                            }} 
                                        >
                                            <option value="" disabled>Selecione a subcategoria...</option>
                                            {(OFFICIAL_TAXONOMY[selectedDeptForEdit] || OFFICIAL_TAXONOMY['Medicamentos'] || []).map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1 relative"><InputLabel label="Fabricante" />{customManufacturerMode ? ( <div className="flex gap-2"><input autoFocus className="flex-1 bg-white p-4 rounded-2xl font-bold border-2 border-brand outline-none text-gray-900 transition-all" value={editingProduct.manufacturer} onChange={e => setEditingProduct({...editingProduct, manufacturer: e.target.value})} placeholder="Novo fabricante..." /><button onClick={() => setCustomManufacturerMode(false)} className="px-4 bg-gray-100 rounded-2xl text-gray-500 hover:bg-gray-200 font-bold"><X size={20}/></button></div> ) : ( <div className="relative"><select className="w-full bg-gray-50 p-4 rounded-2xl font-bold border-2 border-transparent focus:bg-white focus:border-brand outline-none text-gray-900 appearance-none transition-all cursor-pointer" value={editingProduct.manufacturer} onChange={(e) => { if (e.target.value === 'NEW_ENTRY') { setCustomManufacturerMode(true); setEditingProduct({...editingProduct, manufacturer: ''}); } else { setEditingProduct({...editingProduct, manufacturer: e.target.value}); } }} ><option value="" disabled>Selecione...</option><option value="Outros">Outros</option>{manufacturerOptions.filter(m => m !== 'Outros').map(m => <option key={m} value={m}>{m}</option>)}<option value="NEW_ENTRY" className="font-black text-brand">➕ Cadastrar Novo...</option></select><ChevronDown size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/></div> )}</div>
                                <div className="space-y-1"><InputLabel label="Princípio Ativo" /><input type="text" className="w-full bg-gray-50 p-4 rounded-2xl font-bold border text-gray-900" value={editingProduct.activePrinciple} onChange={e => setEditingProduct({...editingProduct, activePrinciple: e.target.value})} /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1 relative"><InputLabel label="Tipo (Legal)" />{customDrugTypeMode ? ( <div className="flex gap-2"><input autoFocus className="flex-1 bg-white p-4 rounded-2xl font-bold border-2 border-brand outline-none text-gray-900 transition-all" value={editingProduct.drugType} onChange={e => setEditingProduct({...editingProduct, drugType: e.target.value})} placeholder="Novo tipo..." /><button onClick={() => setCustomDrugTypeMode(false)} className="px-4 bg-gray-100 rounded-2xl text-gray-500 hover:bg-gray-200 font-bold"><X size={20}/></button></div> ) : ( <div className="relative"><select className="w-full bg-gray-50 p-4 rounded-2xl font-bold border-2 border-transparent focus:bg-white focus:border-brand outline-none text-gray-900 appearance-none transition-all cursor-pointer" value={editingProduct.drugType} onChange={(e) => { if (e.target.value === 'NEW_ENTRY') { setCustomDrugTypeMode(true); setEditingProduct({...editingProduct, drugType: ''}); } else { setEditingProduct({...editingProduct, drugType: e.target.value}); } }} ><option value="" disabled>Selecione...</option>{drugTypeOptions.map(c => <option key={c} value={c}>{c}</option>)}<option value="NEW_ENTRY" className="font-black text-brand">➕ Cadastrar Nova...</option></select><ChevronDown size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/></div> )}</div>
                                <div></div>
                            </div>
                            <div className="space-y-4">
                                <div className="space-y-1"><InputLabel label="Descrição Comercial" /><textarea rows={2} className="w-full bg-gray-50 p-4 rounded-2xl font-medium border resize-none text-gray-900" value={editingProduct.description} onChange={e => setEditingProduct({...editingProduct, description: e.target.value})} /></div>
                                <div className="space-y-1"><InputLabel label="Indicações" /><textarea rows={2} className="w-full bg-gray-50 p-4 rounded-2xl font-medium border resize-none text-gray-900" value={editingProduct.indications || ''} onChange={e => setEditingProduct({...editingProduct, indications: e.target.value})} /></div>
                                <div className="space-y-1"><InputLabel label="Modo de Uso" /><textarea rows={2} className="w-full bg-gray-50 p-4 rounded-2xl font-medium border resize-none text-gray-900" value={editingProduct.usage || ''} onChange={e => setEditingProduct({...editingProduct, usage: e.target.value})} /></div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1"><InputLabel label="Efeitos Colaterais" /><textarea rows={2} className="w-full bg-gray-50 p-4 rounded-2xl font-medium border resize-none text-gray-900" value={editingProduct.sideEffects || ''} onChange={e => setEditingProduct({...editingProduct, sideEffects: e.target.value})} /></div>
                                    <div className="space-y-1"><InputLabel label="Contraindicações" /><textarea rows={2} className="w-full bg-gray-50 p-4 rounded-2xl font-medium border resize-none text-gray-900" value={editingProduct.contraindications || ''} onChange={e => setEditingProduct({...editingProduct, contraindications: e.target.value})} /></div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 bg-purple-50 p-4 rounded-2xl border border-purple-100">
                                <div className="space-y-1 col-span-2"><h4 className="text-[10px] font-black uppercase text-purple-600 mb-2">Variações (Opcional)</h4></div>
                                <div className="space-y-1"><InputLabel label="Agrupador (Slug)" /><input type="text" className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={editingProduct.groupingSlug || ''} onChange={e => setEditingProduct({...editingProduct, groupingSlug: e.target.value})} placeholder="ex: fralda-huggies" /></div>
                                <div className="space-y-1"><InputLabel label="Atributo (Opção)" /><input type="text" className="w-full bg-white p-3 rounded-xl font-bold border text-gray-900" value={editingProduct.variantAttribute || ''} onChange={e => setEditingProduct({...editingProduct, variantAttribute: e.target.value})} placeholder="ex: Tamanho M, Morango" /></div>
                            </div>
                            <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 space-y-4">
                                <h4 className="text-[10px] font-black uppercase text-orange-400">Promoção</h4>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2">
                                        <input type="radio" checked={editingProduct.promotionType === 'NONE' || !editingProduct.promotionType} onChange={() => setEditingProduct({...editingProduct, promotionType: 'NONE'})}/> 
                                        <span className="text-xs font-bold text-gray-900">Nenhuma</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="radio" checked={editingProduct.promotionType === 'DISCOUNT'} onChange={() => setEditingProduct({...editingProduct, promotionType: 'DISCOUNT'})}/> 
                                        <span className="text-xs font-bold text-gray-900">Desconto</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="radio" checked={editingProduct.promotionType === 'BUY_X_PAY_Y'} onChange={() => setEditingProduct({...editingProduct, promotionType: 'BUY_X_PAY_Y'})}/> 
                                        <span className="text-xs font-bold text-gray-900">Kit</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input type="radio" checked={editingProduct.promotionType === 'DISCOUNT_ON_QTY'} onChange={() => setEditingProduct({...editingProduct, promotionType: 'DISCOUNT_ON_QTY'})}/> 
                                        <span className="text-xs font-bold text-gray-900">Desconto na Qtd</span>
                                    </label>
                                </div>
                                {editingProduct.promotionType === 'BUY_X_PAY_Y' && (
                                    <div className="flex gap-2">
                                        <SmartNumberInput placeholder="Leve" className="w-full p-2 rounded-xl border text-center font-bold text-gray-900" value={Number.isNaN(editingProduct.buyX) ? '' : (editingProduct.buyX ?? '')} onChangeValue={val => setEditingProduct({...editingProduct, buyX: val})}/> 
                                        <SmartNumberInput placeholder="Pague" className="w-full p-2 rounded-xl border text-center font-bold text-gray-900" value={Number.isNaN(editingProduct.payY) ? '' : (editingProduct.payY ?? '')} onChangeValue={val => setEditingProduct({...editingProduct, payY: val})}/>
                                    </div>
                                )}
                                {editingProduct.promotionType === 'DISCOUNT_ON_QTY' && (
                                    <div className="flex gap-2">
                                        <SmartNumberInput placeholder="A cada (Qtd)" className="w-full p-2 rounded-xl border text-center font-bold text-gray-900" value={Number.isNaN(editingProduct.discountQtyThreshold) ? '' : (editingProduct.discountQtyThreshold ?? '')} onChangeValue={val => setEditingProduct({...editingProduct, discountQtyThreshold: val})}/> 
                                        <SmartNumberInput placeholder="% Desconto na Unidade" isFloat={true} className="w-full p-2 rounded-xl border text-center font-bold text-gray-900" value={Number.isNaN(editingProduct.discountQtyPercentage) ? '' : (editingProduct.discountQtyPercentage ?? '')} onChangeValue={val => setEditingProduct({...editingProduct, discountQtyPercentage: val})}/>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="p-6 border-t bg-gray-50 flex justify-end gap-4 sticky bottom-0 z-10">
                        <button disabled={isSavingProduct} onClick={() => setEditingProduct(null)} className="px-8 py-4 font-black text-gray-500 uppercase text-xs disabled:opacity-50">Cancelar</button>
                        <button disabled={isSavingProduct} onClick={handleSaveProduct} className="px-10 py-4 bg-brand text-brand-contrast font-black text-sm rounded-2xl shadow-xl hover:brightness-110 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                            {isSavingProduct ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            {isSavingProduct ? "Salvando..." : "Salvar Item"}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Modal Fabricantes - RESTAURADO */}
        {isManagingLabLogos && (
            <div className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
                <div className="bg-white w-full rounded-[2rem] md:rounded-[3rem] p-6 md:p-10 flex flex-col max-h-[90vh] animate-in zoom-in-95 relative">
                    
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 md:mb-8 gap-4 shrink-0">
                        <div className="pr-12 md:pr-0">
                            <h3 className="text-xl md:text-2xl font-black uppercase text-gray-900">Laboratórios e Logos</h3>
                            <p className="text-xs font-bold text-gray-400">Gerencie marcas e identidades visuais.</p>
                        </div>
                        
                        <div className="flex items-center gap-3 w-full md:w-auto">
                            <button 
                                onClick={() => setShowManufacturerImport(!showManufacturerImport)}
                                className="flex-1 md:flex-none flex items-center justify-center gap-2 px-6 py-3 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-black uppercase hover:bg-emerald-100 transition-all border border-emerald-100"
                            >
                                <FileSpreadsheet size={16}/> <span className="whitespace-nowrap">Importar Fabricantes</span>
                            </button>
                            <button onClick={() => setIsManagingLabLogos(false)} className="hidden md:block p-2 bg-gray-50 rounded-full text-gray-400 hover:text-red-500 transition-all"><X size={24}/></button>
                        </div>
                    </div>

                    {showManufacturerImport && (
                        <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 mb-8 animate-in slide-in-from-top-4 duration-200">
                            <div className="flex justify-between items-center mb-4">
                                <h4 className="font-black text-gray-900 text-sm">Importação de Fabricantes</h4>
                                <div className="flex bg-white p-1 rounded-xl border border-gray-100">
                                    <button 
                                        type="button"
                                        onClick={() => setManufacturerImportMethod('file')} 
                                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${manufacturerImportMethod === 'file' ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        📁 Arquivo
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setManufacturerImportMethod('paste')} 
                                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${manufacturerImportMethod === 'paste' ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        📋 Copiar & Colar
                                    </button>
                                </div>
                            </div>

                            {manufacturerImportMethod === 'file' ? (
                                <div className="space-y-3">
                                    <p className="text-xs text-gray-500 leading-relaxed">
                                        Selecione um arquivo Excel ou CSV com as colunas <strong className="text-gray-700">Fabricante</strong> (ou Nome/nome) e opcionalmente <strong className="text-gray-700">Imagem</strong> (ou Logo/logo).
                                    </p>
                                    <button 
                                        type="button"
                                        onClick={() => importManufacturersRef.current?.click()}
                                        className="w-full py-4 bg-gray-900 text-white rounded-2xl text-xs font-black uppercase hover:bg-black transition-all flex items-center justify-center gap-2"
                                    >
                                        <Upload size={16}/> Selecionar Arquivo Excel ou CSV
                                    </button>
                                    <input type="file" ref={importManufacturersRef} className="hidden" accept=".xlsx,.xls,.csv" onChange={processManufacturerImport} />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <p className="text-xs text-gray-500 leading-relaxed">
                                        Copie as colunas da sua planilha contendo os cabeçalhos <strong className="text-gray-700">Fabricante</strong> (ou Name) e cole abaixo:
                                    </p>
                                    <textarea
                                        value={pastedManufacturersText}
                                        onChange={(e) => setPastedManufacturersText(e.target.value)}
                                        placeholder="Cole as colunas copiadas (Fabricante, Imagem) aqui..."
                                        className="w-full h-32 p-3 text-xs font-mono bg-white border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all resize-none"
                                    />
                                    <button 
                                        type="button"
                                        onClick={importPastedManufacturers} 
                                        className="w-full py-4 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg shadow-emerald-50 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                                    >
                                        <CheckCircle2 size={16} /> Processar Dados Colados
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <button 
                        onClick={() => setIsManagingLabLogos(false)} 
                        className="md:hidden absolute top-6 right-6 p-2 bg-gray-100 rounded-full text-gray-500 hover:text-red-500 z-10"
                    >
                        <X size={24}/>
                    </button>

                    <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-8 border-b pb-8">
                            <div className="space-y-4"><InputLabel label="Nome do Lab" /><input className="w-full bg-gray-50 p-4 rounded-2xl border font-bold text-gray-900" value={newLabLogo.name} onChange={e => setNewLabLogo({...newLabLogo, name: e.target.value})} /></div>
                            <div className="space-y-4">
                                <InputLabel label="Logo (Aparece em Genéricos)" />
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <button onClick={() => labLogoFileRef.current?.click()} className="flex-1 bg-gray-50 p-4 rounded-2xl border-2 border-dashed font-bold flex items-center justify-center gap-2 text-gray-600"><Upload size={18}/> {newLabLogo.logo ? 'Alterar' : 'Upload'}</button>
                                    <input type="file" ref={labLogoFileRef} className="hidden" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if(f){ const r = new FileReader(); r.onload=(ev)=>setNewLabLogo({...newLabLogo, logo: ev.target?.result as string}); r.readAsDataURL(f); } }} />
                                    {newLabLogo.originalName && (
                                        <button onClick={() => setNewLabLogo({ name: '', logo: '' })} className="bg-gray-200 text-gray-600 px-6 py-4 rounded-2xl font-black uppercase text-xs w-full sm:w-auto">Cancelar</button>
                                    )}
                                    <button onClick={handleSaveManufacturer} className="bg-black text-white px-8 py-4 rounded-2xl font-black uppercase text-xs w-full sm:w-auto">{newLabLogo.originalName ? 'Salvar' : 'Adicionar'}</button>
                                </div>
                            </div>
                        </div>

                        <div className="mb-8 border-b pb-8">
                            <div className="flex items-center gap-2 mb-4">
                                <Factory size={20} className="text-brand" />
                                <h4 className="text-lg font-black uppercase text-gray-900">Mesclar Laboratórios</h4>
                            </div>
                            <p className="text-xs text-gray-500 mb-4">Selecione um laboratório para mesclar em outro. Todos os produtos serão atualizados e uma regra de sinônimo será criada para futuras importações.</p>
                            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-4 items-end">
                                <div className="space-y-2">
                                    <InputLabel label="De (Origem)" />
                                    <select className="w-full bg-gray-50 p-4 rounded-2xl border font-bold text-gray-900" value={mergeSource} onChange={e => setMergeSource(e.target.value)}>
                                        <option value="">Selecione...</option>
                                        {manufacturerOptions.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                <div className="hidden md:flex items-center justify-center pb-4 text-gray-400">
                                    <ArrowRight size={24} />
                                </div>
                                <div className="space-y-2">
                                    <InputLabel label="Para (Destino)" />
                                    <select className="w-full bg-gray-50 p-4 rounded-2xl border font-bold text-gray-900" value={mergeTarget} onChange={e => setMergeTarget(e.target.value)}>
                                        <option value="">Selecione...</option>
                                        {manufacturerOptions.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                <button 
                                    onClick={handleMergeManufacturers}
                                    disabled={!mergeSource || !mergeTarget || mergeSource === mergeTarget}
                                    className="bg-brand text-brand-contrast px-8 py-4 rounded-2xl font-black uppercase text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Mesclar
                                </button>
                            </div>
                            
                            {tenant.manufacturerSynonyms && Object.keys(tenant.manufacturerSynonyms).length > 0 && (
                                <div className="mt-6">
                                    <InputLabel label="Regras de Sinônimos Ativas" />
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {Object.entries(tenant.manufacturerSynonyms).map(([synonym, target]) => (
                                            <div key={synonym} className="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600">
                                                <span>"{synonym}" <ArrowRight size={10} className="inline mx-1" /> {target}</span>
                                                <button 
                                                    onClick={async () => {
                                                        if (!confirm(`Remover regra de sinônimo para "${synonym}"?`)) return;
                                                        const newSynonyms = { ...tenant.manufacturerSynonyms };
                                                        delete newSynonyms[synonym];
                                                        await onTenantUpdate({ ...tenant, manufacturerSynonyms: newSynonyms });
                                                    }}
                                                    className="text-gray-400 hover:text-red-500 ml-1"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {managedManufacturers.map(m => (
                                <div key={m} className="bg-gray-50 p-4 rounded-2xl border flex flex-col items-center gap-3 group relative cursor-pointer hover:border-black transition-colors" onClick={() => setNewLabLogo({ name: m, logo: tenant.manufacturerLogos?.[m] || '', originalName: m })}>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteManufacturer(m); }} className="absolute top-2 right-2 p-1.5 bg-white text-gray-400 hover:text-red-500 rounded-lg shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><Trash2 size={14}/></button>
                                    <div className="h-12 w-full flex items-center justify-center">{tenant.manufacturerLogos?.[m] ? <img src={fixImageUrl(tenant.manufacturerLogos[m])!} className="h-full object-contain" referrerPolicy="no-referrer" /> : <Factory className="text-gray-200" size={24}/>}</div>
                                    <span className="text-[10px] font-black uppercase text-center truncate w-full text-gray-900">{m}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Modal Venda Balcão - RESTAURADO */}
        {isPhysicalSaleOpen && (
            <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-orange-100 text-orange-600 rounded-xl"><Store size={24}/></div>
                            <div>
                                <h3 className="text-xl font-black text-gray-900">Venda Balcão</h3>
                                <p className="text-xs font-bold text-gray-400">Baixa rápida de estoque</p>
                            </div>
                        </div>
                        <button onClick={() => setIsPhysicalSaleOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500"><X size={20}/></button>
                    </div>

                    <div className="space-y-6">
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input 
                                autoFocus
                                type="text" 
                                placeholder="Buscar produto..." 
                                className="w-full pl-12 pr-12 py-4 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-orange-500 rounded-2xl outline-none font-bold text-gray-900 transition-all"
                                value={physicalSaleSearch}
                                onChange={e => setPhysicalSaleSearch(e.target.value)}
                            />
                            <button 
                                onClick={() => setScannerTarget('PDV')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-xl transition-all"
                                title="Escanear Código de Barras"
                            >
                                <ScanLine size={18} />
                            </button>
                        </div>

                        {physicalSaleResults.length > 0 && !selectedPhysicalProduct && (
                            <div className="max-h-60 overflow-y-auto space-y-2 border border-gray-100 rounded-2xl p-2">
                                {physicalSaleResults.map(p => (
                                    <button 
                                        key={p.id} 
                                        onClick={() => setSelectedPhysicalProduct(p)}
                                        className="w-full text-left p-3 hover:bg-gray-50 rounded-xl flex items-center justify-between group transition-colors"
                                    >
                                        <div>
                                            <p className="font-black text-sm text-gray-900">{p.name}</p>
                                            <p className="text-[10px] font-bold text-gray-400">Estoque: {p.stock}</p>
                                        </div>
                                        <Plus size={16} className="text-gray-300 group-hover:text-orange-500"/>
                                    </button>
                                ))}
                            </div>
                        )}

                        {selectedPhysicalProduct && (
                            <div className="bg-orange-50 p-6 rounded-3xl border border-orange-100 space-y-4 animate-in fade-in">
                                <div>
                                    <p className="text-[10px] font-black uppercase text-orange-400 tracking-widest">Produto Selecionado</p>
                                    <p className="font-black text-lg text-gray-900 leading-tight">{selectedPhysicalProduct.name}</p>
                                    <p className="text-xs font-bold text-gray-500 mt-1">Atual: {selectedPhysicalProduct.stock} un</p>
                                </div>
                                <div className="flex items-center gap-4 bg-white p-2 rounded-2xl border border-orange-100 w-fit">
                                    <button onClick={() => setPhysicalSaleQty(Math.max(1, physicalSaleQty - 1))} className="p-3 bg-gray-50 hover:bg-gray-100 rounded-xl"><Minus size={16}/></button>
                                    <span className="font-black text-xl w-8 text-center text-gray-900">{physicalSaleQty}</span>
                                    <button onClick={() => setPhysicalSaleQty(physicalSaleQty + 1)} className="p-3 bg-gray-900 text-white hover:bg-gray-800 rounded-xl"><Plus size={16}/></button>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => setSelectedPhysicalProduct(null)} className="flex-1 py-3 bg-white border border-orange-200 text-orange-600 font-bold rounded-xl text-xs uppercase">Trocar</button>
                                    <button onClick={handleConfirmPhysicalSale} className="flex-[2] py-3 bg-orange-600 text-white font-black rounded-xl text-xs uppercase shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all">Confirmar Baixa</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {isDepartmentManagerOpen && (
            <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-[90vw] h-[90vh] rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 overflow-y-auto relative">
                    <button onClick={() => setIsDepartmentManagerOpen(false)} className="absolute top-10 right-10 p-2 bg-gray-50 rounded-full hover:bg-gray-100 hover:text-red-500 z-10">
                        <X size={24}/>
                    </button>
                    <AdminDepartmentManager tenant={tenant} onTenantUpdate={onTenantUpdate} products={products} onProductsUpdate={onProductsUpdate} />
                </div>
            </div>
        )}

        {isImportModalOpen && (
            <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-2xl rounded-[3rem] p-10 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                    <div className="flex justify-between items-center mb-8"><div><h3 className="text-2xl font-black text-gray-900">Importação & Estoque</h3><p className="text-sm font-bold text-gray-400">Atualize seu catálogo via Excel ou CSV</p></div><button onClick={() => setIsImportModalOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500"><X size={24}/></button></div>
                    {!auditReport ? (
                        <div className="space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className={`p-6 rounded-3xl border-2 cursor-pointer transition-all ${importType === 'simple' ? 'border-emerald-500 bg-emerald-50' : 'border-gray-100 hover:border-emerald-200'}`} onClick={() => setImportType('simple')}><FileSpreadsheet className={`mb-3 ${importType === 'simple' ? 'text-emerald-600' : 'text-gray-400'}`} size={32}/><h4 className="font-black text-gray-900">Importação Rápida</h4><p className="text-xs font-medium text-gray-500 mt-1 leading-relaxed">Atualiza preços e estoque instantaneamente.</p></div>
                                <div className={`p-6 rounded-3xl border-2 cursor-pointer transition-all ${importType === 'ai' ? 'border-purple-500 bg-purple-50' : 'border-gray-100 hover:border-purple-200'}`} onClick={() => setImportType('ai')}><Sparkles className={`mb-3 ${importType === 'ai' ? 'text-purple-600' : 'text-gray-400'}`} size={32}/><h4 className="font-black text-gray-900">Enriquecer com IA</h4><p className="text-xs font-medium text-gray-500 mt-1 leading-relaxed">Completa descrições e dados técnicos automaticamente.</p></div>
                            </div>
                            <div className="space-y-3"><label className="text-xs font-black uppercase text-gray-400 tracking-widest ml-2">Modo de Estoque</label><div className="flex bg-gray-50 p-1.5 rounded-2xl">{['ADD', 'SET', 'SUBTRACT'].map(mode => (<button key={mode} onClick={() => setImportStockMode(mode as any)} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${importStockMode === mode ? 'bg-white shadow-md text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}>{mode === 'ADD' ? 'Somar (+)' : mode === 'SET' ? 'Substituir (=)' : 'Baixar (-)'}</button>))}</div></div>
                            
                            <div className="space-y-3"><label className="text-xs font-black uppercase text-gray-400 tracking-widest ml-2">Modo de Importação</label><div className="flex bg-gray-50 p-1.5 rounded-2xl">{['UPDATE', 'REPLACE'].map(mode => (<button key={mode} onClick={() => setImportMode(mode as any)} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${importMode === mode ? 'bg-white shadow-md text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}>{mode === 'UPDATE' ? 'Atualizar Existentes' : 'Substituir Catálogo (Apagar não listados)'}</button>))}</div></div>

                            {importType === 'ai' && (
                                <div className="space-y-3">
                                    <label className="text-xs font-black uppercase text-gray-400 tracking-widest ml-2">Sobrescrever Dados Existentes</label>
                                    <div className="flex items-center gap-3 bg-gray-50 p-4 rounded-2xl cursor-pointer" onClick={() => setOverwriteExistingData(!overwriteExistingData)}>
                                        <div className={`w-6 h-6 rounded-md flex items-center justify-center border-2 transition-all ${overwriteExistingData ? 'bg-purple-500 border-purple-500 text-white' : 'border-gray-300 bg-white'}`}>
                                            {overwriteExistingData && <CheckCircle2 size={16} />}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-gray-900">Atualizar produtos completos</p>
                                            <p className="text-[10px] font-medium text-gray-500">Se desmarcado, a IA só processará itens com dados faltando.</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-3">
                                <label className="text-xs font-black uppercase text-gray-400 tracking-widest ml-2">Proteção de Imagens</label>
                                <div className="flex items-center gap-3 bg-amber-50 p-4 rounded-2xl cursor-pointer border border-amber-100" onClick={() => setPreserveImagesOnImport(!preserveImagesOnImport)}>
                                    <div className={`w-6 h-6 rounded-md flex items-center justify-center border-2 transition-all ${preserveImagesOnImport ? 'bg-amber-500 border-amber-500 text-white' : 'border-amber-300 bg-white'}`}>
                                        {preserveImagesOnImport && <CheckCircle2 size={16} />}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-amber-900">⚠️ Preservar fotos existentes (não atualizar imagens)</p>
                                        <p className="text-[10px] font-medium text-amber-700">Se marcado, ignora qualquer dado de imagem da planilha.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4">
                                <label className="text-xs font-black uppercase text-gray-400 tracking-widest ml-2 block mb-3">Método de Entrada</label>
                                <div className="flex bg-gray-50 p-1.5 rounded-2xl mb-6 border border-gray-100">
                                    <button 
                                        type="button"
                                        onClick={() => setImportMethod('file')} 
                                        className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${importMethod === 'file' ? 'bg-white shadow-md text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        📁 Enviar Arquivo
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setImportMethod('paste')} 
                                        className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${importMethod === 'paste' ? 'bg-white shadow-md text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                                    >
                                        📋 Copiar & Colar
                                    </button>
                                </div>

                                {importMethod === 'paste' ? (
                                    <div className="space-y-4 animate-in fade-in duration-200">
                                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-2">
                                            <p className="text-xs font-bold text-gray-700">💡 Como usar:</p>
                                            <p className="text-[10px] text-gray-500 mt-1">1. No Excel ou Google Sheets, selecione os dados (linhas e colunas, incluindo os cabeçalhos como Nome, Preço, Estoque, EAN).</p>
                                            <p className="text-[10px] text-gray-500">2. Copie (Ctrl+C), clique na caixa abaixo e cole (Ctrl+V).</p>
                                        </div>
                                        <textarea
                                            value={pastedText}
                                            onChange={(e) => setPastedText(e.target.value)}
                                            placeholder="Cole as colunas copiadas da planilha aqui..."
                                            className="w-full h-44 p-4 text-xs font-mono bg-gray-50 border border-gray-200 rounded-3xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all resize-none"
                                        />
                                        <button 
                                            type="button"
                                            onClick={importPastedProducts} 
                                            disabled={isImporting}
                                            className="w-full py-6 bg-emerald-600 text-white rounded-3xl font-black text-lg shadow-xl shadow-emerald-100 hover:bg-emerald-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                                        >
                                            {isImporting ? <Loader2 className="animate-spin" size={24} /> : <CheckCircle2 size={24} />} 
                                            Processar Dados Colados
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        {isImporting ? ( 
                                            <div className="bg-gray-50 rounded-3xl p-8 flex flex-col items-center justify-center text-center">
                                                <Loader2 size={40} className="animate-spin text-emerald-600 mb-4" />
                                                <h4 className="font-black text-xl text-gray-900">Processando...</h4>
                                                <p className="text-gray-500 font-bold text-sm mt-2">{importProgress}% concluído</p>
                                                <div className="w-full bg-gray-200 rounded-full h-2 mt-4 overflow-hidden">
                                                    <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${importProgress}%` }}></div>
                                                </div>
                                                <p className="text-[10px] text-gray-400 mt-4 uppercase font-black">Não feche esta janela durante a análise</p>
                                            </div> 
                                        ) : ( 
                                            <button 
                                                type="button"
                                                onClick={() => importProductsRef.current?.click()} 
                                                className="w-full py-6 bg-gray-900 text-white rounded-3xl font-black text-lg shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3"
                                            >
                                                <Upload size={24} /> Selecionar Arquivo Excel ou CSV
                                            </button> 
                                        )}
                                    </div>
                                )}
                            </div>
                            <input type="file" ref={importProductsRef} className="hidden" accept=".xlsx,.xls,.csv" onChange={importBackupStream} />

                            {imageSnapshot && Object.keys(imageSnapshot).length > 0 && !isImporting && (
                                <div className="pt-4 border-t border-gray-100">
                                    <button 
                                        onClick={handleRestoreImages}
                                        className="w-full py-4 bg-white border-2 border-amber-200 text-amber-700 rounded-2xl font-bold text-sm hover:bg-amber-50 transition-all flex items-center justify-center gap-2"
                                    >
                                        <RotateCcw size={18} />
                                        Restaurar Imagens da Última Importação
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-3xl flex items-center gap-4"><div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm"><CheckCircle2 size={24}/></div><div><h4 className="font-black text-emerald-900 text-lg">Processamento Concluído!</h4><p className="text-emerald-700 font-bold text-sm">{auditReport.length} itens processados.</p></div></div>
                            
                            {importSummary && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-gray-50 p-4 rounded-2xl">
                                        <p className="text-[10px] font-black uppercase text-gray-400">Total de Itens</p>
                                        <p className="text-2xl font-black text-gray-900">{importSummary.totalItems}</p>
                                    </div>
                                    <div className="bg-purple-50 p-4 rounded-2xl">
                                        <p className="text-[10px] font-black uppercase text-purple-400">Itens Enriquecidos</p>
                                        <p className="text-2xl font-black text-purple-900">{importSummary.enrichedItems}</p>
                                    </div>
                                    <div className="bg-emerald-50 p-4 rounded-2xl">
                                        <p className="text-[10px] font-black uppercase text-emerald-400">Imagens Validadas</p>
                                        <p className="text-2xl font-black text-emerald-900">{importSummary.imagesValidated}</p>
                                    </div>
                                    <div className="bg-blue-50 p-4 rounded-2xl">
                                        <p className="text-[10px] font-black uppercase text-blue-400">Novas Buscas de Imagem</p>
                                        <p className="text-2xl font-black text-blue-900">{importSummary.newImageSearches}</p>
                                    </div>
                                    {importSummary.ignoredItems > 0 && (
                                        <div className="col-span-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                            <p className="text-[10px] font-black uppercase text-gray-400">Itens Ignorados (Já Completos)</p>
                                            <p className="text-2xl font-black text-gray-900">{importSummary.ignoredItems}</p>
                                        </div>
                                    )}
                                    {importSummary.tokensSaved > 0 && (
                                        <div className="col-span-2 bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                                            <p className="text-[10px] font-black uppercase text-emerald-600">Economia Gerada (Tokens Poupados)</p>
                                            <p className="text-2xl font-black text-emerald-900">~{importSummary.tokensSaved.toLocaleString()}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="max-h-[300px] overflow-y-auto border border-gray-100 rounded-2xl"><table className="w-full text-left"><thead className="bg-gray-50 text-[10px] font-black uppercase text-gray-400 sticky top-0"><tr><th className="p-3">Produto</th><th className="p-3">Status</th><th className="p-3">Detalhes</th></tr></thead><tbody className="text-xs font-medium text-gray-600">{auditReport.slice(0, 500).map((item, idx) => (<tr key={idx} className="border-t border-gray-50"><td className="p-3 font-bold text-gray-900">{item.name}</td><td className="p-3"><span className={`px-2 py-1 rounded-md text-[9px] font-black uppercase ${item.status === 'created' ? 'bg-blue-50 text-blue-600' : item.status === 'updated' ? 'bg-emerald-50 text-emerald-600' : item.status === 'deleted' ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-400'}`}>{item.status === 'created' ? 'Novo' : item.status === 'updated' ? 'Atualizado' : item.status === 'deleted' ? 'Removido' : 'Ignorado'}</span></td><td className="p-3 text-gray-400">{item.details}</td></tr>))}{auditReport.length > 500 && (<tr className="border-t border-gray-50 bg-gray-50"><td colSpan={3} className="p-4 text-center text-gray-500 font-bold text-sm">+ {auditReport.length - 500} outros itens processados (ocultos para melhor performance)</td></tr>)}</tbody></table></div><button onClick={() => { setAuditReport(null); setIsImportModalOpen(false); setImportSummary(null); }} className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Fechar Relatório</button></div>
                    )}
                </div>
            </div>
        )}

        {/* Notificação de Processamento de IA em Background */}
        {aiJobProgress && (
            <div className={`fixed bottom-6 right-6 z-50 bg-white rounded-3xl shadow-2xl border border-gray-100 p-6 w-80 animate-in slide-in-from-bottom-5 transition-all duration-300`}>
                <div className="flex items-center gap-4 mb-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${aiJobProgress.processed < aiJobProgress.total ? 'bg-purple-100 text-purple-600' : 'bg-emerald-100 text-emerald-600'}`}>
                        {aiJobProgress.processed < aiJobProgress.total ? (
                            <Loader2 size={24} className="animate-spin" />
                        ) : (
                            <CheckCircle2 size={24} />
                        )}
                    </div>
                    <div>
                        <h4 className="font-black text-gray-900 text-sm leading-tight">
                            {aiJobProgress.processed < aiJobProgress.total ? 'Enriquecendo Metadados...' : 'Metadados Concluídos'}
                        </h4>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
                            {aiJobProgress.processed} de {aiJobProgress.total} itens
                        </p>
                    </div>
                </div>
                
                <div className="w-full bg-gray-100 rounded-full h-2 mb-5 overflow-hidden">
                    <div 
                        className="bg-purple-600 h-full transition-all duration-500 ease-out" 
                        style={{ width: `${(aiJobProgress.processed / aiJobProgress.total) * 100}%` }}
                    />
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100">
                        <span className="block text-[8px] font-black text-emerald-400 uppercase tracking-widest mb-1">Sucesso</span>
                        <span className="text-lg font-black text-emerald-600">{aiJobProgress.report.processed}</span>
                    </div>
                    <div className="bg-red-50 p-3 rounded-2xl border border-red-100">
                        <span className="block text-[8px] font-black text-red-400 uppercase tracking-widest mb-1">Falhas</span>
                        <span className="text-lg font-black text-red-600">{aiJobProgress.report.failed}</span>
                    </div>
                </div>
            </div>
        )}

        {scannerTarget && (
            <ProductScanner 
                onScan={handleBarcodeScan} 
                onClose={() => setScannerTarget(null)} 
            />
        )}

        {isBulkCategoryModalOpen && (
            <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                                <Package size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-gray-900 leading-tight">Mover Produtos</h3>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{selectedProducts.size} produtos selecionados</p>
                            </div>
                        </div>
                        <button onClick={() => setIsBulkCategoryModalOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500 transition-colors">
                            <X size={24}/>
                        </button>
                    </div>

                    <div className="space-y-4 mb-8">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1">Para o Departamento:</label>
                            <div className="relative">
                                <Select
                                    options={OFFICIAL_DEPARTMENTS.map(d => ({ value: d, label: d }))}
                                    value={{ value: bulkSelectedDepartment, label: bulkSelectedDepartment }}
                                    onChange={(s: any) => {
                                        setBulkSelectedDepartment(s.value);
                                        const subs = OFFICIAL_TAXONOMY[s.value] || [];
                                        setBulkSelectedCategory(subs.length > 0 ? subs[0] : '');
                                    }}
                                    styles={customSelectStyles}
                                    placeholder="Departamento"
                                    className="w-full"
                                    menuPlacement="auto"
                                    menuPosition="fixed"
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-gray-400 tracking-widest ml-1">Nova Subcategoria:</label>
                            <div className="relative">
                                <Select
                                    options={(OFFICIAL_TAXONOMY[bulkSelectedDepartment] || []).map(c => ({ value: c, label: c }))}
                                    value={bulkSelectedCategory ? { value: bulkSelectedCategory, label: bulkSelectedCategory } : null}
                                    onChange={(s: any) => {
                                        setBulkSelectedCategory(s.value);
                                    }}
                                    styles={customSelectStyles}
                                    isSearchable
                                    placeholder="Selecione a Subcategoria Oficial"
                                    className="w-full"
                                    menuPlacement="auto"
                                    menuPosition="fixed"
                                />
                            </div>
                        </div>
                    </div>

                    <button 
                        disabled={isUpdatingBulkCategory || !bulkSelectedCategory}
                        onClick={confirmBulkCategory}
                        className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-blue-200 flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isUpdatingBulkCategory ? <Loader2 size={24} className="animate-spin" /> : <Save size={24} />}
                        {isUpdatingBulkCategory ? 'Movendo...' : 'Confirmar'}
                    </button>
                </div>
            </div>
        )}

        {isBulkPrescriptionModalOpen && (
            <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95 flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
                                <AlertCircle size={24} />
                            </div>
                            <div>
                                <h3 className="text-xl font-black text-gray-900 leading-tight">Status de Receita</h3>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{selectedProducts.size} produtos selecionados</p>
                            </div>
                        </div>
                        <button onClick={() => setIsBulkPrescriptionModalOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500 transition-colors">
                            <X size={24}/>
                        </button>
                    </div>

                    <p className="text-sm font-medium text-gray-600 mb-8">
                        Selecione a ação desejada para os produtos selecionados. Essa alteração será aplicada imediatamente e pode afetar as regras de venda no PDV.
                    </p>

                    <div className="flex flex-col gap-4">
                        <button 
                            disabled={isUpdatingBulkPrescription}
                            onClick={() => confirmBulkPrescription('REQUIRE')}
                            className="w-full relative group overflow-hidden bg-amber-50 hover:bg-amber-100 border border-amber-200 p-6 rounded-3xl transition-all text-left flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div className="w-12 h-12 shrink-0 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                                <FileText size={24} className="text-amber-500" />
                            </div>
                            <div className="flex-1">
                                <h4 className="text-base font-black text-amber-900">Exigir Receita</h4>
                                <p className="text-xs font-medium text-amber-700/70 mt-1">
                                    Venda bloqueada no PDV sem receituário médico
                                </p>
                            </div>
                            {isUpdatingBulkPrescription && bulkPrescriptionAction === 'REQUIRE' && (
                                <Loader2 size={24} className="text-amber-500 animate-spin" />
                            )}
                        </button>

                        <button 
                            disabled={isUpdatingBulkPrescription}
                            onClick={() => confirmBulkPrescription('REMOVE')}
                            className="w-full relative group overflow-hidden bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 p-6 rounded-3xl transition-all text-left flex items-center gap-4 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <div className="w-12 h-12 shrink-0 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                                <CheckCircle2 size={24} className="text-emerald-500" />
                            </div>
                            <div className="flex-1">
                                <h4 className="text-base font-black text-emerald-900">Remover Exigência</h4>
                                <p className="text-xs font-medium text-emerald-700/70 mt-1">
                                    Permitir venda livre (OTC) sem prescrição
                                </p>
                            </div>
                            {isUpdatingBulkPrescription && bulkPrescriptionAction === 'REMOVE' && (
                                <Loader2 size={24} className="text-emerald-500 animate-spin" />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Floating Bar for Flyer Generation */}
        {selectedProducts.size > 0 && (
            <div className="fixed bottom-6 right-6 md:right-8 z-[60] bg-white rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] border p-3 border-gray-100 transition-all flex items-center justify-between gap-4 md:gap-6 w-[calc(100%-48px)] md:w-auto md:min-w-[400px]">
                <div className="flex flex-col pl-2">
                    <span className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-widest mb-0.5">Ações em Massa</span>
                    <div className="flex items-center gap-2">
                        <span className={`text-base md:text-lg font-black ${selectedProducts.size > MAX_FLYER_ITEMS ? 'text-amber-600' : selectedProducts.size === MAX_FLYER_ITEMS ? 'text-green-600' : 'text-blue-600'}`}>
                            {selectedProducts.size}
                        </span>
                        <span className="text-sm font-bold text-gray-700">selecionados</span>
                    </div>
                </div>
                <button
                    onClick={handleGenerateFlyer}
                    disabled={selectedProducts.size === 0}
                    className={`shrink-0 px-5 py-3 md:px-6 md:py-3.5 rounded-xl font-black text-xs uppercase tracking-wide flex items-center justify-center gap-2 transition-all shadow-md active:scale-95
                    ${selectedProducts.size > MAX_FLYER_ITEMS ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30' : selectedProducts.size === MAX_FLYER_ITEMS ? 'bg-green-600 hover:bg-green-700 text-white shadow-green-600/30' : 'bg-purple-600 hover:bg-purple-700 text-white shadow-purple-600/30'}`}
                >
                    <FileImage size={18} />
                    {selectedProducts.size > MAX_FLYER_ITEMS ? `Gerar Encarte (Max 12)` : `Gerar Encarte (${selectedProducts.size}/${MAX_FLYER_ITEMS})`}
                </button>
            </div>
        )}
        {/* Bulk Featured Products Modal */}
        {isBulkFeaturedModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isProcessingBulkFeatured && setIsBulkFeaturedModalOpen(false)}></div>
                <div className="relative bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                    <div className="p-6 md:p-8 flex items-center justify-between border-b border-gray-100 bg-gray-50/50">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center shadow-inner">
                                <Star size={24} fill="currentColor" />
                            </div>
                            <div>
                                <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Distribuição de Destaques em Massa</h2>
                                <p className="text-xs md:text-sm font-bold text-gray-500">Defina os {selectedProducts.size} produtos selecionados como Destaque em várias filiais de uma só vez.</p>
                            </div>
                        </div>
                        <button onClick={() => !isProcessingBulkFeatured && setIsBulkFeaturedModalOpen(false)} className="p-3 bg-white rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all border border-gray-100 shadow-sm">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-6 md:p-8 overflow-y-auto flex-1">
                        {isProcessingBulkFeatured ? (
                            <div className="bg-gray-50 rounded-3xl p-8 flex flex-col items-center justify-center text-center my-4">
                                <Loader2 size={40} className="animate-spin text-purple-600 mb-4" />
                                <h4 className="font-black text-xl text-gray-900">Aplicando Destaques...</h4>
                                <p className="text-gray-500 font-bold text-sm mt-2">{bulkFeaturedProgress}% concluído</p>
                                <div className="w-full bg-gray-200 rounded-full h-2 mt-4 overflow-hidden max-w-md">
                                    <div className="bg-purple-500 h-full transition-all duration-300" style={{ width: `${bulkFeaturedProgress}%` }}></div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-4 uppercase font-black">Por favor, não feche esta janela.</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="bg-purple-50 border border-purple-100 p-4 rounded-2xl flex items-center gap-3">
                                    <AlertCircle size={20} className="text-purple-600 shrink-0" />
                                    <p className="text-xs md:text-sm font-bold text-purple-900">
                                        Os produtos selecionados na Matriz serão pareados nas filiais escolhidas usando o código de barras (EAN) ou código interno e definidos como <span className="font-black underline">Destaques</span> na vitrine online.
                                    </p>
                                </div>

                                <div className="space-y-3 bg-gray-50 border border-gray-100 p-5 rounded-2xl">
                                    <h3 className="text-xs font-black uppercase text-gray-400 tracking-widest">Modo de Distribuição</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <label className={`flex items-start gap-3 p-4 bg-white border rounded-xl cursor-pointer transition-all ${bulkFeaturedMode === 'append' ? 'border-purple-600 ring-1 ring-purple-100 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
                                            <input 
                                                type="radio" 
                                                name="bulkFeaturedMode"
                                                value="append"
                                                checked={bulkFeaturedMode === 'append'}
                                                onChange={() => setBulkFeaturedMode('append')}
                                                className="mt-0.5 w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-xs font-black text-gray-800 uppercase tracking-tight">Adicionar aos destaques atuais (Modo Incremental)</span>
                                                <span className="text-[11px] font-bold text-gray-500 mt-0.5">Mantém os destaques atuais das filiais e apenas adiciona os novos produtos.</span>
                                            </div>
                                        </label>
                                        <label className={`flex items-start gap-3 p-4 bg-white border rounded-xl cursor-pointer transition-all ${bulkFeaturedMode === 'replace' ? 'border-purple-600 ring-1 ring-purple-100 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}>
                                            <input 
                                                type="radio" 
                                                name="bulkFeaturedMode"
                                                value="replace"
                                                checked={bulkFeaturedMode === 'replace'}
                                                onChange={() => setBulkFeaturedMode('replace')}
                                                className="mt-0.5 w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-xs font-black text-gray-800 uppercase tracking-tight">Substituir destaques atuais (Modo Sobrescrever)</span>
                                                <span className="text-[11px] font-bold text-gray-500 mt-0.5">Remove TODOS os destaques atuais das filiais e define apenas os novos produtos selecionados.</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-xs font-black uppercase text-gray-400 tracking-widest">Filiais Alvo</h3>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => setSelectedBulkFeaturedBranches(new Set(bulkFeaturedBranches.map(b => b.id)))}
                                                className="text-[10px] font-black uppercase tracking-wider text-purple-600 hover:text-purple-800 transition-colors"
                                            >
                                                Marcar Todas
                                            </button>
                                            <span className="text-gray-300 text-[10px]">|</span>
                                            <button 
                                                onClick={() => setSelectedBulkFeaturedBranches(new Set())}
                                                className="text-[10px] font-black uppercase tracking-wider text-gray-500 hover:text-gray-700 transition-colors"
                                            >
                                                Desmarcar Todas
                                            </button>
                                        </div>
                                    </div>

                                    <div className="bg-gray-50 p-4 rounded-2xl max-h-64 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 border border-gray-100">
                                        {bulkFeaturedBranches.map(branch => (
                                            <label key={branch.id} className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl cursor-pointer hover:border-purple-200 transition-all">
                                                <input 
                                                    type="checkbox" 
                                                    className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                    checked={selectedBulkFeaturedBranches.has(branch.id)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(selectedBulkFeaturedBranches);
                                                        if (e.target.checked) newSet.add(branch.id);
                                                        else newSet.delete(branch.id);
                                                        setSelectedBulkFeaturedBranches(newSet);
                                                    }}
                                                />
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-bold text-gray-700 leading-tight">{branch.name}</span>
                                                    <span className="text-[10px] text-gray-400 font-medium">ID: {branch.id.slice(0, 8)}...</span>
                                                </div>
                                            </label>
                                        ))}
                                        {bulkFeaturedBranches.length === 0 && (
                                            <p className="text-sm text-gray-500 p-2 col-span-2 text-center">Nenhuma filial conectada encontrada.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {!isProcessingBulkFeatured && (
                        <div className="p-6 md:p-8 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-4 rounded-b-[2rem]">
                            <button 
                                onClick={() => setIsBulkFeaturedModalOpen(false)} 
                                className="px-6 py-3 rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 font-bold text-sm transition-all"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={handleApplyBulkFeatured}
                                disabled={selectedBulkFeaturedBranches.size === 0}
                                className="px-8 py-3 bg-purple-600 hover:bg-purple-700 text-white font-black text-sm rounded-xl transition-all shadow-lg shadow-purple-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Aplicar Destaques
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )}
        {/* Central Price Upload Modal */}
        {isCentralPriceModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isProcessingCentralPrice && setIsCentralPriceModalOpen(false)}></div>
                <div className="relative bg-white w-full max-w-3xl rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
                    <div className="p-6 md:p-8 flex items-center justify-between border-b border-gray-100 bg-gray-50/50">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center shadow-inner">
                                <Upload size={24} />
                            </div>
                            <div>
                                <h2 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight">Preço em Lote Centralizado</h2>
                                <p className="text-xs md:text-sm font-bold text-gray-500">Atualize os preços usando a tabela matriz, casando por EAN.</p>
                            </div>
                        </div>
                        <button onClick={() => !isProcessingCentralPrice && setIsCentralPriceModalOpen(false)} className="p-3 bg-white rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all border border-gray-100 shadow-sm">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-6 md:p-8 overflow-y-auto">
                        {centralPriceLogs.length > 0 ? (
                            <div className="space-y-6">
                                <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-3xl flex items-center gap-4">
                                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm">
                                        <CheckCircle2 size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-emerald-900 text-lg">Processamento Concluído!</h4>
                                        <p className="text-emerald-700 font-bold text-sm">{centralPriceLogs.length} preços alterados na rede.</p>
                                    </div>
                                </div>
                                <div className="bg-white border rounded-2xl p-4 max-h-60 overflow-y-auto">
                                    {centralPriceLogs.map((log, i) => (
                                        <div key={i} className="py-2 border-b last:border-0 border-gray-50 text-xs">
                                            <span className="font-bold">{log.name}</span> <span className="text-gray-500">- {log.details}</span>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={() => { setIsCentralPriceModalOpen(false); setCentralPriceLogs([]); }} className="w-full py-4 bg-gray-900 text-white font-black rounded-xl">
                                    Fechar
                                </button>
                            </div>
                        ) : isProcessingCentralPrice ? (
                            <div className="bg-gray-50 rounded-3xl p-8 flex flex-col items-center justify-center text-center">
                                <Loader2 size={40} className="animate-spin text-purple-600 mb-4" />
                                <h4 className="font-black text-xl text-gray-900">Atualizando Filiais...</h4>
                                <p className="text-gray-500 font-bold text-sm mt-2">{centralPriceProgress}% concluído</p>
                                <div className="w-full bg-gray-200 rounded-full h-2 mt-4 overflow-hidden">
                                    <div className="bg-purple-500 h-full transition-all duration-300" style={{ width: `${centralPriceProgress}%` }}></div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-4 uppercase font-black">Por favor, não feche esta janela.</p>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-black uppercase text-gray-400 tracking-widest">Escopo de Aplicação</h3>
                                    <div className="flex gap-4">
                                        <button 
                                            onClick={() => setCentralPriceScope('ALL')}
                                            className={`flex-1 py-4 px-6 rounded-2xl border-2 transition-all text-sm font-black ${centralPriceScope === 'ALL' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500 hover:border-purple-200'}`}
                                        >
                                            Todas as Filiais
                                        </button>
                                        <button 
                                            onClick={() => setCentralPriceScope('SELECT')}
                                            className={`flex-1 py-4 px-6 rounded-2xl border-2 transition-all text-sm font-black ${centralPriceScope === 'SELECT' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-500 hover:border-purple-200'}`}
                                        >
                                            Selecionar Específicas
                                        </button>
                                    </div>
                                    
                                    {centralPriceScope === 'SELECT' && (
                                        <div className="bg-gray-50 p-4 rounded-2xl max-h-48 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 mt-4 border border-gray-100">
                                            {centralPriceBranches.map(branch => (
                                                <label key={branch.id} className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl cursor-pointer hover:border-purple-200 transition-all">
                                                    <input 
                                                        type="checkbox" 
                                                        className="w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                                        checked={selectedCentralBranches.has(branch.id)}
                                                        onChange={(e) => {
                                                            const newSet = new Set(selectedCentralBranches);
                                                            if (e.target.checked) newSet.add(branch.id);
                                                            else newSet.delete(branch.id);
                                                            setSelectedCentralBranches(newSet);
                                                        }}
                                                    />
                                                    <span className="text-sm font-bold text-gray-700">{branch.name}</span>
                                                </label>
                                            ))}
                                            {centralPriceBranches.length === 0 && (
                                                <p className="text-sm text-gray-500 p-2 col-span-2">Nenhuma filial conectada encontrada.</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4 pt-4 border-t border-gray-100">
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-sm font-black uppercase text-gray-400 tracking-widest">Planilha de Preços</h3>
                                        <div className="flex bg-gray-100 p-1 rounded-xl">
                                            <button 
                                                type="button"
                                                onClick={() => setCentralPriceImportMethod('file')} 
                                                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${centralPriceImportMethod === 'file' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                            >
                                                📁 Arquivo
                                            </button>
                                            <button 
                                                type="button"
                                                onClick={() => setCentralPriceImportMethod('paste')} 
                                                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${centralPriceImportMethod === 'paste' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                            >
                                                📋 Copiar & Colar
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-500">A planilha deve conter as colunas "EAN" (ou Código de Barras) e "PREÇO" (ou Valor). Os produtos serão encontrados e atualizados nas lojas selecionadas usando o EAN.</p>
                                    
                                    {centralPriceImportMethod === 'file' ? (
                                        <div className="space-y-3">
                                            <button 
                                                type="button"
                                                onClick={() => centralPriceInputRef.current?.click()} 
                                                className="w-full py-6 bg-gray-900 text-white rounded-3xl font-black text-lg shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3"
                                            >
                                                <Upload size={24} /> Processar Planilha
                                            </button>
                                            <input type="file" ref={centralPriceInputRef} className="hidden" accept=".xlsx,.xls,.csv" onChange={processCentralPriceUpload} />
                                        </div>
                                    ) : (
                                        <div className="space-y-4 animate-in fade-in duration-200">
                                            <textarea
                                                value={pastedCentralPricesText}
                                                onChange={(e) => setPastedCentralPricesText(e.target.value)}
                                                placeholder="Cole as colunas copiadas (EAN, PREÇO) aqui..."
                                                className="w-full h-32 p-3 text-xs font-mono bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all resize-none"
                                            />
                                            <button 
                                                type="button"
                                                onClick={importPastedCentralPrices} 
                                                className="w-full py-4 bg-purple-600 text-white rounded-2xl text-xs font-black uppercase shadow-lg shadow-purple-50 hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
                                            >
                                                <CheckCircle2 size={16} /> Processar Dados Colados
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

    </div>
  );
};
