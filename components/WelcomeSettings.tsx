import React, { useState, useEffect } from 'react';
import { PharmacyConfig } from '../types';
import { MessageSquare, Phone, CheckCircle, Loader2, Save, Sparkles, Send, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';

export interface WelcomeSettingsProps {
  config: PharmacyConfig;
  onConfigUpdate: (updated: PharmacyConfig) => void | Promise<void>;
}

export const WelcomeSettings: React.FC<WelcomeSettingsProps> = ({ config, onConfigUpdate }) => {
  const tenantId = config.id;

  // Local state for Welcome Message
  const [welcomeEnabled, setWelcomeEnabled] = useState<boolean>(config.welcomeMessageEnabled ?? false);
  const [welcomeText, setWelcomeText] = useState<string>(
    config.welcomeMessageText || "Olá! Seja muito bem-vindo(a) à nossa farmácia! Como podemos te ajudar hoje?"
  );
  const [welcomeFormat, setWelcomeFormat] = useState<'button' | 'text'>(config.welcomeMessageFormat || 'button');
  const [welcomeLink, setWelcomeLink] = useState<string>(config.welcomeMessageLink || "");

  // Loading & feedback states
  const [isToggling, setIsToggling] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Sync state if config prop updates
  useEffect(() => {
    setWelcomeEnabled(config.welcomeMessageEnabled ?? false);
    setWelcomeText(
      config.welcomeMessageText || "Olá! Seja muito bem-vindo(a) à nossa farmácia! Como podemos te ajudar hoje?"
    );
    setWelcomeFormat(config.welcomeMessageFormat || 'button');
    setWelcomeLink(config.welcomeMessageLink || "");
  }, [config]);

  // Handler for Auto-Save on Toggle Switch
  const handleToggleWelcome = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextState = e.target.checked;
    if (isToggling || isSaving) return;

    const previousState = welcomeEnabled;
    setIsToggling(true);
    setWelcomeEnabled(nextState);

    try {
      // 1. Dispatch immediate HTTP PATCH to backend settings endpoint
      const response = await fetch(`/api/v1/tenants/${tenantId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          welcome_message_enabled: nextState,
          welcomeMessageEnabled: nextState,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // 2. Sincroniza o estado no contexto/armazenamento principal
      await onConfigUpdate({
        ...config,
        welcomeMessageEnabled: nextState,
        welcomeMessageText: welcomeText,
        welcomeMessageFormat: welcomeFormat,
        welcomeMessageLink: welcomeLink,
      });

      // 3. Feedback Toast
      if (nextState) {
        toast.success("Mensagem de boas-vindas ativada com sucesso!");
      } else {
        toast.success("Mensagem de boas-vindas desativada com sucesso!");
      }
    } catch (error: any) {
      console.error("Erro ao alterar status da mensagem de boas-vindas:", error);
      // Revert state on failure
      setWelcomeEnabled(previousState);
      toast.error("Erro ao atualizar status da mensagem de boas-vindas.");
    } finally {
      setIsToggling(false);
    }
  };

  // Handler for explicit "Salvar Alterações" button
  const handleSaveWelcomeConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving || isToggling) return;

    setIsSaving(true);
    setSavedSuccess(false);

    try {
      // 1. Persiste via API no backend
      const response = await fetch(`/api/v1/tenants/${tenantId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          welcome_message_enabled: welcomeEnabled,
          welcomeMessageEnabled: welcomeEnabled,
          welcome_message_text: welcomeText,
          welcomeMessageText: welcomeText,
          welcome_message_format: welcomeFormat,
          welcomeMessageFormat: welcomeFormat,
          welcome_message_link: welcomeLink,
          welcomeMessageLink: welcomeLink,
        }),
      });

      if (!response.ok) {
        console.warn(`[WelcomeSettings] Endpoint retornou status ${response.status}, prosseguindo com onConfigUpdate`);
      }

      // 2. Atualiza estado global do tenant
      await onConfigUpdate({
        ...config,
        welcomeMessageEnabled: welcomeEnabled,
        welcomeMessageText: welcomeText,
        welcomeMessageFormat: welcomeFormat,
        welcomeMessageLink: welcomeLink,
      });

      setSavedSuccess(true);
      toast.success("Configurações de boas-vindas salvas com sucesso!");
      setTimeout(() => setSavedSuccess(false), 3500);
    } catch (err: any) {
      console.error("Erro ao salvar configurações de boas-vindas:", err);
      toast.error("Erro ao salvar configurações de boas-vindas.");
    } finally {
      setIsSaving(false);
    }
  };

  const defaultLojaUrl = config.custom_domain
    ? `https://${config.custom_domain}`
    : `https://${config.slug || 'suafarmacia'}.farmaflow.online`;

  return (
    <div className="bg-gradient-to-br from-emerald-50/70 via-white to-white p-6 sm:p-8 rounded-[2.5rem] border border-emerald-100 shadow-sm space-y-6">
      {/* Header com Toggle Switch e Auto-Save */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-100/60 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/20 shrink-0">
            <MessageSquare size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-black text-gray-900 text-xl tracking-tight">Mensagem Automática de Boas-Vindas</h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800">
                1ª Mensagem do Dia
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Envie automaticamente uma saudação personalizada e o link da sua loja online quando o cliente enviar a primeira mensagem do dia no WhatsApp.
            </p>
          </div>
        </div>

        {/* Toggle Switch com Auto-Save e Proteção contra Double Click */}
        <div className="flex items-center gap-3 shrink-0">
          <label className={`relative inline-flex items-center cursor-pointer ${isToggling ? 'opacity-60 cursor-not-allowed' : ''}`}>
            <input
              type="checkbox"
              id="welcome-message-toggle"
              checked={welcomeEnabled}
              onChange={handleToggleWelcome}
              disabled={isToggling || isSaving}
              className="sr-only peer"
            />
            <div className="w-14 h-8 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-600"></div>
            <span className="ml-3 text-sm font-bold text-gray-800 select-none min-w-[75px] flex items-center gap-1.5">
              {isToggling ? (
                <>
                  <Loader2 size={14} className="animate-spin text-emerald-600" />
                  <span className="text-xs text-gray-500">Salvando...</span>
                </>
              ) : (
                welcomeEnabled ? (
                  <span className="text-emerald-700 font-bold">Ativado</span>
                ) : (
                  <span className="text-gray-500 font-medium">Desativado</span>
                )
              )}
            </span>
          </label>
        </div>
      </div>

      {/* Formulário de Configuração & Pré-visualização ao Vivo */}
      <form onSubmit={handleSaveWelcomeConfig} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Left Col: Inputs */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                Texto da Saudação Personalizado
              </label>
              <textarea
                id="welcome-message-text-input"
                rows={4}
                value={welcomeText}
                onChange={(e) => setWelcomeText(e.target.value)}
                placeholder="Digite a mensagem de boas-vindas..."
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm font-medium transition-all"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Personalize o texto inicial enviado ao cliente.
              </p>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                Escolha do Formato do Botão/Link
              </label>
              <select
                id="welcome-message-format-select"
                value={welcomeFormat}
                onChange={(e) => setWelcomeFormat(e.target.value as 'button' | 'text')}
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm font-bold text-gray-800 bg-white transition-all cursor-pointer"
              >
                <option value="button">🔘 Botão Interativo de Link (Evolution API)</option>
                <option value="text">📝 Texto com Link Encurtado e Destacado</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                {welcomeFormat === 'button'
                  ? 'Dispara um botão de link clicável via Evolution API.'
                  : 'Dispara uma mensagem formatada com emojis e link direto em texto.'}
              </p>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                Link da Loja Online (Opcional)
              </label>
              <input
                id="welcome-message-link-input"
                type="text"
                value={welcomeLink}
                onChange={(e) => setWelcomeLink(e.target.value)}
                placeholder={`Ex: ${defaultLojaUrl}`}
                className="w-full px-4 py-3 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-sm font-medium transition-all"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Deixe em branco para usar o link automático do catálogo virtual da farmácia.
              </p>
            </div>
          </div>

          {/* Right Col: Live WhatsApp Preview */}
          <div className="bg-emerald-950/5 border border-emerald-200/50 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-gray-200/60 pb-3 mb-4">
                <span className="text-xs font-black text-emerald-900 uppercase tracking-wider flex items-center gap-2">
                  <Phone size={14} className="text-emerald-600" /> Pré-visualização do Cliente (WhatsApp)
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${welcomeEnabled ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                  {welcomeEnabled ? 'Status: Ativo' : 'Status: Desativado'}
                </span>
              </div>

              {/* Bubble preview */}
              <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-4 shadow-xs text-gray-800 text-xs leading-relaxed space-y-3 font-sans">
                <p className="font-bold text-emerald-900">👋 {config.name || 'Sua Farmácia'}</p>
                <p className="whitespace-pre-wrap">{welcomeText || 'Olá! Seja muito bem-vindo(a)!'}</p>

                {welcomeFormat === 'button' ? (
                  <div className="pt-2">
                    <div className="w-full py-2.5 px-4 bg-white hover:bg-emerald-100/50 border border-emerald-300/80 rounded-xl font-bold text-emerald-700 text-center flex items-center justify-center gap-2 shadow-xs transition-all">
                      <span>🛒 Acessar Loja Online</span>
                    </div>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-emerald-200/50 text-emerald-800">
                    <p className="font-bold mb-1">🛍️ Acesse nossa Loja Online:</p>
                    <p className="text-blue-600 underline font-mono break-all">
                      {welcomeLink || defaultLojaUrl}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <p className="text-[10px] text-gray-400 mt-4 text-center italic">
              * Disparado unicamente na primeira mensagem recebida do cliente no dia.
            </p>
          </div>
        </div>

        {/* Botão Explícito "Salvar Alterações" no Card */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-emerald-100/60">
          <div className="text-xs text-gray-500 font-medium">
            {welcomeEnabled ? (
              <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Envio automático ativado para novos contatos do dia.
              </span>
            ) : (
              <span className="text-gray-400">
                O envio automático está desligado. Você ainda pode salvar suas preferências.
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {savedSuccess && (
              <span className="text-xs font-bold text-emerald-600 flex items-center gap-1.5 animate-in fade-in">
                <CheckCircle size={16} /> Configurações de boas-vindas salvas!
              </span>
            )}
            <button
              type="submit"
              id="btn-save-welcome-settings"
              disabled={isSaving || isToggling}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              Salvar Alterações
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
