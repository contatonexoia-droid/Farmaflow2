import React, { useState } from 'react';
import { PharmacyConfig, AiAgentConfig } from '../types';
import { 
  Bot, Sparkles, Key, Settings, MessageSquare, Play, RefreshCw, 
  CheckCircle, AlertCircle, Eye, EyeOff, Save, Loader2, ShieldCheck, 
  HelpCircle, Zap, Send, CornerDownLeft, Info, Store
} from 'lucide-react';
import { testAiAgent } from '../services/storage';

interface AiAgentSettingsProps {
  config: PharmacyConfig;
  onConfigUpdate: (updated: PharmacyConfig) => Promise<void>;
}

export const DEFAULT_UNIVERSAL_PROMPT = `Você é o Atendente Virtual Inteligente da drogaria conectada a esta sessão.
Seu objetivo é recepcionar o cliente com agilidade, tirar dúvidas sobre medicamentos e produtos, consultar preços reais e direcioná-lo estrategicamente para a compra.

1. CONSULTAS E AUTONOMIA:
   - Use obrigatoriamente a ferramenta \`consultar_dados_loja()\` para verificar o nome real da loja, horários de atendimento, endereço e o link da loja online. Nunca invente essas informações.
   - Use obrigatoriamente \`buscar_produtos(termo)\` para consultar estoque, dosagens e preços em tempo real antes de informar qualquer valor ao cliente. Nunca estime preços.

2. CANAL PREFERENCIAL (CATÁLOGO ONLINE):
   - Apresente a loja online como a forma mais prática e vantajosa para ver fotos, cupons, opções de genéricos/similares com desconto e calcular o frete automaticamente.

3. PEDIDO DIRETO PELO WHATSAPP (VONTADE DO CLIENTE):
   - Se o cliente informar que prefere fechar pelo WhatsApp ou mandar a lista de compras no chat:
     1. Não insista para que ele use o site.
     2. Apresente os preços dos produtos consultados.
     3. Avise educadamente que o balconista da farmácia vai continuar a conversa em instantes para anotar o endereço e concluir o pedido.
     4. Acione a função interna de transbordo para a equipe de balcão.

4. POLÍTICA DE ENTREGA E RECEITUÁRIO:
   - A drogaria opera com foco exclusivo em tele-entrega (delivery). Não ofereça retirada em loja física.
   - Para medicamentos controlados, antibióticos ou tarja preta, avise que a receita médica (foto legível no chat ou anexo no carrinho) deve ser conferida pelo farmacêutico antes da entrega.

5. DIRETRIZES DE LINKS E FORMATAÇÃO VISUAL:
   - Nunca polua o chat com múltiplos links na mesma mensagem.
   - Em buscas e listagens de preços, apresente apenas 'Nome - Preço' e inclua apenas o link geral da loja no final da mensagem.
   - Envie o link direto de um produto específico SOMENTE se o cliente solicitar a compra daquele item em particular.
   - Se o cliente optar por pedir pelo WhatsApp, não envie links de carrinho; apresente os valores e acione o balconista humano para concluir a tele-entrega.

6. POSTURA E LIMITES:
   - Mantenha respostas curtas, gentis e objetivas (1 a 3 parágrafos). Não colete dados de cartão de crédito no chat.`;

export const AiAgentSettings: React.FC<AiAgentSettingsProps> = ({ config, onConfigUpdate }) => {
  const isSuperAdminAuthorized = config.isAiAgentEnabled === true;
  const storeDisplayName = (config as any)?.nome_loja || config.name || 'nossa farmácia';

  const defaultConfig: AiAgentConfig = {
    enabled: false,
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-2.5-flash',
    systemPrompt: DEFAULT_UNIVERSAL_PROMPT,
    temperature: 0.7,
    maxTokens: 500,
    fallbackMessage: 'Desculpe, estou com uma instabilidade momentânea. Um de nossos atendentes humanos responderá sua mensagem em breve!',
    maxInteractionsPerSession: 4,
    transitionToHumanMessage: 'Perfeito! Já notifiquei nossa equipe e um dos nossos balconistas vai dar continuidade ao seu atendimento em instantes para finalizar seu pedido.',
    antiAbuseGuardrailsEnabled: true,
    strictStoreLinkEnforcement: true,
  };

  const [agentConfig, setAgentConfig] = useState<AiAgentConfig>({
    ...defaultConfig,
    ...(config.aiAgentConfig || {}),
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Playground simulator state
  const [testMessage, setTestMessage] = useState('');
  const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    {
      role: 'assistant',
      content: `Olá! Sou o assistente virtual da ${storeDisplayName}. Em que posso te ajudar hoje?`
    }
  ]);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const updatedConfig: PharmacyConfig = {
        ...config,
        aiAgentConfig: agentConfig
      };

      await onConfigUpdate(updatedConfig);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err: any) {
      console.error("Erro ao salvar configuração do Agente de IA:", err);
      setSaveError(err.message || "Erro ao salvar as configurações. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!testMessage.trim() || testing) return;

    const userText = testMessage.trim();
    setTestMessage('');
    setTestError(null);

    const newHistory = [...chatHistory, { role: 'user' as const, content: userText }];
    setChatHistory(newHistory);

    // Validação preventiva de API Key no cliente
    if (!agentConfig.apiKey?.trim()) {
      const providerName = agentConfig.provider === 'gemini' ? 'Google AI Studio (Gemini)' : 'OpenAI';
      const keyUrl = agentConfig.provider === 'gemini' ? 'https://aistudio.google.com/app/apikey' : 'https://platform.openai.com/api-keys';
      setChatHistory(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `🔑 Para que o assistente possa responder, por favor insira sua Chave de API do ${providerName} no campo "Chave de Acesso" ao lado.\n\n👉 Caso ainda não tenha uma chave gratuita, você pode gerá-la em:\n${keyUrl}`
        }
      ]);
      return;
    }

    setTesting(true);

    try {
      const result = await testAiAgent(
        config.id,
        userText,
        newHistory.slice(0, -1),
        agentConfig // Pass current unsaved or edited config to test in real-time
      );

      if (result && result.reply) {
        setChatHistory(prev => [...prev, { role: 'assistant', content: result.reply }]);
      } else {
        throw new Error('Não foi possível gerar resposta com a IA.');
      }
    } catch (err: any) {
      console.error("Erro no teste da IA:", err);
      let errorDisplay = err.message || 'Falha ao processar mensagem no simulador.';
      
      // Limpeza de mensagens técnicas de erro
      if (typeof errorDisplay === 'string' && errorDisplay.startsWith('{')) {
        try {
          const parsed = JSON.parse(errorDisplay);
          if (parsed.error?.message) {
            errorDisplay = parsed.error.message;
          }
        } catch (e) {}
      }

      setTestError(errorDisplay);
      setChatHistory(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ [Aviso do Provedor de IA]:\n${errorDisplay}`
        }
      ]);
    } finally {
      setTesting(false);
    }
  };

  const handleClearChat = () => {
    setChatHistory([
      {
        role: 'assistant',
        content: `Olá! Sou o assistente virtual da ${storeDisplayName}. Em que posso te ajudar hoje?`
      }
    ]);
    setTestError(null);
  };

  if (!isSuperAdminAuthorized) {
    return (
      <div className="space-y-8 animate-in fade-in">
        <div className="bg-gradient-to-br from-purple-900 via-indigo-900 to-gray-950 text-white p-10 md:p-14 rounded-[3rem] shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
            <Bot size={240} />
          </div>

          <div className="max-w-2xl relative z-10 space-y-6">
            <div className="inline-flex items-center gap-2 bg-purple-500/20 text-purple-300 border border-purple-500/30 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider">
              <Sparkles size={14} /> Recurso Especial / Plano Upgrade
            </div>

            <h3 className="text-3xl md:text-4xl font-black tracking-tight leading-tight">
              Agente de Atendimento Inteligente com IA
            </h3>

            <p className="text-purple-200/90 text-sm md:text-base leading-relaxed">
              Atenda seus clientes automaticamente 24 horas por dia com inteligência artificial generativa. 
              O assistente responde dúvidas sobre posologia, horários de entrega, busca produtos no seu estoque em tempo real e direciona o cliente diretamente para a sua Webloja para concluir a compra!
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex items-start gap-3">
                <Zap className="text-yellow-400 shrink-0 mt-0.5" size={20} />
                <div>
                  <h5 className="font-bold text-sm text-white">Respostas Instantâneas</h5>
                  <p className="text-xs text-purple-200">Reduza o tempo de espera no WhatsApp e na loja virtual a zero.</p>
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex items-start gap-3">
                <Store className="text-emerald-400 shrink-0 mt-0.5" size={20} />
                <div>
                  <h5 className="font-bold text-sm text-white">Links da sua Webloja</h5>
                  <p className="text-xs text-purple-200">Indica produtos em estoque com preço atualizado e link direto.</p>
                </div>
              </div>
            </div>

            <div className="bg-purple-950/80 border border-purple-400/30 p-5 rounded-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="text-purple-300 shrink-0" size={24} />
                <div>
                  <p className="text-xs font-bold text-purple-100">Disponível mediante liberação do Plano Master</p>
                  <p className="text-[11px] text-purple-300">Entre em contato com o suporte ou administrador do sistema para habilitar o módulo para esta farmácia.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-in fade-in">
      {/* Banner de status do Módulo */}
      <div className="bg-gradient-to-r from-purple-50 via-indigo-50 to-purple-50 p-6 md:p-8 rounded-[2.5rem] border border-purple-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-md ${agentConfig.enabled ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
            <Bot size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-xl font-black text-gray-900">Agente de Atendimento Inteligente</h4>
              <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full ${agentConfig.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>
                {agentConfig.enabled ? 'Ativo' : 'Pausado'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Personalize as instruções de atendimento e conecte sua chave de API para atendimento automatizado.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer select-none bg-white px-5 py-3 rounded-2xl border-2 border-purple-200 hover:border-purple-300 transition-colors shadow-sm">
          <span className="text-xs font-bold text-gray-700">Ativar Agente no Chat:</span>
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={agentConfig.enabled}
              onChange={(e) => setAgentConfig({ ...agentConfig, enabled: e.target.checked })}
            />
            <div className={`block w-12 h-7 rounded-full transition-colors ${agentConfig.enabled ? 'bg-purple-600' : 'bg-gray-300'}`}></div>
            <div className={`absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${agentConfig.enabled ? 'transform translate-x-5' : ''}`}></div>
          </div>
        </label>
      </div>

      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-6 py-4 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <CheckCircle size={20} className="text-emerald-600 shrink-0" />
          <p className="text-sm font-bold">Configurações do Agente de IA salvas com sucesso!</p>
        </div>
      )}

      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-6 py-4 rounded-2xl flex items-center gap-3 animate-in fade-in">
          <AlertCircle size={20} className="text-red-600 shrink-0" />
          <p className="text-sm font-bold">{saveError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Formulário de Configuração */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSave} className="space-y-6">
            {/* Bloco 1: Provedor e Chave de API */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <Key className="text-purple-600" size={20} />
                <h5 className="font-black text-gray-900 text-base">Provedor e Chave de Acesso (API Key)</h5>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase text-gray-500">Provedor de IA</label>
                  <select
                    value={agentConfig.provider}
                    onChange={(e) => {
                      const prov = e.target.value as 'gemini' | 'openai';
                      setAgentConfig({
                        ...agentConfig,
                        provider: prov,
                        model: prov === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'
                      });
                    }}
                    className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl p-3.5 text-sm font-bold text-gray-800 outline-none focus:border-purple-500 transition-colors"
                  >
                    <option value="gemini">Google Gemini (Recomendado)</option>
                    <option value="openai">OpenAI (ChatGPT)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase text-gray-500">Modelo</label>
                  <select
                    value={agentConfig.model || (agentConfig.provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini')}
                    onChange={(e) => setAgentConfig({ ...agentConfig, model: e.target.value })}
                    className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl p-3.5 text-sm font-bold text-gray-800 outline-none focus:border-purple-500 transition-colors"
                  >
                    {agentConfig.provider === 'gemini' ? (
                      <>
                        <option value="gemini-2.5-flash">Gemini 2.5 Flash (Ultra Rápido & Econômico)</option>
                        <option value="gemini-2.5-pro">Gemini 2.5 Pro (Máximo Raciocínio)</option>
                      </>
                    ) : (
                      <>
                        <option value="gpt-4o-mini">GPT-4o Mini (Rápido)</option>
                        <option value="gpt-4o">GPT-4o (Completo)</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase text-gray-500">Chave de API Própria ({agentConfig.provider === 'gemini' ? 'Google AI Studio Key' : 'OpenAI Secret Key'})</label>
                  <a
                    href={agentConfig.provider === 'gemini' ? 'https://aistudio.google.com/app/apikey' : 'https://platform.openai.com/api-keys'}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-bold text-purple-600 hover:underline flex items-center gap-1"
                  >
                    Obter Chave <CornerDownLeft size={10} />
                  </a>
                </div>

                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={agentConfig.apiKey || ''}
                    onChange={(e) => setAgentConfig({ ...agentConfig, apiKey: e.target.value })}
                    placeholder={agentConfig.provider === 'gemini' ? 'AIzaSy...' : 'sk-...'}
                    className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl p-3.5 pr-12 text-sm font-mono font-bold text-gray-800 outline-none focus:border-purple-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  >
                    {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                
                {agentConfig.provider === 'gemini' && (
                  <div className="bg-amber-50/70 border border-amber-200/80 p-3 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
                    <Info size={15} className="shrink-0 mt-0.5 text-amber-700" />
                    <div>
                      <strong>Atenção ao gerar chave no Google AI Studio:</strong> Ao criar a API Key no <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="underline font-bold text-amber-950">Google AI Studio</a>, selecione <em>"Create API key in new project"</em> (Criar chave em novo projeto) sem vincular restrições de API para garantir o funcionamento com a IA generativa.
                    </div>
                  </div>
                )}
                
                <p className="text-[11px] text-gray-400">
                  Sua chave é armazenada de forma segura e utilizada exclusivamente para processar as conversas da sua farmácia.
                </p>
              </div>
            </div>

            {/* Bloco 2: Prompt e Instruções do Assistente */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <MessageSquare className="text-purple-600" size={20} />
                  <h5 className="font-black text-gray-900 text-base">Instruções de Personalidade & Prompt</h5>
                </div>
                <button
                  type="button"
                  onClick={() => setAgentConfig({ ...agentConfig, systemPrompt: DEFAULT_UNIVERSAL_PROMPT })}
                  className="text-xs font-bold text-purple-600 hover:text-purple-800 transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Restaurar Padrão
                </button>
              </div>

              <div className="space-y-2">
                <textarea
                  rows={8}
                  value={agentConfig.systemPrompt}
                  onChange={(e) => setAgentConfig({ ...agentConfig, systemPrompt: e.target.value })}
                  placeholder="Defina as instruções de atendimento da IA..."
                  className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl p-4 text-xs md:text-sm font-medium text-gray-800 leading-relaxed outline-none focus:border-purple-500 transition-colors"
                />
                <div className="bg-purple-50/60 p-3.5 rounded-xl text-[11px] text-purple-900 flex items-start gap-2">
                  <Info size={16} className="shrink-0 mt-0.5 text-purple-700" />
                  <span>
                    <strong>Dica de Ouro:</strong> O agente recebe automaticamente o catálogo de produtos e preços em estoque para indicar links da sua loja quando o cliente tiver dúvidas de compra.
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label className="text-xs font-black uppercase text-gray-500">Mensagem de Fallback / Falha</label>
                <input
                  type="text"
                  value={agentConfig.fallbackMessage || ''}
                  onChange={(e) => setAgentConfig({ ...agentConfig, fallbackMessage: e.target.value })}
                  placeholder="Mensagem exibida caso a IA esteja temporariamente indisponível"
                  className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl p-3.5 text-xs md:text-sm font-medium text-gray-800 outline-none focus:border-purple-500 transition-colors"
                />
              </div>
            </div>

            {/* Bloco 3: Trava de Segurança, Limite de Tokens e Transição para Humano */}
            <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
              <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                <ShieldCheck className="text-emerald-600" size={22} />
                <div>
                  <h5 className="font-black text-gray-900 text-base">Trava de Segurança & Transição para Humano</h5>
                  <p className="text-xs text-gray-500">Controle estrito de consumo de tokens, proteção contra loops e handoff automático para o balcão.</p>
                </div>
              </div>

              {/* Limite de Interações por Sessão */}
              <div className="space-y-3 bg-gray-50 p-4 md:p-5 rounded-2xl border border-gray-200/80">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label className="text-xs font-black uppercase text-gray-700 flex items-center gap-1.5">
                      <Zap size={14} className="text-amber-500" /> Limite Máximo de Interações por Sessão
                    </label>
                    <p className="text-[11px] text-gray-500">
                      Evita consumo excessivo de tokens e loops infinitos. Após o limite, a IA conclui a resposta, injeta o link da loja e transfere para o balconista.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-300 shadow-sm">
                    <input
                      type="number"
                      min={2}
                      max={10}
                      value={agentConfig.maxInteractionsPerSession || 4}
                      onChange={(e) => setAgentConfig({ ...agentConfig, maxInteractionsPerSession: Math.max(2, Math.min(10, parseInt(e.target.value) || 4)) })}
                      className="w-12 text-center font-black text-sm text-purple-700 outline-none"
                    />
                    <span className="text-xs font-bold text-gray-400">mensagens</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {[3, 4, 5].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setAgentConfig({ ...agentConfig, maxInteractionsPerSession: num })}
                      className={`text-[11px] px-3 py-1 rounded-lg font-bold transition-all ${
                        (agentConfig.maxInteractionsPerSession || 4) === num
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'bg-white text-gray-600 hover:bg-gray-200 border border-gray-200'
                      }`}
                    >
                      {num} {num === 4 ? 'Mensagens (Recomendado)' : 'Mensagens'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mensagem Padrão de Transição para Atendimento Humano */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase text-gray-500">Mensagem de Transição para o Atendente Humano</label>
                  <button
                    type="button"
                    onClick={() => setAgentConfig({
                      ...agentConfig,
                      transitionToHumanMessage: 'Perfeito! Já notifiquei nossa equipe e um dos nossos balconistas vai dar continuidade ao seu atendimento em instantes para finalizar seu pedido.'
                    })}
                    className="text-[11px] font-bold text-purple-600 hover:text-purple-800 transition-colors flex items-center gap-1"
                  >
                    <RefreshCw size={10} /> Restaurar Padrão
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={agentConfig.transitionToHumanMessage || ''}
                  onChange={(e) => setAgentConfig({ ...agentConfig, transitionToHumanMessage: e.target.value })}
                  placeholder="Ex: Perfeito! Já notifiquei nossa equipe e um dos nossos balconistas vai dar continuidade ao seu atendimento em instantes para finalizar seu pedido."
                  className="w-full bg-gray-50 border-2 border-gray-200 rounded-2xl p-3.5 text-xs md:text-sm font-medium text-gray-800 outline-none focus:border-purple-500 transition-colors"
                />
              </div>

              {/* Toggles de Proteção e Injeção de Link */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <label className="flex items-start gap-3 p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-2xl cursor-pointer hover:bg-emerald-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={agentConfig.antiAbuseGuardrailsEnabled !== false}
                    onChange={(e) => setAgentConfig({ ...agentConfig, antiAbuseGuardrailsEnabled: e.target.checked })}
                    className="mt-1 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <span className="text-xs font-black text-emerald-950 block">Proteção Ativa Anti-Abuso</span>
                    <span className="text-[11px] text-emerald-800 leading-tight block mt-0.5">
                      Bloqueia comandos de prompt injection, spam repetitivo e bypass de regras sem gastar tokens.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 bg-purple-50/70 border border-purple-200 rounded-2xl cursor-pointer hover:bg-purple-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={agentConfig.strictStoreLinkEnforcement !== false}
                    onChange={(e) => setAgentConfig({ ...agentConfig, strictStoreLinkEnforcement: e.target.checked })}
                    className="mt-1 rounded text-purple-600 focus:ring-purple-500"
                  />
                  <div>
                    <span className="text-xs font-black text-purple-950 block">Link Obrigatório da Webloja</span>
                    <span className="text-[11px] text-purple-800 leading-tight block mt-0.5">
                      Garante que todas as mensagens do bot contenham o link oficial da loja virtual da farmácia.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Botão de Salvar */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-purple-600 hover:bg-purple-700 text-white font-black text-sm px-8 py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {saving ? 'Salvando...' : 'Salvar Configurações de IA'}
              </button>
            </div>
          </form>
        </div>

        {/* Simulador Interativo / Playground */}
        <div className="lg:col-span-5 flex flex-col">
          <div className="bg-gray-900 text-white p-6 rounded-[2.5rem] shadow-xl flex-1 flex flex-col border border-gray-800 min-h-[540px]">
            <div className="flex items-center justify-between pb-4 border-b border-gray-800 mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-400">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h6 className="font-bold text-sm text-white">Simulador do Agente</h6>
                    {agentConfig.apiKey?.trim() ? (
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-bold">Chave Configurada</span>
                    ) : (
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold">Sem Chave</span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400">Teste com travas de segurança ativas</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-2 py-0.5 bg-gray-800 border border-gray-700 text-gray-300 rounded-md">
                  Interações: {chatHistory.filter(m => m.role === 'user').length} / {agentConfig.maxInteractionsPerSession || 4}
                </span>
                <button
                  onClick={handleClearChat}
                  className="text-[11px] text-gray-400 hover:text-white px-2.5 py-1 bg-gray-800 rounded-lg transition-colors flex items-center gap-1"
                  title="Reiniciar sessão"
                >
                  <RefreshCw size={12} /> Reiniciar
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[360px] scrollbar-thin">
              {chatHistory.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-purple-600 text-white rounded-br-none'
                        : 'bg-gray-800 text-gray-100 rounded-bl-none border border-gray-700'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <span className="text-[9px] text-gray-500 mt-1 px-1">
                    {msg.role === 'user' ? 'Você (Cliente)' : 'Agente IA'}
                  </span>
                </div>
              ))}

              {testing && (
                <div className="flex items-center gap-2 text-purple-400 text-xs py-2">
                  <Loader2 size={14} className="animate-spin" />
                  <span>O assistente está pensando...</span>
                </div>
              )}
            </div>

            {testError && (
              <div className="mt-2 bg-red-900/30 border border-red-800 text-red-300 p-2.5 rounded-xl text-[11px] flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span className="line-clamp-2">{testError}</span>
              </div>
            )}

            {/* Chat Input */}
            <div className="mt-4 pt-3 border-t border-gray-800 flex gap-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSendTestMessage();
                  }
                }}
                placeholder="Ex: Vocês têm Dipirona 500mg em estoque?"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-gray-500 outline-none focus:border-purple-500 transition-colors"
              />
              <button
                type="button"
                onClick={handleSendTestMessage}
                disabled={testing || !testMessage.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white p-2.5 rounded-xl transition-all disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
