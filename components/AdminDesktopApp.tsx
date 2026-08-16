import React, { useState, useEffect } from "react";
import { PharmacyConfig } from "../types";
import { 
  Laptop, 
  Download, 
  CheckCircle, 
  Info, 
  HelpCircle, 
  Sparkles,
  ArrowRight,
  Monitor,
  Chrome,
  Compass,
  AlertCircle
} from "lucide-react";

interface AdminDesktopAppProps {
  tenant: PharmacyConfig;
}

export const AdminDesktopApp: React.FC<AdminDesktopAppProps> = ({ tenant }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [os, setOs] = useState<"Windows" | "macOS" | "Linux" | "Outro">("Windows");
  const [browser, setBrowser] = useState<"Chrome/Edge" | "Safari" | "Firefox" | "Outro">("Chrome/Edge");
  const [installState, setInstallState] = useState<"idle" | "prompting" | "installed" | "error">("idle");

  useEffect(() => {
    // 1. Check if running in standalone mode (already installed)
    const checkStandalone = () => {
      const isStandaloneMode = 
        window.matchMedia("(display-mode: standalone)").matches || 
        (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();
    
    // 2. Load the initial deferred prompt if available
    if ((window as any).deferredPWAInstallPrompt) {
      setDeferredPrompt((window as any).deferredPWAInstallPrompt);
    }

    // 3. Listen to the PWA events
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleCustomPromptReady = () => {
      if ((window as any).deferredPWAInstallPrompt) {
        setDeferredPrompt((window as any).deferredPWAInstallPrompt);
      }
    };

    const handleAppInstalled = () => {
      setIsStandalone(true);
      setInstallState("installed");
      localStorage.setItem(`pwa_installed_${tenant.id}`, "true");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("pwa-prompt-ready", handleCustomPromptReady);
    window.addEventListener("appinstalled", handleAppInstalled);

    // 4. Detect OS and Browser
    const userAgent = window.navigator.userAgent;
    if (userAgent.indexOf("Win") !== -1) setOs("Windows");
    else if (userAgent.indexOf("Mac") !== -1) setOs("macOS");
    else if (userAgent.indexOf("Linux") !== -1) setOs("Linux");
    else setOs("Outro");

    if (userAgent.indexOf("Chrome") !== -1 || userAgent.indexOf("Edg") !== -1) {
      setBrowser("Chrome/Edge");
    } else if (userAgent.indexOf("Safari") !== -1 && userAgent.indexOf("Chrome") === -1) {
      setBrowser("Safari");
    } else if (userAgent.indexOf("Firefox") !== -1) {
      setBrowser("Firefox");
    } else {
      setBrowser("Outro");
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("pwa-prompt-ready", handleCustomPromptReady);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [tenant.id]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      // If the automatic prompt is not available, scroll down to the manual steps
      const element = document.getElementById("manual-steps");
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }

    try {
      setInstallState("prompting");
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setInstallState("installed");
        setIsStandalone(true);
      } else {
        setInstallState("idle");
      }
      setDeferredPrompt(null);
    } catch (err) {
      console.error("Erro ao instalar PWA:", err);
      setInstallState("error");
    }
  };

  const appName = tenant.name || "FarmaFlow AI";
  const appLogo = tenant.logo || "/icon-512.svg";
  const primaryColor = tenant.primaryColor || "#059669";

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12 animate-in fade-in duration-500" id="desktop-app-section">
      {/* Hero Banner / Head Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-slate-900 rounded-[2.5rem] p-8 md:p-12 text-white shadow-xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="max-w-xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider">
              <Sparkles size={14} /> Aplicativo PWA Otimizado
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight leading-tight">
              Instale o FarmaFlow AI <br className="hidden sm:inline" /> no seu Computador
            </h1>
            <p className="text-gray-400 text-sm md:text-base leading-relaxed">
              Transforme este painel em um software nativo e ultrarápido para a sua farmácia. Livre-se de guias do navegador e gerencie vendas, estoques e pedidos diretamente da sua barra de tarefas.
            </p>
          </div>

          <div className="flex flex-col items-center justify-center shrink-0">
            {/* Live mockup of desktop shortcut icon */}
            <div className="relative group p-4 bg-white/5 rounded-[2rem] border border-white/10 shadow-2xl backdrop-blur-sm hover:border-white/20 transition-all duration-300">
              <div className="relative w-28 h-28 bg-white rounded-3xl p-3 flex flex-col items-center justify-center shadow-lg transition-transform duration-500 group-hover:scale-105">
                <img 
                  src={appLogo} 
                  alt={appName} 
                  className="w-16 h-16 object-contain rounded-2xl shadow-sm"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute -bottom-2 bg-emerald-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap shadow-md">
                  PC/DESKTOP
                </div>
              </div>
              <p className="text-center text-[11px] font-bold text-gray-300 mt-4 max-w-[120px] truncate">
                {appName}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Control Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Left Side: Dynamic Download Box */}
        <div className="md:col-span-7 space-y-6">
          <div className="bg-white rounded-[2rem] border border-gray-100 p-8 shadow-sm flex flex-col justify-between min-h-[350px]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                  <Laptop size={24} />
                </div>
                <div>
                  <h3 className="font-black text-gray-900 text-lg">Central de Instalação</h3>
                  <p className="text-xs font-bold text-gray-500">Status do Sistema: {isStandalone ? "Instalado" : "Pronto para Instalação"}</p>
                </div>
              </div>

              <div className="border-t border-gray-100 my-4"></div>

              {isStandalone ? (
                <div className="space-y-4 py-4">
                  <div className="bg-emerald-50 border border-emerald-100/50 rounded-2xl p-4 flex items-start gap-3">
                    <div className="text-emerald-600 mt-0.5 shrink-0">
                      <CheckCircle size={20} />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-emerald-900">Já instalado com sucesso!</h4>
                      <p className="text-xs font-semibold text-emerald-700 mt-1 leading-relaxed">
                        Você já está usando o {appName} em modo aplicativo nativo. Agora você pode fechar as abas do navegador e usar o ícone na área de trabalho!
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 font-medium leading-relaxed bg-gray-50 rounded-xl p-4 border border-gray-100">
                    💡 <strong>Dica Profissional:</strong> Adicione o atalho à barra de tarefas (Taskbar) do Windows ou à Dock do macOS para abrir o sistema em 1 clique ao abrir a loja de manhã.
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-2">
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    A tecnologia PWA (Progressive Web App) permite transformar este painel administrativo em um aplicativo de computador real, sem consumir espaço em disco ou necessitar de downloads complexos em formato .exe.
                  </p>

                  <div className="flex flex-wrap items-center gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-100 text-xs text-gray-500 font-bold">
                    <span className="px-2.5 py-1 rounded-lg bg-white shadow-sm text-gray-700">SO: {os}</span>
                    <span className="px-2.5 py-1 rounded-lg bg-white shadow-sm text-gray-700">Navegador: {browser}</span>
                    {deferredPrompt ? (
                      <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span> Suporte Nativo Ativo
                      </span>
                    ) : (
                      <span className="text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100 flex items-center gap-1">
                        <HelpCircle size={12} /> Instalação Assistida
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {!isStandalone && (
              <div className="mt-8 space-y-3">
                {deferredPrompt ? (
                  <button
                    onClick={handleInstallClick}
                    className="w-full flex items-center justify-center gap-2 text-white font-bold py-4 px-6 rounded-2xl shadow-lg hover:shadow-xl active:scale-[0.98] transition-all cursor-pointer text-sm"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <Download size={18} className="animate-bounce" />
                    Instalar FarmaFlow no Computador
                  </button>
                ) : (
                  <div>
                    <button
                      onClick={handleInstallClick}
                      className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-bold py-4 px-6 rounded-2xl shadow-md active:scale-[0.98] transition-all cursor-pointer text-sm"
                    >
                      <Monitor size={18} />
                      Como Instalar Manualmente
                    </button>
                    <p className="text-center text-[11px] font-bold text-gray-400 mt-2">
                      Siga as instruções abaixo para ativar no seu navegador atual.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Benefits Panel */}
        <div className="md:col-span-5 space-y-6">
          <div className="bg-gray-50 rounded-[2rem] border border-gray-100 p-8 space-y-6 h-full">
            <h3 className="font-black text-gray-900 text-lg">Por que usar o App Desktop?</h3>
            
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0 text-emerald-600 font-bold text-xs border border-gray-100">1</div>
                <div>
                  <h4 className="text-sm font-black text-gray-900">Identidade Própria da Farmácia</h4>
                  <p className="text-xs font-semibold text-gray-500 mt-0.5 leading-relaxed">
                    O aplicativo instalado usará o logo e nome da sua drogaria <strong>({appName})</strong>, tornando o ambiente exclusivo e profissional para os operadores.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0 text-emerald-600 font-bold text-xs border border-gray-100">2</div>
                <div>
                  <h4 className="text-sm font-black text-gray-900">Foco Total (Sem Distrações)</h4>
                  <p className="text-xs font-semibold text-gray-500 mt-0.5 leading-relaxed">
                    O app abre em uma janela limpa, sem barra de endereços do navegador, sem risco do operador fechar a aba acidentalmente ou se distrair com outras redes.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="w-8 h-8 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0 text-emerald-600 font-bold text-xs border border-gray-100">3</div>
                <div>
                  <h4 className="text-sm font-black text-gray-900">Desempenho e Cache Local</h4>
                  <p className="text-xs font-semibold text-gray-500 mt-0.5 leading-relaxed">
                    O sistema aproveita os recursos de hardware do PC, rodando de forma mais fluida, com carregamento imediato das listas de medicamentos e atualizações em tempo real.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Installation Guide Section */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 p-8 md:p-12 shadow-sm space-y-8" id="manual-steps">
        <div className="max-w-xl space-y-2">
          <h3 className="font-black text-gray-900 text-2xl tracking-tight">Guia de Instalação Rápida</h3>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Passo a passo para qualquer navegador</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Step 1 */}
          <div className="space-y-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 font-black rounded-2xl flex items-center justify-center text-lg shadow-sm border border-blue-100/50">
              01
            </div>
            <h4 className="font-black text-gray-900 text-base">Procure o Ícone</h4>
            <p className="text-xs font-semibold text-gray-500 leading-relaxed">
              No topo do seu navegador, ao lado direito da barra de endereços (onde você digita o link do site), procure por um destes ícones:
            </p>
            <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100 flex items-center gap-3 text-xs font-bold text-gray-600 justify-center">
              <span className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl shadow-sm border border-gray-100">
                <Chrome size={14} className="text-gray-400" /> Monitor com Seta
              </span>
              <span className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl shadow-sm border border-gray-100 text-lg">
                +
              </span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-4">
            <div className="w-12 h-12 bg-purple-50 text-purple-600 font-black rounded-2xl flex items-center justify-center text-lg shadow-sm border border-purple-100/50">
              02
            </div>
            <h4 className="font-black text-gray-900 text-base">Clique e Instale</h4>
            <p className="text-xs font-semibold text-gray-500 leading-relaxed">
              Ao clicar no ícone de instalação na barra de endereços (ou no botão acima de "Instalar FarmaFlow"), uma caixa de diálogo do próprio navegador será exibida. Clique no botão <strong>"Instalar"</strong>.
            </p>
          </div>

          {/* Step 3 */}
          <div className="space-y-4">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 font-black rounded-2xl flex items-center justify-center text-lg shadow-sm border border-emerald-100/50">
              03
            </div>
            <h4 className="font-black text-gray-900 text-base">Abra na Área de Trabalho</h4>
            <p className="text-xs font-semibold text-gray-500 leading-relaxed">
              Um atalho com o logo oficial da sua farmácia será criado na sua Área de Trabalho e no Menu Iniciar. Basta abri-lo de manhã para começar a faturar!
            </p>
          </div>
        </div>

        {/* Browser Specific Tips */}
        <div className="bg-blue-50/50 rounded-2xl p-6 border border-blue-100/30">
          <h4 className="text-sm font-black text-blue-900 flex items-center gap-2 mb-3">
            <Info size={16} /> Dicas para outros navegadores
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-medium text-blue-800 leading-relaxed">
            <div className="flex gap-2">
              <Compass size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <strong>Safari (macOS):</strong> No canto superior direito, clique no botão <strong>Compartilhar (quadrado com seta para cima)</strong> e escolha a opção <strong>"Adicionar ao Dock"</strong>.
              </div>
            </div>
            <div className="flex gap-2">
              <AlertCircle size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <div>
                <strong>Firefox / Opera:</strong> Estes navegadores não suportam instalação direta automática de PWAs. Recomendamos utilizar o <strong>Google Chrome, Microsoft Edge ou Brave</strong> no computador do caixa.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
