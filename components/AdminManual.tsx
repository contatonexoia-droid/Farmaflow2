
import React, { useState, useRef } from 'react';
import { 
  BookOpen, ShoppingBag, FileSpreadsheet, Palette, Trash2, 
  Plus, Edit3, Wand2, FileText, Printer, FileImage, 
  Store, MessageCircle, ArrowRight, Layers, RefreshCw, 
  Settings, Sparkles, Star, Zap, BrainCircuit, Search, Bell,
  ChevronDown, ChevronUp, LayoutDashboard, Tag, Activity,
  Play, Video, Package, CheckCircle2, Clock, ShieldCheck, Info,
  Percent, DollarSign, Ticket, Target, Truck, Bot, MessageSquare, MapPin,
  ScanLine, ExternalLink, Sliders, Check
} from 'lucide-react';

// ==========================================
// CONSTANTES DE VÍDEO E CAPÍTULOS DE PROMOÇÕES, CUPONS, CONFIGURAÇÕES E ETIQUETAS
// Configure os segundos exatos de cada capítulo do tutorial abaixo:
// ==========================================
export const YOUTUBE_PROMOTIONS_VIDEO_ID = 'iUf3dLSzCZg';
export const TIME_LEVE_X_PAGUE_Y = 0;       // 00:00 - Leve X e Pague Y
export const TIME_COMBO_FIXO = 65;          // 01:05 - Combo Fixo
export const TIME_OFERTA_RELAMPAGO = 140;    // 02:20 - Oferta Relâmpago

export const YOUTUBE_COUPONS_VIDEO_ID = 'aXDi9XWagVA';
export const TIME_CUPOM_CRIACAO = 0;        // 00:00 - Criação & Tipos de Desconto (% vs R$)
export const TIME_CUPOM_REGRAS = 55;        // 00:55 - Regras de Aplicação & Limites
export const TIME_CUPOM_SEGMENTACAO = 115;  // 01:55 - Segmentação de Produtos

export const YOUTUBE_CONFIG_VIDEO_ID = 'DdmNTb_BOsM';
export const TIME_CONFIG_FRETE = 0;           // 00:00 - Configurações de Entrega & Frete por KM
export const TIME_CONFIG_ETIQUETAS = 75;      // 01:15 - Atendimento (Etiquetas e Atalhos de Resposta)
export const TIME_CONFIG_AGENTE_IA = 155;     // 02:35 - Agente de IA (Atendente Automático)

export const YOUTUBE_PRICETAGS_VIDEO_ID = '7Qk8MyJ89PQ';
export const YOUTUBE_PRICETAGS_URL = 'https://youtu.be/7Qk8MyJ89PQ?is=P4Jd_4Ru920Ts847';
export const YOUTUBE_PRICETAGS_EMBED = 'https://www.youtube-nocookie.com/embed/7Qk8MyJ89PQ?rel=0';
export const TIME_PRICETAGS_BIPAGEM = 0;      // 00:00 - Bipagem & Scanner
export const TIME_PRICETAGS_MODELOS = 50;     // 00:50 - Modelos Gôndola, Baiana e Cartazes
export const TIME_PRICETAGS_IMPRESSAO = 110;  // 01:50 - Configuração A4 Sem Cortes

const formatTimestamp = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

interface PromotionChapter {
  id: 'LEVE_X_PAGUE_Y' | 'COMBO_FIXO' | 'OFERTA_RELAMPAGO';
  title: string;
  shortLabel: string;
  iconText: string;
  seconds: number;
  badge: string;
  themeColor: 'emerald' | 'purple' | 'amber';
}

const PROMOTION_CHAPTERS: PromotionChapter[] = [
  {
    id: 'LEVE_X_PAGUE_Y',
    title: 'Leve X e Pague Y',
    shortLabel: 'Leve X e Pague Y',
    iconText: '📌',
    seconds: TIME_LEVE_X_PAGUE_Y,
    badge: 'Desconto no Excedente',
    themeColor: 'emerald'
  },
  {
    id: 'COMBO_FIXO',
    title: 'Combo Fixo',
    shortLabel: 'Combo Fixo',
    iconText: '📦',
    seconds: TIME_COMBO_FIXO,
    badge: 'Pacote Fechado',
    themeColor: 'purple'
  },
  {
    id: 'OFERTA_RELAMPAGO',
    title: 'Oferta Relâmpago',
    shortLabel: 'Oferta Relâmpago',
    iconText: '⚡',
    seconds: TIME_OFERTA_RELAMPAGO,
    badge: 'Urgência & Cronômetro',
    themeColor: 'amber'
  }
];

interface CouponChapter {
  id: 'TIPOS' | 'REGRAS' | 'SEGMENTACAO';
  title: string;
  shortLabel: string;
  iconText: string;
  seconds: number;
  badge: string;
  themeColor: 'blue' | 'indigo' | 'emerald';
}

const COUPON_CHAPTERS: CouponChapter[] = [
  {
    id: 'TIPOS',
    title: 'Tipos de Desconto (% vs R$)',
    shortLabel: 'Tipos de Desconto',
    iconText: '💰',
    seconds: TIME_CUPOM_CRIACAO,
    badge: 'Porcentagem vs Fixo',
    themeColor: 'blue'
  },
  {
    id: 'REGRAS',
    title: 'Regras de Aplicação & Limites',
    shortLabel: 'Regras & Limites',
    iconText: '🛡️',
    seconds: TIME_CUPOM_REGRAS,
    badge: 'Mínimo & Usos',
    themeColor: 'indigo'
  },
  {
    id: 'SEGMENTACAO',
    title: 'Segmentação de Produtos',
    shortLabel: 'Segmentação',
    iconText: '🎯',
    seconds: TIME_CUPOM_SEGMENTACAO,
    badge: 'Loja, Categoria ou Marca',
    themeColor: 'emerald'
  }
];

interface ConfigChapter {
  id: 'FRETE' | 'ETIQUETAS' | 'AGENTE_IA';
  title: string;
  shortLabel: string;
  iconText: string;
  seconds: number;
  badge: string;
  themeColor: 'blue' | 'purple' | 'emerald';
}

const CONFIG_CHAPTERS: ConfigChapter[] = [
  {
    id: 'FRETE',
    title: 'Entrega & Frete por KM',
    shortLabel: 'Entrega & Frete',
    iconText: '🚚',
    seconds: TIME_CONFIG_FRETE,
    badge: 'Logística & CEP',
    themeColor: 'blue'
  },
  {
    id: 'ETIQUETAS',
    title: 'Atendimento (Etiquetas & Atalhos)',
    shortLabel: 'Etiquetas & Atalhos',
    iconText: '🏷️',
    seconds: TIME_CONFIG_ETIQUETAS,
    badge: 'Organização do Fluxo',
    themeColor: 'purple'
  },
  {
    id: 'AGENTE_IA',
    title: 'Agente de IA (Atendente Automático)',
    shortLabel: 'Agente de IA',
    iconText: '🤖',
    seconds: TIME_CONFIG_AGENTE_IA,
    badge: 'Atendimento 24/7',
    themeColor: 'emerald'
  }
];

interface PriceTagChapter {
  id: 'BIPAGEM' | 'MODELOS' | 'IMPRESSAO';
  title: string;
  shortLabel: string;
  iconText: string;
  seconds: number;
  badge: string;
  themeColor: 'blue' | 'purple' | 'emerald';
}

const PRICETAG_CHAPTERS: PriceTagChapter[] = [
  {
    id: 'BIPAGEM',
    title: 'Bipagem por Leitor ou Câmera',
    shortLabel: 'Bipagem & Scanner',
    iconText: '📷',
    seconds: TIME_PRICETAGS_BIPAGEM,
    badge: 'USB, Bluetooth ou Câmera',
    themeColor: 'blue'
  },
  {
    id: 'MODELOS',
    title: 'Modelos Gôndola, Baiana e Cartazes',
    shortLabel: 'Modelos de Etiquetas',
    iconText: '🏷️',
    seconds: TIME_PRICETAGS_MODELOS,
    badge: '30x, 8x, A5 e A4',
    themeColor: 'purple'
  },
  {
    id: 'IMPRESSAO',
    title: 'Impressão A4 Sem Cortes & Margens',
    shortLabel: 'Impressão Sem Cortes',
    iconText: '🖨️',
    seconds: TIME_PRICETAGS_IMPRESSAO,
    badge: 'Escala 100% & Margem Zero',
    themeColor: 'emerald'
  }
];

const AccordionItem = ({ 
  title, 
  icon, 
  children, 
  isOpen, 
  onToggle,
  badge,
  description
}: { 
  title: string; 
  icon: React.ReactNode; 
  children: React.ReactNode; 
  isOpen: boolean; 
  onToggle: () => void;
  badge?: React.ReactNode;
  description?: string;
}) => {
  return (
    <div className={`bg-white rounded-[2rem] border transition-all duration-300 ${isOpen ? 'border-emerald-200 shadow-xl' : 'border-gray-100 shadow-sm hover:border-emerald-100'}`}>
      <button 
        onClick={onToggle}
        className="w-full flex items-center justify-between p-6 md:p-8 text-left focus:outline-none"
      >
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-2xl transition-colors shrink-0 ${isOpen ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-50 text-gray-500'}`}>
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className={`text-xl md:text-2xl font-black ${isOpen ? 'text-gray-900' : 'text-gray-700'}`}>
                {title}
              </h3>
              {badge}
            </div>
            {description && (
              <p className="text-xs md:text-sm text-gray-500 font-medium mt-1 leading-snug">
                {description}
              </p>
            )}
          </div>
        </div>
        <div className={`p-2 rounded-full transition-colors shrink-0 ml-2 ${isOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
          {isOpen ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
        </div>
      </button>
      <div 
        className={`overflow-hidden transition-all duration-500 ease-in-out ${isOpen ? 'max-h-[10000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="p-6 md:p-8 pt-0 border-t border-gray-50">
          {children}
        </div>
      </div>
    </div>
  );
};

export const AdminManual: React.FC = () => {
  const [openSection, setOpenSection] = useState<number>(6);
  const [tutorialTab, setTutorialTab] = useState<'PROMOTIONS' | 'COUPONS' | 'CONFIG' | 'PRICETAGS'>('PRICETAGS');

  // Estados do vídeo de Promoções
  const [activePromoChapter, setActivePromoChapter] = useState<'LEVE_X_PAGUE_Y' | 'COMBO_FIXO' | 'OFERTA_RELAMPAGO'>('LEVE_X_PAGUE_Y');
  const [promoVideoSrc, setPromoVideoSrc] = useState<string>(
    `https://www.youtube.com/embed/${YOUTUBE_PROMOTIONS_VIDEO_ID}?enablejsapi=1`
  );
  const promoIframeRef = useRef<HTMLIFrameElement>(null);

  // Estados do vídeo de Cupons
  const [activeCouponChapter, setActiveCouponChapter] = useState<'TIPOS' | 'REGRAS' | 'SEGMENTACAO'>('TIPOS');
  const [couponVideoSrc, setCouponVideoSrc] = useState<string>(
    `https://www.youtube.com/embed/${YOUTUBE_COUPONS_VIDEO_ID}?enablejsapi=1`
  );
  const couponIframeRef = useRef<HTMLIFrameElement>(null);

  // Estados do vídeo de Configurações, Frete e Atendimento IA
  const [activeConfigChapter, setActiveConfigChapter] = useState<'FRETE' | 'ETIQUETAS' | 'AGENTE_IA'>('FRETE');
  const [configVideoSrc, setConfigVideoSrc] = useState<string>(
    `https://www.youtube.com/embed/${YOUTUBE_CONFIG_VIDEO_ID}?enablejsapi=1`
  );
  const configIframeRef = useRef<HTMLIFrameElement>(null);

  // Estados do vídeo de Etiquetas e Cartazes
  const [activePriceTagChapter, setActivePriceTagChapter] = useState<'BIPAGEM' | 'MODELOS' | 'IMPRESSAO'>('BIPAGEM');
  const [priceTagVideoSrc, setPriceTagVideoSrc] = useState<string>(
    `https://www.youtube-nocookie.com/embed/${YOUTUBE_PRICETAGS_VIDEO_ID}?rel=0&enablejsapi=1`
  );
  const priceTagIframeRef = useRef<HTMLIFrameElement>(null);

  const handleJumpToPromoChapter = (chapter: PromotionChapter) => {
    setActivePromoChapter(chapter.id);
    const newSrc = `https://www.youtube.com/embed/${YOUTUBE_PROMOTIONS_VIDEO_ID}?enablejsapi=1&start=${chapter.seconds}&autoplay=1`;
    setPromoVideoSrc(newSrc);

    if (promoIframeRef.current?.contentWindow) {
      try {
        promoIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [chapter.seconds, true]
          }),
          '*'
        );
        promoIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'playVideo',
            args: []
          }),
          '*'
        );
      } catch {
        // Fallback garantido pela atualização do iframe src
      }
    }
  };

  const handleJumpToCouponChapter = (chapter: CouponChapter) => {
    setActiveCouponChapter(chapter.id);
    const newSrc = `https://www.youtube.com/embed/${YOUTUBE_COUPONS_VIDEO_ID}?enablejsapi=1&start=${chapter.seconds}&autoplay=1`;
    setCouponVideoSrc(newSrc);

    if (couponIframeRef.current?.contentWindow) {
      try {
        couponIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [chapter.seconds, true]
          }),
          '*'
        );
        couponIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'playVideo',
            args: []
          }),
          '*'
        );
      } catch {
        // Fallback garantido pela atualização do iframe src
      }
    }
  };

  const handleJumpToConfigChapter = (chapter: ConfigChapter) => {
    setActiveConfigChapter(chapter.id);
    const newSrc = `https://www.youtube.com/embed/${YOUTUBE_CONFIG_VIDEO_ID}?enablejsapi=1&start=${chapter.seconds}&autoplay=1`;
    setConfigVideoSrc(newSrc);

    if (configIframeRef.current?.contentWindow) {
      try {
        configIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [chapter.seconds, true]
          }),
          '*'
        );
        configIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'playVideo',
            args: []
          }),
          '*'
        );
      } catch {
        // Fallback garantido pela atualização do iframe src
      }
    }
  };

  const handleJumpToPriceTagChapter = (chapter: PriceTagChapter) => {
    setActivePriceTagChapter(chapter.id);
    const newSrc = `https://www.youtube-nocookie.com/embed/${YOUTUBE_PRICETAGS_VIDEO_ID}?rel=0&enablejsapi=1&start=${chapter.seconds}&autoplay=1`;
    setPriceTagVideoSrc(newSrc);

    if (priceTagIframeRef.current?.contentWindow) {
      try {
        priceTagIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [chapter.seconds, true]
          }),
          '*'
        );
        priceTagIframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'playVideo',
            args: []
          }),
          '*'
        );
      } catch {
        // Fallback garantido pela atualização do iframe src
      }
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20 w-full">
      <div className="bg-white p-8 md:p-12 rounded-[3rem] border border-gray-100 shadow-sm">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-[1.5rem] flex items-center justify-center shrink-0">
            <BookOpen size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-900 tracking-tight">Manual Operacional do FarmaFlow AI</h2>
            <p className="text-gray-500 font-medium mt-1">O guia completo, definitivo e aprofundado para operação e gestão de vendas da sua drogaria digital.</p>
          </div>
        </div>

        {/* ========================================================= */}
        {/* CENTRAL DE VÍDEOS TUTORIAIS OFICIAIS COM ABAS */}
        {/* ========================================================= */}
        <div id="tutorial-video-central" className="mb-12 bg-slate-50/80 border border-slate-200 rounded-[2.5rem] p-6 md:p-10 shadow-sm">
          
          {/* SELETOR DE ABAS DE TUTORIAIS */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                  Academia FarmaFlow
                </span>
                <span className="text-xs text-gray-500 font-bold flex items-center gap-1">
                  <Clock size={12} /> Tutoriais Oficiais em Vídeo
                </span>
              </div>
              <h3 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight mt-1">
                Central de Treinamento e Vídeo Aulas
              </h3>
            </div>

            {/* SELETOR EM ABAS */}
            <div className="flex flex-wrap items-center gap-2 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm self-start sm:self-auto">
              <button
                id="tab-btn-promotions"
                onClick={() => setTutorialTab('PROMOTIONS')}
                className={`flex items-center gap-2 px-3.5 py-2 md:px-4 md:py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-200 ${
                  tutorialTab === 'PROMOTIONS'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                }`}
              >
                <Sparkles size={16} />
                <span>Promoções</span>
              </button>

              <button
                id="tab-btn-coupons"
                onClick={() => setTutorialTab('COUPONS')}
                className={`flex items-center gap-2 px-3.5 py-2 md:px-4 md:py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-200 ${
                  tutorialTab === 'COUPONS'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                }`}
              >
                <Tag size={16} />
                <span>Cupons de Desconto</span>
              </button>

              <button
                id="tab-btn-config"
                onClick={() => setTutorialTab('CONFIG')}
                className={`flex items-center gap-2 px-3.5 py-2 md:px-4 md:py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-200 ${
                  tutorialTab === 'CONFIG'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                }`}
              >
                <Settings size={16} />
                <span>Configurações & Atendimento IA</span>
              </button>

              <button
                id="tab-btn-pricetags"
                onClick={() => setTutorialTab('PRICETAGS')}
                className={`flex items-center gap-2 px-3.5 py-2 md:px-4 md:py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-200 ${
                  tutorialTab === 'PRICETAGS'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                }`}
              >
                <Printer size={16} />
                <span>Etiquetas & Cartazes</span>
                <span className={`px-1.5 py-0.5 text-[9px] font-black rounded-full uppercase tracking-wide ${
                  tutorialTab === 'PRICETAGS'
                    ? 'bg-white/20 text-white'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  Novo
                </span>
              </button>
            </div>
          </div>

          {/* ======================================================== */}
          {/* ABA 1: CAMPANHAS PROMOCIONAIS */}
          {/* ======================================================== */}
          {tutorialTab === 'PROMOTIONS' && (
            <div className="animate-in fade-in duration-300">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-md shadow-emerald-200 shrink-0">
                    <Video size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                        Vídeo Aula 01
                      </span>
                      <span className="text-xs text-gray-500 font-bold flex items-center gap-1">
                        <Clock size={12} /> 3 Modalidades
                      </span>
                    </div>
                    <h4 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight mt-0.5">
                      Como Configurar Promoções no FarmaFlow
                    </h4>
                  </div>
                </div>
                <p className="text-xs md:text-sm text-gray-500 max-w-md font-medium leading-snug">
                  Aprenda como cadastrar campanhas de Leve X Pague Y, Combos Fixos e Ofertas Relâmpago com cronômetro na sua loja digital.
                </p>
              </div>

              {/* Player YouTube Integrado e Responsivo 16:9 */}
              <div className="aspect-video w-full rounded-xl shadow-sm border border-slate-200 overflow-hidden bg-black relative">
                <iframe
                  ref={promoIframeRef}
                  src={promoVideoSrc}
                  title="Tutorial Oficial FarmaFlow - Gestão de Promoções"
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>

              {/* Seletor Dinâmico de Capítulos de Promoções */}
              <div className="mt-6 pt-6 border-t border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Play size={16} className="text-emerald-600 fill-emerald-600" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                      Pular para Capítulo:
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 font-medium">
                    Clique em um botão para ir ao minuto exato do vídeo
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PROMOTION_CHAPTERS.map((chap) => {
                    const isSelected = activePromoChapter === chap.id;
                    let activeStyles = 'bg-white text-gray-700 border-slate-200 hover:border-slate-300 hover:bg-slate-100/60';
                    
                    if (isSelected) {
                      if (chap.id === 'LEVE_X_PAGUE_Y') {
                        activeStyles = 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-200';
                      } else if (chap.id === 'COMBO_FIXO') {
                        activeStyles = 'bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-200';
                      } else if (chap.id === 'OFERTA_RELAMPAGO') {
                        activeStyles = 'bg-amber-600 text-white border-amber-600 shadow-lg shadow-amber-200';
                      }
                    }

                    return (
                      <button
                        key={chap.id}
                        id={`chapter-btn-${chap.id.toLowerCase()}`}
                        onClick={() => handleJumpToPromoChapter(chap)}
                        className={`flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 font-bold text-sm transition-all duration-200 text-left ${activeStyles}`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="text-lg">{chap.iconText}</span>
                          <span className="truncate">{chap.title}</span>
                        </div>
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full shrink-0 ${
                          isSelected ? 'bg-black/20 text-white font-bold' : 'bg-slate-100 text-gray-600'
                        }`}>
                          {formatTimestamp(chap.seconds)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cards Resumo com Passo a Passo das 3 Promoções */}
              <div className="mt-8 pt-6 border-t border-slate-200">
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles size={18} className="text-emerald-600" />
                  <h4 className="text-base md:text-lg font-black text-gray-900">
                    Guia Rápido: Campos Obrigatórios e Boas Práticas por Modalidade
                  </h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* CARD 1: LEVE X E PAGUE Y */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activePromoChapter === 'LEVE_X_PAGUE_Y' 
                      ? 'border-emerald-500 shadow-md ring-4 ring-emerald-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">
                          📌
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Leve X e Pague Y</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Volume & Desova</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToPromoChapter(PROMOTION_CHAPTERS[0])}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-emerald-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      O cliente adiciona as quantidades à cesta e o sistema concede 100% de desconto automático nas unidades excedentes acordadas (ex: compre 3 e pague 2).
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          Campos Obrigatórios:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1 pl-4 list-disc">
                          <li><strong>Nome da Promoção:</strong> Título claro (ex: "Leve 3 Pague 2 Pampers").</li>
                          <li><strong>Quantidade Comprar (X):</strong> Total de unidades a adicionar.</li>
                          <li><strong>Quantidade Pagar (Y):</strong> Unidades cobradas (Y &lt; X).</li>
                          <li><strong>Alvo da Regra:</strong> Categoria, Fabricante ou Produtos específicos.</li>
                          <li><strong>Período de Vigência:</strong> Datas de início e término.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-emerald-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-emerald-600" />
                          Boas Práticas:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-emerald-50/50 p-2.5 rounded-xl border border-emerald-100">
                          Excelente para <strong>produtos de uso recorrente</strong> (fraldas, protetores solares, vitaminas). Divulgue o preço unitário equivalente no WhatsApp.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CARD 2: COMBO FIXO */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activePromoChapter === 'COMBO_FIXO' 
                      ? 'border-purple-500 shadow-md ring-4 ring-purple-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-lg">
                          📦
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Combo Fixo</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Pacotes & Kits</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToPromoChapter(PROMOTION_CHAPTERS[1])}
                        className="p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-purple-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Agrupa produtos complementares em um pacote fechado por um valor promocional travado quando todos os itens estão presentes no carrinho.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-purple-600" />
                          Campos Obrigatórios:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1 pl-4 list-disc">
                          <li><strong>Nome do Combo:</strong> Identificação atrativa (ex: "Kit Cabelos Radiantes").</li>
                          <li><strong>Produtos Componentes:</strong> Seleção dos SKUs participantes obrigatórios.</li>
                          <li><strong>Preço Fixo do Combo (R$):</strong> Valor total promocional do conjunto.</li>
                          <li><strong>Estoque dos Itens:</strong> Garantir estoque positivo em todos os itens.</li>
                          <li><strong>Datas Limites:</strong> Período de validade da campanha.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-purple-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-purple-600" />
                          Boas Práticas:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-purple-50/50 p-2.5 rounded-xl border border-purple-100">
                          Una produtos com <strong>alta afinidade de consumo</strong> (Shampoo + Condicionador ou Vitamina C + Zinco). Fixe um valor que ofereça economia nítida.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CARD 3: OFERTA RELÂMPAGO */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activePromoChapter === 'OFERTA_RELAMPAGO' 
                      ? 'border-amber-500 shadow-md ring-4 ring-amber-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-lg">
                          ⚡
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Oferta Relâmpago</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Urgência & Desconto</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToPromoChapter(PROMOTION_CHAPTERS[2])}
                        className="p-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-amber-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Aplica desconto percentual imediato nos produtos com selo chamativo e cronômetro de contagem regressiva para provocar decisão rápida de compra.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-amber-600" />
                          Campos Obrigatórios:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1 pl-4 list-disc">
                          <li><strong>Nome da Ação:</strong> Título chamativo (ex: "Madrugada de Ofertas - 20% OFF").</li>
                          <li><strong>% de Desconto Relâmpago:</strong> Percentual de desconto direto (% OFF).</li>
                          <li><strong>Produtos ou Categoria:</strong> Itens que receberão o selo e o desconto.</li>
                          <li><strong>Horário de Início e Término:</strong> Janela restrita (ex: 12:00 às 18:00).</li>
                          <li><strong>Dias da Semana (Opcional):</strong> Para repetição periódica.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-amber-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-amber-600" />
                          Boas Práticas:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-amber-50/50 p-2.5 rounded-xl border border-amber-100">
                          Gere <strong>senso real de escassez</strong>. Janelas de 24h a 48h aumentam drasticamente as taxas de conversão de carrinhos parados.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* ABA 2: CUPONS DE DESCONTO */}
          {/* ======================================================== */}
          {tutorialTab === 'COUPONS' && (
            <div className="animate-in fade-in duration-300">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-md shadow-emerald-200 shrink-0">
                    <Tag size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                        Vídeo Aula 02
                      </span>
                      <span className="text-xs text-gray-500 font-bold flex items-center gap-1">
                        <Clock size={12} /> Códigos & Segmentação
                      </span>
                    </div>
                    <h4 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight mt-0.5">
                      Criação e Configuração de Cupons de Desconto
                    </h4>
                  </div>
                </div>
                <p className="text-xs md:text-sm text-gray-500 max-w-md font-medium leading-snug">
                  Domine a geração de cupons personalizados, travas de segurança com pedido mínimo, limites de usos e segmentação precisa por categorias ou marcas.
                </p>
              </div>

              {/* Player YouTube Integrado e Responsivo 16:9 (Cupons) */}
              <div className="aspect-video w-full rounded-xl shadow-sm border border-slate-200 overflow-hidden bg-black relative">
                <iframe
                  ref={couponIframeRef}
                  src={couponVideoSrc}
                  title="Tutorial Oficial FarmaFlow - Criação de Cupons de Desconto"
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>

              {/* Seletor Dinâmico de Capítulos de Cupons */}
              <div className="mt-6 pt-6 border-t border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Play size={16} className="text-emerald-600 fill-emerald-600" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                      Pular para Capítulo:
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 font-medium">
                    Clique em um botão para ir ao minuto exato do vídeo
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {COUPON_CHAPTERS.map((chap) => {
                    const isSelected = activeCouponChapter === chap.id;
                    const activeStyles = isSelected
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-200'
                      : 'bg-white text-gray-700 border-slate-200 hover:border-slate-300 hover:bg-slate-100/60';

                    return (
                      <button
                        key={chap.id}
                        id={`coupon-chapter-btn-${chap.id.toLowerCase()}`}
                        onClick={() => handleJumpToCouponChapter(chap)}
                        className={`flex items-center justify-between px-4 py-3.5 rounded-2xl border-2 font-bold text-sm transition-all duration-200 text-left ${activeStyles}`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="text-lg">{chap.iconText}</span>
                          <span className="truncate">{chap.title}</span>
                        </div>
                        <span className={`text-[11px] font-mono px-2 py-0.5 rounded-full shrink-0 ${
                          isSelected ? 'bg-black/20 text-white font-bold' : 'bg-slate-100 text-gray-600'
                        }`}>
                          {formatTimestamp(chap.seconds)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cards Resumo com Passo a Passo de Cupons */}
              <div className="mt-8 pt-6 border-t border-slate-200">
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles size={18} className="text-emerald-600" />
                  <h4 className="text-base md:text-lg font-black text-gray-900">
                    Guia Rápido de Cupons: Tipos de Desconto, Regras e Segmentação
                  </h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* CARD 1: TIPOS DE DESCONTO */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activeCouponChapter === 'TIPOS' 
                      ? 'border-emerald-500 shadow-md ring-4 ring-emerald-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">
                          💰
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Tipos de Desconto</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Porcentagem (%) vs Fixo (R$)</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToCouponChapter(COUPON_CHAPTERS[0])}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-emerald-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Escolha a forma matemática de abatimento financeiro que melhor se adapta à margem da sua farmácia.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          Modalidades Disponíveis:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1.5 pl-4 list-disc">
                          <li><strong>Porcentagem (%):</strong> Desconta uma taxa proporcional do subtotal (ex: 10% ou 15% OFF). Excelente para cupons universais como <code>PRIMEIRACOMPRA</code>.</li>
                          <li><strong>Valor Fixo (R$):</strong> Abate um valor em dinheiro exato e pontual (ex: R$ 20,00 OFF). Gera forte apelo de "crédito de presente".</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-emerald-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-emerald-600" />
                          Boas Práticas:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-emerald-50/50 p-2.5 rounded-xl border border-emerald-100">
                          Ao criar cupons de <strong>Valor Fixo (R$)</strong>, sempre exija um <strong>Valor Mínimo de Pedido</strong> proporcional para impedir compras com valor zero ou prejuízo na entrega.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CARD 2: REGRAS DE APLICAÇÃO */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activeCouponChapter === 'REGRAS' 
                      ? 'border-indigo-500 shadow-md ring-4 ring-indigo-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-lg">
                          🛡️
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Regras de Aplicação</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Mínimo, Validade & Usos</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToCouponChapter(COUPON_CHAPTERS[1])}
                        className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-indigo-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Travas de proteção financeira e controle de volume para que a campanha permaneça rentável e segura.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-indigo-600" />
                          Regras Principais:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1.5 pl-4 list-disc">
                          <li><strong>Valor Mínimo do Pedido (R$):</strong> Teto mínimo que o carrinho deve somar antes de liberar o cupom (ex: compras acima de R$ 90,00).</li>
                          <li><strong>Limite Global de Usos:</strong> Número máximo de vezes que o código pode ser resgatado na loja inteira (ex: primeiros 50 clientes).</li>
                          <li><strong>Data de Início e Expiração:</strong> Desativação programada automática às 23:59:59 da data final.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-indigo-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-indigo-600" />
                          Boas Práticas:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-indigo-50/50 p-2.5 rounded-xl border border-indigo-100">
                          Configure um <strong>limite restrito de usos</strong> ao enviar cupons em grupos VIP de WhatsApp ou influenciadores para acelerar o fechamento de pedidos com escassez real.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CARD 3: SEGMENTAÇÃO */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activeCouponChapter === 'SEGMENTACAO' 
                      ? 'border-emerald-500 shadow-md ring-4 ring-emerald-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">
                          🎯
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Segmentação</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Loja, Categoria ou Marca</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToCouponChapter(COUPON_CHAPTERS[2])}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-emerald-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Direcione o desconto especificamente para os produtos ou departamentos estratégicos do seu catálogo.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          Opções de Escopo:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1.5 pl-4 list-disc">
                          <li><strong>Todos os Produtos:</strong> Válido em todo o catálogo ativo (exceto itens com retenção de receita).</li>
                          <li><strong>Por Categoria:</strong> Focado em setores específicos (ex: apenas em "Dermocosméticos" ou "Suplementos").</li>
                          <li><strong>Por Marca / Fabricante:</strong> Válido exclusivamente em produtos de indústrias parceiras (ex: Cimed, EMS, Ache).</li>
                          <li><strong>Seleção Manual:</strong> Escolha cirúrgica de SKUs individuais para desova de lotes.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-emerald-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-emerald-600" />
                          Boas Práticas:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-emerald-50/50 p-2.5 rounded-xl border border-emerald-100">
                          Utilize a <strong>segmentação por fabricante</strong> para criar campanhas cooperadas com laboratórios, atraindo verba promocional e alavancando as vendas de alta margem.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* ABA 3: CONFIGURAÇÕES, FRETE, ATENDIMENTO & AGENTE IA */}
          {/* ======================================================== */}
          {tutorialTab === 'CONFIG' && (
            <div className="animate-in fade-in duration-300">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-md shadow-emerald-200 shrink-0">
                    <Settings size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                        Vídeo Aula 03
                      </span>
                      <span className="text-xs text-gray-500 font-bold flex items-center gap-1">
                        <Clock size={12} /> Configurações, Frete, Atendimento e IA
                      </span>
                    </div>
                    <h4 className="text-lg md:text-xl font-black text-gray-900 mt-0.5">
                      Configurações de Loja, Frete por KM, Atendimento e Agente IA
                    </h4>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-white px-3.5 py-2 rounded-xl border border-slate-200 self-start md:self-auto">
                  <Video size={14} className="text-emerald-600" />
                  <span>Vídeo Oficial (YouTube)</span>
                </div>
              </div>

              {/* CONTAINER DO VÍDEO YOUTUBE RESPONSIVO 16:9 */}
              <div className="relative w-full aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-slate-900 mb-6">
                <iframe
                  ref={configIframeRef}
                  src={configVideoSrc}
                  title="Tutorial FarmaFlow - Configurações, Frete, Atendimento e Agente IA"
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>

              {/* SELETOR DE CAPÍTULOS RÁPIDOS */}
              <div className="bg-white rounded-2xl p-4 md:p-5 border border-slate-200 shadow-sm mb-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                      Capítulos Rápidos da Aula:
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400 font-medium">
                    Clique em um capítulo para avançar diretamente o player:
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {CONFIG_CHAPTERS.map((chapter) => {
                    const isActive = activeConfigChapter === chapter.id;
                    return (
                      <button
                        key={chapter.id}
                        id={`btn-config-chapter-${chapter.id.toLowerCase()}`}
                        onClick={() => handleJumpToConfigChapter(chapter)}
                        className={`flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition-all duration-200 border ${
                          isActive
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200'
                            : 'bg-slate-50 hover:bg-slate-100 text-gray-700 border-slate-200/80 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base shrink-0">{chapter.iconText}</span>
                          <div className="min-w-0">
                            <p className={`text-xs font-black truncate ${isActive ? 'text-white' : 'text-gray-900'}`}>
                              {chapter.shortLabel}
                            </p>
                            <p className={`text-[10px] font-medium truncate ${isActive ? 'text-emerald-100' : 'text-gray-500'}`}>
                              {chapter.badge}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            isActive ? 'bg-emerald-700 text-white' : 'bg-white text-gray-600 border border-slate-200'
                          }`}>
                            {formatTimestamp(chapter.seconds)}
                          </span>
                          <Play size={12} className={isActive ? 'fill-white' : 'fill-gray-400 text-gray-400'} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* GUIA OPERACIONAL: 3 CARDS EXPLICATIVOS COM BOAS PRÁTICAS */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <CheckCircle2 size={18} className="text-emerald-600" />
                    Guia Operacional: Configurações, Logística e Atendimento Inteligente
                  </h4>
                  <span className="text-xs text-gray-400 font-medium hidden sm:inline">
                    Orientações essenciais do sistema
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* CARD 1: ENTREGA & FRETE POR KM */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activeConfigChapter === 'FRETE' 
                      ? 'border-blue-500 shadow-md ring-4 ring-blue-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg">
                          🚚
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Entrega & Frete por KM</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Raio, Faixas & Georreferência</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToConfigChapter(CONFIG_CHAPTERS[0])}
                        className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-blue-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Precificação logística justa e automática calculando a distância exata em quilômetros entre a farmácia e o endereço do cliente.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-blue-600" />
                          Configurações Logísticas:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1.5 pl-4 list-disc">
                          <li><strong>Endereço Base da Loja:</strong> Insira rigorosamente o CEP, rua, número e bairro da drogaria. Este ponto ancora a origem de todo cálculo de rota.</li>
                          <li><strong>Faixas Escalonadas de KM:</strong> Estabeleça preços por distância (ex: 0 a 3 km = R$ 5,00; 3 a 6 km = R$ 9,00; 6 a 10 km = R$ 14,00).</li>
                          <li><strong>Pedido Mínimo de Entrega:</strong> Valor mínimo no carrinho para liberar o despacho via motoboy e evitar prejuízos em rotas longas.</li>
                          <li><strong>Frete Grátis com Gatilho:</strong> Estabeleça uma meta de compra (ex: compras acima de R$ 100,00) para elevar o ticket médio.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-blue-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-blue-600" />
                          Boas Práticas de Frete:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-blue-50/50 p-2.5 rounded-xl border border-blue-100">
                          Sempre valide se o CEP da drogaria está correto para que o cálculo de distância georreferenciada calcule a quilometragem viária exata do motoboy até a residência do cliente.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CARD 2: ETIQUETAS E ATALHOS */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activeConfigChapter === 'ETIQUETAS' 
                      ? 'border-purple-500 shadow-md ring-4 ring-purple-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-lg">
                          🏷️
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Etiquetas & Atalhos</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Fluxo Visual & Respostas Rápidas</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToConfigChapter(CONFIG_CHAPTERS[1])}
                        className="p-1.5 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-purple-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Organização por etapas do funil de atendimento e velocidade recorde no WhatsApp com atalhos de mensagem rápida.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-purple-600" />
                          Recursos de Atendimento:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1.5 pl-4 list-disc">
                          <li><strong>Etiquetas Coloridas de Status:</strong> Segmente conversas por fases (ex: "Aguardando Receita", "Em Separação", "Saiu p/ Entrega", "Concluído").</li>
                          <li><strong>Atalhos de Mensagem Rápida (/):</strong> Digite <code>/</code> na caixa de texto para disparar respostas salvas (ex: <code>/pix</code>, <code>/horario</code>, <code>/entrega</code>).</li>
                          <li><strong>Filtros Dinâmicos de Conversa:</strong> Localize clientes em espera ou pedidos pendentes clicando na respectiva etiqueta.</li>
                          <li><strong>Padronização de Atendimento:</strong> Equipe de atendentes alinhada com mensagens padronizadas e sem erros de português.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-purple-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-purple-600" />
                          Boas Práticas de Atendimento:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-purple-50/50 p-2.5 rounded-xl border border-purple-100">
                          Crie uma etiqueta específica para <strong>"Uso Contínuo / Recompra"</strong> para listar clientes com tratamentos crônicos e disparar lembretes periódicos de reposição a cada 30 dias.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* CARD 3: AGENTE DE IA */}
                  <div className={`bg-white rounded-3xl p-6 border-2 transition-all ${
                    activeConfigChapter === 'AGENTE_IA' 
                      ? 'border-emerald-500 shadow-md ring-4 ring-emerald-50' 
                      : 'border-slate-200/80 shadow-sm'
                  }`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-lg">
                          🤖
                        </div>
                        <div>
                          <h5 className="font-black text-gray-900 text-base leading-tight">Agente de IA (Atendente Virtual)</h5>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Atendimento 24/7 & Conversão</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleJumpToConfigChapter(CONFIG_CHAPTERS[2])}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                        title="Assistir trecho no vídeo"
                      >
                        <Play size={14} className="fill-emerald-600" />
                      </button>
                    </div>

                    <p className="text-xs text-gray-600 leading-relaxed mb-4">
                      Atendente virtual inteligente integrado ao seu catálogo de produtos que atende, tira dúvidas e monta carrinhos automaticamente.
                    </p>

                    <div className="space-y-3 pt-3 border-t border-slate-100">
                      <div>
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5 flex items-center gap-1.5">
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          Configurações do Agente:
                        </h6>
                        <ul className="text-xs text-gray-600 space-y-1.5 pl-4 list-disc">
                          <li><strong>Instruções e Personalidade (Prompt):</strong> Configure a postura e tom de voz (ex: "Você é a farmacêutica virtual da Drogaria FarmaFlow, prestativa e atenciosa").</li>
                          <li><strong>Horários de Atuação:</strong> Escolha se a IA responde 24h por dia ou se assume automaticamente apenas durante o fechamento da loja física.</li>
                          <li><strong>Consulta ao Catálogo em Tempo Real:</strong> A IA localiza medicamentos por princípio ativo, genéricos equivalentes e disponibilidade de estoque.</li>
                          <li><strong>Segurança Farmacêutica:</strong> Bloqueio programado para nunca prescrever controlados sem receita, solicitando envio de foto para o farmacêutico humano.</li>
                        </ul>
                      </div>

                      <div className="pt-2">
                        <h6 className="text-[11px] font-black uppercase tracking-wider text-emerald-700 mb-1.5 flex items-center gap-1.5">
                          <ShieldCheck size={13} className="text-emerald-600" />
                          Boas Práticas de IA:
                        </h6>
                        <p className="text-xs text-gray-600 leading-relaxed bg-emerald-50/50 p-2.5 rounded-xl border border-emerald-100">
                          Antes de ativar o Agente em produção, faça simulações de perguntas comuns de clientes no painel de testes para calibrar as respostas e dados da sua loja.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* ABA 4: GERADOR DE ETIQUETAS E CARTAZES */}
          {/* ======================================================== */}
          {tutorialTab === 'PRICETAGS' && (
            <div className="animate-in fade-in duration-300">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-md shadow-emerald-200 shrink-0">
                    <Printer size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                        Vídeo Aula 04
                      </span>
                      <span className="text-xs text-gray-500 font-bold flex items-center gap-1">
                        <Clock size={12} /> Etiquetas & Cartazeamento
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800">
                        Novo Recurso
                      </span>
                    </div>
                    <h4 className="text-lg md:text-xl font-black text-gray-900 mt-0.5">
                      Gerador de Etiquetas de Preço e Cartazes de Ofertas
                    </h4>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-bold text-gray-500 bg-white px-3.5 py-2 rounded-xl border border-slate-200 self-start md:self-auto shadow-sm">
                  <Video size={14} className="text-emerald-600" />
                  <span>Vídeo Oficial (YouTube)</span>
                </div>
              </div>

              {/* CONTAINER DO VÍDEO YOUTUBE RESPONSIVO 16:9 */}
              <div className="relative w-full aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-slate-900 mb-4">
                <iframe
                  ref={priceTagIframeRef}
                  src={priceTagVideoSrc}
                  title="Tutorial FarmaFlow - Gerador de Etiquetas e Cartazes"
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mb-6 px-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  💡 <span>Dica: Assista em tela cheia para ver os detalhes da tela e das impressões.</span>
                </span>
                <a
                  href={YOUTUBE_PRICETAGS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-600 hover:text-red-700 font-semibold underline flex items-center gap-1 transition-colors"
                >
                  Abrir diretamente no YouTube ↗
                </a>
              </div>

              {/* SELETOR DE CAPÍTULOS RÁPIDOS */}
              <div className="bg-white rounded-2xl p-4 md:p-5 border border-slate-200 shadow-sm mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-black uppercase tracking-wider text-gray-700">
                      Capítulos Rápidos da Aula:
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400 font-medium">
                    Clique em um capítulo para avançar diretamente o player:
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {PRICETAG_CHAPTERS.map((chapter) => {
                    const isActive = activePriceTagChapter === chapter.id;
                    return (
                      <button
                        key={chapter.id}
                        id={`btn-pricetag-chapter-${chapter.id.toLowerCase()}`}
                        onClick={() => handleJumpToPriceTagChapter(chapter)}
                        className={`flex items-center justify-between px-3.5 py-3 rounded-xl text-left transition-all duration-200 border ${
                          isActive
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200'
                            : 'bg-slate-50 hover:bg-slate-100 text-gray-700 border-slate-200/80 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base shrink-0">{chapter.iconText}</span>
                          <div className="min-w-0">
                            <p className={`text-xs font-black truncate ${isActive ? 'text-white' : 'text-gray-900'}`}>
                              {chapter.shortLabel}
                            </p>
                            <p className={`text-[10px] font-medium truncate ${isActive ? 'text-emerald-100' : 'text-gray-500'}`}>
                              {chapter.badge}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            isActive ? 'bg-emerald-700 text-white' : 'bg-white text-gray-600 border border-slate-200'
                          }`}>
                            {formatTimestamp(chapter.seconds)}
                          </span>
                          <Play size={12} className={isActive ? 'fill-white' : 'fill-gray-400 text-gray-400'} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* CARD DE ATALHO PARA O TÓPICO DO MANUAL */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <BookOpen size={18} />
                  </div>
                  <div>
                    <h5 className="text-sm font-bold text-gray-900">Guia Prático Operacional no Tópico 7</h5>
                    <p className="text-xs text-gray-600">Acesse abaixo o manual passo a passo de bipagem, modelos A4 e checklist de margem sem cortes.</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setOpenSection(6);
                    const el = document.getElementById('manual-topic-price-tags');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm shrink-0 flex items-center gap-1.5 hover:scale-[1.02]"
                >
                  <span>Abrir Tópico 7 Abaixo</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6 lg:mx-8">
          <AccordionItem 
            title="1. Dashboard (Painel Geral)" 
            icon={<LayoutDashboard size={24} />} 
            isOpen={openSection === 0} 
            onToggle={() => setOpenSection(openSection === 0 ? -1 : 0)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                O Dashboard é a sua torre de controle. Ele fornece uma visão imediata e em tempo real da saúde do seu negócio. O objetivo desta tela é permitir que você acompanhe o fluxo de vendas sem precisar abrir relatórios complexos.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity className="text-blue-500" size={20} />
                    <h4 className="font-bold text-gray-900">Métricas de Desempenho</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Vendas Hoje:</strong> O faturamento bruto diário originado pela plataforma online.</li>
                    <li><strong className="text-gray-800">Pendentes:</strong> Número de pedidos que entraram no sistema e ainda não foram processados pela equipe ou confirmados.</li>
                    <li><strong className="text-gray-800">Ticket Médio:</strong> Valor médio que cada cliente tem gasto por pedido na farmácia. Fundamental para medir engajamento com upsell.</li>
                    <li><strong className="text-gray-800">Novos Clientes:</strong> Cadastros inéditos realizados na loja nos últimos períodos, essencial para medir a atração de público.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <FileSpreadsheet className="text-emerald-500" size={20} />
                    <h4 className="font-bold text-gray-900">Gráficos e Relatórios</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Faturamento Semanal:</strong> Gráfico de barras demonstrando o ritmo financeiro dos últimos 7 dias.</li>
                    <li><strong className="text-gray-800">Desempenho de Promoções:</strong> Ranking das ofertas que mais atraíram cliques e conversões na vitrine.</li>
                    <li><strong className="text-gray-800">Desempenho de Cupons:</strong> Acompanhamento de quais códigos de desconto estão realmente motivando o fechamento de carrinhos.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="text-amber-500" size={20} />
                    <h4 className="font-bold text-gray-900">Ações Rápidas</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Novo Pedido Balcão:</strong> Inicia rapidamente uma venda presencial utilizando a base de produtos online.</li>
                    <li><strong className="text-gray-800">Cadastrar Produto:</strong> Atalho direto para inclusão de novas mercadorias no catálogo.</li>
                    <li><strong className="text-gray-800">Ver Loja Online:</strong> Abre a vitrine exatamente da forma como o cliente final visualiza.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <div className="flex items-center gap-2 mb-4">
                    <Bell className="text-purple-500" size={20} />
                    <h4 className="font-bold text-gray-900">Alertas e Monitoramento</h4>
                  </div>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Últimos Pedidos:</strong> Uma fila espelhada e ao vivo dos carrinhos recentemente concluídos.</li>
                    <li><strong className="text-gray-800">Últimos Alertas:</strong> Avisos cruciais automáticos do sistema (como estoque crítico ou itens expirando).</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="2. Pedidos (Gerenciamento de Vendas)" 
            icon={<ShoppingBag size={24} />} 
            isOpen={openSection === 1} 
            onToggle={() => setOpenSection(openSection === 1 ? -1 : 1)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Este módulo é o coração operacional de atendimento. Nele, sua equipe de expedição vai tratar cada compra, desde a entrada até a saída para entrega.
              </p>

              <div className="grid grid-cols-1 gap-6">
                <div className="border border-gray-100 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <RefreshCw className="text-sky-500" size={20} /> 
                    Fluxo de Status do Pedido
                  </h4>
                  <div className="flex flex-wrap gap-3 mb-4">
                    <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold text-xs rounded-full">Pendente</span>
                    <ArrowRight size={16} className="text-gray-300 mt-1" />
                    <span className="px-3 py-1 bg-blue-100 text-blue-800 font-bold text-xs rounded-full">Confirmado</span>
                    <ArrowRight size={16} className="text-gray-300 mt-1" />
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold text-xs rounded-full">Enviado</span>
                    <ArrowRight size={16} className="text-gray-300 mt-1" />
                    <span className="px-3 py-1 bg-red-100 text-red-800 font-bold text-xs rounded-full">Cancelado</span>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Todo pedido nasce como <strong className="text-gray-800">Pendente</strong>, disparando o alerta sonoro na loja. Após conferir se o pagamento foi realizado (ou se será na entrega), o atendente separa a medicação fisicamente e altera o status para <strong className="text-gray-800">Confirmado</strong>. Assim que o entregador sair da farmácia, altera-se para <strong className="text-gray-800">Enviado</strong>. Se houver ruptura de estoque ou falha na receita retida, utiliza-se <strong className="text-gray-800">Cancelado</strong>.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="border border-gray-100 p-6 rounded-3xl">
                    <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <MessageCircle className="text-green-500" size={20} />
                      Ações de Recuperação
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Sempre que um cliente tiver um problema (falta de produto, divergência no valor ou atraso no PIX), o botão estratégico <strong className="text-gray-800">"Recuperar Venda (WhatsApp)"</strong> abrirá automaticamente o WhatsApp web/app já com o número do cliente pré-preenchido com os detalhes da compra para negociar a manutenção da venda.
                    </p>
                  </div>
                  <div className="border border-gray-100 p-6 rounded-3xl">
                    <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Search className="text-purple-500" size={20} />
                      Filtros e Impressão
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed mb-4">
                      Utilize a barra de pesquisa rápida para localizar clientes exatos ou referências de ID fornecidos no balcão. Através das abas de status rápidas (Ex: "Apenas Pendentes"), a tela não precisará ser recarregada.
                    </p>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Clicando no pedido, você pode acessar <strong className="text-gray-800">"Ver Detalhes"</strong> e imprimir o espelho da compra (comprovante limpo, ideal para anexar na sacola do motoboy).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="3. Produtos (Catálogo Farmacêutico)" 
            icon={<Layers size={24} />} 
            isOpen={openSection === 2} 
            onToggle={() => setOpenSection(openSection === 2 ? -1 : 2)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Um catálogo organizado vende por si só. Esta seção gerencia cada SKU, interage com a busca inteligente do cliente e fornece ferramentas de marketing visual direto da prateleira virtual.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Search size={18} className="text-blue-500"/> Buscas e Filtros Rápidos
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Estoque Zerado:</strong> Lista todos os produtos indisponíveis para reposição imediata.</li>
                    <li><strong className="text-gray-800">Sem Foto:</strong> Exige atenção, pois usuários raramente compram itens sem visualização do rótulo/caixa.</li>
                    <li><strong className="text-gray-800">Destaques:</strong> Filtra os produtos fixados com estrelas que dominam a landing page inicial da loja.</li>
                    <li><strong className="text-gray-800">Múltiplos Níveis:</strong> O cruzamento dinâmico permite que você filtre por Departamento &gt; Subcategoria &gt; Fabricante e então pesquise uma palavra-chave.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Palette size={18} className="text-pink-500"/> Marketing Impresso Digital
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed mb-3">
                    A ferramenta exclusiva <strong className="text-gray-800">"Gerar Encarte"</strong> acaba com o custo de design:
                  </p>
                  <ol className="list-decimal pl-4 space-y-2 text-sm text-gray-600 font-medium">
                    <li>Marque os produtos desejados na checkbox esquerdas da tabela.</li>
                    <li>Clique no botão roxo de Gerar Encarte.</li>
                    <li>O sistema diagramará um folheto visual JPG ou PDF, renderizando os rótulos, preços "De/Por" com a mesma paleta de cores da identidade da sua loja.</li>
                    <li>Pronto para envio imediato nos grupos VIPs do WhatsApp.</li>
                  </ol>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <FileSpreadsheet size={18} className="text-emerald-500"/> Integrações Lote a Lote
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Exportar Faltas:</strong> Gera um relatório CSV dos itens zerados para envio ao fornecedor.</li>
                    <li><strong className="text-gray-800">Atualizar via Planilha:</strong> Interface que recebe listas Excel do seu ERP gerencial para conciliação em massa do preço e estoque sem digitação manual.</li>
                    <li><strong className="text-gray-800">Gerenciar Departamentos:</strong> Local para adicionar novas prateleiras lógicas ou deletar categorias inúteis (possui trava de segurança se houver produtos vinculados).</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Plus size={18} className="text-amber-500"/> Cadastro Avançado de Itens
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Variações Perfeitas:</strong> Usado para itens da mesma linha (Ex: "Fralda P", "Fralda M", "Fralda G"), impedindo a criação de dezenas de anúncios dispersos. Na tela do cliente, ele verá caixas elegantes para alternar os tamanhos.</li>
                    <li><strong className="text-gray-800">Retenção de Receita:</strong> Configuração indispensável em tarjas vermelhas/pretas; força e instrui o cliente final a realizar upload da receita médica durante o checkout online, garantindo documentação sanitária prévia.</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="4. Promoções e Cupons (Marketing Dinâmico)" 
            icon={<Sparkles size={24} />} 
            isOpen={openSection === 3} 
            onToggle={() => setOpenSection(openSection === 3 ? -1 : 3)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Este módulo vai além do desconto simples. Ele orquestra os chamariscos de venda (Topbars, Combos, Códigos) com controle fino de validade e regras arquitetadas para aumentar o ticket médio.
              </p>

              <div className="space-y-6">
                <div className="border border-gray-100 p-6 rounded-3xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                      <Zap size={18} className="text-amber-500"/> As 3 Modalidades Oficiais de Promoções
                    </h4>
                    <button 
                      onClick={() => {
                        setTutorialTab('PROMOTIONS');
                        const el = document.getElementById('tutorial-video-central');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 bg-emerald-50 px-3 py-1 rounded-full self-start sm:self-auto transition-colors"
                    >
                      <Video size={13} /> Assistir no Vídeo Tutorial
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase rounded-full tracking-wider">
                            📌 Leve X e Pague Y
                          </span>
                          <span className="text-[10px] font-mono text-gray-400 font-bold">00:00</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">
                          Estimula volume de compras. O carrinho desconta 100% das unidades extras automaticamente quando o cliente cumpre o gatilho da quantidade.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setTutorialTab('PROMOTIONS');
                          handleJumpToPromoChapter(PROMOTION_CHAPTERS[0]);
                          const el = document.getElementById('tutorial-video-central');
                          if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="mt-3 text-[11px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 self-start"
                      >
                        <Play size={11} className="fill-emerald-600" /> Ver capítulo no vídeo
                      </button>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="px-3 py-1 bg-purple-100 text-purple-800 text-[10px] font-black uppercase rounded-full tracking-wider">
                            📦 Combo Fixo
                          </span>
                          <span className="text-[10px] font-mono text-gray-400 font-bold">01:05</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">
                          Agrupa produtos complementares específicos com preço promocional travado para o conjunto (kit fechado de tratamento ou consumo).
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setTutorialTab('PROMOTIONS');
                          handleJumpToPromoChapter(PROMOTION_CHAPTERS[1]);
                          const el = document.getElementById('tutorial-video-central');
                          if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="mt-3 text-[11px] font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 self-start"
                      >
                        <Play size={11} className="fill-purple-600" /> Ver capítulo no vídeo
                      </button>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="px-3 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase rounded-full tracking-wider">
                            ⚡ Oferta Relâmpago
                          </span>
                          <span className="text-[10px] font-mono text-gray-400 font-bold">02:20</span>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">
                          Ativa desconto percentual direto nos produtos com selo chamativo e cronômetro de contagem regressiva para criar urgência de compra.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setTutorialTab('PROMOTIONS');
                          handleJumpToPromoChapter(PROMOTION_CHAPTERS[2]);
                          const el = document.getElementById('tutorial-video-central');
                          if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="mt-3 text-[11px] font-bold text-amber-600 hover:text-amber-800 flex items-center gap-1 self-start"
                      >
                        <Play size={11} className="fill-amber-600" /> Ver capítulo no vídeo
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="border border-gray-100 p-6 rounded-3xl flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-bold text-gray-900 flex items-center gap-2">
                          <Tag size={18} className="text-emerald-500"/> Gestão Lógica de Cupons
                        </h4>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                          Vídeo Aula 02
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mb-3 leading-relaxed">
                        Cupons servem para aquisição restrita (redes sociais sociais ou influenciadores). O filtro da tela os separa entre <strong className="text-gray-800 text-emerald-600">ATIVOS</strong> e <strong className="text-gray-800 text-red-500">EXPIRADOS</strong>.
                      </p>
                      <p className="text-sm text-gray-600 leading-relaxed border-l-2 border-emerald-500 pl-3">
                        Ao criar ou editar um cupom, você pode <strong>limitar o número máximo de usos</strong> de forma universal, travar um <strong>valor de pedido mínimo</strong> (para não esmagar a margem de lucro), e escolher se é Valor Fixo (R$) ou Porcentagem (%).
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        setTutorialTab('COUPONS');
                        const el = document.getElementById('tutorial-video-central');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="mt-4 text-xs font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 rounded-xl border border-emerald-100 self-start transition-colors"
                    >
                      <Video size={14} /> Assistir Vídeo Aula de Cupons
                    </button>
                  </div>
                  
                  <div className="border border-gray-100 p-6 rounded-3xl">
                    <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Settings size={18} className="text-gray-500"/> Motor de Agendamento
                    </h4>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Nunca perca o timing de remover uma liquidação. Ao editar uma promoção ou cupom, preencha <strong className="text-gray-800">Datas de Início e Fim</strong>. Para ofertas pontuais, escolha os <strong>Dias da Semana Específicos</strong> (Ex: Somente nas Terças da Saúde) e ative horários específicos de restrição. O relógio do sistema ativará e desativará bloqueios automaticamente às 23:59:59 da sua configuração.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="5. Histórico & Configurações de Loja" 
            icon={<Settings size={24} />} 
            isOpen={openSection === 4} 
            onToggle={() => setOpenSection(openSection === 4 ? -1 : 4)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Aqui são parametrizadas as leis do seu negócio no ambiente online. Do visual ao comportamento, frete georreferenciado por KM, central de atendimento inteligente e a trilha de auditoria geral (anti-fraude operacional).
              </p>

              {/* BANNER DA VÍDEO AULA 03 */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-emerald-50/80 border border-emerald-200/80 shadow-sm">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-200">
                    <Video size={22} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-200 text-emerald-900">
                        Vídeo Aula 03
                      </span>
                      <h5 className="text-sm font-black text-emerald-950">Tutorial em Vídeo Disponível</h5>
                    </div>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      Assista à aula completa cobrindo Configurações de Entrega & Frete por KM, Central de Atendimento (Etiquetas e Atalhos) e o Agente de IA.
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => {
                    setTutorialTab('CONFIG');
                    const el = document.getElementById('tutorial-video-central');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-200 shrink-0 flex items-center gap-2 self-start sm:self-auto hover:scale-105"
                >
                  <Play size={13} className="fill-white" /> Assistir Vídeo Aula 03
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* CARD FRETE POR KM */}
                <div className="bg-gray-50 p-6 rounded-3xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-gray-900 flex items-center gap-2">
                        <Truck size={18} className="text-blue-500"/> Logística & Frete por KM
                      </h4>
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">00:00</span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed mb-3">
                      O cálculo de frete georreferenciado calcula a rota viária real da drogaria até a casa do cliente. Cadastre o CEP de origem da loja e configure faixas progressivas de KM ou acréscimo por distância.
                    </p>
                    <ul className="space-y-1.5 text-xs text-gray-600 pl-3 border-l-2 border-blue-400">
                      <li><strong>Endereço Base:</strong> CEP e número corretos da drogaria.</li>
                      <li><strong>Faixas de KM:</strong> Preço escalonado por raio de atendimento.</li>
                      <li><strong>Pedido Mínimo:</strong> Proteção contra entregas deficitárias.</li>
                    </ul>
                  </div>

                  <button
                    onClick={() => {
                      setTutorialTab('CONFIG');
                      handleJumpToConfigChapter(CONFIG_CHAPTERS[0]);
                      const el = document.getElementById('tutorial-video-central');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="mt-4 text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 self-start"
                  >
                    <Play size={11} className="fill-blue-600" /> Ver no Vídeo Tutorial
                  </button>
                </div>

                {/* CARD ATENDIMENTO */}
                <div className="bg-gray-50 p-6 rounded-3xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-gray-900 flex items-center gap-2">
                        <Tag size={18} className="text-purple-500"/> Atendimento: Etiquetas & Atalhos
                      </h4>
                      <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">01:15</span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed mb-3">
                      Organize o fluxo de conversas do WhatsApp com etiquetas visuais por etapas (Aguardando Receita, Em Separação, Saiu p/ Entrega) e acelere respostas com atalhos <code>/</code> salvos no sistema.
                    </p>
                    <ul className="space-y-1.5 text-xs text-gray-600 pl-3 border-l-2 border-purple-400">
                      <li><strong>Etiquetas Coloridas:</strong> Classificação rápida de pedidos.</li>
                      <li><strong>Atalhos com Barra (/):</strong> Envio instantâneo de chaves PIX e dados.</li>
                      <li><strong>Busca & Filtros:</strong> Localização de clientes por tag.</li>
                    </ul>
                  </div>

                  <button
                    onClick={() => {
                      setTutorialTab('CONFIG');
                      handleJumpToConfigChapter(CONFIG_CHAPTERS[1]);
                      const el = document.getElementById('tutorial-video-central');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="mt-4 text-[11px] font-bold text-purple-600 hover:text-purple-800 flex items-center gap-1 self-start"
                  >
                    <Play size={11} className="fill-purple-600" /> Ver no Vídeo Tutorial
                  </button>
                </div>

                {/* CARD AGENTE IA */}
                <div className="bg-gray-50 p-6 rounded-3xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-gray-900 flex items-center gap-2">
                        <Bot size={18} className="text-emerald-500"/> Agente de IA (Atendente 24/7)
                      </h4>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">02:35</span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed mb-3">
                      Automatize o primeiro contato dos clientes com inteligência artificial treinada no seu catálogo farmacêutico, tirando dúvidas sobre medicamentos, buscando genéricos e montando carrinhos.
                    </p>
                    <ul className="space-y-1.5 text-xs text-gray-600 pl-3 border-l-2 border-emerald-400">
                      <li><strong>Prompt da Drogaria:</strong> Personalidade e tom de voz exclusivo.</li>
                      <li><strong>Horário Flexível:</strong> Operação 24h ou durante o fechamento.</li>
                      <li><strong>Segurança:</strong> Transfere receitas controladas a humanos.</li>
                    </ul>
                  </div>

                  <button
                    onClick={() => {
                      setTutorialTab('CONFIG');
                      handleJumpToConfigChapter(CONFIG_CHAPTERS[2]);
                      const el = document.getElementById('tutorial-video-central');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="mt-4 text-[11px] font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 self-start"
                  >
                    <Play size={11} className="fill-emerald-600" /> Ver no Vídeo Tutorial
                  </button>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Palette size={18} className="text-pink-500"/> Identidade Visual (Branding)
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Informações Institucionais:</strong> O Nome da Drogaria e Descrições inseridas aqui assinam todo o frontend.</li>
                    <li><strong className="text-gray-800">Logotipo:</strong> Um upload simples garante o rosto do seu negócio no site e na nota digital.</li>
                    <li><strong className="text-gray-800">Paleta Hexadecimal:</strong> Definir as cores Primária (botão principal), Secundária (Fundo) e Destaque transforma arquitetonicamente os botões e os cartões para a sua marca proprietária instantaneamente (Live Refresh).</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <BrainCircuit size={18} className="text-emerald-500"/> Regras de Checkout & Notificações
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Ponto de Contato (WhatsApp):</strong> Preencha o número oficial da expedição (ex: 55 DDD NÚMERO) para onde o checkout envia os pedidos.</li>
                    <li><strong className="text-gray-800">Pedido Mínimo de Entrega:</strong> Valor mínimo no carrinho para viabilizar saídas de entrega.</li>
                    <li><strong className="text-gray-800">Som de Alerta:</strong> Escolha ou upload de áudio de notificação a cada novo pedido que entra.</li>
                  </ul>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Activity size={18} className="text-red-500"/> Histórico de Auditoria 24h
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Localizado na aba Histórico do painel lateral. Este é um registro de <strong className="text-gray-800">Write-Ahead</strong>. Mantém e acopla logs irreversíveis (das últimas 24 horas) toda vez que as configurações da loja ou pedidos são alterados. Permite que o franqueado ou gestor apure quem/quando o sistema foi alterado indevidamente.
                  </p>
                </div>
              </div>
            </div>
          </AccordionItem>

          <AccordionItem 
            title="6. Gerenciamento de Equipe e Funcionários" 
            icon={<Store size={24} />} 
            isOpen={openSection === 5} 
            onToggle={() => setOpenSection(openSection === 5 ? -1 : 5)}
          >
            <div className="space-y-8">
              <p className="text-gray-600 font-medium leading-relaxed">
                Para garantir o controle e a organização das operações da sua farmácia, você tem total autonomia para gerenciar os acessos da sua equipe de trabalho diretamente pelo sistema, com segurança e muita praticidade.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Plus size={18} className="text-blue-500"/> Como Cadastrar Novos Membros
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    O Proprietário tem total liberdade para criar contas para seus colaboradores a qualquer momento, até mesmo pelo próprio celular! Você pode definir níveis de acesso conforme a necessidade da sua farmácia: <strong className="text-gray-800">Administradores, Gerentes ou Operadores</strong>. Basta abrir o gerenciamento da equipe, selecionar para adicionar um novo funcionário e preencher os dados de cadastro e a função exercida no estabelecimento.
                  </p>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <LayoutDashboard size={18} className="text-emerald-500"/> Nova Experiência Mobile
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Sabemos que a gestão da sua farmácia acontece não apenas no computador, mas na palma da mão. Por isso, nossa tela de cadastro e edição de funcionários é agora <strong className="text-gray-800">100% otimizada para celulares</strong>, permitindo visualizar erros de digitação e os botões de ação perfeitamente, sem travar a tela.
                  </p>
                </div>

                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Trash2 size={18} className="text-red-500"/> Exclusão Definitiva
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Ao clicar para excluir um funcionário, o sistema pedirá uma confirmação e removerá o acesso dele imediatamente e de forma definitiva do banco de dados. Seu nome some da lista na hora, garantindo máxima segurança para sua loja.
                  </p>
                </div>
              </div>
            </div>
          </AccordionItem>

          {/* ======================================================== */}
          {/* SEÇÃO 7: GERADOR DE ETIQUETAS E CARTAZES DE OFERTAS */}
          {/* ======================================================== */}
          <div id="manual-topic-price-tags">
            <AccordionItem 
              title="7. Gerador de Etiquetas e Cartazes de Ofertas" 
              icon={<Printer size={24} />} 
              isOpen={openSection === 6} 
              onToggle={() => setOpenSection(openSection === 6 ? -1 : 6)}
              badge={
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-sm">
                  <Sparkles size={12} className="text-emerald-600" />
                  Novo Recurso
                </span>
              }
              description="Aprenda a bipar produtos com leitor ou câmera, escolher modelos de gôndola/cartazes e imprimir folhas A4 sem cortes."
            >
              <div className="space-y-8">
                {/* INTRODUÇÃO EXPLICATIVA */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 md:p-8 rounded-3xl shadow-lg border border-slate-700">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 mb-2">
                        Automação de Merchandising & Ponto de Venda
                      </span>
                      <h4 className="text-xl md:text-2xl font-black text-white">
                        Precificação Ágil, Padronizada e Sem Desperdício
                      </h4>
                      <p className="text-slate-300 text-sm md:text-base mt-2 leading-relaxed max-w-3xl">
                        O módulo de <strong>Gerador de Etiquetas e Cartazes</strong> foi desenvolvido para solucionar um dos maiores gargalos operacionais da farmácia: a remarcação de gôndolas e a criação de cartazes promocionais. Bipe os itens diretamente no balcão com leitor USB ou câmera de celular, monte a fila de impressão e gere folhas A4 milimetricamente diagramadas sem cortes indesejados.
                      </p>
                    </div>

                    <div className="bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 shrink-0 text-center sm:text-left">
                      <p className="text-xs text-slate-300 font-medium">Compatibilidade Total</p>
                      <p className="text-base font-black text-emerald-400">Papel A4 Comum & Adesivo</p>
                      <p className="text-[11px] text-slate-400 mt-1">Pimaco 6180, Sulfite 75g/90g ou Couché</p>
                    </div>
                  </div>
                </div>

                {/* ======================================================== */}
                {/* PLAYER DE VÍDEO OFICIAL RESPONSIVO DO TUTORIAL */}
                {/* ======================================================== */}
                <div className="w-full max-w-4xl mx-auto my-6">
                  <div className="relative w-full aspect-video rounded-2xl overflow-hidden shadow-xl border border-slate-200 bg-black">
                    <iframe
                      className="w-full h-full"
                      src="https://www.youtube-nocookie.com/embed/7Qk8MyJ89PQ?rel=0"
                      title="Tutorial: Gerador de Etiquetas e Cartazes - FarmaFlow"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mt-3 px-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      💡 <span>Dica: Assista em tela cheia para ver os detalhes da tela e das impressões.</span>
                    </span>
                    <a
                      href="https://youtu.be/7Qk8MyJ89PQ?is=P4Jd_4Ru920Ts847"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-red-600 hover:text-red-700 font-semibold underline flex items-center gap-1 transition-colors"
                    >
                      Abrir diretamente no YouTube ↗
                    </a>
                  </div>
                </div>

                {/* ======================================================== */}
                {/* GUIA PRÁTICO OPERACIONAL EM 5 ETAPAS */}
                {/* ======================================================== */}
                <div>
                  <div className="flex items-center gap-3 mb-6 pb-3 border-b border-gray-100">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black">
                      <FileText size={20} />
                    </div>
                    <div>
                      <h4 className="text-xl font-black text-gray-900">Guia Prático Operacional para a Equipe</h4>
                      <p className="text-xs text-gray-500 font-medium">Siga este roteiro diário para etiquetar gôndolas e produzir cartazes com velocidade e padrão.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* ETAPA 1: BIPAGEM */}
                    <div className="bg-slate-50 p-6 md:p-7 rounded-3xl border border-slate-200/80 hover:border-emerald-200 transition-colors">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="w-8 h-8 rounded-xl bg-blue-600 text-white font-black text-xs flex items-center justify-center shadow-md shadow-blue-200">
                          1
                        </span>
                        <div>
                          <h5 className="font-black text-gray-900 text-base">Bipagem & Adição de Produtos</h5>
                          <span className="text-[11px] text-blue-600 font-bold uppercase tracking-wider">Leitor Físico, Câmera ou Busca</span>
                        </div>
                      </div>

                      <ul className="space-y-3 text-sm text-gray-600">
                        <li className="flex items-start gap-2.5">
                          <Check className="text-emerald-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Leitor USB / Bluetooth:</strong> O campo de busca conta com foco automático inteligente. Basta posicionar o cursor ou disparar o laser do leitor sobre o código de barras (EAN-13) da caixa do remédio para adicioná-lo instantaneamente.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Check className="text-emerald-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Scanner por Câmera:</strong> Clique no botão de câmera para usar o celular ou webcam. Ao apontar para o código de barras, o sistema emite um bipe sonoro de confirmação e inclui o item na lista.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Check className="text-emerald-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Incremento Rápido:</strong> Se você bipar o mesmo produto duas ou mais vezes, a quantidade de etiquetas é somada automaticamente sem duplicar linhas.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Check className="text-emerald-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Controle Manual de Cópias:</strong> Ajuste pelo seletor numérico (+ / -) exatamente quantas etiquetas serão impressas para cada produto da sua fila.
                          </span>
                        </li>
                      </ul>
                    </div>

                    {/* ETAPA 2: MODELOS */}
                    <div className="bg-slate-50 p-6 md:p-7 rounded-3xl border border-slate-200/80 hover:border-purple-200 transition-colors">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="w-8 h-8 rounded-xl bg-purple-600 text-white font-black text-xs flex items-center justify-center shadow-md shadow-purple-200">
                          2
                        </span>
                        <div>
                          <h5 className="font-black text-gray-900 text-base">Modelos de Etiquetas e Cartazes</h5>
                          <span className="text-[11px] text-purple-600 font-bold uppercase tracking-wider">4 Formatos Padrão A4</span>
                        </div>
                      </div>

                      <ul className="space-y-3 text-sm text-gray-600">
                        <li className="flex items-start gap-2.5">
                          <Tag className="text-purple-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Gôndola Padrão (30 por folha):</strong> Grade 3x10 (formato Pimaco 6180 / 26mm x 64mm). Ideal para canaletas plásticas de prateleiras. Contém nome completo, código EAN, código de barras escaneável, laboratório e preço à vista/parcelado.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Layers className="text-purple-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Baiana / Destaque de Ponta (8 por folha):</strong> Grade 2x4 com 65mm de altura. Perfeita para ilhas promocionais, pontas de gôndola e cestos com letras e números ampliados para leitura a média distância.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <FileImage className="text-purple-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Cartaz Promocional A5 (2 por folha):</strong> Meia folha A4 (135mm x 210mm). Recomendado para testeiras de gôndola e pilhas de produtos em oferta (fraldas, protetores solares, dermocosméticos).
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Printer className="text-purple-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Cartaz de Oferta A4 (1 por folha):</strong> Cartaz gigante de página inteira para vitrines, balcão de atendimento e promoções relâmpago de alto impacto visual.
                          </span>
                        </li>
                      </ul>
                    </div>

                    {/* ETAPA 3: INTELIGÊNCIA PROMOCIONAL */}
                    <div className="bg-slate-50 p-6 md:p-7 rounded-3xl border border-slate-200/80 hover:border-amber-200 transition-colors">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="w-8 h-8 rounded-xl bg-amber-600 text-white font-black text-xs flex items-center justify-center shadow-md shadow-amber-200">
                          3
                        </span>
                        <div>
                          <h5 className="font-black text-gray-900 text-base">Inteligência de Preços & Ofertas</h5>
                          <span className="text-[11px] text-amber-600 font-bold uppercase tracking-wider">De / Por, Combos e Parcelamento</span>
                        </div>
                      </div>

                      <ul className="space-y-3 text-sm text-gray-600">
                        <li className="flex items-start gap-2.5">
                          <Percent className="text-amber-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Preço "De / Por" Automático:</strong> Se o produto estiver em oferta no sistema, a etiqueta imprime o preço original riscado e o valor promocional com tipografia pesada e selo de economia.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Sparkles className="text-amber-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Leve X Pague Y Integrado:</strong> Quando configurada uma campanha de volume, o cartaz exibe a chamada promocional destacando o valor unitário equivalente no pacote (ex: <em>"Nesta embalagem a unidade sai por R$ 9,90"</em>).
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <DollarSign className="text-amber-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Condições de Parcelamento:</strong> O sistema calcula e exibe opções de parcelamento sem juros em produtos de maior valor agregado para estimular o ticket médio.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <ShieldCheck className="text-amber-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Conformidade Legal & Procon:</strong> Inclusão automática de data de geração, laboratório fabricante e código EAN escaneável para auditorias sanitárias e fiscais.
                          </span>
                        </li>
                      </ul>
                    </div>

                    {/* ETAPA 4: GESTÃO DE LOTES */}
                    <div className="bg-slate-50 p-6 md:p-7 rounded-3xl border border-slate-200/80 hover:border-teal-200 transition-colors">
                      <div className="flex items-center gap-3 mb-4">
                        <span className="w-8 h-8 rounded-xl bg-teal-600 text-white font-black text-xs flex items-center justify-center shadow-md shadow-teal-200">
                          4
                        </span>
                        <div>
                          <h5 className="font-black text-gray-900 text-base">Lotes & Histórico de Impressão</h5>
                          <span className="text-[11px] text-teal-600 font-bold uppercase tracking-wider">Reimpressão Rápida em 1 Clique</span>
                        </div>
                      </div>

                      <ul className="space-y-3 text-sm text-gray-600">
                        <li className="flex items-start gap-2.5">
                          <Check className="text-teal-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Salvar Lote de Trabalho:</strong> Ao terminar de bipar uma remessa de gôndola, salve o lote com um nome claro (ex: <em>"Remarcação Perfumaria - 22/09"</em>).
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Check className="text-teal-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Recuperação Imediata:</strong> Caso a impressora atole o papel ou seja necessário repor etiquetas danificadas, abra o histórico e clique em <em>"Restaurar Lote"</em> para recuperar todos os itens instantaneamente.
                          </span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <Check className="text-teal-500 shrink-0 mt-0.5" size={16} />
                          <span>
                            <strong>Limpeza Segura da Fila:</strong> Após a conclusão bem-sucedida, você pode limpar a fila atual mantendo o histórico de lotes preservado.
                          </span>
                        </li>
                      </ul>
                    </div>
                  </div>

                  {/* ======================================================== */}
                  {/* CAIXA DE CONFIGURAÇÃO CRÍTICA DE IMPRESSÃO SEM CORTES */}
                  {/* ======================================================== */}
                  <div className="p-6 md:p-8 rounded-3xl bg-amber-50 border-2 border-amber-300 shadow-md">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-200">
                        <Sliders size={24} />
                      </div>
                      <div className="w-full">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-200 text-amber-900">
                            Checklist Obrigatório
                          </span>
                          <span className="text-xs font-bold text-amber-800">
                            Como Configurar a Janela de Impressão Sem Cortar Margens
                          </span>
                        </div>
                        <h5 className="text-lg md:text-xl font-black text-gray-900">
                          Configurações Críticas do Navegador (Chrome / Edge / Firefox)
                        </h5>
                        <p className="text-sm text-gray-700 mt-1 leading-relaxed">
                          Para garantir que as 30 etiquetas da folha Pimaco 6180 ou os cartazes saiam perfeitamente alinhados e sem quebra de página indevida, configure sua janela de impressão conforme abaixo:
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5 mt-5">
                          <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block mb-1">Passo 1: Tamanho</span>
                            <h6 className="font-bold text-gray-900 text-sm">Papel A4</h6>
                            <p className="text-xs text-gray-600 mt-1">Selecione sempre "A4 (210 x 297 mm)" nas opções de papel.</p>
                          </div>

                          <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-wider text-red-600 block mb-1">Passo 2: Margens</span>
                            <h6 className="font-bold text-gray-900 text-sm">Margem: Nenhuma (ou Padrão)</h6>
                            <p className="text-xs text-gray-600 mt-1">Defina como <strong>Nenhuma</strong> para que o cabeçalho e rodapé do navegador não empurrem as etiquetas.</p>
                          </div>

                          <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 block mb-1">Passo 3: Escala</span>
                            <h6 className="font-bold text-gray-900 text-sm">Escala: 100% (Padrão)</h6>
                            <p className="text-xs text-gray-600 mt-1"><strong>Nunca</strong> selecione "Ajustar à página" ou porcentagens diferentes de 100%.</p>
                          </div>

                          <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm sm:col-span-2 md:col-span-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-purple-700 block mb-1">Passo 4: Gráficos de Fundo (Indispensável)</span>
                            <h6 className="font-bold text-gray-900 text-sm">Marcar "Gráficos de segundo plano"</h6>
                            <p className="text-xs text-gray-600 mt-1">
                              No menu <em>Mais definições</em>, ative a opção <strong>Gráficos de segundo plano</strong> (Background graphics). Sem isso, as faixas pretas e fundos promocionais não serão impressos.
                            </p>
                          </div>

                          <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 block mb-1">Passo 5: Cabeçalho</span>
                            <h6 className="font-bold text-gray-900 text-sm">Desmarcar Cabeçalhos/Rodapés</h6>
                            <p className="text-xs text-gray-600 mt-1">Desative cabeçalhos para evitar carimbos com URLs e data nas bordas.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ======================================================== */}
                  {/* RESUMO DE MODELOS RECOMENDADOS POR ÁREA DA FARMÁCIA */}
                  {/* ======================================================== */}
                  <div className="mt-8 bg-gray-50 p-6 md:p-8 rounded-3xl border border-gray-100">
                    <h5 className="font-black text-gray-900 text-base mb-4 flex items-center gap-2">
                      <Store size={18} className="text-emerald-600" />
                      Onde Usar Cada Modelo no Ponto de Venda (PDV)
                    </h5>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-blue-100 text-blue-800">
                          30x por Folha
                        </span>
                        <h6 className="font-bold text-gray-900 text-sm mt-2">Canaletas de Gôndola</h6>
                        <p className="text-xs text-gray-500 mt-1">Medicamentos RX e OTC, dermocosméticos finos e higiene bucal em prateleiras fechadas.</p>
                      </div>

                      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-purple-100 text-purple-800">
                          8x por Folha
                        </span>
                        <h6 className="font-bold text-gray-900 text-sm mt-2">Pontas de Gôndola & Ilhas</h6>
                        <p className="text-xs text-gray-500 mt-1">Cestos centrais, pontas de corredor e produtos em promoção da semana.</p>
                      </div>

                      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-100 text-amber-800">
                          A5 (Meia Folha)
                        </span>
                        <h6 className="font-bold text-gray-900 text-sm mt-2">Testeiras & Fraldário</h6>
                        <p className="text-xs text-gray-500 mt-1">Topo de gôndolas e pilhas de fraldas descartáveis, lenços e leites infantis.</p>
                      </div>

                      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-100 text-rose-800">
                          A4 (Folha Inteira)
                        </span>
                        <h6 className="font-bold text-gray-900 text-sm mt-2">Vitrines & Balcão</h6>
                        <p className="text-xs text-gray-500 mt-1">Cartazes gigantes com chamadas fortes na entrada da loja e no caixa.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </AccordionItem>
          </div>
        </div>

        <div className="mt-16 p-8 bg-emerald-600 rounded-[2.5rem] text-white flex flex-col lg:flex-row items-center justify-between gap-8 shadow-2xl shadow-emerald-200">
          <div className="flex items-center gap-5 w-full">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md shrink-0">
              <MessageCircle size={32} />
            </div>
            <div>
              <h4 className="text-xl md:text-2xl font-black leading-tight">Precisa de ajuda com operações avançadas?</h4>
              <p className="text-emerald-100 font-medium text-sm md:text-base mt-2">Nossa equipe de suporte técnico especializada está à sua completa disposição para integrações e dúvidas emergenciais.</p>
            </div>
          </div>
          <a 
            href="https://wa.me/5522981552881" 
            target="_blank" 
            rel="noreferrer"
            className="w-full lg:w-auto bg-white text-emerald-600 px-8 py-5 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 hover:scale-105 hover:bg-emerald-50 transition-all shadow-xl whitespace-nowrap"
          >
            Falar com Especialista <ArrowRight size={18} />
          </a>
        </div>
      </div>
    </div>
  );
};

