import React, { useState, useEffect } from 'react';
import { QrCode, X, RefreshCw, CheckCircle, Smartphone, AlertCircle } from 'lucide-react';

interface WhatsAppConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  inboxId?: string;
}

export const WhatsAppConnectModal: React.FC<WhatsAppConnectModalProps> = ({ isOpen, onClose, tenantId, inboxId }) => {
  const [status, setStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'QRCODE'>('DISCONNECTED');
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Mocking the initial fetch
  useEffect(() => {
    if (isOpen) {
      fetchInstanceStatus();
    } else {
      setIsPolling(false);
    }
  }, [isOpen]);

  // Polling logic
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPolling && status !== 'CONNECTED') {
      interval = setInterval(() => {
        fetchInstanceStatus();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isPolling, status]);

  
  const fetchInstanceStatus = async () => {
    try {
      let url = `/api/v1/chat/instance/status?tenantId=${tenantId}`;
      if (inboxId) url += `&inboxId=${inboxId}`;
      const res = await fetch(url, {
          headers: {
              'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token')}`
          }
      });
      const data = await res.json();
      if (res.ok && data.status) {
          setStatus(data.status);
          if (data.qrcodeBase64) {
              let b64 = data.qrcodeBase64;
              if (!b64.startsWith('data:image')) {
                  b64 = `data:image/png;base64,${b64}`;
              }
              setQrCodeBase64(b64);
          }
      }
    } catch (e) {
        console.log("Erro ao checar status", e);
    }
  };


  
  const handleGenerateQRCode = async () => {
    if (!tenantId || tenantId === 'undefined' || tenantId === '') {
      console.error("Store ID/Tenant ID é inválido ou indefinido. Abortando criação da instância.");
      alert("Erro: UUID válido da loja não encontrado no contexto.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/chat/instance/create', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('farmaflow_admin_token')}`
          },
          body: JSON.stringify({ tenantId, inboxId })
      });
      const data = await res.json();
      if (res.ok && data.qrcodeBase64) {
          // If Evolution API returns the base64 without prefix
          let b64 = data.qrcodeBase64;
          if (!b64.startsWith('data:image')) {
              b64 = `data:image/png;base64,${b64}`;
          }
          setQrCodeBase64(b64);
          setStatus('QRCODE');
          setIsPolling(true);
      } else {
          alert(data.error || "Erro ao gerar QR Code. Verifique as configurações da API.");
      }
    } catch (e) {
        console.log("Erro ao gerar QR Code", e);
        alert("Erro de conexão ao gerar QR Code.");
    } finally {
        setIsLoading(false);
    }
  };


  const simulateConnectionSuccess = () => {
    setStatus('CONNECTED');
    setPhoneNumber('+55 (11) 99999-9999');
    setIsPolling(false);
    setTimeout(() => {
      onClose();
    }, 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden relative animate-in fade-in zoom-in duration-200">
        
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Smartphone className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-800">Conexão WhatsApp</h2>
              <p className="text-xs text-gray-500">Gerenciar instância Evolution API</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8 flex flex-col items-center justify-center min-h-[300px] text-center">
          
          {status === 'DISCONNECTED' && (
            <div className="space-y-4 w-full flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-2">
                <AlertCircle className="w-8 h-8 text-gray-400" />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-lg">WhatsApp Desconectado</h3>
                <p className="text-sm text-gray-500 mt-1 px-4">
                  Sua loja não está conectada ao WhatsApp. Gere o QR Code para parear o número de atendimento.
                </p>
              </div>
              <button 
                onClick={handleGenerateQRCode}
                disabled={isLoading}
                className="mt-4 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-2"
              >
                {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <QrCode className="w-5 h-5" />}
                {isLoading ? 'Gerando...' : 'Gerar QR Code'}
              </button>
            </div>
          )}

          {status === 'QRCODE' && (
            <div className="space-y-6 w-full flex flex-col items-center">
              <h3 className="font-bold text-gray-800">Leia o QR Code</h3>
              <div className="p-4 bg-white border-2 border-gray-100 rounded-2xl shadow-sm relative">
                {qrCodeBase64 ? (
                  <img src={qrCodeBase64} alt="WhatsApp QR Code" className="w-48 h-48 object-contain" />
                ) : (
                  <div className="w-48 h-48 bg-gray-100 animate-pulse rounded-xl"></div>
                )}
                {/* Overlay simulating scanning */}
                <div className="absolute inset-0 border-2 border-emerald-500 rounded-2xl animate-pulse opacity-50 pointer-events-none"></div>
              </div>
              <div className="flex flex-col items-center text-sm text-gray-500 space-y-2">
                <p>1. Abra o WhatsApp no seu celular</p>
                <p>2. Toque em Mais opções &gt; Aparelhos conectados</p>
                <p>3. Aponte a câmera para esta tela</p>
              </div>
              
              <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold bg-emerald-50 px-4 py-2 rounded-full mt-2">
                <RefreshCw className="w-3 h-3 animate-spin" /> Aguardando leitura...
              </div>

              {/* Dev Only Button to Simulate Success */}
              <button onClick={simulateConnectionSuccess} className="text-[10px] text-gray-300 underline mt-4">
                (Dev) Simular Sucesso
              </button>
            </div>
          )}

          {status === 'CONNECTED' && (
            <div className="space-y-4 w-full flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-2">
                <CheckCircle className="w-10 h-10 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-lg">Conectado com Sucesso!</h3>
                <p className="text-sm text-gray-500 mt-1">
                  O WhatsApp da sua loja está pronto para operar.
                </p>
                <p className="text-md font-bold text-emerald-700 mt-2 bg-emerald-50 inline-block px-4 py-1.5 rounded-full">
                  {phoneNumber}
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
