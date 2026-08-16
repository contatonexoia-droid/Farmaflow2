import React, { useState } from 'react';
import { Sparkles, Check, Copy, Wand2, HeartHandshake, Zap, FileText, Loader2, ArrowRight, X, MessageSquare, AlertCircle } from 'lucide-react';

interface AiChatCopilotProps {
  tenantId: string;
  currentMessage: string;
  onApplyText: (newText: string) => void;
  disabled?: boolean;
}

type CopilotAction = 'fix' | 'empathy' | 'summarize' | 'expand' | 'custom';

export const AiChatCopilot: React.FC<AiChatCopilotProps> = ({
  tenantId,
  currentMessage,
  onApplyText,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedText, setSuggestedText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedAction, setSelectedAction] = useState<CopilotAction | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [draftTopics, setDraftTopics] = useState('');

  const actions = [
    {
      id: 'fix' as CopilotAction,
      title: 'Corrigir Ortografia & Gramática',
      desc: 'Corrige erros de digitação e português mantendo termos farmacêuticos intactos.',
      icon: Check,
      color: 'from-emerald-500 to-teal-600',
      bgLight: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80 border-emerald-200',
      badge: 'Correção Rápida'
    },
    {
      id: 'empathy' as CopilotAction,
      title: 'Tornar Mais Empático & Acolhedor',
      desc: 'Ajusta o tom para um atendimento caloroso, humanizado e atencioso de drogaria.',
      icon: HeartHandshake,
      color: 'from-pink-500 to-purple-600',
      bgLight: 'bg-purple-50 text-purple-700 hover:bg-purple-100/80 border-purple-200',
      badge: 'Humanizado'
    },
    {
      id: 'summarize' as CopilotAction,
      title: 'Resumir & Tornar Direto',
      desc: 'Deixa a resposta concisa, mantendo apenas as orientações e valores essenciais.',
      icon: Zap,
      color: 'from-amber-500 to-orange-600',
      bgLight: 'bg-amber-50 text-amber-700 hover:bg-amber-100/80 border-amber-200',
      badge: 'Objetivo'
    },
    {
      id: 'expand' as CopilotAction,
      title: 'Criar Mensagem a partir de Tópicos',
      desc: 'Transforma anotações soltas (ex: preço, entrega, receita) em uma resposta completa.',
      icon: Wand2,
      color: 'from-indigo-500 to-blue-600',
      bgLight: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100/80 border-indigo-200',
      badge: 'Gerar do Zero'
    },
  ];

  const handleExecute = async (action: CopilotAction, customText?: string) => {
    setSelectedAction(action);
    setErrorMsg(null);
    setSuggestedText(null);
    setIsLoading(true);

    let textToProcess = currentMessage;
    if (action === 'expand' && draftTopics.trim()) {
      textToProcess = draftTopics.trim();
    } else if (action === 'expand' && !currentMessage.trim() && !draftTopics.trim()) {
      setErrorMsg('Por favor, digite os tópicos ou anotações no campo abaixo.');
      setIsLoading(false);
      return;
    } else if (!textToProcess.trim() && action !== 'custom') {
      setErrorMsg('Digite um texto no chat ou selecione "Criar a partir de Tópicos" para a IA processar.');
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/v1/chat/ai-copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action,
          text: textToProcess,
          customInstruction: customText || customPrompt
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Não foi possível processar a solicitação com a IA.');
      }

      setSuggestedText(data.suggestedText);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro de comunicação com o assistente de IA.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = () => {
    if (suggestedText) {
      onApplyText(suggestedText);
      setIsOpen(false);
      setSuggestedText(null);
      setDraftTopics('');
      setShowCustomInput(false);
    }
  };

  const handleCopy = () => {
    if (suggestedText) {
      navigator.clipboard.writeText(suggestedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative inline-block">
      {/* Botão de Acionamento no Chat */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setIsOpen(!isOpen);
          setErrorMsg(null);
          setSuggestedText(null);
          if (currentMessage.trim()) {
            setDraftTopics(currentMessage);
          }
        }}
        title="Assistente de IA para Atendentes (Copilot)"
        className={`p-2 rounded-xl flex items-center gap-1.5 text-xs font-bold transition-all shadow-sm active:scale-95 ${
          isOpen
            ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white ring-2 ring-purple-300'
            : 'bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 text-indigo-700 hover:from-purple-100 hover:to-indigo-100 border border-indigo-200'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Sparkles className="w-4 h-4 text-purple-600 animate-pulse" />
        <span className="hidden sm:inline font-semibold">Assistente IA</span>
      </button>

      {/* Popover Flutuante */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm sm:absolute sm:inset-auto sm:bottom-full sm:right-0 sm:mb-3 sm:w-[480px] sm:max-w-[90vw] animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden w-full max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-700 via-indigo-700 to-blue-700 p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/10 rounded-xl backdrop-blur-md">
                  <Sparkles className="w-5 h-5 text-purple-200" />
                </div>
                <div>
                  <h3 className="font-bold text-sm leading-tight flex items-center gap-2">
                    Copilot de Atendimento
                    <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full uppercase tracking-wider font-extrabold">IA</span>
                  </h3>
                  <p className="text-[11px] text-purple-100">Aprimore suas respostas antes de enviar ao cliente</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo */}
            <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(85vh-140px)]">
              {/* Mensagem de Erro */}
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Ops, atenção:</p>
                    <p className="mt-0.5">{errorMsg}</p>
                  </div>
                </div>
              )}

              {/* Se ainda não gerou ou não está carregando */}
              {!suggestedText && !isLoading && (
                <>
                  {/* Se o chat está vazio, sugere modo de tópicos */}
                  {!currentMessage.trim() && (
                    <div className="bg-indigo-50/70 p-3 rounded-xl border border-indigo-100 space-y-2">
                      <label className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-indigo-600" /> Digite suas anotações ou tópicos soltos:
                      </label>
                      <textarea
                        rows={2}
                        value={draftTopics}
                        onChange={(e) => setDraftTopics(e.target.value)}
                        placeholder="Ex: remédio dorflex 12 reais, temos estoque, entrega sai em 30 min..."
                        className="w-full text-xs p-2.5 rounded-lg border border-indigo-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                    </div>
                  )}

                  {/* Lista de Ações Predefinidas */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Escolha uma Ação Rápida:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {actions.map((act) => {
                        const Icon = act.icon;
                        return (
                          <button
                            key={act.id}
                            type="button"
                            onClick={() => handleExecute(act.id)}
                            className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between group relative overflow-hidden ${act.bgLight}`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="p-1.5 rounded-lg bg-white shadow-xs">
                                <Icon className="w-4 h-4" />
                              </span>
                              <span className="text-[9px] font-extrabold uppercase tracking-wider opacity-80">{act.badge}</span>
                            </div>
                            <div>
                              <p className="text-xs font-bold leading-tight">{act.title}</p>
                              <p className="text-[10px] opacity-75 mt-0.5 line-clamp-2">{act.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Ação Personalizada */}
                  <div className="pt-2 border-t border-gray-100">
                    {!showCustomInput ? (
                      <button
                        type="button"
                        onClick={() => setShowCustomInput(true)}
                        className="w-full py-2 px-3 text-xs font-bold text-gray-600 hover:text-indigo-600 hover:bg-gray-50 rounded-xl border border-dashed border-gray-300 transition-all flex items-center justify-center gap-1.5"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Outra Instrução Personalizada...
                      </button>
                    ) : (
                      <div className="space-y-2 bg-gray-50 p-3 rounded-xl border border-gray-200 animate-in fade-in">
                        <label className="text-[11px] font-bold text-gray-700">O que você quer que a IA faça com o texto?</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="Ex: Traduzir para inglês, adicionar dados do PIX..."
                            className="flex-1 text-xs p-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => handleExecute('custom', customPrompt)}
                            disabled={!customPrompt.trim()}
                            className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1"
                          >
                            Gerar <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Carregando com Spinner */}
              {isLoading && (
                <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full border-4 border-purple-200 border-t-purple-600 animate-spin" />
                    <Sparkles className="w-5 h-5 text-purple-600 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">Processando com Inteligência Artificial...</p>
                    <p className="text-xs text-gray-500 mt-0.5">Aprimorando sua mensagem para o melhor atendimento farmacêutico</p>
                  </div>
                </div>
              )}

              {/* Resultado Gerado com Preview */}
              {suggestedText && !isLoading && (
                <div className="space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5 text-emerald-600" /> Sugestão da IA Pronta:
                    </span>
                    <button
                      type="button"
                      onClick={() => setSuggestedText(null)}
                      className="text-[11px] text-gray-500 hover:text-gray-800 underline font-medium"
                    >
                      Tentar outra opção
                    </button>
                  </div>

                  <div className="p-3 bg-gradient-to-br from-emerald-50/60 to-teal-50/40 rounded-xl border border-emerald-200 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                    {suggestedText}
                  </div>

                  {/* Barra de Ações do Resultado */}
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleApply}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-4 h-4" /> Inserir no Chat
                    </button>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copiado!' : 'Copiar'}
                    </button>
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
