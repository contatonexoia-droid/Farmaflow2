
import React, { useState, useRef } from 'react';
import { 
  BookOpen, ShoppingBag, FileSpreadsheet, Palette, Trash2, 
  Plus, Edit3, Wand2, FileText, Printer, FileImage, 
  Store, MessageCircle, ArrowRight, Layers, RefreshCw, 
  Settings, Sparkles, Star, Zap, BrainCircuit, Search, Bell,
  ChevronDown, ChevronUp, LayoutDashboard, Tag, Activity,
  Play, Video, Package, CheckCircle2, Clock, ShieldCheck, Info,
  Percent, DollarSign, Ticket, Target
} from 'lucide-react';

// ==========================================
// CONSTANTES DE VÍDEO E CAPÍTULOS DE PROMOÇÕES E CUPONS
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

const AccordionItem = ({ title, icon, children, isOpen, onToggle }: { title: string, icon: React.ReactNode, children: React.ReactNode, isOpen: boolean, onToggle: () => void }) => {
  return (
    <div className={`bg-white rounded-[2rem] border transition-all duration-300 ${isOpen ? 'border-emerald-200 shadow-xl' : 'border-gray-100 shadow-sm hover:border-emerald-100'}`}>
      <button 
        onClick={onToggle}
        className="w-full flex items-center justify-between p-6 md:p-8 text-left focus:outline-none"
      >
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-2xl transition-colors ${isOpen ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-50 text-gray-500'}`}>
            {icon}
          </div>
          <h3 className={`text-xl md:text-2xl font-black ${isOpen ? 'text-gray-900' : 'text-gray-700'}`}>
            {title}
          </h3>
        </div>
        <div className={`p-2 rounded-full transition-colors ${isOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
          {isOpen ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
        </div>
      </button>
      <div 
        className={`overflow-hidden transition-all duration-500 ease-in-out ${isOpen ? 'max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="p-6 md:p-8 pt-0 border-t border-gray-50">
          {children}
        </div>
      </div>
    </div>
  );
};

export const AdminManual: React.FC = () => {
  const [openSection, setOpenSection] = useState<number>(0);
  const [tutorialTab, setTutorialTab] = useState<'PROMOTIONS' | 'COUPONS'>('PROMOTIONS');

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
            <div className="flex items-center gap-2 p-1.5 bg-white rounded-2xl border border-slate-200 shadow-sm self-start sm:self-auto">
              <button
                id="tab-btn-promotions"
                onClick={() => setTutorialTab('PROMOTIONS')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-200 ${
                  tutorialTab === 'PROMOTIONS'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                }`}
              >
                <Sparkles size={16} />
                <span>Campanhas Promocionais</span>
              </button>

              <button
                id="tab-btn-coupons"
                onClick={() => setTutorialTab('COUPONS')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs md:text-sm transition-all duration-200 ${
                  tutorialTab === 'COUPONS'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-slate-50'
                }`}
              >
                <Tag size={16} />
                <span>Cupons de Desconto</span>
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
                Aqui são parametrizadas as leis do seu negócio no ambiente online. Do visual ao comportamento, e também a trilha de auditoria geral (anti-fraude operacional).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <h4 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Activity size={18} className="text-red-500"/> Histórico de Auditoria 24h
                  </h4>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    Localizado na aba Histórico do painel lateral. Este é um registro de <strong className="text-gray-800">Write-Ahead</strong>. Mantém e acopla logs irreversíveis (das últimas 24 horas) toda vez que as configurações da loja ou pedidos são alterados. Permite que o franqueado ou gestor apure quem/quando o sistema foi alterado indevidamente.
                  </p>
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
                    <BrainCircuit size={18} className="text-emerald-500"/> Regras e Fluxos
                  </h4>
                  <ul className="space-y-3 text-sm text-gray-600">
                    <li><strong className="text-gray-800">Ponto de Contato (WhatsApp):</strong> Preencha o número oficial da expedição (ex: 55 DDD NÚMERO). É para esta exata chave que a automação apontará o checkout do cliente com o ID.</li>
                    <li><strong className="text-gray-800">Ticket e Logística:</strong> Cadastre rigorosamente o "Pedido Mínimo de Entrega" (R$) para evitar entregas deficitárias, além de poder embutir a Taxa de Entrega padrão.</li>
                    <li><strong className="text-gray-800">Som de Alerta:</strong> A escolha do som no banco ou upload próprio para garantir a perfuração de ruído no salão de loja a cada pedido.</li>
                  </ul>
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

