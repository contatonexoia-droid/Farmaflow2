import React, { useState, useEffect } from 'react';
import { 
  QrCode, X, RefreshCw, CheckCircle, Smartphone, AlertCircle, Unlink, 
  PhoneCall, ShieldCheck, Zap, Settings, Globe, Key, Layers, Eye, EyeOff,
  Check, Copy, Info, Sparkles, ArrowRight
} from 'lucide-react';

interface WhatsAppConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  inboxId?: string;
  inboxName?: string;
  exclusive?: boolean;
  initialInstanceName?: string;
}

const DEFAULT_EVOLUTION_API_URL = 'https://evolution.nexoia.online';

function sanitizeEvolutionUrl(rawUrl?: string | null): string {
  const trimmed = String(rawUrl || '').replace(/[\r\n\t]+/g, '').trim();
  if (!trimmed) return DEFAULT_EVOLUTION_API_URL;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProto);
    const cleanPath = parsed.pathname
      .replace(/\/manager(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${cleanPath}`;
  } catch {
    return withProto
      .replace(/[?#].*$/, '')
      .replace(/\/manager(?:\/.*)?$/i, '')
      .replace(/\/+$/, '');
  }
}

function sanitizeEvolutionApiKey(rawKey?: string | null): string {
  let cleaned = String(rawKey || '').replace(/[\r\n\t]+/g, '').trim();
  if (!cleaned) return '';
  if (cleaned.includes('•') || cleaned.includes('***') || cleaned.includes('•••')) {
    return '';
  }
  cleaned = cleaned.replace(/^bearer\s+/i, '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (!cleaned || cleaned.includes('•') || cleaned.includes('***') || cleaned.includes('•••')) {
    return '';
  }
  return cleaned;
}

async function safeFetchJson(url: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    let data: any = null;
    
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      const text = await res.text().catch(() => '');
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
    
    if (!res.ok) {
      const errorMsg = data?.error || data?.message || `Erro HTTP ${res.status}`;
      return { ok: false, status: res.status, data, error: errorMsg };
    }
    
    return { ok: true, status: res.status, data: data || {} };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err.message || 'Falha de conexão com o servidor FarmaFlow.'
    };
  }
}

export const WhatsAppConnectModal: React.FC<WhatsAppConnectModalProps> = ({ 
  isOpen, 
  onClose, 
  tenantId, 
  inboxId,
  inboxName,
  exclusive = false,
  initialInstanceName
}) => {
  const [activeTab, setActiveTab] = useState<'connect' | 'settings'>('connect');
  const [status, setStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'QRCODE'>('DISCONNECTED');
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Configurações da Evolution API (carregadas do servidor na abertura sem sobrescrever com chaves antigas em cache)
  const DEFAULT_EVOLUTION_URL = DEFAULT_EVOLUTION_API_URL;
  const [evolutionUrl, setEvolutionUrl] = useState('');
  const [evolutionKey, setEvolutionKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [activeKeySource, setActiveKeySource] = useState<'env' | 'db_loja' | 'none' | null>(null);
  const [activeKeyPreview, setActiveKeyPreview] = useState<string | null>(null);
  const [isCustomServer, setIsCustomServer] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; instancesCount?: number } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [isConfiguringWebhook, setIsConfiguringWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const cleanStoreName = (tenantId || "principal")
    .replace(/^store_/, '')
    .replace(/^tenant_/, '')
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

  const defaultInstanceName = initialInstanceName && initialInstanceName.trim()
    ? initialInstanceName.trim()
    : (exclusive && inboxId && inboxId !== 'default' && !inboxId.includes('default'))
      ? `inbox_ex_${inboxId.replace(/^inbox_/i, '').replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 20)}`
      : (cleanStoreName ? `store_${cleanStoreName}` : 'store_principal');

  const currentWebhookUrl = (() => {
    if (typeof window === 'undefined') {
      return 'https://farmaflow.online/api/v1/chat/webhook';
    }
    const host = (window.location.hostname || '').toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === 'farmaflow.online' ||
      host === 'www.farmaflow.online' ||
      host.endsWith('.farmaflow.online')
    ) {
      return 'https://farmaflow.online/api/v1/chat/webhook';
    }
    return `${window.location.origin}/api/v1/chat/webhook`;
  })();

  useEffect(() => {
    if (isOpen) {
      setActiveTab('connect');
      setStatus('DISCONNECTED');
      setQrCodeBase64(null);
      setPhoneNumber(null);
      setIsPolling(false);
      setErrorMessage(null);
      setSuccessMessage(null);
      setTestResult(null);
      setWebhookStatus(null);
      setEvolutionKey('');
      setInstanceName(defaultInstanceName);
      fetchInstanceStatus(true, defaultInstanceName);
    } else {
      setIsPolling(false);
      setQrCodeBase64(null);
    }
  }, [isOpen, tenantId, inboxId, exclusive, initialInstanceName]);

  // Polling automático de status enquanto exibe QR Code
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPolling && status !== 'CONNECTED') {
      interval = setInterval(() => {
        fetchInstanceStatus(false);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isPolling, status, activeTab, instanceName, exclusive]);

  const fetchInstanceStatus = async (isInitial: boolean | React.MouseEvent = false, overrideInstanceName?: string) => {
    if (!tenantId) return;
    const isInit = isInitial === true;
    const effectiveInstanceName = (
      overrideInstanceName ||
      (isInit ? defaultInstanceName : instanceName) ||
      defaultInstanceName
    ).trim();

    try {
      let url = `/api/v1/chat/instance/status?tenantId=${encodeURIComponent(tenantId)}`;
      if (inboxId) url += `&inboxId=${encodeURIComponent(inboxId)}`;
      if (exclusive) url += `&exclusive=true`;
      if (effectiveInstanceName) url += `&instanceName=${encodeURIComponent(effectiveInstanceName)}`;
      
      const { ok, data } = await safeFetchJson(url, {
        headers: {
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        }
      });

      if (ok && data) {
        const returnedName = typeof data.instanceName === 'string' ? data.instanceName.trim() : '';
        const isMismatchedExclusive = Boolean(
          exclusive &&
          returnedName &&
          (
            returnedName.toLowerCase().startsWith('store_') ||
            (effectiveInstanceName && returnedName !== effectiveInstanceName)
          )
        );

        if (isMismatchedExclusive) {
          setStatus('DISCONNECTED');
          setQrCodeBase64(null);
          setPhoneNumber(null);
          setIsPolling(false);
          return;
        }

        if (data.status === 'CONNECTED') {
          setStatus('CONNECTED');
          setIsPolling(false);
          if (data.phoneNumber || data.phone_number) {
            setPhoneNumber(data.phoneNumber || data.phone_number);
          }
        } else if (data.qrcodeBase64) {
          let b64 = data.qrcodeBase64;
          if (!b64.startsWith('data:image')) {
            b64 = `data:image/png;base64,${b64}`;
          }
          setQrCodeBase64(b64);
          setStatus('QRCODE');
        } else if (isInit || !qrCodeBase64) {
          setStatus('DISCONNECTED');
        }
        
        // Só atualiza os campos de input na carga inicial ou fora da aba de ajustes
        if (isInit || activeTab !== 'settings') {
          if (data.evolutionUrl) {
            const cleanEvoUrl = sanitizeEvolutionUrl(data.evolutionUrl);
            setEvolutionUrl(cleanEvoUrl);
          }
          if (typeof data.hasKey === 'boolean') {
            setHasSavedKey(data.hasKey);
          }
          if (data.keySource) {
            setActiveKeySource(data.keySource);
          }
          if (data.keyPreview !== undefined) {
            setActiveKeyPreview(data.keyPreview || null);
          }
          if (typeof data.isCustomServer === 'boolean') {
            setIsCustomServer(data.isCustomServer);
          }
          // Remove chaves antigas em cache local para nunca sobrescrever a config ativa da Easypanel
          if (typeof window !== 'undefined' && (!data.isCustomServer || data.keySource === 'env')) {
            localStorage.removeItem(`farmaflow_evo_key_${tenantId}`);
            localStorage.removeItem(`farmaflow_evo_url_${tenantId}`);
          }
          if (returnedName && (!exclusive || !initialInstanceName) && (isInit || !instanceName)) {
            setInstanceName(returnedName);
          }
        }
      }
    } catch (e: any) {
      console.warn("[WhatsAppConnectModal] Erro ao checar status:", e);
    }
  };

  // Monta payload padronizado (mesmos nomes de campos JSON lidos pelo backend, nunca enviando chave mascarada)
  const buildEvolutionPayload = () => {
    const cleanedUrl = evolutionUrl.trim() ? sanitizeEvolutionUrl(evolutionUrl) : undefined;
    if (cleanedUrl && cleanedUrl !== evolutionUrl) {
      setEvolutionUrl(cleanedUrl);
    }
    const cleanedKey = sanitizeEvolutionApiKey(evolutionKey);
    const cleanedInstance = (instanceName || defaultInstanceName).trim();

    const payload: Record<string, any> = {
      tenantId,
      inboxId,
      instanceName: cleanedInstance,
      exclusive: Boolean(exclusive),
    };
    if (cleanedUrl) {
      payload.url = cleanedUrl;
      payload.evolutionUrl = cleanedUrl;
    }
    if (cleanedKey) {
      payload.apiKey = cleanedKey;
      payload.evolutionKey = cleanedKey;
    }
    return { payload, cleanedUrl, cleanedKey, cleanedInstance };
  };

  const handleTestEvolutionConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      const { payload } = buildEvolutionPayload();

      const { ok, data, error } = await safeFetchJson('/api/v1/chat/instance/test-evolution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      if (ok && data?.ok) {
        if (data.evolutionUrl) {
          setEvolutionUrl(sanitizeEvolutionUrl(data.evolutionUrl));
        }
        if (data.keySource) {
          setActiveKeySource(data.keySource);
        }
        if (data.keyPreview) {
          setActiveKeyPreview(data.keyPreview);
          setHasSavedKey(true);
        }
        setTestResult({
          ok: true,
          message: data.message || `Evolution API conectada! (${data.totalInstances || 0} instância(s) no servidor)`
        });
      } else {
        setTestResult({
          ok: false,
          message: error || data?.error || "Não foi possível conectar à Evolution API. Verifique a URL e a API Key."
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: "Falha ao tentar contatar o servidor Evolution API."
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const { payload, cleanedUrl, cleanedKey } = buildEvolutionPayload();

      const { ok, data, error } = await safeFetchJson('/api/v1/chat/instance/save-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      if (ok && data?.success) {
        const savedUrl = sanitizeEvolutionUrl(data.evolutionUrl || cleanedUrl || '');
        if (savedUrl) {
          setEvolutionUrl(savedUrl);
        }
        if (typeof data.hasKey === 'boolean') {
          setHasSavedKey(data.hasKey);
        } else if (cleanedKey) {
          setHasSavedKey(true);
        }
        if (data.keySource) {
          setActiveKeySource(data.keySource);
        }
        if (data.keyPreview !== undefined) {
          setActiveKeyPreview(data.keyPreview || null);
        }
        if (typeof data.isCustomServer === 'boolean') {
          setIsCustomServer(data.isCustomServer);
        }
        // Limpa o campo de input e qualquer cache antigo no localStorage após salvar com segurança no servidor
        setEvolutionKey('');
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`farmaflow_evo_key_${tenantId}`);
          localStorage.removeItem(`farmaflow_evo_url_${tenantId}`);
        }
        setSuccessMessage("Configurações da Evolution API salvas com sucesso!");
        setTimeout(() => setSuccessMessage(null), 4000);
      } else {
        setErrorMessage(error || data?.error || "Erro ao salvar configurações.");
      }
    } catch (e: any) {
      setErrorMessage("Erro ao salvar configurações.");
    } finally {
      setIsLoading(false);
    }
  };

  const applyWebhookDiagnostic = (webhookData: any) => {
    if (!webhookData) return;
    if (webhookData.ok) {
      setWebhookStatus({
        ok: true,
        message: `Webhook registrado automaticamente (${webhookData.formatUsed || 'Evolution'} · HTTP ${webhookData.status || 200}).`,
      });
    } else {
      const detail = webhookData.error || `Erro HTTP ${webhookData.status || 500} ao registrar webhook na Evolution.`;
      setWebhookStatus({
        ok: false,
        message: `Falha no registro automático do webhook: ${detail}`,
      });
      setErrorMessage(`Atenção: o webhook não foi registrado automaticamente na Evolution (${detail}). Use "Reconfigurar Webhook" em Configurações.`);
    }
  };

  const handleReconfigureWebhook = async () => {
    if (!tenantId || tenantId === 'undefined') return;
    setIsConfiguringWebhook(true);
    setWebhookStatus(null);
    setErrorMessage(null);
    try {
      const { payload } = buildEvolutionPayload();

      const { ok, data, error } = await safeFetchJson('/api/v1/chat/instance/configure-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      if (ok && data?.ok) {
        setWebhookStatus({
          ok: true,
          message:
            data.message ||
            `Webhook registrado com sucesso (${data.webhook?.formatUsed || 'Evolution'} · HTTP ${data.webhook?.status || 200}).`,
        });
      } else {
        const detail =
          data?.error ||
          data?.webhook?.error ||
          error ||
          'Não foi possível registrar o webhook na Evolution API.';
        setWebhookStatus({
          ok: false,
          message: detail,
        });
      }
    } catch (err: any) {
      setWebhookStatus({
        ok: false,
        message: err?.message || 'Erro de conexão ao reconfigurar o webhook na Evolution API.',
      });
    } finally {
      setIsConfiguringWebhook(false);
    }
  };

  const handleGenerateQRCode = async () => {
    if (!tenantId || tenantId === 'undefined' || tenantId === '') {
      setErrorMessage("Identificador da loja não encontrado.");
      return;
    }

    const cleanedKeyInput = sanitizeEvolutionApiKey(evolutionKey);
    if (!cleanedKeyInput && !hasSavedKey) {
      setErrorMessage("Informe a Chave Global da Evolution API (AUTHENTICATION_API_KEY) para criar a instância automaticamente.");
      setActiveTab('settings');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setWebhookStatus(null);
    try {
      const { payload } = buildEvolutionPayload();

      const { ok, data, error } = await safeFetchJson('/api/v1/chat/instance/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      if (ok && data && data.success !== false) {
        if (data.evolutionUrl) {
          setEvolutionUrl(sanitizeEvolutionUrl(data.evolutionUrl));
        }
        if (data.keySource) setActiveKeySource(data.keySource);
        if (data.keyPreview) {
          setActiveKeyPreview(data.keyPreview);
          setHasSavedKey(true);
        }

        if (data.status === 'CONNECTED') {
          setStatus('CONNECTED');
          setPhoneNumber(data.phoneNumber || data.phone_number || null);
          setIsPolling(false);
          setSuccessMessage("WhatsApp conectado com sucesso!");
          applyWebhookDiagnostic(data.webhook);
        } else if (data.qrcodeBase64) {
          let b64 = data.qrcodeBase64;
          if (!b64.startsWith('data:image')) {
            b64 = `data:image/png;base64,${b64}`;
          }
          setQrCodeBase64(b64);
          setStatus('QRCODE');
          setIsPolling(true);
          setSuccessMessage("QR Code gerado com sucesso! Aponte o WhatsApp do celular para conectar.");
          applyWebhookDiagnostic(data.webhook);
        } else {
          setStatus('DISCONNECTED');
          setIsPolling(false);
          setErrorMessage(data.error || "A Evolution API não retornou o QR Code. Verifique as configurações e tente novamente.");
        }
      } else {
        setStatus('DISCONNECTED');
        setIsPolling(false);
        setErrorMessage(error || data?.error || "Não foi possível criar a instância na Evolution API. Verifique a URL e a API Key na aba Configurações.");
      }
    } catch (e: any) {
      console.error("[WhatsAppConnectModal] Erro ao gerar QR Code:", e);
      setStatus('DISCONNECTED');
      setIsPolling(false);
      setErrorMessage(e.message || "Erro de conexão ao comunicar com a Evolution API.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecreateInstance = async () => {
    if (!tenantId || tenantId === 'undefined') return;
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setWebhookStatus(null);
    setQrCodeBase64(null);
    try {
      const { payload } = buildEvolutionPayload();

      const { ok, data, error } = await safeFetchJson('/api/v1/chat/instance/recreate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      if (ok && data && data.success !== false) {
        if (data.evolutionUrl) {
          setEvolutionUrl(sanitizeEvolutionUrl(data.evolutionUrl));
        }
        if (data.keySource) setActiveKeySource(data.keySource);
        if (data.keyPreview) {
          setActiveKeyPreview(data.keyPreview);
          setHasSavedKey(true);
        }

        if (data.status === 'CONNECTED') {
          setStatus('CONNECTED');
          setPhoneNumber(data.phoneNumber || data.phone_number || null);
          setIsPolling(false);
          setSuccessMessage("WhatsApp conectado com sucesso!");
          applyWebhookDiagnostic(data.webhook);
        } else if (data.qrcodeBase64) {
          let b64 = data.qrcodeBase64;
          if (!b64.startsWith('data:image')) {
            b64 = `data:image/png;base64,${b64}`;
          }
          setQrCodeBase64(b64);
          setStatus('QRCODE');
          setIsPolling(true);
          setSuccessMessage("Instância reiniciada com sucesso na Evolution API! QR Code gerado.");
          applyWebhookDiagnostic(data.webhook);
        } else {
          setStatus('DISCONNECTED');
          setIsPolling(false);
          setErrorMessage(data.error || "A Evolution API não retornou o QR Code para esta instância. Verifique a URL e a API Key.");
        }
      } else {
        setStatus('DISCONNECTED');
        setIsPolling(false);
        setErrorMessage(error || data?.error || "Erro ao recriar instância na Evolution API.");
      }
    } catch (e: any) {
      setStatus('DISCONNECTED');
      setIsPolling(false);
      setErrorMessage(e?.message || "Falha ao recriar instância na Evolution API.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Deseja realmente desconectar este WhatsApp da Evolution API?")) return;
    setIsDisconnecting(true);
    setErrorMessage(null);
    try {
      const { payload } = buildEvolutionPayload();
      const { ok, data, error } = await safeFetchJson('/api/v1/chat/instance/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify(payload)
      });

      if (ok) {
        setStatus('DISCONNECTED');
        setQrCodeBase64(null);
        setPhoneNumber(null);
        setIsPolling(false);
      } else {
        setErrorMessage(error || data?.error || "Não foi possível desconectar esta instância.");
      }
    } catch (e: any) {
      console.warn("[WhatsAppConnectModal] Erro ao desconectar:", e);
      setErrorMessage(e?.message || "Erro ao desconectar instância.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(currentWebhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2500);
  };

  if (!isOpen) return null;

  const instanceTitle = exclusive && inboxName
    ? `Caixa Exclusiva: ${inboxName}`
    : inboxName
      ? `Caixa: ${inboxName}`
      : `Instância WhatsApp Principal`;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden relative animate-in fade-in zoom-in-95 duration-200 border border-gray-100 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center shadow-xs">
              <Smartphone className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-black text-gray-900 text-base flex items-center gap-2">
                Conectar WhatsApp
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Evolution API Automática</span>
              </h2>
              <p className="text-xs text-gray-500 font-medium">{instanceTitle}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-100 px-6 bg-white shrink-0">
          <button
            onClick={() => setActiveTab('connect')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'connect'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>Conexão QR Code</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Configurações da Evolution</span>
          </button>
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div className="m-4 mb-0 p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-xs text-red-700 font-medium">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span>{errorMessage}</span>
              {!hasSavedKey && (
                <button 
                  onClick={() => setActiveTab('settings')}
                  className="block mt-1 text-[11px] font-bold text-red-800 underline hover:text-red-900"
                >
                  Abrir configurações da Evolution para inserir a Chave API &rarr;
                </button>
              )}
            </div>
          </div>
        )}

        {successMessage && (
          <div className="m-4 mb-0 p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-2.5 text-xs text-emerald-800 font-medium">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1">
          
          {activeTab === 'connect' && (
            <div className="flex flex-col items-center justify-center text-center">
              
              {status === 'DISCONNECTED' && (
                <div className="space-y-4 w-full flex flex-col items-center">
                  <div className="w-14 h-14 rounded-3xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-1">
                    <Sparkles className="w-7 h-7 text-emerald-600" />
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="font-black text-gray-900 text-lg">Criação & Conexão Automática</h3>
                    <p className="text-xs text-gray-600 max-w-sm">
                      Ao clicar no botão abaixo, o sistema criará a instância na Evolution API e exibirá o QR Code para leitura no WhatsApp.
                    </p>
                  </div>

                  {/* Inline API Key input if not saved yet */}
                  {!hasSavedKey && (
                    <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-4 w-full text-left space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                          <Key className="w-3.5 h-3.5 text-amber-700" />
                          Chave Global da Evolution (AUTHENTICATION_API_KEY):
                        </label>
                        <span className="text-[10px] bg-amber-200/60 text-amber-900 font-bold px-1.5 py-0.5 rounded">Easypanel</span>
                      </div>
                      <div className="relative">
                        <input 
                          type={showKey ? "text" : "password"}
                          value={evolutionKey}
                          onChange={(e) => setEvolutionKey(e.target.value)}
                          placeholder="Cole a AUTHENTICATION_API_KEY do seu Easypanel"
                          className="w-full p-2.5 pr-9 text-xs bg-white border border-amber-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-[11px] text-amber-800">
                        Insira uma única vez. O sistema salva automaticamente e cria a instância sem trabalho manual.
                      </p>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-2xl p-3.5 w-full border border-gray-100 text-left space-y-1.5 text-xs text-gray-600">
                    <div className="flex items-center justify-between font-bold text-gray-800">
                      <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-emerald-600" /> Instância Automática:</span>
                      <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200/60 font-bold text-[11px]">
                        {instanceName || defaultInstanceName}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">• Criação automática no WhatsApp-Baileys</p>
                    <p className="text-[11px] text-gray-500">• Webhooks e sincronização em tempo real ativados</p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full pt-2">
                    <button 
                      onClick={fetchInstanceStatus}
                      className="w-full sm:w-auto py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-2xl transition-colors flex items-center justify-center gap-2 text-xs"
                    >
                      <RefreshCw className="w-4 h-4" /> Status
                    </button>
                    <button 
                      onClick={handleGenerateQRCode}
                      disabled={isLoading}
                      className="w-full flex-1 py-3 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
                    >
                      {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                      {isLoading ? 'Gerando QR Code...' : 'Gerar QR Code'}
                    </button>
                  </div>
                  <div className="pt-1">
                    <button
                      onClick={handleRecreateInstance}
                      disabled={isLoading}
                      className="text-xs text-amber-700 hover:text-amber-800 font-bold hover:underline flex items-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" /> Forçar Recriação da Instância na Evolution
                    </button>
                  </div>
                </div>
              )}

              {status === 'QRCODE' && (
                <div className="space-y-4 w-full flex flex-col items-center">
                  <div>
                    <h3 className="font-black text-gray-900 text-lg">Leia o QR Code com seu WhatsApp</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Escaneie no WhatsApp do celular para conectar automaticamente</p>
                  </div>

                  <div className="p-4 bg-white border-2 border-emerald-500/40 rounded-3xl shadow-xl relative flex items-center justify-center min-h-[260px] min-w-[260px]">
                    {qrCodeBase64 ? (
                      <div className="flex flex-col items-center space-y-2">
                        <img 
                          src={qrCodeBase64} 
                          alt="WhatsApp QR Code Evolution" 
                          className="w-56 h-56 object-contain rounded-xl shadow-xs" 
                        />
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          QR Code Ativo • Pronto para Leitura
                        </span>
                      </div>
                    ) : isLoading ? (
                      <div className="w-56 h-56 bg-emerald-50/50 border border-dashed border-emerald-300 rounded-2xl flex flex-col items-center justify-center text-center p-4 space-y-3">
                        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
                        <div>
                          <p className="text-xs font-bold text-gray-800">Gerando QR Code...</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">Iniciando sessão com a Evolution API</p>
                        </div>
                      </div>
                    ) : (
                      <div className="w-56 h-56 bg-emerald-50/50 border border-dashed border-emerald-300 rounded-2xl flex flex-col items-center justify-center text-center p-4 space-y-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
                          <QrCode className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-800">QR Code não carregado</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">Clique abaixo para gerar o QR Code</p>
                        </div>
                        <button
                          onClick={handleGenerateQRCode}
                          disabled={isLoading}
                          className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                        >
                          <Zap className="w-3.5 h-3.5" /> Gerar QR Code Agora
                        </button>
                        <button
                          onClick={handleRecreateInstance}
                          disabled={isLoading}
                          className="text-[10px] font-bold text-amber-700 hover:text-amber-800 hover:underline flex items-center gap-1"
                        >
                          <RefreshCw className="w-2.5 h-2.5" /> Recriar Instância do Zero
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="bg-emerald-50/60 rounded-2xl p-3.5 w-full text-xs text-emerald-950 text-left space-y-1.5 border border-emerald-100">
                    <p className="font-bold text-emerald-900 flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-600" /> Passo a passo no seu celular:
                    </p>
                    <p>1. Abra o <strong>WhatsApp</strong> &gt; Toque em <strong>Aparelhos conectados</strong></p>
                    <p>2. Toque em <strong>Conectar um aparelho</strong> e aponte para a tela</p>
                    <p className="text-emerald-700 font-bold pt-0.5">✨ O sistema conecta automaticamente assim que você escanear!</p>
                  </div>
                  
                  <div className="flex flex-wrap items-center justify-between gap-2 w-full pt-1">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={handleGenerateQRCode}
                        disabled={isLoading}
                        className="text-xs font-bold text-gray-600 hover:text-gray-900 flex items-center gap-1.5 py-2 px-3 rounded-xl hover:bg-gray-100 transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Atualizar
                      </button>
                      <button 
                        onClick={handleRecreateInstance}
                        disabled={isLoading}
                        className="text-xs font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 flex items-center gap-1.5 py-2 px-2.5 rounded-xl transition-colors border border-amber-200/60"
                        title="Caso a instância esteja travada, recria ela do zero na Evolution"
                      >
                        <Zap className="w-3 h-3 text-amber-600" /> Recriar Instância
                      </button>
                    </div>
                    
                    <button 
                      onClick={fetchInstanceStatus}
                      className="text-xs font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 py-2 px-4 rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Já Escaneei
                    </button>
                  </div>
                </div>
              )}

              {status === 'CONNECTED' && (
                <div className="space-y-5 w-full flex flex-col items-center">
                  <div className="w-20 h-20 rounded-3xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-1">
                    <CheckCircle className="w-10 h-10 text-emerald-600" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-black text-gray-900 text-xl flex items-center justify-center gap-2">
                      WhatsApp Conectado!
                      <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    </h3>
                    <p className="text-xs text-gray-500">
                      Instância ativa e integrada à Central de Atendimento e IA.
                    </p>
                  </div>

                  {phoneNumber && (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold px-4 py-2.5 rounded-2xl text-sm">
                      <PhoneCall className="w-4 h-4 text-emerald-600" />
                      <span>{phoneNumber}</span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full pt-3">
                    <button 
                      onClick={handleDisconnect}
                      disabled={isDisconnecting}
                      className="w-full sm:flex-1 py-3 px-4 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-2xl transition-colors flex items-center justify-center gap-2 text-xs"
                    >
                      {isDisconnecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
                      {isDisconnecting ? 'Desconectando...' : 'Desconectar WhatsApp'}
                    </button>
                    <button 
                      onClick={onClose}
                      className="w-full sm:flex-1 py-3 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
                    >
                      Concluído
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-4 text-left">
              <div>
                <h4 className="font-bold text-gray-900 text-sm">Parâmetros da Evolution API</h4>
                <p className="text-xs text-gray-500">
                  Configure o endpoint e as credenciais da Evolution API para criação e pareamento automático.
                </p>
              </div>

              {/* URL da Evolution API */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-gray-500" /> URL da Evolution API:
                  </label>
                  {evolutionUrl !== DEFAULT_EVOLUTION_URL && (
                    <button
                      type="button"
                      onClick={() => setEvolutionUrl(DEFAULT_EVOLUTION_URL)}
                      className="text-[11px] text-emerald-700 hover:text-emerald-800 font-semibold underline"
                    >
                      Restaurar padrão ({DEFAULT_EVOLUTION_URL})
                    </button>
                  )}
                </div>
                <input 
                  type="url"
                  value={evolutionUrl}
                  onChange={(e) => setEvolutionUrl(e.target.value)}
                  onBlur={() => {
                    if (evolutionUrl.trim()) {
                      setEvolutionUrl(sanitizeEvolutionUrl(evolutionUrl));
                    }
                  }}
                  placeholder="https://evolution.nexoia.online"
                  className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono"
                />
                <p className="text-[11px] text-gray-500">
                  Informe o endereço da sua Evolution API (ex: <code className="text-emerald-800 font-bold bg-emerald-50 px-1 py-0.5 rounded">https://evolution.nexoia.online</code>). Sufixos como <code className="font-mono">/manager</code> e barras finais são removidos automaticamente.
                </p>
              </div>

              {/* Global API Key */}
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-gray-500" /> Chave Global de API (AUTHENTICATION_API_KEY):
                  </label>
                  {hasSavedKey && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                      {activeKeySource === 'env' ? 'Ativa (Easypanel)' : 'Salva na loja'}
                      {activeKeyPreview ? ` · ${activeKeyPreview}` : ''}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input 
                    type={showKey ? "text" : "password"}
                    value={evolutionKey}
                    onChange={(e) => setEvolutionKey(e.target.value)}
                    placeholder={
                      hasSavedKey
                        ? `Deixe vazio para usar a chave ativa${activeKeyPreview ? ` (${activeKeyPreview})` : ''} ou cole uma nova`
                        : "Chave AUTHENTICATION_API_KEY do Easypanel"
                    }
                    className="w-full p-2.5 pr-9 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {!isCustomServer && hasSavedKey && (
                  <p className="text-[11px] text-emerald-700">
                    Usando automaticamente as variáveis ativas da Easypanel. Só preencha acima se quiser usar outro servidor próprio.
                  </p>
                )}
              </div>

              {/* Instance Name */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-gray-500" /> Nome da Instância (Automático):
                </label>
                <input 
                  type="text"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  placeholder={defaultInstanceName}
                  className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono"
                />
              </div>

              {/* Test Result Message */}
              {testResult && (
                <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  testResult.ok 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {testResult.ok ? (
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleTestEvolutionConnection}
                  disabled={isTesting}
                  className="flex-1 py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                  <span>Testar Conexão</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={isLoading}
                  className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                >
                  {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Salvar Ajustes</span>
                </button>
              </div>

              {/* Webhook Info */}
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-800">
                    <Info className="w-4 h-4 text-emerald-600 shrink-0" /> Webhook Integrado Automático:
                  </div>
                  <button
                    type="button"
                    onClick={handleReconfigureWebhook}
                    disabled={isConfiguringWebhook}
                    className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-60 whitespace-nowrap"
                    title="Força o registro do webhook e eventos na Evolution API para instâncias já conectadas"
                  >
                    <RefreshCw className={`w-3 h-3 ${isConfiguringWebhook ? 'animate-spin' : ''}`} />
                    {isConfiguringWebhook ? 'Registrando...' : 'Reconfigurar Webhook'}
                  </button>
                </div>
                
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2 text-xs text-gray-600">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-700">URL Registrada Automaticamente:</span>
                    <button
                      type="button"
                      onClick={handleCopyWebhook}
                      className="text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1 text-[11px]"
                    >
                      {copiedWebhook ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {copiedWebhook ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <div className="p-2 bg-white rounded-lg border border-gray-200 font-mono text-[11px] break-all text-gray-800">
                    {currentWebhookUrl}
                  </div>
                  <p className="text-[11px] text-gray-500">
                    Ao criar a instância ou gerar o QR Code, o sistema grava automaticamente a URL e os eventos (v2/v1) na Evolution API. Para instâncias já conectadas, clique em <strong>Reconfigurar Webhook</strong>.
                  </p>

                  {webhookStatus && (
                    <div
                      className={`p-2.5 rounded-lg border text-[11px] flex items-start gap-2 ${
                        webhookStatus.ok
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-red-50 border-red-200 text-red-700'
                      }`}
                    >
                      {webhookStatus.ok ? (
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                      )}
                      <span className="break-words">{webhookStatus.message}</span>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
};
