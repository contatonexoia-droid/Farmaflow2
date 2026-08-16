import React, { useState, useRef, useEffect } from 'react';
import { X, Printer, ImageIcon, Loader2, Sparkles, Phone, Truck, Info, Star, ChevronDown, AlertTriangle } from 'lucide-react';
import { domToJpeg } from 'modern-screenshot';
import { getStoreUrl } from '../lib/store';

interface FlyerProduct {
    id: string;
    name: string;
    category: string;
    price: number;
    originalPrice?: number;
    promotionType?: 'DISCOUNT' | 'BUY_X_PAY_Y' | 'NONE' | 'DISCOUNT_ON_QTY';
    buyX?: number;
    payY?: number;
    image?: string;
    isHighlight?: boolean;
    badgeText?: string;
}

interface FlyerConfig {
    themeColor: string;
    themeSecondaryColor: string;
    bannerTitle: string;
    subTitle: string;
    productsArray: FlyerProduct[];
    footerInfo: {
        whatsapp: string;
        deliveryLink: string;
        rules: string;
    };
    logo?: string;
    tenantName: string;
    tenantSlug?: string;
    tenantSubdomain?: string;
    tenantId?: string;
    customDomain?: string;
    storeUrl?: string;
    tenant?: any;
}

interface DynamicFlyerGeneratorProps {
    initialConfig: FlyerConfig;
    onClose: () => void;
}

export const DynamicFlyerGenerator: React.FC<DynamicFlyerGeneratorProps> = ({ initialConfig, onClose }) => {
    const [config, setConfig] = useState<FlyerConfig>(initialConfig);
    const [isGeneratingJPG, setIsGeneratingJPG] = useState(false);
    const [showTitleSuggestions, setShowTitleSuggestions] = useState(false);
    const flyerRef = useRef<HTMLDivElement>(null);

    const titleSuggestions = [
        "Saldão da Economia",
        "Festival da Saúde",
        "Mega Ofertas da Semana",
        "Feirão do Desconto",
        "Segunda e Terça da Imunidade"
    ];

    // Load draft from localStorage on mount
    useEffect(() => {
        const savedDraft = localStorage.getItem(`farmaflow_flyer_draft_${initialConfig.tenantName}`);
        if (savedDraft) {
            try {
                const parsed = JSON.parse(savedDraft);
                
                // Merge saved product settings (highlight, badgeText) into the currently selected products
                const mergedProducts = initialConfig.productsArray.map(p => {
                    const draftedProduct = parsed.productsArray?.find((dp: any) => dp.id === p.id);
                    if (draftedProduct) {
                        return { ...p, isHighlight: draftedProduct.isHighlight, badgeText: draftedProduct.badgeText };
                    }
                    return p;
                });

                setConfig({
                    ...initialConfig,
                    bannerTitle: parsed.bannerTitle || initialConfig.bannerTitle,
                    subTitle: parsed.subTitle || initialConfig.subTitle,
                    footerInfo: parsed.footerInfo || initialConfig.footerInfo,
                    productsArray: mergedProducts
                });
            } catch (e) {
                console.error("Failed to parse drafted flyer state", e);
            }
        }
    }, [initialConfig]);

    // Save draft to localStorage whenever it changes
    useEffect(() => {
        localStorage.setItem(`farmaflow_flyer_draft_${config.tenantName}`, JSON.stringify({
            bannerTitle: config.bannerTitle,
            subTitle: config.subTitle,
            footerInfo: config.footerInfo,
            productsArray: config.productsArray.map(p => ({
                id: p.id,
                isHighlight: p.isHighlight,
                badgeText: p.badgeText
            }))
        }));
    }, [config]);

    const getProxiedImageUrl = (url?: string) => {
        if (!url) return 'https://via.placeholder.com/300x300.png?text=Sem+Imagem';
        if (url.startsWith('http') && !url.includes('supabase.co')) {
            return `/api/image-proxy?url=${encodeURIComponent(url)}`;
        }
        return url;
    };

    const getProductDisplayImage = (product: FlyerProduct) => {
        return getProxiedImageUrl(product.image);
    };

    const generateFlyerTextSupport = () => {
        const storeUrl = config.storeUrl || getStoreUrl(config.tenant) || getStoreUrl({
            id: config.tenantId,
            slug: config.tenantSlug,
            subdomain: config.tenantSubdomain,
            custom_domain: config.customDomain,
            name: config.tenantName
        });

        const storeName = (config.tenantName || 'NOSSA LOJA').toUpperCase();
        
        const whatsappMessage = `💪🛡️ SEMPRE PERTO, CUIDANDO DE VOCÊ. NA ${storeName}! 🛡️💪\n\n💊 Saúde e bem-estar com descontos imperdíveis diretamente no nosso site.\n\n🛒 Confira as ofertas e faça seu pedido na nossa loja online:\n🔗 ${storeUrl}`;

        return whatsappMessage;
    };

    const generateFlyerImageBlob = async () => {
        if (!flyerRef.current) throw new Error("Referência do encarte não encontrada.");
        
        const images = flyerRef.current.querySelectorAll('img');
        const imagePromises = Array.from(images).map(async (img) => {
            if (img.src.startsWith('data:')) return;
            let originalSrc = img.src;
            // Avoid double proxying
            if (originalSrc.includes('/api/image-proxy?url=')) {
                const urlParam = new URL(originalSrc).searchParams.get('url');
                if (urlParam) {
                    originalSrc = urlParam;
                }
            }
            try {
                const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(originalSrc)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error("Status " + response.status);
                const blob = await response.blob();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                img.src = dataUrl;
            } catch (e) {
                console.warn("Failed to proxy image:", originalSrc, e);
            }
        });
        await Promise.all(imagePromises);
        await new Promise(resolve => setTimeout(resolve, 500));

        const dataUrl = await Promise.race([
            domToJpeg(flyerRef.current, {
                quality: 0.95,
                pixelRatio: 2,
                backgroundColor: '#ffffff',
                fetch: {
                    bypassingCache: true,
                    requestInit: { mode: 'cors' }
                }
            } as any),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timeout ao gerar imagem")), 15000))
        ]);

        const base64Data = dataUrl.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteArrays = [];
        for (let offset = 0; offset < byteCharacters.length; offset += 512) {
            const slice = byteCharacters.slice(offset, offset + 512);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }
        return {
            blob: new Blob(byteArrays, { type: 'image/jpeg' }),
            dataUrl
        };
    };

    const handleDownloadOnly = async () => {
        if (!flyerRef.current) return;
        setIsGeneratingJPG(true);
        try {
            const { blob } = await generateFlyerImageBlob();
            const objectUrl = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            const sanitizedTitle = config.bannerTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            link.download = `encarte-${sanitizedTitle || 'ofertas'}-${new Date().getTime()}.jpg`;
            link.href = objectUrl;
            link.click();
            
            URL.revokeObjectURL(objectUrl);
        } catch (e: any) {
            console.error("Erro ao gerar encarte detalhado:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
            alert("Erro ao gerar encarte: " + (e?.message || e || "Erro desconhecido"));
        } finally {
            setIsGeneratingJPG(false);
        }
    };

    const handleShareWhatsApp = async () => {
        if (!flyerRef.current) return;
        setIsGeneratingJPG(true);
        try {
            const { blob: fileBlob, dataUrl } = await generateFlyerImageBlob();
            
            const file = new File([fileBlob], `Encarte-${config.tenantName}-${new Date().getTime()}.jpg`, { type: 'image/jpeg' });
            const shareText = generateFlyerTextSupport();

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({
                        files: [file],
                        title: config.bannerTitle,
                        text: shareText
                    });
                } catch (shareError: any) {
                    if (shareError.name !== 'AbortError') {
                        throw shareError;
                    }
                }
            } else {
                // Fallback for Desktop: Download image and open WhatsApp Web with text
                const link = document.createElement('a');
                link.download = file.name;
                link.href = dataUrl;
                link.click();
                
                const cleanPhone = (config.footerInfo?.whatsapp || '').replace(/\D/g, '');
                const waUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(shareText)}`;
                window.open(waUrl, '_blank');
            }
        } catch (e: any) {
            console.error("Erro ao gerar encarte detalhado:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
            alert("Erro ao gerar encarte: " + (e?.message || e || "Erro desconhecido"));
        } finally {
            setIsGeneratingJPG(false);
        }
    };

    const toggleHighlight = (productId: string) => {
        setConfig(prev => ({
            ...prev,
            productsArray: prev.productsArray.map(p => 
                p.id === productId ? { ...p, isHighlight: !p.isHighlight } : p
            )
        }));
    };

    const handleBadgeChange = (productId: string, text: string) => {
        setConfig(prev => ({
            ...prev,
            productsArray: prev.productsArray.map(p => 
                p.id === productId ? { ...p, badgeText: text } : p
            )
        }));
    };

    const highlightedProducts = config.productsArray.filter(p => p.isHighlight);
    const normalProducts = config.productsArray.filter(p => !p.isHighlight);

    return (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white w-full rounded-[2rem] p-4 lg:p-6 shadow-2xl flex flex-col lg:flex-row max-h-[95vh] h-full gap-6 animate-in zoom-in-95">
                
                {/* Lateral Esquerda - Controles (Formulário) */}
                <div className="w-full lg:w-1/3 flex flex-col lg:h-full overflow-y-auto pr-2 custom-scrollbar shrink-0 max-h-[40vh] lg:max-h-full">
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h3 className="text-2xl font-black text-gray-900">Gerador Dinâmico</h3>
                            <p className="text-sm font-bold text-gray-400">Personalize seu encarte comercial</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <div className="flex justify-between items-end mb-1">
                                <label className="block text-xs font-black uppercase text-gray-500">Título do Encarte</label>
                                <div className="relative">
                                    <button 
                                        onClick={() => setShowTitleSuggestions(!showTitleSuggestions)}
                                        className="text-[10px] flex items-center gap-1 font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded"
                                    >
                                        <Sparkles size={12} /> Sugestões
                                    </button>
                                    
                                    {showTitleSuggestions && (
                                        <div className="absolute top-full right-0 mt-1 w-48 bg-white border rounded-lg shadow-xl z-50 overflow-hidden">
                                            {titleSuggestions.map((title, i) => (
                                                <button 
                                                    key={i}
                                                    onClick={() => {
                                                        setConfig({...config, bannerTitle: title});
                                                        setShowTitleSuggestions(false);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 border-b last:border-0"
                                                >
                                                    {title}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <input 
                                type="text" 
                                value={config.bannerTitle}
                                onChange={(e) => setConfig({...config, bannerTitle: e.target.value})}
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-blue-500 outline-none"
                                placeholder="Ex: SEGUNDA DA IMUNIDADE"
                            />
                        </div>

                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <label className="block text-xs font-black uppercase text-gray-500 mb-1">Subtítulo</label>
                            <input 
                                type="text" 
                                value={config.subTitle}
                                onChange={(e) => setConfig({...config, subTitle: e.target.value})}
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold focus:border-blue-500 outline-none"
                                placeholder="Fortaleça sua saúde com ofertas!"
                            />
                        </div>
                        
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <h4 className="text-xs font-black uppercase text-gray-500 mb-3 border-b pb-2">Rodapé e Contatos</h4>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">WhatsApp de Pedidos</label>
                                    <input 
                                        type="text" 
                                        value={config.footerInfo.whatsapp}
                                        onChange={(e) => setConfig({...config, footerInfo: {...config.footerInfo, whatsapp: e.target.value}})}
                                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Link Delivery / Informação Curta</label>
                                    <input 
                                        type="text" 
                                        value={config.footerInfo.deliveryLink}
                                        onChange={(e) => setConfig({...config, footerInfo: {...config.footerInfo, deliveryLink: e.target.value}})}
                                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                                        placeholder="Levamos até você!"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Regras da Promoção</label>
                                    <input 
                                        type="text" 
                                        value={config.footerInfo.rules}
                                        onChange={(e) => setConfig({...config, footerInfo: {...config.footerInfo, rules: e.target.value}})}
                                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold outline-none"
                                        placeholder="Ex: Ofertas válidas para Segunda e Terça-Feira"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <div className="flex justify-between items-center mb-3 border-b pb-2">
                                <h4 className="text-xs font-black uppercase text-gray-500">Produtos ({config.productsArray.length})</h4>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${highlightedProducts.length > 4 ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'}`}>
                                    {highlightedProducts.length} destaques
                                </span>
                            </div>
                            
                            {highlightedProducts.length > 4 && (
                                <div className="mb-3 bg-red-50 text-red-700 p-2 rounded-lg flex gap-2 items-start text-[10px] font-bold border border-red-100">
                                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                    <p>Muitos produtos em destaque podem quebrar o limite de altura da imagem na hora de exportar. Considere usar no máximo 4 destaques.</p>
                                </div>
                            )}

                            <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                {config.productsArray.map((p) => (
                                    <div key={p.id} className="bg-white border rounded-lg p-3 flex flex-col gap-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 shrink-0 bg-gray-50 rounded p-1">
                                                <img src={getProductDisplayImage(p)} className="w-full h-full object-contain" crossOrigin="anonymous" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold truncate text-gray-900">{p.name}</p>
                                                <p className="text-[9px] text-gray-500">R$ {p.price.toFixed(2)}</p>
                                            </div>
                                            <button 
                                                onClick={() => toggleHighlight(p.id)}
                                                className={`p-1.5 rounded-full ${p.isHighlight ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                                                title="Destacar Produto"
                                            >
                                                <Star size={14} fill={p.isHighlight ? "currentColor" : "none"} />
                                            </button>
                                        </div>
                                        {p.isHighlight && (
                                            <div className="mt-1">
                                                <input 
                                                    type="text"
                                                    value={p.badgeText || ''}
                                                    onChange={(e) => handleBadgeChange(p.id, e.target.value)}
                                                    placeholder="Badge ex: Leve 3 por R$ 19,98"
                                                    className="w-full text-[10px] font-bold border rounded px-2 py-1 outline-none"
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Lateral Direita - Preview e Download */}
                <div className="w-full lg:w-2/3 flex flex-col flex-1 bg-gray-100 rounded-3xl overflow-hidden relative border-2 border-gray-200">
                    <button onClick={onClose} className="absolute top-4 right-4 z-50 p-2 bg-white/80 backdrop-blur rounded-full hover:text-red-500 shadow-lg"><X size={24}/></button>
                    
                    <div className="flex-1 overflow-auto p-4 flex justify-center items-start custom-scrollbar">
                        {/* Canvas do Encarte */}
                        <div 
                            ref={flyerRef} 
                            className="bg-white shadow-2xl relative overflow-hidden flex flex-col justify-between shrink-0"
                            style={{ 
                                width: '794px', 
                                minHeight: '1123px',
                                background: `radial-gradient(circle at top, ${config.themeSecondaryColor || '#1e3a8a'} 0%, ${config.themeColor || '#1e40af'} 100%)`
                            }}
                        >
                            {/* Cabeçalho Agressivo */}
                            <div className="pt-10 pb-6 px-12 flex flex-col items-center text-center relative z-10">
                                {/* Decorators / Sparkles */}
                                <Sparkles className="absolute top-8 left-8 text-yellow-300 opacity-80" size={32} />
                                <Sparkles className="absolute top-12 right-8 text-yellow-400 opacity-60" size={40} />
                                
                                <div className="bg-green-500 text-white px-4 py-1.5 rounded-full text-[12px] font-black uppercase inline-flex items-center gap-2 mb-4 shadow-lg border-2 border-white/20 transform -rotate-1 relative z-20">
                                    <Info size={14} /> Ofertas Especiais
                                </div>
                                
                                <h1 
                                     className="text-[3.5rem] leading-[0.9] font-black uppercase text-white tracking-tighter relative z-20 px-10"
                                    style={{
                                        textShadow: '0 8px 16px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.8), -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000'
                                    }}
                                >
                                    {config.bannerTitle || "OFERTAS ESPECIAIS"}
                                </h1>
                                
                                <div className="mt-4 bg-yellow-400 text-yellow-900 px-6 py-2 rounded-xl text-lg font-black uppercase tracking-widest shadow-xl transform rotate-1 border-2 border-yellow-300">
                                    {config.subTitle || "Aqui você encontra saúde e bem estar!"}
                                </div>
                            </div>
                                      {/* Grade de Produtos */}
                            <div className="px-6 py-4 flex-1 flex flex-col gap-4 relative z-10">
                                <div className="grid grid-cols-3 gap-4 mt-2">
                                    {config.productsArray.map(p => {
                                        const hasDiscount = Boolean(p.originalPrice && p.originalPrice > p.price);
                                        const isKit = p.promotionType === 'BUY_X_PAY_Y';
                                        const img = getProductDisplayImage(p);
                                        return (
                                            <div key={p.id} className={`bg-white rounded-2xl p-3 text-center relative shadow-lg flex flex-col items-center justify-between pt-6 ${p.isHighlight ? 'border-4 border-yellow-400 shadow-[0_8px_30px_rgb(0,0,0,0.2)]' : 'border-b-4 border-gray-200'}`}>
                                                
                                                {p.badgeText && (
                                                    <div className={`absolute top-0 right-0 left-0 text-white text-[10px] font-black uppercase px-2 py-1 shadow-sm z-10 ${p.isHighlight ? 'rounded-t-xl' : 'rounded-t-xl'} ${isKit ? 'bg-purple-600' : (p.isHighlight ? 'bg-blue-600' : 'bg-red-600')}`}>
                                                        {p.badgeText}
                                                    </div>
                                                )}
                                                
                                                <div className="w-full h-24 flex items-center justify-center mb-3 mt-2">
                                                    <img src={img} className={`max-w-full max-h-full object-contain ${p.isHighlight ? 'drop-shadow-md' : ''}`} referrerPolicy="no-referrer" crossOrigin="anonymous" />
                                                </div>
                                                
                                                <div className="w-full">
                                                    <span className="text-[8px] font-black uppercase text-gray-400 block mb-0.5 tracking-widest">{p.category}</span>
                                                    <div className="font-black text-gray-800 text-sm mb-2 leading-tight line-clamp-2 h-10 flex items-center justify-center">{p.name}</div>
                                                    
                                                    <div className={`rounded-xl p-2 border ${p.isHighlight ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-100'}`}>
                                                        {hasDiscount ? (
                                                            <p className="text-[10px] text-gray-500 font-bold line-through mb-[-2px]">
                                                                De R$ {p.originalPrice?.toFixed(2).replace('.', ',')}
                                                            </p>
                                                        ) : null}
                                                        <div className={`text-2xl font-black tracking-tighter ${p.isHighlight ? 'text-green-600' : (hasDiscount ? 'text-red-600' : 'text-gray-900')}`}>
                                                            R$ {p.price.toFixed(2).replace('.', ',')}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                            
                            {/* Rodapé Agressivo */}
                            <div className="bg-white p-6 relative z-10 shadow-[0_-10px_20px_rgba(0,0,0,0.1)]">
                                <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-4">
                                    {/* Logo */}
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center shadow border p-2">
                                            {config.logo ? <img src={getProxiedImageUrl(config.logo)} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" crossOrigin="anonymous" /> : <span className="text-xl font-black text-blue-800">{config.tenantName.charAt(0)}</span>}
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-black text-gray-900 tracking-tighter uppercase leading-none">{config.tenantName}</h2>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{config.footerInfo.deliveryLink}</p>
                                        </div>
                                    </div>
                                    
                                    {/* Contatos */}
                                    <div className="flex gap-6">
                                        <div className="flex items-center gap-3 bg-green-50 px-4 py-2 rounded-xl border border-green-200">
                                            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white shadow-md">
                                                <Phone size={20} />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black text-green-700 uppercase">Fale Conosco pelo WhatsApp</p>
                                                <p className="text-lg font-black text-green-800 leading-none">{config.footerInfo.whatsapp || '(00) 00000-0000'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex justify-between items-center text-[10px] font-bold uppercase text-gray-500 bg-gray-50 rounded-lg p-3">
                                    <div className="flex items-center gap-2">
                                        <Truck size={14} className="text-blue-500" />
                                        {config.footerInfo.deliveryLink || 'Delivery Rápido'}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Info size={14} className="text-blue-500" />
                                        {config.footerInfo.rules || 'Ofertas válidas enquanto durarem os estoques.'}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Star size={14} className="text-blue-500" />
                                        Imagens ilustrativas.
                                    </div>
                                </div>
                            </div>
                            
                            {/* Graphic Overlay Backgrounds */}
                            <div className="absolute inset-0 z-0 opacity-10 mix-blend-overlay" style={{ backgroundImage: `url('/api/image-proxy?url=${encodeURIComponent('https://www.transparenttextures.com/patterns/cubes.png')}')` }}></div>
                        </div>
                    </div>
                    
                    {/* Botões Inferiores */}
                    <div className="bg-white p-4 border-t flex flex-col sm:flex-row justify-end gap-3 sm:gap-4 shrink-0">
                        <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 order-3 sm:order-1">
                            Cancelar
                        </button>
                        <button 
                            onClick={handleDownloadOnly} 
                            disabled={isGeneratingJPG} 
                            className="px-6 py-3 bg-slate-800 text-white rounded-xl font-black shadow-lg hover:bg-slate-950 transition-all flex items-center justify-center gap-3 disabled:opacity-50 order-2 sm:order-2"
                        >
                            {isGeneratingJPG ? <Loader2 size={20} className="animate-spin" /> : <Printer size={20} />} 
                            Apenas Baixar Imagem
                        </button>
                        <button 
                            onClick={handleShareWhatsApp} 
                            disabled={isGeneratingJPG} 
                            className="px-8 py-3 bg-green-600 text-white rounded-xl font-black shadow-lg hover:bg-green-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50 order-1 sm:order-3"
                        >
                            {isGeneratingJPG ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={20} />} 
                            Compartilhar no WhatsApp
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
