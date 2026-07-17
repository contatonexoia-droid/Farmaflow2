import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { CreditCard, Zap, Server, ShieldCheck, Plus, CheckCircle, Loader2, Link2, X } from 'lucide-react';

interface PaymentSettingsProps {
  tenantId: string;
}

export const PaymentSettings: React.FC<PaymentSettingsProps> = ({ tenantId }) => {
  const [gateways, setGateways] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGateway, setActiveGateway] = useState<string | null>(null);

  // Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [formLoading, setFormLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<{ loading: boolean, success?: boolean, error?: string }>({ loading: false });

  const GATEWAYS_MAPPING = [
    {
      id: 'stripe',
      name: 'Stripe',
      logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/ba/Stripe_Logo%2C_revised_2016.svg',
      fields: [
        { key: 'publishableKey', label: 'Publishable Key', type: 'text' },
        { key: 'secretKey', label: 'Secret Key', type: 'password' }
      ]
    },
    {
      id: 'mercado_pago',
      name: 'Mercado Pago',
      logoUrl: 'https://logospng.org/download/mercado-pago/logo-mercado-pago-icone-1024.png',
      fields: [
        { key: 'publicKey', label: 'Public Key', type: 'text' },
        { key: 'accessToken', label: 'Access Token', type: 'password' }
      ]
    },
    {
      id: 'picpay',
      name: 'PicPay',
      logoUrl: 'https://logospng.org/download/picpay/logo-picpay-2048.png',
      fields: [
        { key: 'xPicpayToken', label: 'X-Picpay-Token', type: 'password' },
        { key: 'sellerToken', label: 'X-Seller-Token', type: 'password' }
      ]
    },
    {
      id: 'infinitepay',
      name: 'InfinitePay',
      logoUrl: 'https://techtudo-assets.techtudo.com.br/hHovYFclR7L8t2eP64V_337Hw40=/1200xx/s.glbimg.com/po/tt2/f/original/2021/08/17/infinitepay1.jpg',
      fields: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' }
      ]
    }
  ];

  useEffect(() => {
    fetchGateways();
  }, [tenantId]);

  const getAuthHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {})
    };
  };

  const fetchGateways = async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/tenants/${tenantId}/payment-gateways`, { headers });
      if (response.ok) {
        const json = await response.json();
        setGateways(json.data || []);
      }
    } catch (e) {
      console.error("Failed to load gateways", e);
    } finally {
      setLoading(false);
    }
  };

  const getGatewayConfig = (id: string) => {
    return gateways.find(g => g.gateway_name === id) || { is_active: false, credentials: {} };
  };

  const openConfig = (gatewayId: string) => {
    setActiveGateway(gatewayId);
    const existing = getGatewayConfig(gatewayId);
    setFormData({ is_active: existing.is_active, credentials: existing.credentials || {} });
    setTestStatus({ loading: false });
    setIsModalOpen(true);
  };

  const handleTestConnection = async () => {
    if (!activeGateway) return;
    setTestStatus({ loading: true, error: undefined, success: undefined });
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/tenants/${tenantId}/payment-gateways?test=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          gateway_name: activeGateway,
          is_active: formData.is_active,
          credentials: formData.credentials
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro na conexão.");
      setTestStatus({ loading: false, success: true });
    } catch (e: any) {
      setTestStatus({ loading: false, error: e.message });
    }
  };

  const handleSave = async () => {
    if (!activeGateway) return;
    setFormLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/tenants/${tenantId}/payment-gateways`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          gateway_name: activeGateway,
          is_active: formData.is_active,
          credentials: formData.credentials
        })
      });
      if (!response.ok) {
        const d = await response.json();
        throw new Error(d.error);
      }
      setIsModalOpen(false);
      await fetchGateways();
    } catch (e: any) {
      alert("Erro ao salvar: " + e.message);
    } finally {
      setFormLoading(false);
    }
  };

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-brand w-8 h-8" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100 flex items-center justify-between mb-8">
        <div>
           <h3 className="text-xl font-bold text-gray-900 mb-1">Gateways de Pagamento Integrados</h3>
           <p className="text-sm text-gray-600">Aceite Pix Dinâmico, Cartão de Crédito e Carteiras Digitais de forma segura, com repasse direto para a sua conta.</p>
        </div>
        <ShieldCheck className="text-emerald-500 w-12 h-12 opacity-80" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {GATEWAYS_MAPPING.map(gateway => {
          const config = getGatewayConfig(gateway.id);
          const isActive = config.is_active;

          return (
            <div key={gateway.id} className="bg-white border-2 border-gray-100 hover:border-brand/30 transition-all rounded-[2rem] p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div className="h-8 w-24 relative flex items-center">
                    <img src={gateway.logoUrl} alt={gateway.name} className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer" />
                  </div>
                  {isActive ? (
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-full tracking-wider flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Ativo
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-gray-100 text-gray-500 text-[10px] font-black uppercase rounded-full tracking-wider">
                      Inativo
                    </span>
                  )}
                </div>
                
                <h4 className="font-bold text-gray-900">{gateway.name}</h4>
                <p className="text-xs text-gray-500 mt-1 mb-8">Processamento de cartões e pix instantâneo.</p>
              </div>

              <button
                onClick={() => openConfig(gateway.id)}
                className="w-full bg-gray-50 hover:bg-emerald-50 text-emerald-600 font-bold text-sm py-3 rounded-xl transition-colors border border-transparent hover:border-emerald-200"
              >
                Configurar Gateway
              </button>
            </div>
          );
        })}
      </div>

      {isModalOpen && activeGateway && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-xl text-gray-900">Configurar {GATEWAYS_MAPPING.find(g => g.id === activeGateway)?.name}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 bg-white p-2 rounded-full shadow-sm"><X size={20}/></button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                <div>
                  <h4 className="font-bold text-gray-900">Ativar na Loja Online</h4>
                  <p className="text-xs text-gray-500">Permitir que os clientes paguem usando este gateway.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={formData.is_active || false} onChange={e => setFormData({...formData, is_active: e.target.checked})} />
                  <div className="w-14 h-7 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>

              <div className="space-y-4">
                {GATEWAYS_MAPPING.find(g => g.id === activeGateway)?.fields.map(field => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-[11px] font-black text-gray-600 uppercase tracking-widest">{field.label}</label>
                    <input
                      type={field.type}
                      className="w-full bg-gray-50 border-2 border-transparent focus:bg-white focus:border-brand rounded-2xl py-3 px-4 outline-none transition-all font-bold text-gray-800"
                      value={formData.credentials[field.key] || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        credentials: { ...formData.credentials, [field.key]: e.target.value }
                      })}
                      placeholder={`Cole sua ${field.label}...`}
                    />
                  </div>
                ))}
              </div>

              {testStatus.error && (
                <div className="p-3 bg-red-50 text-red-600 text-sm font-bold rounded-xl border border-red-100 flex items-center gap-2">
                   <div className="w-2 h-2 rounded-full bg-red-500 shrink-0"></div> {testStatus.error}
                </div>
              )}
              {testStatus.success && (
                <div className="p-3 bg-emerald-50 text-emerald-600 text-sm font-bold rounded-xl border border-emerald-100 flex items-center gap-2">
                   <CheckCircle size={16} /> Conexão estabelecida com sucesso!
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-100 flex justify-between bg-white items-center gap-4">
               <button 
                 onClick={handleTestConnection}
                 disabled={testStatus.loading}
                 className="flex-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold py-4 rounded-xl flex justify-center items-center gap-2 transition-all"
               >
                 {testStatus.loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Link2 size={18} />} Testar Conexão
               </button>

               <button 
                 onClick={handleSave}
                 disabled={formLoading}
                 className="flex-1 bg-emerald-600 hover:bg-brand text-white font-black uppercase tracking-wider text-sm py-4 rounded-xl flex justify-center items-center gap-2 transition-all shadow-lg"
               >
                 {formLoading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Salvar'}
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
