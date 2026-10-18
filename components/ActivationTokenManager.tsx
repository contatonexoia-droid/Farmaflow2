import React, { useState, useEffect } from 'react';
import { Copy, CheckCircle, KeyRound, Loader2, Download, MessageSquare } from 'lucide-react';

interface Tenant {
  id: string;
  name: string;
  erp_type?: string;
  erpType?: string;
}

export const ActivationTokenManager: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedInstructions, setCopiedInstructions] = useState(false);

  const selectedTenantData = tenants.find(t => t.id === selectedTenant);
  const selectedErpType = (selectedTenantData?.erp_type || selectedTenantData?.erpType || '').toLowerCase();
  
  const INSTALLER_LINK = (selectedErpType === 'inovafarma' || selectedErpType.includes('inova'))
    ? `${window.location.origin}/installers/farmaflow-inovafarma.zip`
    : selectedErpType === 'siagold' 
      ? `${window.location.origin}/installers/farmaflow-siagold.zip`
      : selectedErpType === 'softpharma'
        ? `${window.location.origin}/installers/farmaflow-softpharma.zip`
        : `${window.location.origin}/installers/farmaflow-agent.zip`;

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      setFetching(true);
      const res = await fetch('/api/v1/resolve-tenant');
      if (!res.ok) {
        const adminRes = await fetch('/api/v1/tenants/admin');
        if (adminRes.ok) {
          const data = await adminRes.json();
          if (data.data) {
             setTenants(data.data);
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFetching(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!selectedTenant) {
      setError('Por favor, selecione uma farmácia (tenant) primeiro.');
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedToken(null);
    setCopiedToken(false);
    setCopiedLink(false);
    setCopiedInstructions(false);

    try {
      const response = await fetch('/api/v1/agent/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: selectedTenant })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Erro ao gerar token');
      }

      const data = await response.json();
      setGeneratedToken(data.token);
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, setCopiedState: React.Dispatch<React.SetStateAction<boolean>>) => {
    if (!selectedTenant) {
      setError('Por favor, selecione uma farmácia (tenant) primeiro.');
      return;
    }
    navigator.clipboard.writeText(text);
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 2000);
  };

  const instructionsText = `Olá! 🚀
Aqui está o instalador do Agente Desktop e seu token de ativação exclusivo.

📥 *1. Baixe o instalador através deste link:*
${INSTALLER_LINK}

⚠️ *Aviso de Instalação (Windows):*
Como o nosso aplicativo é novo, o Windows pode exibir uma tela azul escrita "O Windows protegeu o computador".
Para prosseguir com a instalação, basta clicar em *"Mais informações"* e depois no botão *"Executar assim mesmo"*.

🔑 *2. Após instalar, abra o aplicativo e insira seu token de ativação:*
${generatedToken}

Qualquer dúvida, estou à disposição!`;

  return (
    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm w-full animate-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 p-2.5 rounded-xl text-emerald-600">
            <KeyRound className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900">Agente Desktop</h2>
            <p className="text-sm font-medium text-gray-500">Gerador de Tokens de Ativação</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {selectedTenant ? (
            <a
              href={INSTALLER_LINK}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-colors shadow-sm"
              title="Baixar Instalador"
            >
              <Download className="w-4 h-4" />
              Baixar Instalador
            </a>
          ) : (
            <button
              type="button"
              disabled
              onClick={() => setError('Por favor, selecione uma farmácia (tenant) primeiro.')}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-400 rounded-xl font-bold text-sm cursor-not-allowed opacity-60"
              title="Selecione uma farmácia primeiro"
            >
              <Download className="w-4 h-4" />
              Baixar Instalador
            </button>
          )}

          <button
            type="button"
            disabled={!selectedTenant}
            onClick={() => copyToClipboard(INSTALLER_LINK, setCopiedLink)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-xl font-bold text-sm transition-colors ${
              selectedTenant
                ? 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-700 cursor-pointer'
                : 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
            }`}
            title={selectedTenant ? 'Copiar Link do Instalador' : 'Selecione uma farmácia primeiro'}
          >
            {copiedLink ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            Copiar Link
          </button>
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-bold text-gray-700">
              Farmácia (Tenant ID)
            </label>
            {selectedTenant && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-gray-500 uppercase">ERP:</span>
                <span className={`text-xs font-black px-2 py-0.5 rounded-md ${
                  tenants.find(t => t.id === selectedTenant)?.erp_type?.toLowerCase() === 'inovafarma' || tenants.find(t => t.id === selectedTenant)?.erpType?.toLowerCase() === 'inovafarma'
                    ? 'bg-emerald-100 text-emerald-800'
                    : tenants.find(t => t.id === selectedTenant)?.erp_type?.toLowerCase() === 'siagold' || tenants.find(t => t.id === selectedTenant)?.erpType?.toLowerCase() === 'siagold'
                      ? 'bg-blue-100 text-blue-700' 
                      : tenants.find(t => t.id === selectedTenant)?.erp_type?.toLowerCase() === 'softpharma' || tenants.find(t => t.id === selectedTenant)?.erpType?.toLowerCase() === 'softpharma'
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-gray-100 text-gray-600'
                }`}>
                  {tenants.find(t => t.id === selectedTenant)?.erp_type?.toLowerCase() === 'inovafarma' || tenants.find(t => t.id === selectedTenant)?.erpType?.toLowerCase() === 'inovafarma'
                    ? 'InovaFarma (SQL Server)'
                    : (tenants.find(t => t.id === selectedTenant)?.erp_type || tenants.find(t => t.id === selectedTenant)?.erpType || 'Padrão')}
                </span>
              </div>
            )}
          </div>
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            disabled={fetching}
          >
            <option value="">Selecione uma farmácia...</option>
            {tenants.map(t => (
              <option key={t.id} value={t.id}>{t.name || t.id}</option>
            ))}
          </select>
          {fetching && <p className="text-xs font-bold text-gray-400 mt-1.5">Carregando farmácias...</p>}
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-sm font-medium rounded-xl border border-red-100">
            {error}
          </div>
        )}

        <button
          onClick={handleGenerateToken}
          disabled={loading || !selectedTenant}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3.5 px-4 rounded-xl font-black hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>Gerar Novo Token</>
          )}
        </button>

        {generatedToken && (
          <div className="mt-8 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-2xl relative overflow-hidden">
              <div className="absolute -right-4 -top-4 text-emerald-500/10">
                <KeyRound className="w-32 h-32" />
              </div>
              <div className="relative z-10">
                <p className="text-sm font-bold text-emerald-800 mb-2 uppercase tracking-wider">Token Gerado</p>
                <div className="flex items-center gap-3">
                  <code className="flex-1 block px-4 py-3 bg-white border border-emerald-200 rounded-xl text-2xl font-black text-center text-emerald-950 tracking-[0.2em] shadow-sm">
                    {generatedToken}
                  </code>
                  <button
                    onClick={() => copyToClipboard(generatedToken, setCopiedToken)}
                    className="p-3.5 bg-white border border-emerald-200 rounded-xl hover:bg-emerald-50 text-emerald-700 transition-colors focus:outline-none focus:ring-4 focus:ring-emerald-500/20 flex-shrink-0 shadow-sm"
                    title="Copiar token"
                  >
                    {copiedToken ? <CheckCircle className="w-6 h-6 text-emerald-600" /> : <Copy className="w-6 h-6" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Instruções para o Cliente (WhatsApp)
                </h3>
                <button
                  onClick={() => copyToClipboard(instructionsText, setCopiedInstructions)}
                  className="text-xs font-bold flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 text-gray-700 transition-colors"
                >
                  {copiedInstructions ? (
                    <><CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Copiado</>
                  ) : (
                    <><Copy className="w-3.5 h-3.5" /> Copiar Texto</>
                  )}
                </button>
              </div>
              <pre className="text-sm font-medium text-gray-600 whitespace-pre-wrap font-sans bg-white p-4 rounded-xl border border-gray-200">
                {instructionsText}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
