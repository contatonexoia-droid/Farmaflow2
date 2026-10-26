import React, { useState, useEffect } from 'react';
import { PharmacyConfig, AuthSession } from '../types';
import { UpsellCard } from './UpsellCard';
import { Tags, Zap, Upload, Palette, Phone, Building, Save, CheckCircle, Loader2, Type, MessageSquare, AlertTriangle, FileText, MapPin, Mail, DollarSign, BellRing, PlayCircle, Volume2, Store, CreditCard, Truck, Bot, Sparkles, Building2, ShieldCheck, UserCheck, Scale, Clock, RefreshCw, Key, Copy, Check, History, ExternalLink } from 'lucide-react';
import { ImageMigrationTool } from './ImageMigrationTool';
import { ControlledProductsMigrationTool } from './ControlledProductsMigrationTool';
import { SmartNumberInput } from './SmartNumberInput';
import { supabase } from '../services/supabase';
import { PaymentSettings } from './PaymentSettings';
import { DeliverySettings } from './DeliverySettings';
import { AiAgentSettings } from './AiAgentSettings';
import { TenantSelector } from './TenantSelector';
import { WelcomeSettings } from './WelcomeSettings';
import { StoreShareCard } from './StoreShareCard';
import {
  parseOperatingHoursFromText,
  buildOperatingHoursSummary,
  resolveTenantOperatingHours,
} from '../utils/operatingHours';
import { triggerInovafarmaSync, INOVAFARMA_DEFAULT_API_URL } from '../services/inovafarma';


export const formatCnpj = (value: string): string => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
};

const parseFullAddress = (fullAddress?: string) => {
  let cep = "", street = "", number = "", complement = "", neighborhood = "", city = "", state = "";
  if (!fullAddress) {
    return { cep, street, number, complement, neighborhood, city, state };
  }

  // 1. Try to extract CEP
  const cepMatch = fullAddress.match(/(\d{5}-?\d{3})/);
  if (cepMatch) {
    cep = cepMatch[1];
    if (cep.length === 8) {
      cep = cep.slice(0, 5) + "-" + cep.slice(5);
    }
    fullAddress = fullAddress.replace(cepMatch[0], '').replace(/,\s*CEP:\s*/i, '').replace(/\|\s*CEP:\s*/i, '').replace(/-\s*CEP:\s*/i, '').replace(/,\s*$/, '').trim();
  }

  fullAddress = fullAddress.replace(/,\s*$/, '').replace(/-\s*$/, '').replace(/\|\s*$/, '').trim();

  // 2. Parse by splitting
  const mainParts = fullAddress.split(/\s+-\s+/);
  
  if (mainParts.length >= 2) {
    const streetPart = mainParts[0].trim();
    const commaIndex = streetPart.indexOf(',');
    if (commaIndex !== -1) {
      street = streetPart.slice(0, commaIndex).trim();
      const numComp = streetPart.slice(commaIndex + 1).trim();
      const compMatch = numComp.match(/\(([^)]+)\)/);
      if (compMatch) {
        complement = compMatch[1].trim();
        number = numComp.replace(/\([^)]+\)/, '').trim();
      } else {
        number = numComp;
      }
    } else {
      street = streetPart;
    }

    const remaining = mainParts.slice(1).join(' - ').trim();
    const remainingCommaParts = remaining.split(',');
    if (remainingCommaParts.length >= 2) {
      neighborhood = remainingCommaParts[0].trim();
      const cityStatePart = remainingCommaParts[1].trim();
      const stateMatch = cityStatePart.match(/-\s*([A-Za-z]{2})$/);
      if (stateMatch) {
        state = stateMatch[1].toUpperCase();
        city = cityStatePart.replace(/-\s*[A-Za-z]{2}$/, '').trim();
      } else {
        city = cityStatePart;
      }
    } else {
      const subParts = remaining.split(/\s*-\s*/);
      if (subParts.length === 2) {
        city = subParts[0].trim();
        state = subParts[1].trim().toUpperCase();
      } else if (subParts.length >= 3) {
        neighborhood = subParts[0].trim();
        city = subParts[1].trim();
        state = subParts[2].trim().toUpperCase();
      } else {
        neighborhood = remaining;
      }
    }
  } else {
    const commaParts = fullAddress.split(',');
    if (commaParts.length >= 4) {
      street = commaParts[0].trim();
      number = commaParts[1].trim();
      neighborhood = commaParts[2].trim();
      
      const cityStatePart = commaParts[3].trim();
      const sub = cityStatePart.split(/\s*-\s*/);
      if (sub.length >= 2) {
        city = sub[0].trim();
        state = sub[1].trim().toUpperCase();
      } else {
        city = cityStatePart;
      }
    } else if (commaParts.length === 3) {
      street = commaParts[0].trim();
      number = commaParts[1].trim();
      
      const cityStatePart = commaParts[2].trim();
      const sub = cityStatePart.split(/\s*-\s*/);
      if (sub.length >= 2) {
        city = sub[0].trim();
        state = sub[1].trim().toUpperCase();
      } else {
        city = cityStatePart;
      }
    } else if (commaParts.length === 2) {
      street = commaParts[0].trim();
      const sub = commaParts[1].split(/\s*-\s*/);
      if (sub.length >= 2) {
        city = sub[0].trim();
        state = sub[1].trim().toUpperCase();
      } else {
        number = commaParts[1].trim();
      }
    } else {
      street = fullAddress;
    }
  }

  // Limpeza de segurança: impedir que dígitos ou prefixo do CEP contaminem bairro, cidade ou UF
  if (/^\d{4,8}/.test(neighborhood.trim()) || neighborhood.toLowerCase().includes("cep")) neighborhood = "";
  if (/^\d{4,8}/.test(city.trim()) || city.toLowerCase().includes("cep")) city = "";
  if (/^\d{4,8}/.test(state.trim()) || state.toLowerCase().includes("cep")) state = "";

  return { cep, street, number, complement, neighborhood, city, state };
};

interface AdminSettingsProps {
  config: PharmacyConfig;
  onConfigUpdate: (config: PharmacyConfig) => void;
  networkTenants?: PharmacyConfig[];
  onSelectTenant?: (tenant: PharmacyConfig) => void;
  session?: AuthSession;
  isMatrixUser?: boolean;
}

export const AdminSettings: React.FC<AdminSettingsProps> = ({ 
  config, 
  onConfigUpdate,
  networkTenants = [],
  onSelectTenant,
  session,
  isMatrixUser
}) => {
  const userRole = (session?.role || "").toLowerCase().trim();
  const isRestrictedRole = [
    "operador", 
    "balconista", 
    "atendente", 
    "farmaceutico", 
    "caixa", 
    "vendedor", 
    "entregador", 
    "gerente"
  ].includes(userRole);

  const effectiveIsMatrixUser = isRestrictedRole ? false : (
    isMatrixUser ?? (
      session?.type === 'SUPER_ADMIN' || 
      userRole === 'matriz' || 
      userRole === 'admin_matriz' || 
      userRole === 'network_admin' || 
      userRole === 'master' || 
      (config?.isNetworkMaster && (userRole === 'owner' || userRole === 'admin' || !userRole))
    )
  );

  const canSwitchStore = effectiveIsMatrixUser && networkTenants && networkTenants.length > 1 && !!onSelectTenant;

  const [activeTab, setActiveTab] = useState<'geral' | 'pagamentos' | 'entrega' | 'atendimento' | 'agente_ia'>('geral');
  const [formData, setFormData] = useState<PharmacyConfig>({ ...config });
  const [showSaved, setShowSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Estados da Integração Inovafarma (Portal PS)
  const [isSyncingInovafarma, setIsSyncingInovafarma] = useState(false);
  const [inovafarmaFeedback, setInovafarmaFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    details?: string;
    stats?: { totalFetched: number; insertedCount: number; updatedCount: number; skippedCount: number };
  } | null>(null);
  const [integrationLogs, setIntegrationLogs] = useState<any[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopyText = (text: string, fieldKey: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const fetchTenantIntegrationLogs = async (tenantId: string) => {
    if (!tenantId) return;
    setIsLoadingLogs(true);
    try {
      const res = await fetch(`/api/integration/logs/${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setIntegrationLogs(data.slice(0, 15));
        }
      }
    } catch (err) {
      console.error('Erro ao buscar logs de integração:', err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (config.id && activeTab === 'geral') {
      fetchTenantIntegrationLogs(config.id);
    }
  }, [config.id, activeTab]);

  const handleSyncInovafarmaNow = async () => {
    if (!config.id) return;
    setIsSyncingInovafarma(true);
    setInovafarmaFeedback(null);

    try {
      const tokenToUse = (formData.integrationToken || config.integrationToken || '').trim();
      const urlToUse = (formData.erpUrl || config.erpUrl || INOVAFARMA_DEFAULT_API_URL).trim();

      const result = await triggerInovafarmaSync({
        tenantId: config.id,
        erpUrl: urlToUse,
        apiToken: tokenToUse,
        ignoreErpPrices: Boolean(formData.ignore_erp_prices),
      });

      setInovafarmaFeedback({
        type: 'success',
        message: result.message || 'Sincronização com Inovafarma concluída com sucesso!',
        details: `Endpoint utilizado: ${result.endpointUsed}`,
        stats: {
          totalFetched: result.totalFetched,
          insertedCount: result.insertedCount,
          updatedCount: result.updatedCount,
          skippedCount: result.skippedCount,
        },
      });

      if (Array.isArray((result as any).logs)) {
        setIntegrationLogs((result as any).logs.slice(0, 15));
      } else {
        await fetchTenantIntegrationLogs(config.id);
      }
    } catch (err: any) {
      setInovafarmaFeedback({
        type: 'error',
        message: 'Falha ao sincronizar com Inovafarma (Portal PS)',
        details: err?.message || 'Verifique se o Token Bearer/API Key e a URL da API estão configurados corretamente.',
      });
      await fetchTenantIntegrationLogs(config.id);
    } finally {
      setIsSyncingInovafarma(false);
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
          // Assegura que bairro receba data.bairro, cidade receba data.localidade e uf receba data.uf, impedindo que inputs recebam o valor do CEP
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
          setCepError("");
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

  useEffect(() => {
    const resolvedHours = resolveTenantOperatingHours(config);
    setFormData({
      ...config,
      opening_time_weekdays: resolvedHours.weekdays.open,
      closing_time_weekdays: resolvedHours.weekdays.close,
      opening_time_saturdays: resolvedHours.saturday.open,
      closing_time_saturdays: resolvedHours.saturday.close,
      opening_time_sundays: resolvedHours.sunday.open,
      closing_time_sundays: resolvedHours.sunday.close,
      closed_on_sundays: resolvedHours.sunday.closed,
      is_24_hours: resolvedHours.is24Hours,
    });

    if (config.street || config.neighborhood || config.city || config.cep) {
      setAddressData({
        cep: config.cep || "",
        street: config.street || "",
        number: config.address_number || "",
        complement: config.complement || "",
        neighborhood: /^\d{4,8}/.test(config.neighborhood || "") ? "" : (config.neighborhood || ""),
        city: /^\d{4,8}/.test(config.city || "") ? "" : (config.city || ""),
        state: /^\d{4,8}/.test(config.state || "") ? "" : (config.state || "")
      });
    } else if (config.fullAddress) {
      const parsed = parseFullAddress(config.fullAddress);
      setAddressData(parsed);
    } else {
      setAddressData({
        cep: "",
        street: "",
        number: "",
        complement: "",
        neighborhood: "",
        city: "",
        state: ""
      });
    }
  }, [
    config.id,
    config.updatedAt,
    config.opening_time_weekdays,
    config.closing_time_weekdays,
    config.opening_time_sundays,
    config.closing_time_sundays,
    config.closed_on_sundays,
    config.is_24_hours,
    config.horario_funcionamento,
  ]);

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 10) {
      return numbers.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3').replace(/(\d{2})(\d{4})/, '($1) $2');
    }
    return numbers.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert("Apenas arquivos de imagem são permitidos.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) { 
      alert("A imagem é muito grande (Máx: 5MB). Por favor, escolha uma imagem menor.");
      return;
    }

    setIsUploadingLogo(true);
    try {
      const fileExt = file.name.split('.').pop() || 'png';
      const safeStoreId = (config.id || 'loja').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filePath = `logos/${safeStoreId}_logo_${Date.now()}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(filePath, file, {
          contentType: file.type,
          upsert: true
        });

      if (error) {
        console.warn("Upload direto para Supabase Storage falhou, gerando data URL:", error.message);
        const reader = new FileReader();
        reader.onload = (re) => {
          const base64 = re.target?.result as string;
          setFormData(prev => ({ ...prev, logo: base64, logo_url: base64 }));
        };
        reader.readAsDataURL(file);
      } else {
        const { data: publicUrlData } = supabase.storage
          .from('product-images')
          .getPublicUrl(filePath);

        const publicUrl = publicUrlData.publicUrl;
        setFormData(prev => ({
          ...prev,
          logo: publicUrl,
          logo_url: publicUrl
        }));
      }
    } catch (err: any) {
      console.error("Erro no upload do logotipo:", err);
      const reader = new FileReader();
      reader.onload = (re) => setFormData(prev => ({ ...prev, logo: re.target?.result as string, logo_url: re.target?.result as string }));
      reader.readAsDataURL(file);
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
        alert("Apenas arquivos de áudio (.mp3, .wav, .ogg) são permitidos.");
        return;
    }

    if (file.size > 2 * 1024 * 1024) {
        alert("O tamanho do áudio deve ser de no máximo 2MB.");
        return;
    }

    setIsUploadingAudio(true);
    setUploadProgress(10);
    try {
        const safeFileName = `${config.id}_custom_alert_${Date.now()}.${file.name.split('.').pop()}`;
        const { data, error } = await supabase.storage.from('product-images').upload(`sounds/${safeFileName}`, file, {
            contentType: file.type,
            upsert: true
        });

        if (error) throw error;
        
        setUploadProgress(80);

        const { data: publicUrlData } = supabase.storage.from('product-images').getPublicUrl(`sounds/${safeFileName}`);
        
        setFormData(prev => ({
            ...prev,
            notificationSound: publicUrlData.publicUrl
        }));
        
        setUploadProgress(100);
    } catch (err) {
        console.error("Erro ao subir audio:", err);
        alert("Erro ao enviar o áudio. Tente novamente.");
    } finally {
        setIsUploadingAudio(false);
        setUploadProgress(0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setShowSaved(false);

    const addr = addressData;
    let finalAddress = "";
    if (addr.street || addr.cep) {
      const streetNumComp = `${addr.street || ''}${addr.number ? ', ' + addr.number : ''}${addr.complement ? ' (' + addr.complement + ')' : ''}`.trim();
      const cityState = `${addr.city || ''}${addr.city && addr.state ? ' - ' + addr.state : (addr.state || '')}`.trim();
      
      if (streetNumComp) finalAddress += streetNumComp;
      if (addr.neighborhood) finalAddress += (finalAddress ? " - " : "") + addr.neighborhood;
      if (cityState) finalAddress += (finalAddress ? ", " : "") + cityState;
      if (addr.cep) finalAddress += (finalAddress ? " | CEP: " : "") + addr.cep;
    }

    const updatedFormData: PharmacyConfig = {
      ...formData,
      fullAddress: finalAddress || formData.fullAddress,
      street: addr.street || "",
      address_number: addr.number || "",
      complement: addr.complement || "",
      neighborhood: addr.neighborhood || "",
      city: addr.city || "",
      state: addr.state || "",
      cep: addr.cep || "",
      logradouro: addr.street || "",
      numero: addr.number || "",
      complemento: addr.complement || "",
      bairro: addr.neighborhood || "",
      cidade: addr.city || "",
      uf: addr.state || "",
      razao_social: formData.razao_social || formData.razaoSocial || "",
      razaoSocial: formData.razao_social || formData.razaoSocial || "",
      farmaceutico_responsavel: formData.farmaceutico_responsavel || formData.farmaceuticoResponsavel || "",
      farmaceuticoResponsavel: formData.farmaceutico_responsavel || formData.farmaceuticoResponsavel || "",
      crf: formData.crf || "",
      horario_funcionamento: formData.horario_funcionamento || formData.horarioFuncionamento || "",
      horarioFuncionamento: formData.horario_funcionamento || formData.horarioFuncionamento || "",
      opening_time_weekdays: formData.opening_time_weekdays || "07:00",
      closing_time_weekdays: formData.closing_time_weekdays || "23:00",
      opening_time_saturdays: formData.opening_time_saturdays || formData.opening_time_weekdays || "07:00",
      closing_time_saturdays: formData.closing_time_saturdays || formData.closing_time_weekdays || "23:00",
      opening_time_sundays: formData.opening_time_sundays || "07:00",
      closing_time_sundays: formData.closing_time_sundays || "21:00",
      closed_on_sundays: Boolean(formData.closed_on_sundays),
      is_24_hours: Boolean(formData.is_24_hours),
      telefone_contato: formData.telefone_contato || "",
      cnpj: formData.cnpj || "",
      logo: formData.logo_url || formData.logo || "",
      logo_url: formData.logo_url || formData.logo || "",
      logoUrl: formData.logo_url || formData.logo || "",
    };

    try {
        await onConfigUpdate(updatedFormData);
        setFormData(updatedFormData);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 3000);
    } catch (e: any) {
        console.error("Erro ao salvar configurações:", e);
        const msg = e.message || e.error_description || 'Erro desconhecido ao salvar. Verifique sua conexão.';
        setErrorMsg(msg);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <div className="bg-white p-10 md:p-14 rounded-[3.5rem] border border-gray-100 shadow-[0_20px_50px_rgba(0,0,0,0.02)]">
        
        {/* Header and Tabs */}
        <div className="mb-12">
          {canSwitchStore && (
            <div className="mb-6 p-4 bg-emerald-50/90 border border-emerald-200/80 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-xs shrink-0">
                  <Building2 size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-black uppercase text-emerald-800 tracking-wider">Unidade em Configuração:</span>
                    {config.isNetworkMaster && (
                      <span className="bg-purple-100 text-purple-700 text-[9px] font-black px-2 py-0.5 rounded-full uppercase">
                        Matriz
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm font-extrabold text-gray-900">{config.name}</h4>
                </div>
              </div>
              <div className="w-full sm:w-72 shrink-0">
                <TenantSelector
                  tenants={networkTenants}
                  currentTenant={config}
                  onSelectTenant={onSelectTenant!}
                  isMatrixUser={effectiveIsMatrixUser}
                  userRole={session?.role}
                  networkName={networkTenants.find(t => t.isNetworkMaster)?.name || "Rede FarmaFlow"}
                  className="w-full"
                />
              </div>
            </div>
          )}

          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Configurações da Drogaria</h2>
          <p className="text-gray-500 mt-2">Personalize a identidade visual, pagamentos online, atendimento e integrações de cada unidade.</p>
          <p className="text-xs text-gray-300 mt-1 font-mono">ID: {formData.id}</p>
          
          <div className="flex gap-4 mt-8 border-b border-gray-100 pb-4 overflow-x-auto whitespace-nowrap scrollbar-none">
            <button 
              onClick={() => setActiveTab('geral')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shrink-0 ${activeTab === 'geral' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <Store size={18} /> Geral e Visual
            </button>
            <button 
              onClick={() => setActiveTab('pagamentos')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shrink-0 ${activeTab === 'pagamentos' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <CreditCard size={18} /> Pagamentos Online
            </button>
            <button 
              onClick={() => setActiveTab('entrega')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shrink-0 ${activeTab === 'entrega' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <Truck size={18} /> Configurações de Entrega
            </button>
            <button 
              onClick={() => setActiveTab('atendimento')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shrink-0 ${activeTab === 'atendimento' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <MessageSquare size={18} /> Atendimento (Etiquetas e Atalhos)
            </button>
            <button 
              onClick={() => setActiveTab('agente_ia')}
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all shrink-0 ${
                activeTab === 'agente_ia' 
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20' 
                  : 'text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200'
              }`}
            >
              <Bot size={18} /> Agente de IA (Atendente)
              {config.isAiAgentEnabled && (
                <span className="text-[9px] font-black uppercase bg-purple-200 text-purple-900 px-2 py-0.5 rounded-full ml-1">
                  PRO
                </span>
              )}
            </button>
          </div>
        </div>

        {activeTab === 'geral' && (
          <div className="space-y-8 animate-in fade-in">
            <StoreShareCard tenant={formData} />

            <form onSubmit={handleSubmit} className="space-y-10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-8">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Building size={14} /> Nome da Drogaria
                </label>
                <input 
                  type="text"
                  className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Drogaria Central"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Phone size={14} /> WhatsApp de Vendas
                </label>
                <div className="flex gap-3">
                  <div className="bg-gray-100 border-2 border-transparent px-6 py-4 rounded-2xl font-black text-gray-400 flex items-center">
                    +55
                  </div>
                  <input 
                    type="tel"
                    className="flex-1 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                    value={formatPhone(formData.whatsapp)}
                    onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                  />
                </div>
                <p className="text-[10px] text-gray-400 italic px-1">Insira o DDD + Número (ex: 11999998888). Limite de 11 dígitos.</p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Upload size={14} /> Logotipo da Drogaria (WhatsApp & Redes Sociais)
                </label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                  <div className="w-24 h-24 bg-gray-50 rounded-[2rem] border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden shrink-0 shadow-xs relative">
                    {isUploadingLogo ? (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <Loader2 className="animate-spin text-emerald-600" size={24} />
                        <span className="text-[9px] font-bold text-gray-500">Enviando...</span>
                      </div>
                    ) : (formData.logo_url || formData.logo) ? (
                      <img 
                        src={formData.logo_url || formData.logo} 
                        className="w-full h-full object-contain p-2" 
                        alt="Preview" 
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "https://farmaflow.online/preview-share.png";
                        }}
                      />
                    ) : (
                      <Upload className="text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-2 w-full">
                    <div className="flex items-center gap-3">
                      <label className={`cursor-pointer bg-white border-2 border-gray-200 hover:border-emerald-600 text-gray-700 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 ${isUploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}>
                        <Upload size={14} />
                        {isUploadingLogo ? "Enviando ao Supabase Storage..." : "Selecionar Arquivo de Logo"}
                        <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} disabled={isUploadingLogo} />
                      </label>
                      {(formData.logo_url || formData.logo) && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, logo: "", logo_url: "" })}
                          className="text-xs text-red-500 hover:text-red-700 font-bold px-2 py-1"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                    <div className="mt-1">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1">
                        URL Pública do Logotipo (`logo_url`)
                      </label>
                      <input
                        type="url"
                        placeholder="https://...supabase.co/storage/v1/object/public/product-images/logos/... ou https://..."
                        value={formData.logo_url || formData.logo || ""}
                        onChange={(e) => setFormData({ ...formData, logo_url: e.target.value, logo: e.target.value })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-800 outline-none focus:border-emerald-500 transition-colors"
                      />
                      <p className="text-[10px] text-gray-400 mt-1">
                        Armazenado no bucket público do Supabase Storage para pré-visualização em links do WhatsApp e redes sociais. Fallback automático: <code>https://farmaflow.online/preview-share.png</code>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Palette size={14} /> Paleta de Cores da Marca
                </label>
                <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-2 items-center bg-gray-50 p-3 rounded-2xl border border-gray-100">
                        <span className="text-[9px] font-black uppercase text-gray-400">Primária</span>
                        <input 
                            type="color"
                            className="w-10 h-10 rounded-xl border-none cursor-pointer p-0 bg-transparent overflow-hidden"
                            value={formData.primaryColor || '#059669'}
                            onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })}
                        />
                    </div>
                    <div className="flex flex-col gap-2 items-center bg-gray-50 p-3 rounded-2xl border border-gray-100">
                        <span className="text-[9px] font-black uppercase text-gray-400">Secundária</span>
                        <input 
                            type="color"
                            className="w-10 h-10 rounded-xl border-none cursor-pointer p-0 bg-transparent overflow-hidden"
                            value={formData.secondaryColor || '#047857'}
                            onChange={(e) => setFormData({ ...formData, secondaryColor: e.target.value })}
                        />
                    </div>
                    <div className="flex flex-col gap-2 items-center bg-gray-50 p-3 rounded-2xl border border-gray-100">
                        <span className="text-[9px] font-black uppercase text-gray-400">Destaque</span>
                        <input 
                            type="color"
                            className="w-10 h-10 rounded-xl border-none cursor-pointer p-0 bg-transparent overflow-hidden"
                            value={formData.accentColor || '#f59e0b'}
                            onChange={(e) => setFormData({ ...formData, accentColor: e.target.value })}
                        />
                    </div>
                    <div className="flex flex-col gap-2 items-center bg-gray-50 p-3 rounded-2xl border border-gray-100">
                        <span className="text-[9px] font-black uppercase text-gray-400">Banner Cupom</span>
                        <input 
                            type="color"
                            className="w-10 h-10 rounded-xl border-none cursor-pointer p-0 bg-transparent overflow-hidden"
                            value={formData.couponBannerColor || '#10b981'}
                            onChange={(e) => setFormData({ ...formData, couponBannerColor: e.target.value })}
                        />
                    </div>
                </div>
              </div>

              <div className="space-y-2 pt-4 border-t border-gray-50">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={14} /> Valor Mínimo para Entrega
                </label>
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R$</span>
                  <SmartNumberInput 
                    isFloat={true}
                    className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 pl-14 pr-6 outline-none transition-all font-bold text-black relative z-0"
                    value={formData.minimumOrderValue || 0}
                    onChangeValue={(val) => setFormData({ ...formData, minimumOrderValue: val || 0 })}
                    placeholder="0.00"
                  />
                </div>
                <p className="text-[10px] text-gray-400 italic px-1">Valor mínimo em produtos para permitir a finalização do pedido. Deixe 0 para desativar.</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-50 pt-8">
             <div className="mb-6">
                 <h3 className="text-lg font-black text-gray-900">Dados Corporativos</h3>
                 <p className="text-sm text-gray-500">Informações que aparecerão nos documentos emitidos.</p>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <FileText size={14} /> CNPJ
                    </label>
                    <input 
                      type="text"
                      className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                      value={formData.cnpj || ''}
                      onChange={(e) => setFormData({ ...formData, cnpj: formatCnpj(e.target.value) })}
                      placeholder="00.000.000/0000-00"
                      maxLength={18}
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <Mail size={14} /> E-mail Corporativo
                    </label>
                    <input 
                      type="email"
                      className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                      value={formData.corporateEmail || ''}
                      onChange={(e) => setFormData({ ...formData, corporateEmail: e.target.value })}
                      placeholder="contato@drogaria.com"
                    />
                </div>
                <div className="md:col-span-2 bg-gray-50/50 p-6 md:p-8 rounded-[2rem] border border-gray-100 space-y-6">
                    <h4 className="text-xs font-black uppercase text-gray-500 tracking-wider flex items-center gap-2">
                      <MapPin size={14} className="text-brand" /> Endereço da Drogaria
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                          CEP {isFetchingCep && <Loader2 size={12} className="inline animate-spin text-brand" />}
                        </label>
                        <input 
                          type="text" 
                          className="w-full bg-white border-2 border-transparent focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black" 
                          value={addressData.cep} 
                          onChange={handleCepChange} 
                          placeholder="00000-000" 
                          maxLength={9}
                        />
                        {cepError && <span className="text-red-500 text-xs font-bold ml-2">{cepError}</span>}
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Logradouro</label>
                        <input 
                          type="text" 
                          className="w-full bg-white border-2 border-transparent focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black" 
                          value={addressData.street} 
                          onChange={e => setAddressData({...addressData, street: e.target.value})} 
                          placeholder="Rua / Avenida" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Número</label>
                        <input 
                          type="text" 
                          className="w-full bg-white border-2 border-transparent focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black" 
                          value={addressData.number} 
                          onChange={e => setAddressData({...addressData, number: e.target.value})} 
                          placeholder="123" 
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Complemento</label>
                        <input 
                          type="text" 
                          className="w-full bg-white border-2 border-transparent focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black" 
                          value={addressData.complement} 
                          onChange={e => setAddressData({...addressData, complement: e.target.value})} 
                          placeholder="Sala 1, Loja 2 (Opcional)" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Bairro</label>
                        <input 
                          type="text" 
                          className="w-full bg-white border-2 border-transparent focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black" 
                          value={addressData.neighborhood} 
                          onChange={e => setAddressData({...addressData, neighborhood: e.target.value})} 
                          placeholder="Centro" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Cidade</label>
                        <input 
                          type="text" 
                          className="w-full bg-white border-2 border-transparent focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black" 
                          value={addressData.city} 
                          onChange={e => setAddressData({...addressData, city: e.target.value})} 
                          placeholder="São Paulo" 
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">UF</label>
                        <select 
                          className="w-full bg-white border-2 border-transparent focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black" 
                          value={addressData.state} 
                          onChange={e => setAddressData({...addressData, state: e.target.value})}
                        >
                          <option value="">Selecione UF</option>
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
             </div>
          </div>

          {/* Seção de Dados Regulatórios e Farmacêuticos (Anvisa RDC 44/2009) */}
          <div className="border-t border-gray-50 pt-8">
            <div className="mb-6">
              <div className="flex items-center gap-2">
                <ShieldCheck size={20} className="text-emerald-600" />
                <h3 className="text-lg font-black text-gray-900">Dados Regulatórios e Farmacêuticos (Anvisa)</h3>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Informações legais exigidas pela RDC 44/2009 que serão exibidas no rodapé da sua loja online.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* 1. Razão Social */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Building size={14} /> Razão Social
                </label>
                <input
                  type="text"
                  className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                  value={formData.razao_social || formData.razaoSocial || ''}
                  onChange={(e) => setFormData({ ...formData, razao_social: e.target.value, razaoSocial: e.target.value })}
                  placeholder="Ex: Drogaria Trevo Ltda"
                />
              </div>

              {/* 2. CNPJ */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={14} /> CNPJ
                </label>
                <input
                  type="text"
                  className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                  value={formData.cnpj || ''}
                  onChange={(e) => setFormData({ ...formData, cnpj: formatCnpj(e.target.value) })}
                  placeholder="00.000.000/0000-00"
                  maxLength={18}
                />
              </div>

              {/* 3. Farmacêutico Responsável */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <UserCheck size={14} /> Farmacêutico Responsável
                </label>
                <input
                  type="text"
                  className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                  value={formData.farmaceutico_responsavel || formData.farmaceuticoResponsavel || ''}
                  onChange={(e) => setFormData({ ...formData, farmaceutico_responsavel: e.target.value, farmaceuticoResponsavel: e.target.value })}
                  placeholder="Ex: Dr. Nome Completo"
                />
              </div>

              {/* 4. CRF / Registro Profissional */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Scale size={14} /> CRF / Registro Profissional
                </label>
                <input
                  type="text"
                  className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                  value={formData.crf || ''}
                  onChange={(e) => setFormData({ ...formData, crf: e.target.value })}
                  placeholder="Ex: CRF/RJ - 12345"
                />
              </div>

              {/* 5. Horário de Funcionamento */}
              <div className="space-y-3 md:col-span-2 bg-gray-50/70 p-4 sm:p-5 rounded-2xl border border-gray-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                    <Clock size={14} className="text-emerald-600" /> Horário de Funcionamento (Selo Dinâmico da Loja)
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      checked={Boolean(formData.closed_on_sundays)}
                      onChange={(e) => {
                        const closedSun = e.target.checked;
                        const wOpen = formData.opening_time_weekdays || "07:00";
                        const wClose = formData.closing_time_weekdays || "23:00";
                        const sOpen = formData.opening_time_sundays || "07:00";
                        const sClose = formData.closing_time_sundays || "21:00";
                        const summary = buildOperatingHoursSummary(wOpen, wClose, sOpen, sClose, closedSun, formData.is_24_hours);
                        setFormData({
                          ...formData,
                          closed_on_sundays: closedSun,
                          horario_funcionamento: summary,
                          horarioFuncionamento: summary,
                        });
                      }}
                    />
                    Fechado aos domingos
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Segunda a Sábado */}
                  <div className="bg-white p-3.5 rounded-xl border border-gray-200/80 space-y-2">
                    <span className="text-[11px] font-extrabold text-gray-700 uppercase tracking-wider block">
                      Segunda a Sábado
                    </span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Abertura</span>
                        <input
                          type="time"
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-brand rounded-xl py-2 px-3 outline-none font-bold text-sm text-black"
                          value={formData.opening_time_weekdays || "07:00"}
                          onChange={(e) => {
                            const wOpen = e.target.value;
                            const wClose = formData.closing_time_weekdays || "23:00";
                            const sOpen = formData.opening_time_sundays || "07:00";
                            const sClose = formData.closing_time_sundays || "21:00";
                            const summary = buildOperatingHoursSummary(wOpen, wClose, sOpen, sClose, formData.closed_on_sundays, formData.is_24_hours);
                            setFormData({
                              ...formData,
                              opening_time_weekdays: wOpen,
                              opening_time_saturdays: wOpen,
                              horario_funcionamento: summary,
                              horarioFuncionamento: summary,
                            });
                          }}
                        />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Fechamento</span>
                        <input
                          type="time"
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-brand rounded-xl py-2 px-3 outline-none font-bold text-sm text-black"
                          value={formData.closing_time_weekdays || "23:00"}
                          onChange={(e) => {
                            const wOpen = formData.opening_time_weekdays || "07:00";
                            const wClose = e.target.value;
                            const sOpen = formData.opening_time_sundays || "07:00";
                            const sClose = formData.closing_time_sundays || "21:00";
                            const summary = buildOperatingHoursSummary(wOpen, wClose, sOpen, sClose, formData.closed_on_sundays, formData.is_24_hours);
                            setFormData({
                              ...formData,
                              closing_time_weekdays: wClose,
                              closing_time_saturdays: wClose,
                              horario_funcionamento: summary,
                              horarioFuncionamento: summary,
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Domingo */}
                  <div className={`bg-white p-3.5 rounded-xl border border-gray-200/80 space-y-2 transition-opacity ${formData.closed_on_sundays ? 'opacity-50 pointer-events-none' : ''}`}>
                    <span className="text-[11px] font-extrabold text-gray-700 uppercase tracking-wider block">
                      Domingo
                    </span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Abertura</span>
                        <input
                          type="time"
                          disabled={Boolean(formData.closed_on_sundays)}
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-brand rounded-xl py-2 px-3 outline-none font-bold text-sm text-black"
                          value={formData.opening_time_sundays || "07:00"}
                          onChange={(e) => {
                            const wOpen = formData.opening_time_weekdays || "07:00";
                            const wClose = formData.closing_time_weekdays || "23:00";
                            const sOpen = e.target.value;
                            const sClose = formData.closing_time_sundays || "21:00";
                            const summary = buildOperatingHoursSummary(wOpen, wClose, sOpen, sClose, formData.closed_on_sundays, formData.is_24_hours);
                            setFormData({
                              ...formData,
                              opening_time_sundays: sOpen,
                              horario_funcionamento: summary,
                              horarioFuncionamento: summary,
                            });
                          }}
                        />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Fechamento</span>
                        <input
                          type="time"
                          disabled={Boolean(formData.closed_on_sundays)}
                          className="w-full bg-gray-50 border border-gray-200 focus:bg-white focus:border-brand rounded-xl py-2 px-3 outline-none font-bold text-sm text-black"
                          value={formData.closing_time_sundays || "21:00"}
                          onChange={(e) => {
                            const wOpen = formData.opening_time_weekdays || "07:00";
                            const wClose = formData.closing_time_weekdays || "23:00";
                            const sOpen = formData.opening_time_sundays || "07:00";
                            const sClose = e.target.value;
                            const summary = buildOperatingHoursSummary(wOpen, wClose, sOpen, sClose, formData.closed_on_sundays, formData.is_24_hours);
                            setFormData({
                              ...formData,
                              closing_time_sundays: sClose,
                              horario_funcionamento: summary,
                              horarioFuncionamento: summary,
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                    Texto exibido no rodapé (sincronizado automaticamente ou personalizado)
                  </span>
                  <input
                    type="text"
                    className="w-full bg-white border-2 border-gray-200/80 focus:border-brand rounded-2xl py-3 px-4 outline-none transition-all font-bold text-sm text-black"
                    value={formData.horario_funcionamento || formData.horarioFuncionamento || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const parsed = parseOperatingHoursFromText(val);
                      setFormData({
                        ...formData,
                        horario_funcionamento: val,
                        horarioFuncionamento: val,
                        opening_time_weekdays: parsed.weekdays.open,
                        closing_time_weekdays: parsed.weekdays.close,
                        opening_time_saturdays: parsed.saturday.open,
                        closing_time_saturdays: parsed.saturday.close,
                        opening_time_sundays: parsed.sunday.open,
                        closing_time_sundays: parsed.sunday.close,
                        closed_on_sundays: parsed.sunday.closed,
                        is_24_hours: parsed.is24Hours,
                      });
                    }}
                    placeholder="Ex: Segunda a sábado das 07h às 23h e Domingo das 07h às 21h"
                  />
                </div>
              </div>

              {/* 6. Telefone de Contato / Atendimento */}
              <div className="space-y-2">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                  <Phone size={14} /> Telefone de Contato / Atendimento
                </label>
                <input
                  type="text"
                  className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                  value={formData.telefone_contato || ''}
                  onChange={(e) => setFormData({ ...formData, telefone_contato: formatPhone(e.target.value) })}
                  placeholder="Ex: (22) 99876-5432"
                  maxLength={15}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-50 pt-8">
             <div className="mb-6">
                 <h3 className="text-lg font-black text-gray-900">Personalização da Loja</h3>
                 <p className="text-sm text-gray-500">Defina os textos que aparecem no topo da sua loja online.</p>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <Type size={14} /> Título do Banner
                    </label>
                    <input 
                      type="text"
                      className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                      value={formData.bannerTitle || ''}
                      onChange={(e) => setFormData({ ...formData, bannerTitle: e.target.value })}
                      placeholder={formData.name || "Ex: Bem-vindo..."}
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <MessageSquare size={14} /> Subtítulo / Frase de Efeito
                    </label>
                    <input 
                      type="text"
                      className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-4 px-6 outline-none transition-all font-bold text-black"
                      value={formData.bannerSubtitle || ''}
                      onChange={(e) => setFormData({ ...formData, bannerSubtitle: e.target.value })}
                      placeholder="Ex: Encontre seus medicamentos aqui..."
                    />
                </div>
             </div>
          </div>

          <div className="border-t border-gray-50 pt-8">
             <div className="mb-6 flex items-center justify-between">
                 <div>
                     <h3 className="text-lg font-black text-gray-900">Banners Inteligentes</h3>
                     <p className="text-sm text-gray-500">Alterne automaticamente o banner da loja com base na categoria ou busca do cliente.</p>
                 </div>
                 <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={formData.enableSmartBanners || false}
                        onChange={(e) => setFormData({ ...formData, enableSmartBanners: e.target.checked })}
                    />
                    <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-brand"></div>
                 </label>
             </div>
             
             {formData.enableSmartBanners && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                    {[
                        { id: 'health', label: 'Saúde / Imunidade', desc: 'Exibido para vitaminas, gripes, etc.' },
                        { id: 'beauty', label: 'Higiene / Beleza', desc: 'Exibido para dermocosméticos, perfumaria.' },
                        { id: 'kids', label: 'Infantil', desc: 'Exibido para fraldas, leites, bebê.' },
                        { id: 'default', label: 'Padrão / Entrega Rápida', desc: 'Exibido quando nenhuma categoria específica é detectada.' }
                    ].map(banner => {
                        const currentConfig = formData.smartBanners?.[banner.id] || { enabled: true, imageUrl: '' };
                        return (
                            <div key={banner.id} className="bg-gray-50 p-5 rounded-3xl border border-gray-100 flex flex-col gap-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="font-black text-gray-900">{banner.label}</h4>
                                        <p className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">{banner.desc}</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            className="sr-only peer" 
                                            checked={currentConfig.enabled}
                                            onChange={(e) => {
                                                setFormData({
                                                    ...formData,
                                                    smartBanners: {
                                                        ...(formData.smartBanners || {}),
                                                        [banner.id]: { ...currentConfig, enabled: e.target.checked }
                                                    }
                                                });
                                            }}
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand"></div>
                                    </label>
                                </div>
                                
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Imagem Personalizada (Opcional)</label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text"
                                            className="flex-1 bg-white border border-gray-200 rounded-xl py-2 px-3 outline-none focus:border-brand transition-all text-xs font-bold text-gray-800"
                                            value={currentConfig.imageUrl || ''}
                                            onChange={(e) => {
                                                setFormData({
                                                    ...formData,
                                                    smartBanners: {
                                                        ...(formData.smartBanners || {}),
                                                        [banner.id]: { ...currentConfig, imageUrl: e.target.value }
                                                    }
                                                });
                                            }}
                                            placeholder="URL da imagem (https://...)"
                                        />
                                        {currentConfig.imageUrl && (
                                            <img src={currentConfig.imageUrl} alt="Preview" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
                                        )}
                                    </div>
                                    <p className="text-[9px] text-gray-400 font-medium">Deixe em branco para usar a imagem padrão do sistema.</p>
                                </div>
                            </div>
                        );
                    })}
                 </div>
             )}
          </div>

          <div className="border-t border-gray-50 pt-8 mb-8 mt-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div>
                      <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                          <Store size={20} className="text-brand" /> Integração com ERP / PDV (Inovafarma - Portal PS)
                      </h3>
                      <p className="text-sm text-gray-500">
                          Conecte o catálogo da sua farmácia à API oficial do Inovafarma (<span className="font-mono text-xs">guiaintegracao.portalps.app</span>) e receba baixas de estoque em tempo real do PDV.
                      </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                      <a
                          href="https://guiaintegracao.portalps.app/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2.5 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-xs font-bold text-gray-700 flex items-center gap-1.5 transition-all"
                      >
                          <ExternalLink size={14} /> Guia Portal PS
                      </a>
                      <button
                          type="button"
                          onClick={handleSyncInovafarmaNow}
                          disabled={isSyncingInovafarma}
                          className="px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer"
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
                  </div>
              </div>

              {inovafarmaFeedback && (
                  <div
                      className={`mb-6 p-5 rounded-3xl border flex flex-col gap-2 ${
                          inovafarmaFeedback.type === 'success'
                              ? 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
                              : 'bg-red-50/90 border-red-200 text-red-900'
                      }`}
                  >
                      <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 font-black text-sm">
                              {inovafarmaFeedback.type === 'success' ? (
                                  <CheckCircle size={18} className="text-emerald-600 shrink-0" />
                              ) : (
                                  <AlertTriangle size={18} className="text-red-600 shrink-0" />
                              )}
                              <span>{inovafarmaFeedback.message}</span>
                          </div>
                          <button
                              type="button"
                              onClick={() => setInovafarmaFeedback(null)}
                              className="text-xs font-bold opacity-60 hover:opacity-100"
                          >
                              Fechar
                          </button>
                      </div>
                      {inovafarmaFeedback.details && (
                          <p className="text-xs opacity-80 leading-relaxed pl-6">{inovafarmaFeedback.details}</p>
                      )}
                      {inovafarmaFeedback.stats && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 pl-6">
                              <div className="bg-white/80 rounded-2xl p-3 border border-emerald-100">
                                  <span className="block text-[10px] font-bold uppercase text-gray-400">Recebidos da API</span>
                                  <span className="text-lg font-black text-gray-900">{inovafarmaFeedback.stats.totalFetched}</span>
                              </div>
                              <div className="bg-white/80 rounded-2xl p-3 border border-emerald-100">
                                  <span className="block text-[10px] font-bold uppercase text-emerald-600">Novos Produtos</span>
                                  <span className="text-lg font-black text-emerald-700">{inovafarmaFeedback.stats.insertedCount}</span>
                              </div>
                              <div className="bg-white/80 rounded-2xl p-3 border border-emerald-100">
                                  <span className="block text-[10px] font-bold uppercase text-blue-600">Atualizados</span>
                                  <span className="text-lg font-black text-blue-700">{inovafarmaFeedback.stats.updatedCount}</span>
                              </div>
                              <div className="bg-white/80 rounded-2xl p-3 border border-emerald-100">
                                  <span className="block text-[10px] font-bold uppercase text-gray-400">Ignorados</span>
                                  <span className="text-lg font-black text-gray-600">{inovafarmaFeedback.stats.skippedCount}</span>
                              </div>
                          </div>
                      )}
                  </div>
              )}

              <div className="bg-gray-50/50 p-6 rounded-3xl border border-gray-100 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                          <label className="block text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
                              Sistema ERP / PDV
                          </label>
                          <select
                              value={formData.erpType || 'inovafarma'}
                              onChange={(e) => setFormData({ ...formData, erpType: e.target.value })}
                              className="w-full p-3.5 bg-white border border-gray-200 rounded-2xl font-bold text-sm text-gray-800 outline-none focus:ring-2 focus:ring-brand"
                          >
                              <option value="inovafarma">Inovafarma (Portal PS)</option>
                              <option value="trier">Trier Sistemas</option>
                              <option value="linx">Linx / Big</option>
                              <option value="hos">HOS Sistemas</option>
                              <option value="custom">Outro ERP / Webhook Padrão</option>
                          </select>
                      </div>

                      <div>
                          <label className="block text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
                              URL da API Inovafarma (Portal PS)
                          </label>
                          <input
                              type="text"
                              placeholder="https://guiaintegracao.portalps.app"
                              value={formData.erpUrl ?? INOVAFARMA_DEFAULT_API_URL}
                              onChange={(e) => setFormData({ ...formData, erpUrl: e.target.value })}
                              className="w-full p-3.5 bg-white border border-gray-200 rounded-2xl font-mono text-xs text-gray-700 outline-none focus:ring-2 focus:ring-brand"
                          />
                      </div>

                      <div>
                          <label className="block text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2">
                              Token de Integração (Bearer / x-api-key)
                          </label>
                          <div className="flex items-center gap-2">
                              <input
                                  type="text"
                                  placeholder="Token da API / Chave do Webhook"
                                  value={formData.integrationToken || ''}
                                  onChange={(e) => setFormData({ ...formData, integrationToken: e.target.value })}
                                  className="w-full p-3.5 bg-white border border-gray-200 rounded-2xl font-mono text-xs text-gray-700 outline-none focus:ring-2 focus:ring-brand"
                              />
                              <button
                                  type="button"
                                  onClick={() => {
                                      const generated = (typeof crypto !== 'undefined' && crypto.randomUUID)
                                          ? crypto.randomUUID()
                                          : `ff_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
                                      setFormData({ ...formData, integrationToken: generated });
                                  }}
                                  title="Gerar novo token"
                                  className="p-3.5 bg-white border border-gray-200 hover:bg-gray-100 rounded-2xl text-gray-600 text-xs font-bold shrink-0"
                              >
                                  <Key size={16} />
                              </button>
                              {formData.integrationToken && (
                                  <button
                                      type="button"
                                      onClick={() => handleCopyText(formData.integrationToken || '', 'token')}
                                      title="Copiar Token"
                                      className="p-3.5 bg-white border border-gray-200 hover:bg-gray-100 rounded-2xl text-gray-600 text-xs font-bold shrink-0"
                                  >
                                      {copiedField === 'token' ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                                  </button>
                              )}
                          </div>
                      </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200/70">
                      <div className="bg-white p-4 rounded-2xl border border-gray-100">
                          <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                                  Webhook PDV - Baixa de Venda (POST)
                              </span>
                              <span className="text-[10px] font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                                  Header: x-api-key
                              </span>
                          </div>
                          <div className="flex items-center gap-2">
                              <input
                                  type="text"
                                  readOnly
                                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/integration/venda`}
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono text-gray-600"
                              />
                              <button
                                  type="button"
                                  onClick={() =>
                                      handleCopyText(
                                          `${typeof window !== 'undefined' ? window.location.origin : ''}/api/integration/venda`,
                                          'venda_url',
                                      )
                                  }
                                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-gray-700 flex items-center gap-1 shrink-0"
                              >
                                  {copiedField === 'venda_url' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                  {copiedField === 'venda_url' ? 'Copiado' : 'Copiar'}
                              </button>
                          </div>
                      </div>

                      <div className="bg-white p-4 rounded-2xl border border-gray-100">
                          <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">
                                  Webhook PDV - Entrada de Compra (POST)
                              </span>
                              <span className="text-[10px] font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                                  Header: x-api-key
                              </span>
                          </div>
                          <div className="flex items-center gap-2">
                              <input
                                  type="text"
                                  readOnly
                                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/integration/compra`}
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono text-gray-600"
                              />
                              <button
                                  type="button"
                                  onClick={() =>
                                      handleCopyText(
                                          `${typeof window !== 'undefined' ? window.location.origin : ''}/api/integration/compra`,
                                          'compra_url',
                                      )
                                  }
                                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-gray-700 flex items-center gap-1 shrink-0"
                              >
                                  {copiedField === 'compra_url' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                                  {copiedField === 'compra_url' ? 'Copiado' : 'Copiar'}
                              </button>
                          </div>
                      </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-4 border-t border-gray-200/70">
                      <div className="flex-1">
                          <h4 className="font-black text-gray-900 text-sm">Ignorar Preços do ERP (Preservar Preços Manuais / Planilha)</h4>
                          <p className="text-xs text-gray-500 mt-1">Ative para manter os preços que você cadastra manualmente ou envia via planilha no FarmaFlow. Quando ativo, a sincronização com o Inovafarma e o PDV atualizará apenas o estoque, mantendo seus preços intactos.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                         <input 
                             type="checkbox" 
                             className="sr-only peer" 
                             checked={formData.ignore_erp_prices || false}
                             onChange={(e) => setFormData({ ...formData, ignore_erp_prices: e.target.checked })}
                         />
                         <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-brand"></div>
                      </label>
                  </div>

                  {/* Logs Recentes da Integração ERP/PDV */}
                  <div className="pt-4 border-t border-gray-200/70">
                      <div className="flex items-center justify-between mb-3">
                          <h4 className="font-black text-gray-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
                              <History size={15} className="text-gray-500" /> Logs Recentes de Sincronização e Webhooks PDV
                          </h4>
                          <button
                              type="button"
                              onClick={() => fetchTenantIntegrationLogs(config.id)}
                              disabled={isLoadingLogs}
                              className="text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center gap-1"
                          >
                              <RefreshCw size={13} className={isLoadingLogs ? 'animate-spin' : ''} /> Atualizar Logs
                          </button>
                      </div>

                      {integrationLogs.length === 0 ? (
                          <div className="bg-white rounded-2xl border border-gray-100 p-4 text-center text-xs text-gray-400 font-medium">
                              Nenhum registro de sincronização ou webhook recebido recentemente.
                          </div>
                      ) : (
                          <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                              {integrationLogs.map((log: any) => (
                                  <div
                                      key={log.id || `${log.endpoint}-${log.created_at}`}
                                      className="bg-white border border-gray-100 rounded-2xl p-3 flex items-start justify-between gap-3 text-xs"
                                  >
                                      <div className="flex items-start gap-2.5 min-w-0">
                                          <span
                                              className={`px-2 py-0.5 rounded-lg font-black text-[10px] uppercase shrink-0 ${
                                                  log.status === 'SUCCESS'
                                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                      : 'bg-red-50 text-red-700 border border-red-200'
                                              }`}
                                          >
                                              {log.status === 'SUCCESS' ? 'SUCESSO' : 'ERRO'}
                                          </span>
                                          <div className="min-w-0">
                                              <div className="font-mono font-bold text-gray-800 truncate">
                                                  {log.endpoint}
                                              </div>
                                              {log.error_message && (
                                                  <div className="text-red-600 font-medium mt-0.5 break-words">
                                                      {log.error_message}
                                                  </div>
                                              )}
                                              {log.payload && typeof log.payload === 'object' && log.payload.totalValid !== undefined && (
                                                  <div className="text-gray-500 mt-0.5">
                                                      Processados: {log.payload.totalValid} ({log.payload.insertedCount || 0} novos, {log.payload.updatedCount || 0} atualizados)
                                                  </div>
                                              )}
                                          </div>
                                      </div>
                                      <span className="text-[10px] font-mono text-gray-400 shrink-0">
                                          {log.created_at ? new Date(log.created_at).toLocaleString('pt-BR') : ''}
                                      </span>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>

          <div className="border-t border-gray-50 pt-8 mb-8 mt-8">
              <div className="mb-6">
                  <h3 className="text-lg font-black text-gray-900 flex items-center gap-2"><BellRing size={20} className="text-brand" /> Alertas Sonoros</h3>
                  <p className="text-sm text-gray-500">Escolha o som de notificação para novos pedidos e ajuste o volume.</p>
              </div>

              <div className="bg-gray-50/50 p-6 rounded-3xl border border-gray-100 flex flex-col md:flex-row gap-8">
                 <div className="flex-1 space-y-4">
                     <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Selecione o Som</label>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                          { id: 'classic', name: 'Alarme Curto', url: 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg' },
                          { id: 'digital', name: 'Alerta Duplo', url: 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg' },
                          { id: 'siren', name: 'Campainha', url: 'https://actions.google.com/sounds/v1/alarms/bugle_tune.ogg' },
                          { id: 'beep', name: 'Sino Digital', url: 'https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg' },
                        ].map((sound) => (
                           <div key={sound.id} className={`flex items-center justify-between p-3 rounded-2xl border-2 transition-all ${formData.notificationSound === sound.id || (!formData.notificationSound && sound.id === 'classic') ? 'border-brand bg-brand/5' : 'border-gray-200 bg-white hover:border-brand/30'}`}>
                               <label className="flex items-center gap-3 cursor-pointer flex-1">
                                  <input 
                                     type="radio" 
                                     name="notificationSound" 
                                     value={sound.id} 
                                     checked={formData.notificationSound === sound.id || (!formData.notificationSound && sound.id === 'classic')}
                                     onChange={(e) => setFormData({ ...formData, notificationSound: e.target.value })}
                                     className="w-4 h-4 text-brand bg-gray-100 border-gray-300 focus:ring-brand"
                                  />
                                  <span className="text-sm font-bold text-gray-800">{sound.name}</span>
                               </label>
                               <button 
                                  type="button" 
                                  onClick={() => {
                                      const audio = new Audio(sound.url);
                                      audio.volume = formData.notificationVolume ?? 0.5;
                                      audio.play();
                                  }}
                                  className="p-2 text-gray-400 hover:text-brand hover:bg-brand/10 rounded-xl transition-all"
                                  title="Testar Som"
                               >
                                  <PlayCircle size={20} />
                               </button>
                           </div>
                        ))}
                     </div>

                     <div className="mt-4 border-t border-gray-200 pt-4">
                        <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-3">Ou Faça Upload do seu Toque</label>
                        {formData.notificationSound && formData.notificationSound.startsWith('http') && !['classic', 'digital', 'siren', 'beep'].includes(formData.notificationSound) ? (
                            <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                                        <BellRing size={18} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-gray-900">Som Customizado Ativo</p>
                                        <p className="text-xs text-gray-500">Este áudio será reproduzido em novos pedidos.</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button 
                                        type="button" 
                                        onClick={() => {
                                            const audio = new Audio(formData.notificationSound);
                                            audio.volume = formData.notificationVolume ?? 0.5;
                                            audio.play();
                                        }}
                                        className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-xl transition-all"
                                        title="Ouvir"
                                    >
                                        <PlayCircle size={20} />
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={() => setFormData({ ...formData, notificationSound: 'classic' })}
                                        className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-all text-xs font-bold"
                                    >
                                        Remover
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative group">
                                <input 
                                    type="file" 
                                    accept=".mp3,.wav,.ogg,audio/*"
                                    onChange={handleAudioUpload}
                                    disabled={isUploadingAudio}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                />
                                <div className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${isUploadingAudio ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-brand hover:bg-brand/5'}`}>
                                    {isUploadingAudio ? (
                                        <div className="flex flex-col items-center gap-2">
                                            <Loader2 size={24} className="text-brand animate-spin" />
                                            <span className="text-xs font-bold text-gray-600">Uploading... {uploadProgress}%</span>
                                            <div className="w-full h-1 bg-gray-200 rounded-full mt-2">
                                                <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <Upload className="mx-auto h-8 w-8 text-gray-400 group-hover:text-brand mb-2 transition-colors" />
                                            <p className="text-sm font-bold text-gray-900">Arraste um áudio ou clique</p>
                                            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">.MP3, .WAV, .OGG • Máx 2MB</p>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                     </div>
                 </div>

                 <div className="w-full md:w-64 space-y-4 flex flex-col justify-center">
                     <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-between">
                         <span className="flex items-center gap-2"><Volume2 size={14} /> Volume do Alerta</span>
                         <span className="text-brand">{Math.round((formData.notificationVolume ?? 0.5) * 100)}%</span>
                     </label>
                     <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05"
                        value={formData.notificationVolume ?? 0.5}
                        onChange={(e) => setFormData({ ...formData, notificationVolume: parseFloat(e.target.value) })}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-brand"
                     />
                     <p className="text-[10px] text-gray-400 text-center uppercase tracking-wide font-bold">Ajuste o volume do teste</p>
                 </div>
              </div>
          </div>

          {errorMsg && (
              <div className="bg-red-50 text-red-600 px-6 py-4 rounded-2xl flex items-center gap-3 text-sm font-bold animate-in fade-in border border-red-100">
                  <AlertTriangle size={24} className="shrink-0" /> 
                  <div className="flex flex-col">
                      <span>{errorMsg}</span>
                      <span className="text-[10px] uppercase opacity-70 mt-1">Se o erro persistir, contate o suporte.</span>
                  </div>
              </div>
          )}

          <div className="pt-10 border-t border-gray-50 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className={`flex items-center gap-2 text-emerald-600 font-bold transition-all ${showSaved ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}`}>
              <CheckCircle size={20} /> Configurações salvas com sucesso!
            </div>
            <button 
              type="submit"
              disabled={loading}
              className="w-full md:w-fit bg-brand text-brand-contrast px-12 py-5 rounded-[2rem] font-black text-lg flex items-center justify-center gap-3 shadow-2xl shadow-brand/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" /> : <><Save size={24} /> Salvar Alterações</>}
            </button>
          </div>
        </form>
      </div>
      )}

        {activeTab === 'pagamentos' && (
          <div className="animate-in fade-in duration-300">
            <PaymentSettings tenantId={config.id} />
          </div>
        )}

        {activeTab === 'entrega' && (
          <form onSubmit={handleSubmit} className="space-y-10 animate-in fade-in">
            <DeliverySettings 
              settings={formData.deliverySettings || { enabled: false, fee: 0, minOrderForFreeDelivery: 0 }}
              onChange={(newSettings) => setFormData({ ...formData, deliverySettings: newSettings })}
            />

            {errorMsg && (
                <div className="bg-red-50 text-red-600 px-6 py-4 rounded-2xl flex items-center gap-3 text-sm font-bold animate-in fade-in border border-red-100">
                    <AlertTriangle size={24} className="shrink-0" /> 
                    <div className="flex flex-col">
                        <span>{errorMsg}</span>
                        <span className="text-[10px] uppercase opacity-70 mt-1">Se o erro persistir, contate o suporte.</span>
                    </div>
                </div>
            )}

            <div className="pt-10 border-t border-gray-50 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className={`flex items-center gap-2 text-emerald-600 font-bold transition-all ${showSaved ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}`}>
                <CheckCircle size={20} /> Configurações salvas com sucesso!
              </div>
              <button 
                type="submit"
                disabled={loading}
                className="w-full md:w-fit bg-brand text-brand-contrast px-12 py-5 rounded-[2rem] font-black text-lg flex items-center justify-center gap-3 shadow-2xl shadow-brand/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" /> : <><Save size={24} /> Salvar Alterações</>}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'atendimento' && (
          <div className="animate-in fade-in duration-300">
            {config.isChatEnabled ? (
              <AtendimentoSettings 
                config={formData} 
                onConfigUpdate={async (updated) => {
                  await onConfigUpdate(updated);
                  setFormData(updated);
                }} 
              />
            ) : (
              <UpsellCard
                title="Atendimento Profissional no WhatsApp"
                description="Liberte o potencial da sua equipe com as ferramentas avançadas de chat. Crie etiquetas personalizadas para organizar conversas, respostas rápidas para agilizar o atendimento e uma mensagem automática de boas-vindas com o cardápio da sua farmácia."
                icon={MessageSquare}
                features={[
                  { title: "Mensagem de Boas-Vindas", description: "Envie automaticamente seu catálogo na primeira mensagem.", icon: Bot, iconColor: "text-purple-500" },
                  { title: "Etiquetas e Organização", description: "Classifique clientes por prioridade, financeiro ou status do pedido.", icon: Tags, iconColor: "text-blue-500" },
                  { title: "Respostas Rápidas", description: "Crie atalhos (ex: /pix, /endereco) para textos frequentes.", icon: Zap, iconColor: "text-yellow-500" }
                ]}
              />
            )}
          </div>
        )}

        {activeTab === 'agente_ia' && (
          <div className="animate-in fade-in duration-300">
            <AiAgentSettings 
              config={formData} 
              onConfigUpdate={async (updated) => {
                await onConfigUpdate(updated);
                setFormData(updated);
              }} 
            />
          </div>
        )}
      </div>
      
      {activeTab === 'geral' && (
        <div className="mt-8">
          <ImageMigrationTool tenantId={config.id} />
          <ControlledProductsMigrationTool tenantId={config.id} />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ATENDIMENTO SETTINGS COMPONENT (LABELS & CANNED RESPONSES CRUD)
// ============================================================================
const AtendimentoSettings: React.FC<{ config: PharmacyConfig; onConfigUpdate: (updated: PharmacyConfig) => void | Promise<void> }> = ({ config, onConfigUpdate }) => {
  const tenantId = config.id;
  const [labels, setLabels] = useState<any[]>([]);
  const [canned, setCanned] = useState<any[]>([]);

  // States for label creation/edit
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#3B82F6');
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);

  // States for canned response creation/edit
  const [newCannedShortcut, setNewCannedShortcut] = useState('');
  const [newCannedText, setNewCannedText] = useState('');
  const [editingCannedId, setEditingCannedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    try {
      const resL = await fetch(`/api/v1/chat/labels?tenantId=${tenantId}`);
      if (resL.ok) {
        const jL = await resL.json();
        if (jL?.data) setLabels(jL.data);
      }
      const resC = await fetch(`/api/v1/chat/canned-responses?tenantId=${tenantId}`);
      if (resC.ok) {
        const jC = await resC.json();
        if (jC?.data) setCanned(jC.data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, [tenantId]);

  // Label actions
  const handleSaveLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabelName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/chat/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingLabelId || undefined,
          tenantId,
          name: newLabelName.trim(),
          color: newLabelColor
        })
      });
      if (res.ok) {
        setNewLabelName('');
        setNewLabelColor('#3B82F6');
        setEditingLabelId(null);
        await loadData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLabel = async (id: string) => {
    if (!confirm("Deseja realmente excluir esta etiqueta? Ela será removida de todas as conversas.")) return;
    try {
      const res = await fetch(`/api/v1/chat/labels/${id}?tenantId=${tenantId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditLabel = (lbl: any) => {
    setEditingLabelId(lbl.id);
    setNewLabelName(lbl.name);
    setNewLabelColor(lbl.color);
  };

  // Canned response actions
  const handleSaveCanned = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCannedShortcut.trim() || !newCannedText.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/chat/canned-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingCannedId || undefined,
          tenantId,
          shortcut: newCannedShortcut.trim().replace(/^\//, ''),
          text: newCannedText.trim()
        })
      });
      if (res.ok) {
        setNewCannedShortcut('');
        setNewCannedText('');
        setEditingCannedId(null);
        await loadData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCanned = async (id: string) => {
    if (!confirm("Deseja realmente excluir esta mensagem rápida?")) return;
    try {
      const res = await fetch(`/api/v1/chat/canned-responses/${id}?tenantId=${tenantId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditCanned = (cr: any) => {
    setEditingCannedId(cr.id);
    setNewCannedShortcut(cr.shortcut);
    setNewCannedText(cr.text);
  };

  const presetColors = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6B7280', '#14B8A6'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
      
      {/* SEÇÃO 0: MENSAGEM AUTOMÁTICA DE BOAS-VINDAS DIÁRIA (COM AUTO-SAVE E BOTÃO SALVAR ALTERAÇÕES) */}
      <div className="lg:col-span-2">
        <WelcomeSettings config={config} onConfigUpdate={onConfigUpdate} />
      </div>

      {/* SEÇÃO 1: GERENCIAMENTO DE ETIQUETAS */}
      <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm space-y-6">
        <div>
          <h3 className="font-black text-gray-800 text-lg">Sistema de Etiquetas (Labels / Tags)</h3>
          <p className="text-xs text-gray-400 mt-1">Crie e gerencie as etiquetas coloridas que os atendentes aplicam nas conversas.</p>
        </div>

        <form onSubmit={handleSaveLabel} className="space-y-4 bg-gray-50 p-4 rounded-2xl">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide text-gray-700">
            {editingLabelId ? 'Editar Etiqueta' : 'Nova Etiqueta'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Ex: Urgente, Financeiro, Orçamento..."
              className="flex-1 bg-white border border-gray-300 rounded-xl py-2 px-4 text-sm outline-none focus:border-emerald-500 font-medium text-black"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              required
            />
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="w-10 h-10 border border-gray-300 rounded-xl p-1 bg-white cursor-pointer"
                value={newLabelColor}
                onChange={(e) => setNewLabelColor(e.target.value)}
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm py-2 px-6 rounded-xl shadow-md transition-all shrink-0"
              >
                {editingLabelId ? 'Atualizar' : 'Criar'}
              </button>
              {editingLabelId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingLabelId(null);
                    setNewLabelName('');
                    setNewLabelColor('#3B82F6');
                  }}
                  className="bg-gray-200 text-gray-700 font-bold text-xs py-2 px-3 rounded-xl hover:bg-gray-300 shrink-0"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {presetColors.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setNewLabelColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${newLabelColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </form>

        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide px-1 text-gray-700">Etiquetas Cadastradas</p>
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {labels.length === 0 ? (
              <p className="text-gray-400 text-xs py-6 text-center">Nenhuma etiqueta cadastrada.</p>
            ) : (
              labels.map((lbl) => (
                <div key={lbl.id} className="flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded-xl transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="w-3.5 h-3.5 rounded-full shadow-sm" style={{ backgroundColor: lbl.color }} />
                    <span className="text-sm font-bold text-gray-800">{lbl.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditLabel(lbl)}
                      className="text-xs text-indigo-600 hover:underline font-bold px-2 py-1"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteLabel(lbl.id)}
                      className="text-xs text-red-600 hover:underline font-bold px-2 py-1"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* SEÇÃO 2: GERENCIAMENTO DE ATALHOS / RESPOSTAS RÁPIDAS */}
      <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm space-y-6">
        <div>
          <h3 className="font-black text-gray-800 text-lg">Respostas Rápidas (Canned Responses)</h3>
          <p className="text-xs text-gray-400 mt-1">Crie atalhos para textos longos que seus atendentes usam com frequência digitando '/' no chat.</p>
        </div>

        <form onSubmit={handleSaveCanned} className="space-y-4 bg-gray-50 p-4 rounded-2xl">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide text-gray-700">
            {editingCannedId ? 'Editar Resposta Rápida' : 'Nova Resposta Rápida'}
          </p>
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <span className="bg-gray-200 border border-gray-300 text-gray-500 rounded-xl py-2 px-3 text-sm font-mono font-bold">/</span>
              <input
                type="text"
                placeholder="atalho (ex: pix, entrega, bomdia)"
                className="flex-1 bg-white border border-gray-300 rounded-xl py-2 px-4 text-sm outline-none focus:border-emerald-500 font-mono font-bold text-black"
                value={newCannedShortcut}
                onChange={(e) => setNewCannedShortcut(e.target.value)}
                required
              />
            </div>
            <textarea
              placeholder="Digite o texto de resposta completo que será colado no chat..."
              rows={3}
              className="w-full bg-white border border-gray-300 rounded-xl py-2.5 px-4 text-sm outline-none focus:border-emerald-500 font-medium text-black"
              value={newCannedText}
              onChange={(e) => setNewCannedText(e.target.value)}
              required
            />
            <div className="flex justify-end gap-2">
              {editingCannedId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingCannedId(null);
                    setNewCannedShortcut('');
                    setNewCannedText('');
                  }}
                  className="bg-gray-200 text-gray-700 font-bold text-xs py-2 px-4 rounded-xl hover:bg-gray-300 transition-all"
                >
                  Cancelar
                </button>
              )}
              <button
                type="submit"
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-6 rounded-xl shadow-md transition-all"
              >
                {editingCannedId ? 'Atualizar' : 'Criar Resposta'}
              </button>
            </div>
          </div>
        </form>

        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide px-1 text-gray-700">Respostas Cadastradas</p>
          <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {canned.length === 0 ? (
              <p className="text-gray-400 text-xs py-6 text-center">Nenhuma resposta cadastrada.</p>
            ) : (
              canned.map((cr) => (
                <div key={cr.id} className="py-3 px-1 hover:bg-gray-50 rounded-xl transition-colors space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">/{cr.shortcut}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditCanned(cr)}
                        className="text-xs text-indigo-600 hover:underline font-bold px-1"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteCanned(cr.id)}
                        className="text-xs text-red-600 hover:underline font-bold px-1"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 line-clamp-2 pl-1 leading-relaxed">{cr.text}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

    </div>
  );
};