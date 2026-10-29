
import React, { useState, useEffect, useMemo } from 'react';
import { PharmacyConfig, Product, AuthSession, AppReview, BackupLog } from '../types';
import { getTenants, saveTenant, getAllProducts, getProductsByTenant, getAppReviews, getBackupLogs, runManualBackup, saveBackupConfig, getBackupConfig, getPharmacyStats, exportBackupData, downloadLatestBackupFile, getIntegrationLogs } from '../services/storage';
import { getDepartmentForCategory } from '../lib/departments';
import { Plus, Trash2, Edit3, ExternalLink, X, Loader2, Key, Calendar, RefreshCw, Check, Store, AlertCircle, ShieldAlert, Lock, Unlock, MapPin, Palette, Phone, FileDown, Download, Filter, Star, MessageSquare, ShieldCheck, Search, Database, History, HardDriveDownload, FileText, FileCode, Link, Bot, Sparkles } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ActivationTokenManager } from './ActivationTokenManager';
import { StatusMonitor } from './StatusMonitor';
import {
  triggerInovafarmaSync,
  parseInovafarmaUrlAndRoute,
  resolveEffectiveInovafarmaCnpj,
  INOVAFARMA_DEFAULT_API_URL,
  INOVAFARMA_DEFAULT_ROUTE_ID,
} from '../services/inovafarma';


interface SuperAdminManagerProps {
  session: AuthSession;
  onAccessTenant?: (tenant: PharmacyConfig) => void;
  onDeleteTenant: (tenantId: string) => Promise<void>;
}

type RenewalPeriod = 'monthly' | 'semiannual' | 'annual';

// Função auxiliar para evitar estouro de limite de caracteres do Excel (32767 chars)
const excelSafeValue = (val: any) => {
    if (val === undefined || val === null) return '';
    if (Array.isArray(val)) return JSON.stringify(val);
    const str = String(val);
    if (str.length > 32760) {
        return str.substring(0, 32760); 
    }
    return str;
};

export const SuperAdminManager: React.FC<SuperAdminManagerProps> = ({ session, onAccessTenant, onDeleteTenant }) => {
  const [tenants, setTenants] = useState<PharmacyConfig[]>([]);
  const [reviews, setReviews] = useState<AppReview[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isNewTenant, setIsNewTenant] = useState(true);
  const [isReviewsOpen, setIsReviewsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<RenewalPeriod>('monthly');
  const [exportTenantId, setExportTenantId] = useState<string>('all');
  const [isPendingImagesOpen, setIsPendingImagesOpen] = useState(false);
  const [pendingImagesProducts, setPendingImagesProducts] = useState<Product[]>([]);
  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [selectedTenantForBackup, setSelectedTenantForBackup] = useState<PharmacyConfig | null>(null);
  const [backupLogs, setBackupLogs] = useState<BackupLog[]>([]);
  const [backupConfig, setBackupConfig] = useState<any>({ frequency: 'OFF' });
  const [pharmacyStats, setPharmacyStats] = useState<Record<string, { averageRating: number, totalReviews: number }>>({});
  const [restoreJobId, setRestoreJobId] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<any>(null);
  const [exportProgress, setExportProgress] = useState<{ active: boolean, progress: number, message: string }>({ active: false, progress: 0, message: '' });
  const [isIntegrationOpen, setIsIntegrationOpen] = useState(false);
  const [selectedTenantForIntegration, setSelectedTenantForIntegration] = useState<PharmacyConfig | null>(null);
  const [integrationLogs, setIntegrationLogs] = useState<any[]>([]);
  const [isSyncingInovafarma, setIsSyncingInovafarma] = useState(false);
  const [inovafarmaSyncFeedback, setInovafarmaSyncFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: string;
  } | null>(null);
  const [copiedWebhookField, setCopiedWebhookField] = useState<string | null>(null);
  const [isQueueDashboardOpen, setIsQueueDashboardOpen] = useState(false);
  const [queueStats, setQueueStats] = useState<any>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSyncTenantInovafarma = async () => {
    if (!selectedTenantForIntegration?.id) return;
    setIsSyncingInovafarma(true);
    setInovafarmaSyncFeedback(null);
    try {
      const parsedRoute = parseInovafarmaUrlAndRoute(
        selectedTenantForIntegration.erpBaseUrl || selectedTenantForIntegration.erpUrl || INOVAFARMA_DEFAULT_API_URL,
        selectedTenantForIntegration.erpRouteId || selectedTenantForIntegration.erp_route_id || 'homologacao',
      );
      const effectiveCnpj = resolveEffectiveInovafarmaCnpj(
        selectedTenantForIntegration.erpCnpj || selectedTenantForIntegration.erp_cnpj || selectedTenantForIntegration.cnpj || '',
        parsedRoute.slug,
      );
      const result = await triggerInovafarmaSync({
        tenantId: selectedTenantForIntegration.id,
        erpUrl: parsedRoute.origin,
        erpRouteId: parsedRoute.slug,
        cnpj: effectiveCnpj,
        apiToken: selectedTenantForIntegration.integrationToken || '',
        ignoreErpPrices: Boolean(selectedTenantForIntegration.ignore_erp_prices),
      });
      const exactStatus = result.httpStatus ?? 200;
      const exactCnpj = result.cnpjSent || effectiveCnpj;
      setInovafarmaSyncFeedback({
        type: 'success',
        message: result.message || `Sincronização com Inovafarma concluída (HTTP ${exactStatus} | Header cnpj: ${exactCnpj})!`,
        details: `Status HTTP: ${exactStatus} | Header cnpj enviado: ${exactCnpj} | Endpoint: ${result.endpointUsed} | Recebidos: ${result.totalFetched} | Novos: ${result.insertedCount} | Atualizados: ${result.updatedCount}`,
      });
      if (Array.isArray((result as any).logs)) {
        setIntegrationLogs((result as any).logs);
      } else {
        const updatedLogs = await getIntegrationLogs(selectedTenantForIntegration.id);
        setIntegrationLogs(updatedLogs);
      }
    } catch (err: any) {
      setInovafarmaSyncFeedback({
        type: 'error',
        message: 'Erro ao sincronizar com Inovafarma',
        details: err?.message || 'Verifique o Token e a URL da API do Portal PS.',
      });
      const updatedLogs = await getIntegrationLogs(selectedTenantForIntegration.id);
      setIntegrationLogs(updatedLogs);
    } finally {
      setIsSyncingInovafarma(false);
    }
  };

  
  
  const [addressData, setAddressData] = useState({
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: ""
  });
  const [isFetchingCep, setIsFetchingCep] = useState(false);
  const [cepError, setCepError] = useState("");

const [editData, setEditData] = useState<Partial<PharmacyConfig>>({
    name: '', 
    whatsapp: '', 
    primaryColor: '#059669', 
    secondaryColor: '#047857',
    accentColor: '#10b981',
    id: '', 
    logo: '', 
    admin_email: '', 
    admin_password: '', 
    isBlocked: false, 
    licenseExpiration: '', 
    type: 'PHARMACY',
    erpUrl: '',
    erpType: '',
    isAiAgentEnabled: false,
    isAiCopilotEnabled: false,
    aiAgentConfig: undefined
  });

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 10) {
      return numbers.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3').replace(/(\d{2})(\d{4})/, '($1) $2');
    }
    return numbers.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  };

  const loadTenants = async () => {
      setLoading(true);
      try {
        const data = await getTenants();
        setTenants(data);
        
        // Load stats for each tenant
        const statsMap: any = {};
        await Promise.all(data.map(async (t) => {
            const stats = await getPharmacyStats(t.id);
            statsMap[t.id] = stats;
        }));
        setPharmacyStats(statsMap);
      } catch (e: any) {
        console.error("Erro ao carregar:", e);
      } finally {
        setLoading(false);
      }
  };

  const handleOpenReviews = async () => {
      setLoading(true);
      try {
          const data = await getAppReviews();
          setReviews(data);
          setIsReviewsOpen(true);
      } catch (e: any) {
          alert("Erro ao carregar avaliações.");
      } finally {
          setLoading(false);
      }
  };

  const handleOpenQueueDashboard = async () => {
      setLoading(true);
      try {
          const response = await fetch('/api/v1/queue/stats');
          if (response.ok) {
              const data = await response.json();
              setQueueStats(data);
              setIsQueueDashboardOpen(true);
          } else {
              alert("Erro ao carregar status da fila.");
          }
      } catch (e: any) {
          alert("Erro ao carregar status da fila.");
      } finally {
          setLoading(false);
      }
  };

  useEffect(() => {
      let interval: NodeJS.Timeout;
      if (isQueueDashboardOpen) {
          interval = setInterval(async () => {
              try {
                  const response = await fetch('/api/v1/queue/stats');
                  if (response.ok) {
                      const data = await response.json();
                      setQueueStats(data);
                  }
              } catch (e) {
                  console.error("Erro ao atualizar status da fila:", e);
              }
          }, 3000);
      }
      return () => clearInterval(interval);
  }, [isQueueDashboardOpen]);

  useEffect(() => {
    loadTenants();
  }, []);

  const getDaysRemaining = (expiration?: string) => {
    if (!expiration) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiration);
    exp.setHours(0, 0, 0, 0);
    const diffTime = exp.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const expiringSoonTenants = useMemo(() => {
    return tenants.filter(t => {
        const days = getDaysRemaining(t.licenseExpiration);
        return days >= 0 && days <= 2;
    });
  }, [tenants]);

  // Função Original de Exportação (Mantida Intacta)
  const handleExportProducts = async () => {
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 100)); // Yield to event loop to show loading spinner
    try {
        let productsToExport: Product[] = [];
        let fileNameSuffix = "Todas_Empresas";

        if (exportTenantId === 'all') {
            productsToExport = await getAllProducts();
        } else {
            productsToExport = await getProductsByTenant(exportTenantId, undefined, true);
            const tenantName = tenants.find(t => t.id === exportTenantId)?.name || exportTenantId;
            fileNameSuffix = tenantName.replace(/\s+/g, '_');
        }

        if (productsToExport.length === 0) {
            alert("Nenhum produto encontrado para os critérios selecionados.");
            return;
        }

        const dataToExport = productsToExport.map((p: Product) => {
            const tenantConfig = tenants.find(t => t.id === p.tenantId) || { departments: [] };
            return {
                'Nome': p.name,
                'CodigoInterno': p.internalCode || '',
                'EAN': p.barcode || '',
                'Departamento': getDepartmentForCategory(p.category || '', tenantConfig.departments),
                'Subcategoria': p.category || 'Geral',
                'Laboratorio': p.manufacturer || 'Outros',
                'PrecoVenda': p.price,
                'PrecoOriginal': p.originalPrice || 0,
                'PrecoPromocional': p.promotionalPrice || 0,
                'PRECO_PROMOCIONAL': p.promotionalPrice || 0,
                'PROMOTIONAL_PRICE': p.promotionalPrice || 0,
                'Estoque': p.stock,
                'Descricao': excelSafeValue(p.description),
                'Imagem': excelSafeValue(p.image),
                'PrincipioAtivo': p.activePrinciple || '',
                'TipoLegal': p.drugType || ''
            };
        });

        await new Promise(resolve => setTimeout(resolve, 100)); // Yield before heavy XLSX operations

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Produtos");
        XLSX.writeFile(wb, `Export_Produtos_${fileNameSuffix}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error: any) {
        console.error("Erro ao exportar produtos:", error);
        alert("Falha técnica ao gerar arquivo de produtos.");
    } finally {
        setLoading(false);
    }
  };

  // NOVA FUNCIONALIDADE: Backup Integral Individual
  const handleFullBackup = async () => {
    if (exportTenantId === 'all') {
        alert("Para realizar um backup de segurança integral, selecione uma empresa específica no filtro.");
        return;
    }

    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 100)); // Yield to event loop
    try {
        const productsToExport = await getProductsByTenant(exportTenantId, undefined, true);
        const tenant = tenants.find(t => t.id === exportTenantId);
        const tenantName = tenant?.name || exportTenantId;

        if (productsToExport.length === 0) {
            alert("Esta empresa não possui produtos para backup.");
            return;
        }

        // Mapeamento Integral de todos os campos da tabela
        const backupData = productsToExport.map((p: Product) => {
            const tenantConfig = tenant || { departments: [] };
            const deptName = getDepartmentForCategory(p.category || '', tenantConfig.departments as import('../types').DepartmentConfig[]);
            const deptObj = tenantConfig.departments?.find(d => d.name === deptName);
            return {
            'ID_SISTEMA': p.id,
            'TENANT_ID': p.tenantId,
            'NOME_PRODUTO': p.name,
            'PRECO_VENDA': p.price,
            'PRECO_ORIGINAL': p.originalPrice || 0,
            'PRECO_PROMOCIONAL': p.promotionalPrice || 0,
            'PROMOTIONAL_PRICE': p.promotionalPrice || 0,
            'ESTOQUE_ATUAL': p.stock,
            'CODIGO_INTERNO': p.internalCode || '',
            'EAN_BARRAS': p.barcode || '',
            'DEPARTAMENTO': deptName,
            'DEPARTAMENTO_ID': deptObj?.id || '',
            'SUBCATEGORIA': p.category || 'Geral',
            'SUBCATEGORIA_ID': p.category || 'Geral',
            'CATEGORIA_CLASSE': p.category || 'Geral',
            'FABRICANTE_LAB': p.manufacturer || 'Outros',
            'PRINCIPIO_ATIVO': p.activePrinciple || '',
            'TIPO_MEDICAMENTO': p.drugType || '',
            'APRESENTACAO': p.presentation || '',
            'DESCRICAO_COMERCIAL': excelSafeValue(p.description),
            'INDICACOES': excelSafeValue(p.indications),
            'MODO_USO': excelSafeValue(p.usage),
            'EFEITOS_COLATERAIS': excelSafeValue(p.sideEffects),
            'CONTRAINDICACOES': excelSafeValue(p.contraindications),
            'IMAGEM_PRINCIPAL': excelSafeValue(p.image),
            'LINK_VIDEO': p.videoUri || '',
            'DADOS_IA_ENRIQUECIDOS': p.isAiEnriched ? 'SIM' : 'NAO',
            'TIPO_PROMOCAO': p.promotionType || 'NONE',
            'PROMO_LEVE': p.buyX || 0,
            'PROMO_PAGUE': p.payY || 0,
            'STATUS_DESTAQUE': p.isFeatured ? 'SIM' : 'NAO'
            };
        });

        await new Promise(resolve => setTimeout(resolve, 100)); // Yield before heavy XLSX operations

        const ws = XLSX.utils.json_to_sheet(backupData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Backup_Integral");
        
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `BACKUP_INTEGRAL_${tenantName.replace(/\s+/g, '_')}_${dateStr}.xlsx`;
        
        XLSX.writeFile(wb, fileName);
    } catch (error: any) {
        console.error("Erro no backup integral:", error);
        alert("Erro ao gerar backup de segurança.");
    } finally {
        setLoading(false);
    }
  };

  const handleExportManufacturers = async () => {
    setLoading(true);
    try {
        if (tenants.length === 0) {
            alert("Não há dados de empresas carregados.");
            return;
        }

        const manufacturersMap = new Map<string, string>();
        let fileNameSuffix = "Todas_Empresas";
        
        const sourceTenants = exportTenantId === 'all' 
            ? tenants 
            : tenants.filter(t => t.id === exportTenantId);

        if (exportTenantId !== 'all') {
            fileNameSuffix = sourceTenants[0]?.name.replace(/\s+/g, '_') || exportTenantId;
        }

        sourceTenants.forEach(t => {
            if (t.manufacturerLogos) {
                Object.entries(t.manufacturerLogos).forEach(([name, logo]) => {
                    if (name && (!manufacturersMap.has(name) || (manufacturersMap.get(name) === '' && logo))) {
                        manufacturersMap.set(name, String(logo || ''));
                    }
                });
            }
            if (t.customManufacturers) {
                t.customManufacturers.forEach(m => {
                    if (m && !manufacturersMap.has(m)) manufacturersMap.set(m, '');
                });
            }
        });

        if (manufacturersMap.size === 0) {
            alert("Nenhum fabricante encontrado para a seleção.");
            return;
        }

        const dataToExport = Array.from(manufacturersMap.entries()).map(([name, logo]) => ({
            'Fabricante': name,
            'Imagem': excelSafeValue(logo)
        }));

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Fabricantes");
        XLSX.writeFile(wb, `Export_Fabricantes_${fileNameSuffix}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error: any) {
        console.error("Erro ao exportar fabricantes:", error);
        alert("Erro ao processar a lista de fabricantes.");
    } finally {
        setLoading(false);
    }
  };

  const handleToggleBlock = async (e: React.MouseEvent, tenant: PharmacyConfig) => {
    e.stopPropagation();
    const action = tenant.isBlocked ? 'desbloquear' : 'bloquear';
    if (!confirm(`Tem certeza que deseja ${action} a empresa "${tenant.name}"?`)) return;

    setLoading(true);
    try {
        const updatedTenant = { ...tenant, isBlocked: !tenant.isBlocked };
        await saveTenant(updatedTenant, true);
        await loadTenants();
    } catch (error: any) {
        alert("Erro ao alterar status: " + (error.message || "Tente novamente"));
    } finally {
        setLoading(false);
    }
  };

  
  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 8) value = value.slice(0, 8);
    
    let formatted = value;
    if (value.length > 5) {
      formatted = value.slice(0, 5) + "-" + value.slice(5);
    }
    
    setAddressData(prev => ({ ...prev, cep: formatted }));
    
    if (value.length === 8) {
      setIsFetchingCep(true);
      setCepError("");
      try {
        const res = await fetch(`https://viacep.com.br/ws/${value}/json/`);
        const data = await res.json();
        
        if (data.erro) {
          setCepError("CEP não encontrado.");
        } else {
          const newNeighborhood = typeof data.bairro === 'string' && data.bairro.trim() && !/^\d+$/.test(data.bairro.trim()) ? data.bairro.trim() : "";
          const newCity = typeof data.localidade === 'string' && data.localidade.trim() && !/^\d+$/.test(data.localidade.trim()) ? data.localidade.trim() : "";
          const newState = typeof data.uf === 'string' && data.uf.trim() && !/^\d+$/.test(data.uf.trim()) ? data.uf.trim().toUpperCase() : "";

          setAddressData(prev => ({
            ...prev,
            street: typeof data.logradouro === 'string' ? data.logradouro : prev.street,
            neighborhood: newNeighborhood || prev.neighborhood,
            city: newCity || prev.city,
            state: newState || prev.state
          }));
        }
      } catch (err) {
        setCepError("Erro ao buscar CEP.");
      } finally {
        setIsFetchingCep(false);
      }
    } else {
      setCepError("");
    }
  };

  const handleEditClick = (e: React.MouseEvent, tenant: PharmacyConfig) => {
    e.stopPropagation();
    
    // Attempt to parse existing fullAddress or use discrete columns
    let cep = "", street = "", number = "", complement = "", neighborhood = "", city = "", state = "";
    if (tenant.street || tenant.neighborhood || tenant.city || tenant.cep) {
      cep = tenant.cep || "";
      street = tenant.street || "";
      number = tenant.address_number || "";
      complement = tenant.complement || "";
      neighborhood = /^\d{4,8}/.test(tenant.neighborhood || "") ? "" : (tenant.neighborhood || "");
      city = /^\d{4,8}/.test(tenant.city || "") ? "" : (tenant.city || "");
      state = /^\d{4,8}/.test(tenant.state || "") ? "" : (tenant.state || "");
    } else if (tenant.fullAddress) {
      // Basic parse: Logradouro, Número - Bairro, Cidade - UF, CEP
      const parts = tenant.fullAddress.split(',');
      if (parts.length >= 2) {
        street = parts[0].trim();
        const secondPart = parts.slice(1).join(',').trim();
        const dashParts = secondPart.split('-');
        if (dashParts.length >= 2) {
           number = dashParts[0].trim();
           // Try to find cep at the end
           const cepMatch = tenant.fullAddress.match(/\d{5}-\d{3}/);
           if (cepMatch) cep = cepMatch[0];
        } else {
           street = tenant.fullAddress; // fallback
        }
      } else {
        street = tenant.fullAddress;
      }
    }
    setAddressData({ cep, street, number, complement, neighborhood, city, state });
    
    setEditData({
        ...tenant,
        admin_password: '', // Clear password on edit. If empty on save, keeps the old one.
        secondaryColor: tenant.secondaryColor || '#047857',
        accentColor: tenant.accentColor || '#10b981'
    });
    setIsNewTenant(false);
    setIsEditing(true);
    setAttemptedSave(false);
    setSaveError(null);
  };

  const calculateNewExpiration = (currentExpiration: string | undefined, period: RenewalPeriod) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let baseDate = today;
    if (currentExpiration) {
        const currentExpDate = new Date(currentExpiration);
        if (currentExpDate > today) baseDate = currentExpDate;
    }
    const newDate = new Date(baseDate);
    if (period === 'monthly') newDate.setMonth(newDate.getMonth() + 1);
    else if (period === 'semiannual') newDate.setMonth(newDate.getMonth() + 6);
    else if (period === 'annual') newDate.setFullYear(newDate.getFullYear() + 1);
    return newDate.toISOString().split('T')[0];
  };

  const handleApplyRenewal = () => {
    const nextDate = calculateNewExpiration(editData.licenseExpiration, selectedPeriod);
    setEditData(prev => ({ ...prev, licenseExpiration: nextDate }));
  };

  const handleSave = async () => {
    setAttemptedSave(true);
    setSaveError(null);
    
    // Format fullAddress
    const addr = addressData;
        if (addr.street || addr.cep) {
      const streetNumComp = `${addr.street || ''}${addr.number ? ', ' + addr.number : ''}${addr.complement ? ' (' + addr.complement + ')' : ''}`.trim();
      const cityState = `${addr.city || ''}${addr.city && addr.state ? ' - ' + addr.state : (addr.state || '')}`.trim();
      
      const parts = [];
      if (streetNumComp) parts.push(streetNumComp);
      if (addr.neighborhood) parts.push(addr.neighborhood);
      if (cityState) parts.push(cityState);
      if (addr.cep) parts.push(addr.cep); // Only the CEP number, no 'CEP: ' prefix, to match exact example
      
      // The example was "Logradouro, Número - Bairro, Cidade - UF, CEP"
      // We will join with " - " for street - neighborhood - city - cep
      // Actually: Logradouro, 123 - Centro, São Paulo - SP, 01000-000
      
      let finalAddress = "";
      if (streetNumComp) finalAddress += streetNumComp;
      if (addr.neighborhood) finalAddress += (finalAddress ? " - " : "") + addr.neighborhood;
      if (cityState) finalAddress += (finalAddress ? ", " : "") + cityState;
      if (addr.cep) finalAddress += (finalAddress ? ", " : "") + addr.cep;
      
      editData.fullAddress = finalAddress;
    }
    if (!editData.id || !editData.name || !editData.admin_email || !editData.whatsapp) {
        setSaveError("Preencha os campos obrigatórios.");
        return;
    }
    if (isNewTenant && !editData.admin_password) {
        setSaveError("Preencha a senha obrigatória para a nova drogaria.");
        return;
    }
    
    setLoading(true);
    try {
        const rawId = editData.id || '';
        const cleanId = isNewTenant 
            ? rawId.trim().toLowerCase().replace(/\s/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]/g, "")
            : rawId;
        
        if (!cleanId) throw new Error("ID inválido.");

        // CORREÇÃO CRÍTICA: Impedir sobrescrita de empresa verificando unicidade do ID em novos cadastros
        if (isNewTenant && tenants.some(t => t.id === cleanId)) {
            setSaveError("Este ID de URL (Slug) já está em uso por outra drogaria. Escolha um nome diferente.");
            setLoading(false);
            return;
        }

        let existingTenant = tenants.find(t => t.id === cleanId);
        
        let finalPassword = editData.admin_password || '';
        if (!isNewTenant && !finalPassword && existingTenant) {
            finalPassword = existingTenant.admin_password || '';
        }

        const newTenant: PharmacyConfig = { 
          ...(existingTenant || {} as any),
          id: cleanId,
          type: 'PHARMACY',
          name: editData.name || '',
          whatsapp: (editData.whatsapp || '').replace(/\D/g, '').slice(0, 11),
          primaryColor: editData.primaryColor || '#059669',
          secondaryColor: editData.secondaryColor || '#047857',
          accentColor: editData.accentColor || '#10b981',
          logo: editData.logo || '',
          admin_email: editData.admin_email || '',
          admin_password: finalPassword,
          isBlocked: editData.isBlocked || false,
          bannerTitle: editData.bannerTitle || '',
          bannerSubtitle: editData.bannerSubtitle || '',
          licenseExpiration: editData.licenseExpiration || '',
          cnpj: editData.cnpj || '',
          fullAddress: editData.fullAddress || '',
          corporateEmail: editData.corporateEmail || '',
          ...(() => {
            const parsedErp = parseInovafarmaUrlAndRoute(
              editData.erpBaseUrl ?? editData.erp_base_url ?? editData.erpUrl ?? '',
              editData.erpRouteId ?? editData.erp_route_id ?? existingTenant?.erpRouteId ?? '',
            );
            const integrationCnpj = (
              editData.erpCnpj ??
              editData.erp_cnpj ??
              editData.cnpj ??
              existingTenant?.erpCnpj ??
              ''
            ).trim();
            return {
              erpUrl: parsedErp.origin,
              erpBaseUrl: parsedErp.origin,
              erp_base_url: parsedErp.origin,
              erpRouteId: parsedErp.routeId,
              erp_route_id: parsedErp.routeId,
              erpCnpj: integrationCnpj,
              erp_cnpj: integrationCnpj,
            };
          })(),
          erpApiKey: (editData.erpApiKey ?? editData.erp_api_key ?? existingTenant?.erpApiKey ?? '').trim(),
          erp_api_key: (editData.erpApiKey ?? editData.erp_api_key ?? existingTenant?.erpApiKey ?? '').trim(),
          erpType: editData.erpType || '',
          erp_login: (editData.erp_login ?? editData.erpApiLogin ?? editData.erp_api_login ?? existingTenant?.erpApiLogin ?? '').trim(),
          erpApiLogin: (editData.erp_login ?? editData.erpApiLogin ?? editData.erp_api_login ?? existingTenant?.erpApiLogin ?? '').trim(),
          erp_api_login: (editData.erp_login ?? editData.erpApiLogin ?? editData.erp_api_login ?? existingTenant?.erpApiLogin ?? '').trim(),
          erp_password: (editData.erp_password ?? editData.erpApiPassword ?? editData.erp_api_password ?? '').trim(),
          erpApiPassword: (editData.erp_password ?? editData.erpApiPassword ?? editData.erp_api_password ?? '').trim(),
          erp_api_password: (editData.erp_password ?? editData.erpApiPassword ?? editData.erp_api_password ?? '').trim(),
          isChatEnabled: editData.isChatEnabled || false,
          isAiAgentEnabled: editData.isAiAgentEnabled || false,
          isAiCopilotEnabled: editData.isAiCopilotEnabled || false,
          aiAgentConfig: editData.aiAgentConfig || existingTenant?.aiAgentConfig,
          isNetworkMaster: editData.isNetworkMaster || false,
          networkId: editData.networkId || '',
          integrationToken: editData.integrationToken || (existingTenant?.integrationToken) || crypto.randomUUID(),
          departments: existingTenant?.departments || editData.departments,
          customCategories: existingTenant?.customCategories || editData.customCategories,
          customManufacturers: existingTenant?.customManufacturers || editData.customManufacturers,
          manufacturerLogos: existingTenant?.manufacturerLogos || editData.manufacturerLogos,
        };

        // Passa explicitamente se é uma atualização ou inserção nova
        await saveTenant(newTenant, !isNewTenant);
        await loadTenants();
        setIsEditing(false);
        setAttemptedSave(false);
        alert(isNewTenant ? "Cadastrada com sucesso!" : "Atualizado com sucesso!");
    } catch (error: any) {
        setSaveError(error.message || "Erro ao salvar.");
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Deseja excluir permanentemente esta empresa?')) {
      setLoading(true);
      try {
        await onDeleteTenant(id);
        setTenants(prev => prev.filter(t => t.id !== id));
        alert('Removida com sucesso!');
      } catch (error: any) {
          alert('Erro ao excluir: ' + (error.message || "Falha técnica"));
      } finally {
          setLoading(false);
      }
    }
  };

  const handleOpenPendingImages = async () => {
      setLoading(true);
      try {
          let products: Product[] = [];
          if (exportTenantId === 'all') {
              products = await getAllProducts();
          } else {
              products = await getProductsByTenant(exportTenantId);
          }
          const pending = products.filter(p => !p.image || p.image.trim() === '');
          setPendingImagesProducts(pending);
          setIsPendingImagesOpen(true);
      } catch (error) {
          console.error("Erro ao carregar pendências:", error);
          alert("Falha ao carregar imagens pendentes.");
      } finally {
          setLoading(false);
      }
  };

  const handleOpenBackupManager = async (tenant: PharmacyConfig) => {
      setSelectedTenantForBackup(tenant);
      setLoading(true);
      try {
          const config = await getBackupConfig(tenant.id);
          setBackupConfig(config);
          const logs = await getBackupLogs(tenant.id);
          setBackupLogs(logs);
          setIsBackupOpen(true);
      } catch (error) {
          alert("Erro ao carregar dados de backup.");
      } finally {
          setLoading(false);
      }
  };

  const handleOpenIntegrationManager = async (tenant: PharmacyConfig) => {
      setSelectedTenantForIntegration(tenant);
      setLoading(true);
      try {
          const logs = await getIntegrationLogs(tenant.id);
          setIntegrationLogs(logs);
          setIsIntegrationOpen(true);
      } catch (error) {
          alert("Erro ao carregar logs de integração.");
      } finally {
          setLoading(false);
      }
  };

  const handleSaveBackupConfig = async () => {
      if (!selectedTenantForBackup) return;
      setLoading(true);
      try {
          await saveBackupConfig(selectedTenantForBackup.id, backupConfig);
          alert("Configuração de backup salva!");
          await loadTenants();
      } catch (error) {
          alert("Erro ao salvar configuração.");
      } finally {
          setLoading(false);
      }
  };

  const handleTriggerManualBackup = async () => {
      if (!selectedTenantForBackup) return;
      setLoading(true);
      try {
          await runManualBackup(selectedTenantForBackup.id);
          alert("Backup iniciado com sucesso!");
          const logs = await getBackupLogs(selectedTenantForBackup.id);
          setBackupLogs(logs);
      } catch (error) {
          alert("Erro ao executar backup.");
      } finally {
          setLoading(false);
      }
  };

  const handleGerarEBaixar = async (format: 'sql' | 'csv') => {
      if (!selectedTenantForBackup) return;
      
      setExportProgress({ active: true, progress: 10, message: 'Iniciando dump de dados...' });
      
      // Simulate progress while generating
      const interval = setInterval(() => {
          setExportProgress(prev => {
              if (prev.progress >= 90) return prev;
              return { ...prev, progress: prev.progress + 10, message: prev.progress > 50 ? 'Formatando arquivo...' : 'Processando itens...' };
          });
      }, 500);

      try {
          // Trigger the backup generation on server (this updates storage)
          await runManualBackup(selectedTenantForBackup.id);
          
          setExportProgress({ active: true, progress: 100, message: 'Download iniciado!' });
          
          // Trigger the actual download
          await exportBackupData(selectedTenantForBackup.id, format);
          
          setTimeout(() => {
              setExportProgress({ active: false, progress: 0, message: '' });
              clearInterval(interval);
          }, 2000);
      } catch (error: any) {
          clearInterval(interval);
          setExportProgress({ active: false, progress: 0, message: '' });
          alert("Erro ao gerar exportação: " + error.message);
      }
  };

  const handleDownloadLatest = async () => {
      if (!selectedTenantForBackup) return;
      try {
          await downloadLatestBackupFile(selectedTenantForBackup.id);
      } catch (error: any) {
          alert("Erro ao baixar backup: " + error.message);
      }
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedTenantForBackup) return;

      if (!confirm("Atenção: Esta ação substituirá os dados atuais da empresa pelos dados contidos no backup. Deseja continuar?")) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
      }

      setLoading(true);
      try {
          const text = await file.text();
          const backupData = JSON.parse(text);

          const response = await fetch(`/api/backups/restore/${selectedTenantForBackup.id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(backupData)
          });

          if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Erro ao iniciar restauração');
          }

          const { jobId } = await response.json();
          setRestoreJobId(jobId);
          setRestoreStatus({ status: 'pending', progress: 0, message: 'Iniciando restauração...' });
      } catch (error: any) {
          alert(error.message || "Erro ao ler arquivo de backup.");
      } finally {
          setLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  useEffect(() => {
      let interval: NodeJS.Timeout;
      if (restoreJobId && restoreStatus?.status !== 'completed' && restoreStatus?.status !== 'failed') {
          interval = setInterval(async () => {
              try {
                  const res = await fetch(`/api/backups/restore-status/${restoreJobId}`);
                  if (res.ok) {
                      const status = await res.json();
                      setRestoreStatus(status);
                      if (status.status === 'completed' || status.status === 'failed') {
                          clearInterval(interval);
                          if (status.status === 'completed') {
                              alert(`Restauração concluída:\n${status.details?.productsRestored || 0} produtos restaurados\n${status.details?.categoriesRestored || 0} categorias recriadas.`);
                          } else {
                              alert(`Erro na restauração: ${status.message}`);
                          }
                          setTimeout(() => {
                              setRestoreJobId(null);
                              setRestoreStatus(null);
                          }, 3000);
                      }
                  }
              } catch (e) {
                  console.error("Erro ao checar status:", e);
              }
          }, 2000);
      }
      return () => clearInterval(interval);
  }, [restoreJobId, restoreStatus?.status]);

  const isFieldInvalid = (value: string | undefined) => attemptedSave && (!value || value.trim() === '');

  return (
    <div className="space-y-10">
      {loading && (
          <div className="fixed inset-0 z-[120] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center">
              <div className="bg-white p-6 rounded-3xl shadow-xl flex flex-col items-center gap-4">
                  <Loader2 size={40} className="animate-spin text-emerald-600" />
                  <p className="font-black text-gray-900">Processando Requisição...</p>
              </div>
          </div>
      )}

      {expiringSoonTenants.length > 0 && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-[2.5rem] p-6 flex flex-col gap-4 animate-in slide-in-from-top-4">
              <div className="flex items-center gap-3 text-amber-700">
                  <AlertCircle size={24} />
                  <h3 className="text-lg font-black">Alertas de Licença</h3>
              </div>
              <div className="space-y-2">
                  {expiringSoonTenants.map(t => {
                      const days = getDaysRemaining(t.licenseExpiration);
                      return (
                          <div key={t.id} className="bg-white/50 p-4 rounded-2xl flex justify-between items-center border border-amber-100">
                              <span className="font-bold text-gray-800">{t.name}</span>
                              <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-[10px] font-black uppercase">
                                  {days === 0 ? 'Expira Hoje' : `Vence em ${days} dia(s)`}
                              </span>
                          </div>
                      );
                  })}
              </div>
          </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ActivationTokenManager />
        <StatusMonitor />
      </div>

      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
        <div className="w-full xl:w-auto">
          <h2 className="text-3xl font-black text-gray-900">Portal Master</h2>
          <p className="text-gray-500 font-medium">Controle central de todas as drogarias do sistema.</p>
        </div>
        
        <div className="flex flex-col md:flex-row flex-wrap items-stretch md:items-center gap-4 bg-white p-4 rounded-3xl border border-gray-100 shadow-sm w-full xl:w-auto">
          <div className="flex flex-col gap-1 w-full md:w-auto">
              <label className="text-[10px] font-black uppercase text-gray-400 ml-1 flex items-center gap-1"><Filter size={10}/> Origem dos Dados</label>
              <select 
                value={exportTenantId} 
                onChange={(e) => setExportTenantId(e.target.value)}
                className="bg-gray-50 border-2 border-transparent focus:border-emerald-500 rounded-xl px-3 py-2 text-xs font-bold outline-none transition-all w-full md:min-w-[200px] text-gray-900"
              >
                <option value="all" className="text-gray-900">Todas as Empresas</option>
                {tenants.map(t => (
                    <option key={t.id} value={t.id} className="text-gray-900">{t.name}</option>
                ))}
              </select>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button 
                onClick={handleOpenReviews}
                className="bg-yellow-500 text-white px-5 py-3 rounded-2xl font-black shadow-lg hover:bg-yellow-600 transition-all flex items-center gap-2 text-xs"
            >
                <Star size={16} /> Avaliações App
            </button>
            <button 
                onClick={handleExportProducts}
                className="bg-emerald-600 text-white px-5 py-3 rounded-2xl font-black shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2 text-xs"
            >
                <Download size={16} /> Produtos
            </button>
            <button 
                onClick={handleExportManufacturers}
                className="bg-blue-600 text-white px-5 py-3 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition-all flex items-center gap-2 text-xs"
            >
                <FileDown size={16} /> Fabricantes
            </button>
            <button 
                onClick={handleOpenPendingImages}
                className="bg-orange-500 text-white px-5 py-3 rounded-2xl font-black shadow-lg hover:bg-orange-600 transition-all flex items-center gap-2 text-xs"
            >
                <AlertCircle size={16} /> Pendências IA
            </button>
            
            <button 
                onClick={handleFullBackup}
                disabled={exportTenantId === 'all'}
                className={`px-5 py-3 rounded-2xl font-black shadow-lg transition-all flex items-center gap-2 text-xs ${exportTenantId === 'all' ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none' : 'bg-gray-900 text-white hover:bg-black'}`}
                title={exportTenantId === 'all' ? "Selecione uma empresa específica para backup integral" : "Backup Integral de Segurança"}
            >
                <ShieldCheck size={16} /> Backup Segurança
            </button>
            <button 
                onClick={handleOpenQueueDashboard}
                className="bg-purple-600 text-white px-5 py-3 rounded-2xl font-black shadow-lg hover:bg-purple-700 transition-all flex items-center gap-2 text-xs"
            >
                <Database size={16} /> Status Filas
            </button>
          </div>
        </div>

        <button 
            onClick={() => {
              setEditData({ name: '', whatsapp: '', primaryColor: '#059669', secondaryColor: '#047857', accentColor: '#10b981', id: '', logo: '', admin_email: '', admin_password: '', isBlocked: false, licenseExpiration: '', type: 'PHARMACY', erpUrl: '', erpType: '', cnpj: '', fullAddress: '', corporateEmail: '', isNetworkMaster: false, networkId: '' });
              setIsNewTenant(true);
              setIsEditing(true);
              setAttemptedSave(false);
              setSaveError(null);
            }}
            className="bg-gray-900 text-white px-8 py-4 rounded-3xl font-black shadow-xl hover:bg-gray-800 transition-all flex items-center justify-center gap-2 w-full xl:w-auto shrink-0"
        >
            <Plus size={20} /> Cadastrar Drogaria
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {tenants.length === 0 && !loading ? (
            <div className="col-span-full py-20 bg-white rounded-[3rem] border-2 border-dashed border-gray-100 flex flex-col items-center justify-center text-gray-400">
                <Store size={48} className="mb-4 opacity-20" />
                <p className="font-bold">Nenhuma drogaria carregada.</p>
            </div>
        ) : (
            tenants.map(t => {
              const daysRem = getDaysRemaining(t.licenseExpiration);
              const isExpired = daysRem < 0;
              const isBlocked = t.isBlocked || isExpired;
              return (
              <div key={t.id} className={`bg-white p-8 rounded-[2.5rem] border shadow-sm flex flex-col hover:shadow-xl transition-all group relative overflow-hidden ${isBlocked ? 'border-red-100 opacity-80' : 'border-gray-100'}`}>
                {(t.isBlocked || isExpired) && (
                  <div className="absolute top-0 right-0 bg-red-600 text-white px-4 py-1.5 rounded-bl-2xl text-[9px] font-black uppercase tracking-widest z-10 flex items-center gap-2">
                    <ShieldAlert size={10} /> {isExpired ? 'Licença Expirada' : 'Suspenso'}
                  </div>
                )}
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
                  <div className="flex items-center gap-4 w-full sm:w-auto">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-black text-2xl overflow-hidden shadow-inner bg-gray-50 shrink-0" style={{ borderLeft: `4px solid ${t.primaryColor || '#059669'}` }}>
                      {t.logo ? <img src={t.logo} alt={t.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : t.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xl font-black text-gray-900 line-clamp-1">{t.name}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">ID: {t.id}</p>
                          {pharmacyStats[t.id] && pharmacyStats[t.id].totalReviews > 0 && (
                              <div className="flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-lg">
                                  <Star size={10} className="text-emerald-600" fill="currentColor" />
                                  <span className="text-[10px] font-black text-emerald-600">{pharmacyStats[t.id].averageRating.toFixed(1)}</span>
                              </div>
                          )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto justify-start sm:justify-end bg-gray-50/50 sm:bg-transparent p-2 sm:p-0 rounded-2xl sm:rounded-none">
                      <button onClick={(e) => { e.stopPropagation(); handleOpenIntegrationManager(t); }} className="p-2.5 sm:p-2 text-gray-500 sm:text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-xl transition-all" title="Integração ERP/PDV"><Link size={20} /></button>
                      <button onClick={(e) => handleOpenBackupManager(t)} className="p-2.5 sm:p-2 text-gray-500 sm:text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Gerenciar Backups"><Database size={20} /></button>
                      <button onClick={(e) => { e.stopPropagation(); handleOpenBackupManager(t); }} className="p-2.5 sm:p-2 text-gray-500 sm:text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-xl transition-all" title="Gerar e Baixar Backup Agora"><FileDown size={20} /></button>
                      <button onClick={(e) => handleEditClick(e, t)} className="p-2.5 sm:p-2 text-gray-500 sm:text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"><Edit3 size={20} /></button>
                      <button onClick={(e) => handleToggleBlock(e, t)} className={`p-2.5 sm:p-2 rounded-xl transition-all ${t.isBlocked ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}><Unlock size={20} /></button>
                      <button onClick={(e) => handleDelete(e, t.id)} className="p-2.5 sm:p-2 text-gray-300 sm:text-gray-200 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={20}/></button>
                  </div>
                </div>
                <div className="mb-6 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-black uppercase text-gray-400">
                        <span className="flex items-center gap-1.5"><Calendar size={12} /> Expira em: {t.licenseExpiration ? new Date(t.licenseExpiration).toLocaleDateString('pt-BR') : 'Sem data'}</span>
                        {t.isAiAgentEnabled && (
                          <span className="flex items-center gap-1 bg-purple-100 text-purple-700 px-2 py-0.5 rounded-md font-extrabold text-[9px]">
                            <Bot size={10} /> Bot IA
                          </span>
                        )}
                        {(t.isAiCopilotEnabled || (t as any).is_ai_copilot_enabled) && (
                          <span className="flex items-center gap-1 bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md font-extrabold text-[9px]">
                            <Sparkles size={10} /> Copilot IA
                          </span>
                        )}
                    </div>
                </div>
                <div className="space-y-2 mt-auto">
                    <button onClick={() => onAccessTenant?.(t)} className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2 ${isBlocked && session.type !== 'GUEST' ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-gray-900 text-white hover:bg-gray-800'}`} disabled={isBlocked && session.type !== 'GUEST'}><Lock size={16} /> Painel Administrativo</button>
                    <a href={`${window.location.origin}${window.location.pathname}?p=${t.id}`} target="_blank" rel="noreferrer" className="w-full py-3.5 bg-gray-50 text-gray-600 rounded-2xl font-bold text-sm hover:bg-gray-100 transition-all flex items-center justify-center gap-2"><ExternalLink size={16} /> Ver Loja</a>
                </div>
              </div>
            )})
        )}
      </div>

      {isReviewsOpen && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl p-8 overflow-y-auto max-h-[90vh] animate-in zoom-in-95 flex flex-col">
                  <div className="flex justify-between items-center mb-8 shrink-0">
                      <div>
                          <h3 className="text-2xl font-black text-gray-900">Avaliações do App</h3>
                          <p className="text-sm font-bold text-gray-400">Feedback recebido dos clientes nas lojas.</p>
                      </div>
                      <button onClick={() => setIsReviewsOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500"><X size={24}/></button>
                  </div>
                  
                  {reviews.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center py-20 text-gray-400">
                          <MessageSquare size={48} className="mb-4 opacity-20" />
                          <p className="font-bold">Nenhuma avaliação recebida ainda.</p>
                      </div>
                  ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {reviews.map(review => (
                              <div key={review.id} className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                                  <div className="flex justify-between items-start mb-3">
                                      <div className="flex gap-1 text-yellow-400">
                                          {[1,2,3,4,5].map(s => (
                                              <Star key={s} size={14} fill={review.rating >= s ? "currentColor" : "none"} strokeWidth={review.rating >= s ? 0 : 2} className={review.rating < s ? "text-gray-300" : ""} />
                                          ))}
                                      </div>
                                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{new Date(review.date).toLocaleDateString()}</span>
                                  </div>
                                  <p className="text-gray-800 font-medium text-sm leading-relaxed mb-4">"{review.comment || 'Sem comentário'}"</p>
                                  <div className="flex items-center gap-2">
                                      <Store size={14} className="text-gray-400" />
                                      <span className="text-xs font-bold text-gray-500">Loja ID: {review.tenantId || 'Desconhecida'}</span>
                                  </div>
                              </div>
                          ))}
                      </div>
                  )}
              </div>
          </div>
      )}

      {isEditing && (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl p-10 overflow-y-auto max-h-[95vh] animate-in zoom-in-95">
             <div className="flex justify-between items-center mb-10">
                <div className="flex items-center gap-3">
                   <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                      {isNewTenant ? <Plus size={24}/> : <Edit3 size={24}/>}
                   </div>
                   <h3 className="text-2xl font-black text-gray-900">{isNewTenant ? 'Cadastrar Drogaria' : 'Editar Drogaria'}</h3>
                </div>
                <button onClick={() => setIsEditing(false)} className="p-2 bg-gray-50 rounded-full text-gray-500 hover:text-red-500"><X size={24}/></button>
             </div>
             
             {saveError && (
                 <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl flex items-start gap-3 animate-in fade-in">
                    <AlertCircle className="shrink-0 mt-0.5" size={20} />
                    <div className="text-sm font-bold">{saveError}</div>
                 </div>
             )}

             <div className="space-y-6 text-black">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <label className="text-[11px] font-black uppercase text-gray-800 ml-2 tracking-wider">ID da URL (Slug) *</label>
                      <input className={`w-full bg-gray-50 p-4 rounded-2xl border-2 ${isFieldInvalid(editData.id) ? 'border-red-500' : 'border-gray-200'} outline-none font-bold text-black disabled:opacity-50`} value={editData.id} onChange={e => setEditData({...editData, id: e.target.value})} placeholder="ex: drogaria-central" disabled={!isNewTenant} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-black uppercase text-gray-800 ml-2 tracking-wider">Nome Comercial *</label>
                      <input className={`w-full bg-gray-50 p-4 rounded-2xl border-2 ${isFieldInvalid(editData.name) ? 'border-red-500' : 'border-gray-200'} outline-none font-bold text-black`} value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} placeholder="Ex: Drogaria Central" />
                    </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-black uppercase text-gray-800 ml-2 tracking-wider">WhatsApp Vendas *</label>
                  <div className="flex gap-2">
                    <div className="bg-gray-100 p-4 rounded-2xl border-2 border-transparent font-black text-gray-400">+55</div>
                    <input 
                      className={`flex-1 bg-gray-50 p-4 rounded-2xl border-2 ${isFieldInvalid(editData.whatsapp) ? 'border-red-500' : 'border-gray-200'} outline-none font-bold text-black`} 
                      value={formatPhone(editData.whatsapp || '')} 
                      onChange={e => setEditData({...editData, whatsapp: e.target.value.replace(/\D/g, '').slice(0, 11)})} 
                      placeholder="(00) 00000-0000" 
                      maxLength={15}
                    />
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 space-y-6">
                    <div className="flex items-center gap-2 mb-2">
                        <Store size={16} className="text-gray-700" />
                        <span className="text-[11px] font-black text-gray-700 uppercase tracking-widest">Configuração de Rede</span>
                    </div>
                    
                    <div className="space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer p-4 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-all">
                            <input type="radio" name="storeType" checked={!editData.isNetworkMaster && !editData.networkId} onChange={() => setEditData({...editData, isNetworkMaster: false, networkId: undefined})} className="text-emerald-600" />
                            <span className="font-bold text-sm text-gray-700">Loja Individual / Tradicional</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer p-4 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-all">
                            <input type="radio" name="storeType" checked={editData.isNetworkMaster} onChange={() => setEditData({...editData, isNetworkMaster: true, networkId: editData.id})} className="text-emerald-600" />
                            <span className="font-bold text-sm text-gray-700">Matriz de uma Rede de Drogarias</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer p-4 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-all">
                            <input type="radio" name="storeType" checked={!editData.isNetworkMaster && !!editData.networkId} onChange={() => setEditData({...editData, isNetworkMaster: false, networkId: tenants.find(t => t.isNetworkMaster)?.id})} className="text-emerald-600" />
                            <span className="font-bold text-sm text-gray-700">Filial de uma Rede Existente</span>
                        </label>
                    </div>

                    {(!editData.isNetworkMaster && editData.networkId) && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Selecione a Rede/Matriz</label>
                          <select className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black" value={editData.networkId} onChange={e => setEditData({...editData, networkId: e.target.value})}>
                              <option value="">Selecione...</option>
                              {tenants.filter(t => t.isNetworkMaster).map(t => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                          </select>
                        </div>
                    )}
                </div>

                <div className="bg-gray-50 p-8 rounded-[2.5rem] border border-gray-100 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">CNPJ</label>
                          <input type="text" className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black" value={editData.cnpj || ''} onChange={e => setEditData({...editData, cnpj: e.target.value})} placeholder="00.000.000/0000-00" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">E-mail Corporativo</label>
                          <input type="email" className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black" value={editData.corporateEmail || ''} onChange={e => setEditData({...editData, corporateEmail: e.target.value})} placeholder="contato@empresa.com" />
                        </div>
                    </div>
                    <div className="col-span-1 md:col-span-2 bg-white p-6 rounded-3xl border border-gray-200 space-y-4">
                      <h4 className="text-xs font-black uppercase text-gray-500 mb-2 flex items-center gap-2">
                        <MapPin size={14} /> Endereço
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">
                            CEP {isFetchingCep && <Loader2 size={12} className="inline animate-spin" />}
                          </label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.cep} 
                            onChange={handleCepChange} 
                            placeholder="00000-000" 
                            maxLength={9}
                          />
                          {cepError && <span className="text-red-500 text-xs font-bold ml-2">{cepError}</span>}
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Logradouro</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.street} 
                            onChange={e => setAddressData({...addressData, street: e.target.value})} 
                            placeholder="Rua / Avenida" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Número</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.number} 
                            onChange={e => setAddressData({...addressData, number: e.target.value})} 
                            placeholder="123" 
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Complemento</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.complement} 
                            onChange={e => setAddressData({...addressData, complement: e.target.value})} 
                            placeholder="Sala 1, Loja 2 (Opcional)" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Bairro</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.neighborhood} 
                            onChange={e => setAddressData({...addressData, neighborhood: e.target.value})} 
                            placeholder="Centro" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Cidade</label>
                          <input 
                            type="text" 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.city} 
                            onChange={e => setAddressData({...addressData, city: e.target.value})} 
                            placeholder="São Paulo" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">UF</label>
                          <select 
                            className="w-full bg-gray-50 p-4 rounded-2xl border-2 border-gray-100 outline-none font-bold text-black focus:border-emerald-500 transition-colors" 
                            value={addressData.state} 
                            onChange={e => setAddressData({...addressData, state: e.target.value})}
                          >
                            <option value="">UF</option>
                            <option value="AC">AC</option><option value="AL">AL</option><option value="AP">AP</option><option value="AM">AM</option>
                            <option value="BA">BA</option><option value="CE">CE</option><option value="DF">DF</option><option value="ES">ES</option>
                            <option value="GO">GO</option><option value="MA">MA</option><option value="MT">MT</option><option value="MS">MS</option>
                            <option value="MG">MG</option><option value="PA">PA</option><option value="PB">PB</option><option value="PR">PR</option>
                            <option value="PE">PE</option><option value="PI">PI</option><option value="RJ">RJ</option><option value="RN">RN</option>
                            <option value="RS">RS</option><option value="RO">RO</option><option value="RR">RR</option><option value="SC">SC</option>
                            <option value="SP">SP</option><option value="SE">SE</option><option value="TO">TO</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[11px] font-black uppercase text-gray-800 ml-2">URL da API Inovafarma</label>
                        <input
                          type="text"
                          className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black"
                          value={editData.erpBaseUrl ?? editData.erp_base_url ?? editData.erpUrl ?? ''}
                          onChange={e => {
                            const rawVal = e.target.value;
                            const routeMatch = rawVal.match(/\/api\/v1\/([^/?#[\]()]+)/i);
                            const extractedSlug = routeMatch?.[1]?.trim();
                            setEditData({
                              ...editData,
                              erpBaseUrl: rawVal,
                              erp_base_url: rawVal,
                              erpUrl: rawVal,
                              ...(extractedSlug && extractedSlug.toLowerCase() !== 'api' && extractedSlug.toLowerCase() !== 'login'
                                ? { erpRouteId: extractedSlug, erp_route_id: extractedSlug }
                                : {}),
                            });
                          }}
                          onBlur={e => {
                            const parsed = parseInovafarmaUrlAndRoute(
                              e.target.value,
                              editData.erpRouteId ?? editData.erp_route_id,
                            );
                            setEditData(prev => ({
                              ...prev,
                              erpBaseUrl: parsed.origin,
                              erp_base_url: parsed.origin,
                              erpUrl: parsed.origin,
                              erpRouteId: parsed.routeId,
                              erp_route_id: parsed.routeId,
                            }));
                          }}
                          placeholder="https://integracao.portalps.app"
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Slug / Identificador da Rota (`&#123;integracao&#125;`)</label>
                          <input
                            type="text"
                            className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black"
                            value={editData.erpRouteId ?? editData.erp_route_id ?? INOVAFARMA_DEFAULT_ROUTE_ID}
                            onChange={e => setEditData({ ...editData, erpRouteId: e.target.value, erp_route_id: e.target.value })}
                            placeholder="homologacao"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">CNPJ da Integração (Header `cnpj`)</label>
                          <input
                            type="text"
                            className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black"
                            value={editData.erpCnpj ?? editData.erp_cnpj ?? editData.cnpj ?? ''}
                            onChange={e => setEditData({ ...editData, erpCnpj: e.target.value, erp_cnpj: e.target.value })}
                            placeholder="02433981097173"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Tipo de ERP</label>
                      <select className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black" value={editData.erpType || ''} onChange={e => setEditData({...editData, erpType: e.target.value})}>
                        <option value="">Selecione o tipo de ERP</option>
                        <option value="inovafarma">InovaFarma (Portal PS)</option>
                        <option value="siagold">Siagold</option>
                        <option value="softpharma">Softpharma</option>
                        <option value="outros">Outros</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Login da API (ERP / Inovafarma)</label>
                      <input
                        type="text"
                        autoComplete="off"
                        className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black"
                        value={editData.erp_login || editData.erpApiLogin || editData.erp_api_login || ''}
                        onChange={e => setEditData({ ...editData, erp_login: e.target.value, erpApiLogin: e.target.value, erp_api_login: e.target.value })}
                        placeholder="Login de acesso da API do Inovafarma"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Senha da API (ERP / Inovafarma)</label>
                      <input
                        type="password"
                        autoComplete="new-password"
                        className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black"
                        value={editData.erp_password || editData.erpApiPassword || ''}
                        onChange={e => setEditData({ ...editData, erp_password: e.target.value, erpApiPassword: e.target.value, erp_api_password: e.target.value })}
                        placeholder={editData.hasErpApiPassword ? '•••••••••••• (Digite apenas para alterar)' : 'Senha da API do Inovafarma'}
                      />
                    </div>
                </div>

                <div className="bg-emerald-50 p-8 rounded-[2.5rem] border border-emerald-100 space-y-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Key size={16} className="text-emerald-700" />
                      <span className="text-[11px] font-black text-emerald-700 uppercase tracking-widest">Credenciais de Acesso</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">E-mail Administrativo *</label>
                          <input type="email" className={`w-full bg-white p-4 rounded-2xl border-2 ${isFieldInvalid(editData.admin_email) ? 'border-red-500' : 'border-gray-200'} outline-none font-bold text-black`} value={editData.admin_email} onChange={e => setEditData({...editData, admin_email: e.target.value})} placeholder="admin@drogaria.com" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Senha de Acesso {isNewTenant ? '*' : '(Opcional)'}</label>
                          <input type="text" className={`w-full bg-white p-4 rounded-2xl border-2 ${isNewTenant && isFieldInvalid(editData.admin_password) ? 'border-red-500' : 'border-gray-200'} outline-none font-bold text-black`} value={editData.admin_password} onChange={e => setEditData({...editData, admin_password: e.target.value})} placeholder={isNewTenant ? "••••••••" : "Deixe em branco para manter"} />
                        </div>
                    </div>
                </div>

                <div className="bg-gray-50 p-8 rounded-[2.5rem] border border-gray-100 space-y-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Palette size={16} className="text-gray-700" />
                      <span className="text-[11px] font-black text-gray-700 uppercase tracking-widest">Personalização Inicial</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-gray-500 ml-1">Primária</label>
                            <div className="flex items-center gap-2 bg-white p-2 rounded-xl border-2 border-gray-200">
                                <input type="color" className="w-8 h-8 rounded-lg border-none bg-transparent cursor-pointer" value={editData.primaryColor} onChange={e => setEditData({...editData, primaryColor: e.target.value})} />
                                <span className="text-[10px] font-bold text-gray-400">{editData.primaryColor}</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-gray-500 ml-1">Secundária</label>
                            <div className="flex items-center gap-2 bg-white p-2 rounded-xl border-2 border-gray-200">
                                <input type="color" className="w-8 h-8 rounded-lg border-none bg-transparent cursor-pointer" value={editData.secondaryColor} onChange={e => setEditData({...editData, secondaryColor: e.target.value})} />
                                <span className="text-[10px] font-bold text-gray-400">{editData.secondaryColor}</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase text-gray-500 ml-1">Destaque</label>
                            <div className="flex items-center gap-2 bg-white p-2 rounded-xl border-2 border-gray-200">
                                <input type="color" className="w-8 h-8 rounded-lg border-none bg-transparent cursor-pointer" value={editData.accentColor} onChange={e => setEditData({...editData, accentColor: e.target.value})} />
                                <span className="text-[10px] font-bold text-gray-400">{editData.accentColor}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-blue-50 p-8 rounded-[2.5rem] border border-blue-100 space-y-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar size={16} className="text-blue-700" />
                      <span className="text-[11px] font-black text-blue-700 uppercase tracking-widest">Licenciamento</span>
                    </div>
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Selecionar Plano de Renovação</label>
                            <div className="flex p-1.5 bg-white border-2 border-blue-100 rounded-2xl gap-1">
                                {[{ id: 'monthly', label: 'Mensal' }, { id: 'semiannual', label: 'Semestral' }, { id: 'annual', label: 'Anual' }].map((p) => (
                                    <button key={p.id} type="button" onClick={() => setSelectedPeriod(p.id as RenewalPeriod)} className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${selectedPeriod === p.id ? 'bg-blue-600 text-white shadow-md' : 'text-blue-400 hover:bg-blue-50'}`}>{p.label}</button>
                                ))}
                            </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-black uppercase text-gray-800 ml-2">Data de Vencimento</label>
                          <div className="flex gap-2">
                              <input type="date" className="flex-1 bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black" value={editData.licenseExpiration || ''} onChange={e => setEditData({...editData, licenseExpiration: e.target.value})} />
                              <button onClick={handleApplyRenewal} className="bg-blue-600 text-white px-6 rounded-2xl font-black text-xs flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg active:scale-95"><RefreshCw size={16} /> Aplicar</button>
                          </div>
                        </div>
                    </div>
                </div>

                <div className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100 space-y-6">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={16} className="text-indigo-700" />
                        <span className="text-[11px] font-black text-indigo-700 uppercase tracking-widest">Add-ons e Módulos Especiais</span>
                      </div>
                      <span className="text-[9px] font-black bg-indigo-200/60 text-indigo-800 px-2.5 py-0.5 rounded-full uppercase tracking-wider">Controle Master</span>
                    </div>
                    
                    <label className="flex items-center gap-4 cursor-pointer group bg-white p-4 rounded-2xl border-2 border-indigo-100 hover:border-indigo-300 transition-colors">
                        <div className="relative">
                            <input type="checkbox" className="sr-only" checked={editData.isChatEnabled || false} onChange={e => setEditData({...editData, isChatEnabled: e.target.checked})} />
                            <div className={`block w-14 h-8 rounded-full transition-colors ${editData.isChatEnabled ? 'bg-indigo-500' : 'bg-gray-300'}`}></div>
                            <div className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${editData.isChatEnabled ? 'transform translate-x-6' : ''}`}></div>
                        </div>
                        <div>
                            <p className="font-bold text-gray-900 text-sm group-hover:text-indigo-700 transition-colors">Módulo de Chat Multi-Atendentes</p>
                            <p className="text-xs text-gray-500">Ativa a interface de Chat e a conexão com WhatsApp via Z-API para esta loja.</p>
                        </div>
                    </label>

                                        {/* Master Switch para o Assistente de IA dos Atendentes (Copilot) */}
                    <label className="flex items-center gap-4 cursor-pointer group bg-gradient-to-r from-blue-50 via-indigo-50/50 to-purple-50 p-4 rounded-2xl border-2 border-indigo-200 hover:border-indigo-400 transition-all shadow-sm">
                        <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only" 
                              checked={editData.isAiCopilotEnabled || false} 
                              onChange={e => setEditData({...editData, isAiCopilotEnabled: e.target.checked})} 
                            />
                            <div className={`block w-14 h-8 rounded-full transition-colors ${editData.isAiCopilotEnabled ? 'bg-indigo-600' : 'bg-gray-300'}`}></div>
                            <div className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${editData.isAiCopilotEnabled ? 'transform translate-x-6' : ''}`}></div>
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className="p-1 rounded-lg bg-indigo-100 text-indigo-700"><Sparkles size={16} /></span>
                                <p className="font-bold text-gray-900 text-sm group-hover:text-indigo-700 transition-colors">Módulo de Assistente de IA para Atendentes (Co-piloto do Chat)</p>
                                <span className="text-[9px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Upgrade / Plano PRO</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">Habilita as ferramentas de IA na tela de chat para os operadores corrigirem textos, ajustarem o tom para empático, resumirem ou criarem respostas a partir de tópicos.</p>
                        </div>
                    </label>

                    {/* Master Switch para o Agente de IA */}
                    <label className="flex items-center gap-4 cursor-pointer group bg-gradient-to-r from-purple-50 via-white to-indigo-50 p-4 rounded-2xl border-2 border-purple-200 hover:border-purple-400 transition-all shadow-sm">
                        <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only" 
                              checked={editData.isAiAgentEnabled || false} 
                              onChange={e => setEditData({...editData, isAiAgentEnabled: e.target.checked})} 
                            />
                            <div className={`block w-14 h-8 rounded-full transition-colors ${editData.isAiAgentEnabled ? 'bg-purple-600' : 'bg-gray-300'}`}></div>
                            <div className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${editData.isAiAgentEnabled ? 'transform translate-x-6' : ''}`}></div>
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className="p-1 rounded-lg bg-purple-100 text-purple-700"><Bot size={16} /></span>
                                <p className="font-bold text-gray-900 text-sm group-hover:text-purple-700 transition-colors">Módulo de Agente de IA (Atendente Inteligente)</p>
                                <span className="text-[9px] font-black bg-purple-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Upgrade / Plano PRO</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">Autoriza esta drogaria a configurar sua chave de API e ativar o Atendente Virtual de IA com direcionamento para a Webloja.</p>
                        </div>
                    </label>
                </div>

                <div className="flex justify-end gap-4 mt-10">
                    <button type="button" onClick={() => setIsEditing(false)} className="px-8 py-4 font-black text-gray-500 uppercase text-xs tracking-widest">Cancelar</button>
                    <button type="button" onClick={handleSave} disabled={loading} className="bg-emerald-600 text-white px-12 py-5 rounded-3xl font-black shadow-xl active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50">
                      {loading ? <Loader2 className="animate-spin" /> : (isNewTenant ? 'Salvar Drogaria' : 'Atualizar Drogaria')}
                    </button>
                </div>
             </div>
          </div>
        </div>
      )}
      {isBackupOpen && selectedTenantForBackup && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl p-8 overflow-y-auto max-h-[90vh] animate-in zoom-in-95 flex flex-col">
                  <div className="flex justify-between items-center mb-8 shrink-0">
                      <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                              <Database size={24} />
                          </div>
                          <div>
                              <h3 className="text-2xl font-black text-gray-900">Backup as a Service</h3>
                              <p className="text-sm font-bold text-gray-400">Empresa: {selectedTenantForBackup.name}</p>
                          </div>
                      </div>
                      <button onClick={() => setIsBackupOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500"><X size={24}/></button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                      <div className="bg-gray-50 p-8 rounded-[2.5rem] border border-gray-100 space-y-6">
                          <div className="flex items-center gap-2 mb-2">
                              <RefreshCw size={16} className="text-gray-700" />
                              <span className="text-[11px] font-black text-gray-700 uppercase tracking-widest">Configuração de Periodicidade</span>
                          </div>
                          <div className="space-y-4">
                              <select 
                                  value={backupConfig.frequency}
                                  onChange={(e) => setBackupConfig({ ...backupConfig, frequency: e.target.value })}
                                  className="w-full bg-white p-4 rounded-2xl border-2 border-gray-200 outline-none font-bold text-black"
                              >
                                  <option value="OFF">Desativado</option>
                                  <option value="WEEKLY">Semanal (Todo Domingo)</option>
                                  <option value="BIWEEKLY">Quinzenal (Dias 01 e 15)</option>
                                  <option value="MONTHLY">Mensal (Dia 01)</option>
                              </select>
                              <button 
                                  onClick={handleSaveBackupConfig}
                                  className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                              >
                                  Salvar Configuração
                              </button>
                          </div>
                      </div>

                      <div className="bg-emerald-50 p-8 rounded-[2.5rem] border border-emerald-100 space-y-6">
                          <div className="flex items-center gap-2 mb-2">
                              <ShieldCheck size={16} className="text-emerald-700" />
                              <span className="text-[11px] font-black text-emerald-700 uppercase tracking-widest">Gerar e Baixar Agora</span>
                          </div>
                          <p className="text-xs font-medium text-emerald-800">Realiza o dump em tempo real e oferece o download imediato.</p>
                          
                          {exportProgress.active ? (
                              <div className="space-y-3">
                                  <div className="flex justify-between items-center text-[10px] font-black text-emerald-700 uppercase">
                                      <span>{exportProgress.message}</span>
                                      <span>{exportProgress.progress}%</span>
                                  </div>
                                  <div className="w-full bg-emerald-100 rounded-full h-2 overflow-hidden">
                                      <div className="bg-emerald-500 h-2 rounded-full transition-all duration-500" style={{ width: `${exportProgress.progress}%` }}></div>
                                  </div>
                              </div>
                          ) : (
                              <div className="grid grid-cols-2 gap-3">
                                  <button 
                                      onClick={() => handleGerarEBaixar('sql')}
                                      className="bg-emerald-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 text-xs"
                                  >
                                      <FileCode size={16} /> Exportar SQL
                                  </button>
                                  <button 
                                      onClick={() => handleGerarEBaixar('csv')}
                                      className="bg-white text-emerald-600 border-2 border-emerald-600 py-4 rounded-2xl font-black shadow-lg hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 text-xs"
                                  >
                                      <FileText size={16} /> Exportar CSV
                                  </button>
                              </div>
                          )}
                          
                          <button 
                              onClick={handleDownloadLatest}
                              className="w-full bg-gray-900 text-white py-3 rounded-xl font-bold text-xs hover:bg-black transition-all flex items-center justify-center gap-2 mt-2"
                          >
                              <Download size={14} /> Baixar Último Backup JSON Completo (.JSON)
                          </button>
                      </div>
                  </div>

                  <div className="bg-red-50 p-8 rounded-[2.5rem] border border-red-100 mb-8 space-y-6">
                      <div className="flex items-center gap-2 mb-2">
                          <AlertCircle size={16} className="text-red-700" />
                          <span className="text-[11px] font-black text-red-700 uppercase tracking-widest">Recuperação de Desastres</span>
                      </div>
                      <p className="text-xs font-medium text-red-800">Restaure os dados da empresa a partir de um arquivo de backup (.json). Esta ação é irreversível.</p>
                      
                      {restoreStatus ? (
                          <div className="bg-white p-6 rounded-2xl border border-red-200 space-y-4">
                              <div className="flex justify-between items-center text-sm font-bold text-gray-800">
                                  <span>{restoreStatus.message}</span>
                                  <span>{restoreStatus.progress}%</span>
                              </div>
                              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                  <div className="bg-red-500 h-2 rounded-full transition-all duration-500" style={{ width: `${restoreStatus.progress}%` }}></div>
                              </div>
                          </div>
                      ) : (
                          <div className="flex items-center gap-4">
                              <input 
                                  type="file" 
                                  accept=".json" 
                                  className="hidden" 
                                  ref={fileInputRef}
                                  onChange={handleRestoreBackup}
                              />
                              <button 
                                  onClick={() => fileInputRef.current?.click()}
                                  className="w-full bg-red-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-red-700 transition-all flex items-center justify-center gap-2"
                              >
                                  <HardDriveDownload size={16} /> Restaurar Backup
                              </button>
                          </div>
                      )}
                  </div>

                  <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex items-center gap-2 mb-4">
                          <History size={16} className="text-gray-400" />
                          <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Histórico de Backups</span>
                      </div>
                      
                      <div className="overflow-y-auto flex-1 pr-2 space-y-3">
                          {backupLogs.length === 0 ? (
                              <div className="py-10 text-center text-gray-400 font-bold">Nenhum backup realizado ainda.</div>
                          ) : (
                              backupLogs.map(log => (
                                  <div key={log.id} className="bg-white border border-gray-100 p-4 rounded-2xl flex justify-between items-center shadow-sm">
                                      <div className="flex items-center gap-4">
                                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                              {log.status === 'SUCCESS' ? <Check size={20} /> : <AlertCircle size={20} />}
                                          </div>
                                          <div>
                                              <p className="font-bold text-gray-900 text-sm">{log.fileName}</p>
                                              <p className="text-[10px] text-gray-400 font-black uppercase">{new Date(log.date).toLocaleString()} • {(log.fileSize / 1024).toFixed(2)} KB</p>
                                          </div>
                                      </div>
                                      {log.status === 'SUCCESS' && (
                                          <button className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Download Indisponível (Apenas Logs)">
                                              <HardDriveDownload size={20} />
                                          </button>
                                      )}
                                  </div>
                              ))
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {isPendingImagesOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl rounded-[2.5rem] p-8 max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-8 sticky top-0 bg-white z-10 pb-4 border-b">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center">
                            <AlertCircle size={24} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-gray-900 tracking-tight">Painel de Pendências (IA)</h3>
                            <p className="text-sm font-bold text-gray-400 mt-1">
                                {pendingImagesProducts.length} produtos aguardando curadoria de imagem
                            </p>
                        </div>
                    </div>
                    <button onClick={() => setIsPendingImagesOpen(false)} className="p-3 bg-gray-50 rounded-full hover:text-red-500 transition-colors">
                        <X size={24}/>
                    </button>
                </div>

                {pendingImagesProducts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-4">
                            <Check size={40} />
                        </div>
                        <h4 className="text-xl font-black text-gray-900">Tudo Certo!</h4>
                        <p className="text-gray-500 font-medium mt-2">Nenhum produto está com imagem pendente.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pendingImagesProducts.map(product => (
                            <div key={product.id} className="border border-gray-100 p-4 rounded-2xl flex gap-4 items-center bg-gray-50">
                                <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center border border-gray-200 shrink-0">
                                    <Palette size={24} className="text-gray-300" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h5 className="font-bold text-gray-900 truncate">{product.name}</h5>
                                    <p className="text-xs text-gray-500 truncate">{product.manufacturer}</p>
                                    <div className="flex gap-2 mt-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest bg-white px-2 py-1 rounded-md text-gray-400 border border-gray-100">
                                            EAN: {product.barcode || 'N/A'}
                                        </span>
                                    </div>
                                </div>
                                <a 
                                    href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${product.barcode} ${product.name} ${product.manufacturer}`)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-3 bg-white text-brand rounded-xl shadow-sm hover:bg-brand hover:text-brand-contrast transition-colors"
                                    title="Buscar no Google Imagens"
                                >
                                    <Search size={18} />
                                </a>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
      )}

      {isQueueDashboardOpen && queueStats && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl p-8 overflow-y-auto max-h-[90vh] animate-in zoom-in-95 flex flex-col">
                  <div className="flex justify-between items-center mb-8 shrink-0">
                      <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
                              <Database size={24} />
                          </div>
                          <div>
                              <h3 className="text-2xl font-black text-gray-900">Dashboard de Filas</h3>
                              <p className="text-sm font-bold text-gray-400">Monitoramento em tempo real</p>
                          </div>
                      </div>
                      <button onClick={() => setIsQueueDashboardOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500"><X size={24}/></button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                      <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 flex flex-col items-center justify-center text-center">
                          <span className="text-4xl font-black text-gray-900 mb-2">{queueStats.pending}</span>
                          <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">Mensagens Pendentes</span>
                      </div>
                      <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 flex flex-col items-center justify-center text-center">
                          <span className="text-4xl font-black text-emerald-600 mb-2">{queueStats.processed24h}</span>
                          <span className="text-sm font-bold text-emerald-800 uppercase tracking-wider">Processadas (24h)</span>
                      </div>
                      <div className="bg-red-50 p-6 rounded-3xl border border-red-100 flex flex-col items-center justify-center text-center">
                          <span className="text-4xl font-black text-red-600 mb-2">{queueStats.failed}</span>
                          <span className="text-sm font-bold text-red-800 uppercase tracking-wider">Falhas na Fila</span>
                      </div>
                      <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 flex flex-col items-center justify-center text-center">
                          <span className="text-4xl font-black text-blue-600 mb-2">{queueStats.memoryUsageMB} MB</span>
                          <span className="text-sm font-bold text-blue-800 uppercase tracking-wider">Uso de Memória</span>
                      </div>
                  </div>
                  
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3">
                      <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={20} />
                      <div>
                          <h4 className="font-bold text-amber-900">Saúde do Sistema</h4>
                          <p className="text-sm text-amber-800 mt-1">O sistema processa até 20 mensagens simultaneamente. Vendas (SALE) têm prioridade sobre entradas (PURCHASE). Em caso de falha, o sistema tenta reprocessar até 3 vezes com intervalo crescente (Exponential Backoff).</p>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {isIntegrationOpen && selectedTenantForIntegration && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl p-8 overflow-y-auto max-h-[90vh] animate-in zoom-in-95 flex flex-col">
                  <div className="flex justify-between items-center mb-6 shrink-0">
                      <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center">
                              <Link size={24} />
                          </div>
                          <div>
                              <h3 className="text-2xl font-black text-gray-900">Integração ERP/PDV (Inovafarma)</h3>
                              <p className="text-sm font-bold text-gray-400">Empresa: {selectedTenantForIntegration.name}</p>
                          </div>
                      </div>
                      <div className="flex items-center gap-3">
                          <button
                              type="button"
                              onClick={handleSyncTenantInovafarma}
                              disabled={isSyncingInovafarma}
                              className="px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
                          >
                              {isSyncingInovafarma ? (
                                  <>
                                      <Loader2 size={16} className="animate-spin" />
                                      Sincronizando...
                                  </>
                              ) : (
                                  <>
                                      <RefreshCw size={16} />
                                      Sincronizar Agora com Inovafarma
                                  </>
                              )}
                          </button>
                          <button onClick={() => setIsIntegrationOpen(false)} className="p-2 bg-gray-50 rounded-full hover:text-red-500"><X size={24}/></button>
                      </div>
                  </div>

                  {inovafarmaSyncFeedback && (
                      <div
                          className={`mb-6 p-4 rounded-2xl border flex items-start justify-between gap-3 ${
                              inovafarmaSyncFeedback.type === 'success'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                  : 'bg-red-50 border-red-200 text-red-900'
                          }`}
                      >
                          <div>
                              <p className="font-black text-sm">{inovafarmaSyncFeedback.message}</p>
                              {inovafarmaSyncFeedback.details && (
                                  <p className="text-xs opacity-80 mt-1">{inovafarmaSyncFeedback.details}</p>
                              )}
                          </div>
                          <button
                              type="button"
                              onClick={() => setInovafarmaSyncFeedback(null)}
                              className="text-xs font-bold opacity-60 hover:opacity-100"
                          >
                              Fechar
                          </button>
                      </div>
                  )}

                  <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 mb-8">
                      <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                          <Key size={20} className="text-purple-600" />
                          Credenciais de Integração
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Integration Token (Header x-api-key)</label>
                              <div className="flex items-center gap-2">
                                  <input 
                                      type="text" 
                                      readOnly 
                                      value={selectedTenantForIntegration.integrationToken || 'Token não gerado. Edite a empresa e salve.'} 
                                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-600"
                                  />
                                  <button 
                                      onClick={() => {
                                          if (!selectedTenantForIntegration.integrationToken) return;
                                          navigator.clipboard.writeText(selectedTenantForIntegration.integrationToken);
                                          setCopiedWebhookField('token');
                                          setTimeout(() => setCopiedWebhookField(null), 2000);
                                      }}
                                      className="p-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 text-xs font-bold"
                                  >
                                      {copiedWebhookField === 'token' ? 'Copiado!' : 'Copiar'}
                                  </button>
                              </div>
                              <p className="text-xs text-gray-400 mt-2">Envie este token no header <code className="bg-gray-100 px-1 rounded">x-api-key</code> das requisições do PDV.</p>
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Portal PS / Inovafarma API</label>
                              <div className="flex items-center gap-2">
                                  <input 
                                      type="text" 
                                      readOnly 
                                      value={selectedTenantForIntegration.erpUrl || INOVAFARMA_DEFAULT_API_URL} 
                                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono text-gray-600"
                                  />
                                  <button 
                                      onClick={() => {
                                          navigator.clipboard.writeText(selectedTenantForIntegration.erpUrl || INOVAFARMA_DEFAULT_API_URL);
                                          setCopiedWebhookField('erp_url');
                                          setTimeout(() => setCopiedWebhookField(null), 2000);
                                      }}
                                      className="p-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 text-xs font-bold"
                                  >
                                      {copiedWebhookField === 'erp_url' ? 'Copiado!' : 'Copiar'}
                                  </button>
                              </div>
                          </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-gray-200">
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Webhooks de Entrada (PDV -&gt; FarmaFlow)</label>
                          
                          <div className="mb-3">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Venda / Baixa de Estoque (POST com header x-api-key)</label>
                              <div className="flex items-center gap-2">
                                  <input 
                                      type="text" 
                                      readOnly 
                                      value={`${window.location.origin}/api/integration/venda`} 
                                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-xs font-mono text-gray-600"
                                  />
                                  <button 
                                      onClick={() => {
                                          navigator.clipboard.writeText(`${window.location.origin}/api/integration/venda`);
                                          setCopiedWebhookField('venda');
                                          setTimeout(() => setCopiedWebhookField(null), 2000);
                                      }}
                                      className="p-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 text-xs font-bold"
                                  >
                                      {copiedWebhookField === 'venda' ? 'Copiado!' : 'Copiar'}
                                  </button>
                              </div>
                          </div>

                          <div>
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Compra / Entrada de Mercadoria (POST com header x-api-key)</label>
                              <div className="flex items-center gap-2">
                                  <input 
                                      type="text" 
                                      readOnly 
                                      value={`${window.location.origin}/api/integration/compra`} 
                                      className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-xs font-mono text-gray-600"
                                  />
                                  <button 
                                      onClick={() => {
                                          navigator.clipboard.writeText(`${window.location.origin}/api/integration/compra`);
                                          setCopiedWebhookField('compra');
                                          setTimeout(() => setCopiedWebhookField(null), 2000);
                                      }}
                                      className="p-2 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 text-xs font-bold"
                                  >
                                      {copiedWebhookField === 'compra' ? 'Copiado!' : 'Copiar'}
                                  </button>
                              </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-2">Envie o header <code className="bg-gray-100 px-1 rounded">x-api-key</code> com o Integration Token da drogaria nas rotas <code className="bg-gray-100 px-1 rounded">/api/integration/venda</code> e <code className="bg-gray-100 px-1 rounded">/api/integration/compra</code>.</p>
                      </div>
                      <div className="mt-4 pt-4 border-t border-gray-200 flex items-center gap-6">
                          <a href="/api-docs" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-700 font-bold text-sm flex items-center gap-1">
                              <FileText size={16} /> Ver Documentação da API (Swagger)
                          </a>
                          <a href="https://guiaintegracao.portalps.app/" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-700 font-bold text-sm flex items-center gap-1">
                              <ExternalLink size={16} /> Guia de Integração Inovafarma (Portal PS)
                          </a>
                      </div>
                  </div>

                  <div>
                      <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                          <History size={20} className="text-gray-400" />
                          Logs Recentes de Integração
                      </h4>
                      
                      {integrationLogs.length === 0 ? (
                          <div className="text-center py-8 bg-gray-50 rounded-3xl border border-gray-100">
                              <p className="text-gray-500 font-medium">Nenhum log de integração encontrado.</p>
                          </div>
                      ) : (
                          <div className="space-y-3">
                              {integrationLogs.map((log: any) => (
                                  <div key={log.id} className="bg-white border border-gray-100 p-4 rounded-2xl flex items-start gap-4 shadow-sm">
                                      <div className={`p-2 rounded-xl shrink-0 ${log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                          {log.status === 'SUCCESS' ? <Check size={20} /> : <X size={20} />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                          <div className="flex justify-between items-start">
                                              <h5 className="font-bold text-gray-900 text-sm">{log.endpoint}</h5>
                                              <span className="text-xs text-gray-400 font-mono">
                                                  {new Date(log.created_at).toLocaleString()}
                                              </span>
                                          </div>
                                          {log.error_message && (
                                              <p className="text-xs text-red-500 mt-1 font-medium">{log.error_message}</p>
                                          )}
                                          <details className="mt-2">
                                              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 font-medium">Ver Payload</summary>
                                              <pre className="mt-2 text-[10px] bg-gray-50 p-2 rounded-lg overflow-x-auto text-gray-600 border border-gray-100">
                                                  {JSON.stringify(log.payload, null, 2)}
                                              </pre>
                                          </details>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};
