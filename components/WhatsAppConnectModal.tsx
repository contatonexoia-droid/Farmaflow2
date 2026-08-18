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
}

export const WhatsAppConnectModal: React.FC<WhatsAppConnectModalProps> = ({ 
  isOpen, 
  onClose, 
  tenantId, 
  inboxId,
  inboxName 
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

  // Configurações da Evolution API
  const [evolutionUrl, setEvolutionUrl] = useState('https://evolution-evolution-api.7wcbhg.easypanel.host');
  const [evolutionKey, setEvolutionKey] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; instancesCount?: number } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const cleanStoreName = (tenantId || "principal")
    .replace(/^store_/, '')
    .replace(/^tenant_/, '')
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

  const defaultInstanceName = inboxId && inboxId !== 'default' && !inboxId.includes('default')
    ? `inbox_${inboxId.replace(/^inbox_/, '').replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`
    : (cleanStoreName ? `store_${cleanStoreName}` : 'store_principal');

  const currentWebhookUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/v1/chat/webhook`
    : 'https://farmaflow.online/api/v1/chat/webhook';

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setSuccessMessage(null);
      setTestResult(null);
      if (!instanceName) {
        setInstanceName(defaultInstanceName);
      }
      fetchInstanceStatus();
    } else {
      setIsPolling(false);
    }
  }, [isOpen, tenantId, inboxId]);

  // Polling automático de status enquanto exibe QR Code
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPolling && status !== 'CONNECTED') {
      interval = setInterval(() => {
        fetchInstanceStatus();
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isPolling, status]);

  const fetchInstanceStatus = async () => {
    if (!tenantId) return;
    try {
      let url = `/api/v1/chat/instance/status?tenantId=${encodeURIComponent(tenantId)}`;
      if (inboxId) url += `&inboxId=${encodeURIComponent(inboxId)}`;
      
      const res = await fetch(url, {
        headers: {
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        if (data.status) {
          setStatus(data.status);
          if (data.status === 'CONNECTED') {
            setIsPolling(false);
            if (data.phoneNumber || data.phone_number) {
              setPhoneNumber(data.phoneNumber || data.phone_number);
            }
          }
        }
        if (data.qrcodeBase64) {
          let b64 = data.qrcodeBase64;
          if (!b64.startsWith('data:image')) {
            b64 = `data:image/png;base64,${b64}`;
          }
          setQrCodeBase64(b64);
        }
        if (data.evolutionUrl) {
          setEvolutionUrl(data.evolutionUrl);
        }
        if (data.evolutionKey) {
          setEvolutionKey(data.evolutionKey);
          setHasSavedKey(true);
        } else if (data.hasKey) {
          setHasSavedKey(true);
        }
        if (data.instanceName && !instanceName) {
          setInstanceName(data.instanceName);
        }
      }
    } catch (e: any) {
      console.warn("[WhatsAppConnectModal] Erro ao checar status:", e);
    }
  };

  const handleTestEvolutionConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/v1/chat/instance/test-evolution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify({
          tenantId,
          inboxId,
          evolutionUrl,
          evolutionKey,
          instanceName: instanceName || defaultInstanceName
        })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          message: data.message || `Evolution API conectada! (${data.totalInstances || 0} instância(s) no servidor)`
        });
      } else {
        setTestResult({
          ok: false,
          message: data.error || "Não foi possível conectar à Evolution API. Verifique a URL e a API Key."
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        message: "Falha de rede ao tentar contatar o servidor Evolution API."
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
      const res = await fetch('/api/v1/chat/instance/save-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify({
          tenantId,
          inboxId,
          evolutionUrl,
          evolutionKey,
          instanceName: instanceName || defaultInstanceName
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMessage("Configurações salvas com sucesso!");
        setHasSavedKey(true);
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setErrorMessage(data.error || "Erro ao salvar configurações.");
      }
    } catch (e: any) {
      setErrorMessage("Erro de rede ao salvar configurações.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateQRCode = async () => {
    if (!tenantId || tenantId === 'undefined' || tenantId === '') {
      setErrorMessage("Identificador da loja não encontrado.");
      return;
    }

    if (!evolutionKey.trim() && !hasSavedKey) {
      setErrorMessage("Informe a Chave Global da Evolution API (AUTHENTICATION_API_KEY) para criar a instância automaticamente.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/v1/chat/instance/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify({ 
          tenantId, 
          inboxId,
          evolutionUrl: evolutionUrl.trim(),
          evolutionKey: evolutionKey.trim(),
          instanceName: (instanceName || defaultInstanceName).trim()
        })
      });
      const data = await res.json();
      if (res.ok) {
        if (data.status === 'CONNECTED') {
          setStatus('CONNECTED');
          setPhoneNumber(data.phoneNumber || null);
          setIsPolling(false);
          setSuccessMessage("WhatsApp conectado com sucesso!");
        } else if (data.qrcodeBase64) {
          let b64 = data.qrcodeBase64;
          if (!b64.startsWith('data:image')) {
            b64 = `data:image/png;base64,${b64}`;
          }
          setQrCodeBase64(b64);
          setStatus('QRCODE');
          setIsPolling(true);
        } else {
          setErrorMessage(data.error || "Aguardando geração do QR Code pela Evolution API. Tente novamente.");
        }
      } else {
        setErrorMessage(data.error || "Não foi possível criar a instância automaticamente na Evolution API.");
      }
    } catch (e: any) {
      console.error("[WhatsAppConnectModal] Erro ao gerar QR Code:", e);
      setErrorMessage("Erro de conexão ao comunicar com a Evolution API.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Deseja realmente desconectar este WhatsApp da Evolution API?")) return;
    setIsDisconnecting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/v1/chat/instance/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
          'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token') || ''}`
        },
        body: JSON.stringify({ 
          tenantId, 
          inboxId,
          evolutionUrl,
          evolutionKey,
          instanceName: instanceName || defaultInstanceName
        })
      });
      if (res.ok) {
        setStatus('DISCONNECTED');
        setQrCodeBase64(null);
        setPhoneNumber(null);
        setIsPolling(false);
      }
    } catch (e: any) {
      console.warn("[WhatsAppConnectModal] Erro ao desconectar:", e);
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

  const instanceTitle = inboxName 
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

                  <div className="flex items-center gap-3 w-full pt-2">
                    <button 
                      onClick={fetchInstanceStatus}
                      className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-2xl transition-colors flex items-center justify-center gap-2 text-xs"
                    >
                      <RefreshCw className="w-4 h-4" /> Verificar Status
                    </button>
                    <button 
                      onClick={handleGenerateQRCode}
                      disabled={isLoading}
                      className="flex-2 py-3 px-6 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
                    >
                      {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                      {isLoading ? 'Criando Instância & QR Code...' : 'Gerar QR Code'}
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

                  <div className="p-4 bg-white border-2 border-emerald-500/40 rounded-3xl shadow-xl relative flex items-center justify-center">
                    {qrCodeBase64 ? (
                      <img 
                        src={qrCodeBase64} 
                        alt="WhatsApp QR Code Evolution" 
                        className="w-56 h-56 object-contain rounded-xl" 
                      />
                    ) : (
                      <div className="w-56 h-56 bg-gray-100 animate-pulse rounded-xl flex items-center justify-center text-gray-400">
                        <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
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
                  
                  <div className="flex items-center justify-between w-full pt-1">
                    <button 
                      onClick={handleGenerateQRCode}
                      disabled={isLoading}
                      className="text-xs font-bold text-gray-600 hover:text-gray-900 flex items-center gap-1.5 py-2 px-3 rounded-xl hover:bg-gray-100 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Atualizar QR Code
                    </button>
                    
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
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-gray-500" /> URL da Evolution API:
                </label>
                <input 
                  type="url"
                  value={evolutionUrl}
                  onChange={(e) => setEvolutionUrl(e.target.value)}
                  placeholder="https://evolution-evolution-api.7wcbhg.easypanel.host"
                  className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-hidden font-mono"
                />
              </div>

              {/* Global API Key */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-gray-500" /> Chave Global de API (AUTHENTICATION_API_KEY):
                </label>
                <div className="relative">
                  <input 
                    type={showKey ? "text" : "password"}
                    value={evolutionKey}
                    onChange={(e) => setEvolutionKey(e.target.value)}
                    placeholder="Chave AUTHENTICATION_API_KEY do Easypanel"
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
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-800">
                  <Info className="w-4 h-4 text-emerald-600" /> Webhook Integrado Automático:
                </div>
                
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-1.5 text-xs text-gray-600">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-700">URL Registrada Automaticamente:</span>
                    <button
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
                    Ao gerar o QR Code, o sistema registra os eventos automaticamente na Evolution API.
                  </p>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
};
