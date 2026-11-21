import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Download,
  Copy,
  Check,
  Share2,
  Search,
  Trash2,
  ArrowUp,
  ArrowDown,
  Smartphone,
  Layers,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RotateCcw,
  ExternalLink,
  MessageCircle,
  Tag,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PharmacyConfig, Product, PromotionRule } from '../types';
import { buildProductSlug, getStoreUrl } from '../lib/store';
import { appendOriginParam } from '../lib/orderOrigin';

interface AdminStoryGeneratorProps {
  products: Product[];
  tenant: PharmacyConfig;
  promotions?: PromotionRule[];
}

type StoryMode = 'single' | 'combo';
type StoryThemeId = 'flash' | 'health' | 'beauty' | 'dark';

interface StoryThemeConfig {
  id: StoryThemeId;
  name: string;
  subtitle: string;
  swatches: [string, string, string];
  bgStops: [string, string, string];
  patternColor: string;
  accentBg: string;
  accentText: string;
  headlineColor: string;
  headlineAccentBg: string;
  headlineAccentText: string;
  headerBg: string;
  headerBorder: string;
  headerText: string;
  headerSubtext: string;
  deliveryBadgeBg: string;
  deliveryBadgeText: string;
  cardBg: string;
  cardBorder: string;
  cardText: string;
  cardSubtext: string;
  priceHighlightBg: string;
  priceHighlightText: string;
  priceOldColor: string;
  discountBadgeBg: string;
  discountBadgeText: string;
  footerBg: string;
  footerText: string;
  footerSubtext: string;
  stickerGuideColor: string;
  isLightTheme: boolean;
}

const STORY_THEMES: Record<StoryThemeId, StoryThemeConfig> = {
  flash: {
    id: 'flash',
    name: 'Oferta Relâmpago',
    subtitle: 'Alta conversão varejo farma',
    swatches: ['#DC2626', '#FACC15', '#FFFFFF'],
    bgStops: ['#991B1B', '#DC2626', '#7F1D1D'],
    patternColor: 'rgba(255, 255, 255, 0.06)',
    accentBg: '#FACC15',
    accentText: '#111827',
    headlineColor: '#FEF08A',
    headlineAccentBg: '#FACC15',
    headlineAccentText: '#7F1D1D',
    headerBg: 'rgba(255, 255, 255, 0.14)',
    headerBorder: 'rgba(255, 255, 255, 0.24)',
    headerText: '#FFFFFF',
    headerSubtext: '#FEE2E2',
    deliveryBadgeBg: '#FACC15',
    deliveryBadgeText: '#7F1D1D',
    cardBg: '#FFFFFF',
    cardBorder: 'rgba(254, 240, 138, 0.45)',
    cardText: '#111827',
    cardSubtext: '#4B5563',
    priceHighlightBg: '#FACC15',
    priceHighlightText: '#7F1D1D',
    priceOldColor: '#6B7280',
    discountBadgeBg: '#111827',
    discountBadgeText: '#FACC15',
    footerBg: 'rgba(0, 0, 0, 0.24)',
    footerText: '#FFFFFF',
    footerSubtext: '#FEF08A',
    stickerGuideColor: 'rgba(255, 255, 255, 0.72)',
    isLightTheme: false,
  },
  health: {
    id: 'health',
    name: 'Saúde & Confiança',
    subtitle: 'Azul clínico e limpo',
    swatches: ['#0284C7', '#FFFFFF', '#10B981'],
    bgStops: ['#0C4A6E', '#0284C7', '#0369A1'],
    patternColor: 'rgba(255, 255, 255, 0.07)',
    accentBg: '#10B981',
    accentText: '#FFFFFF',
    headlineColor: '#FFFFFF',
    headlineAccentBg: '#38BDF8',
    headlineAccentText: '#082F49',
    headerBg: 'rgba(255, 255, 255, 0.14)',
    headerBorder: 'rgba(255, 255, 255, 0.25)',
    headerText: '#FFFFFF',
    headerSubtext: '#E0F2FE',
    deliveryBadgeBg: '#10B981',
    deliveryBadgeText: '#FFFFFF',
    cardBg: '#FFFFFF',
    cardBorder: 'rgba(186, 230, 253, 0.6)',
    cardText: '#0F172A',
    cardSubtext: '#475569',
    priceHighlightBg: '#0284C7',
    priceHighlightText: '#FFFFFF',
    priceOldColor: '#64748B',
    discountBadgeBg: '#10B981',
    discountBadgeText: '#FFFFFF',
    footerBg: 'rgba(8, 47, 73, 0.35)',
    footerText: '#FFFFFF',
    footerSubtext: '#BAE6FD',
    stickerGuideColor: 'rgba(224, 242, 254, 0.78)',
    isLightTheme: false,
  },
  beauty: {
    id: 'beauty',
    name: 'Perfumaria & Beleza',
    subtitle: 'Editorial claro e moderno',
    swatches: ['#FDF2F8', '#BE185D', '#D4A373'],
    bgStops: ['#FFFBF7', '#FDEEE8', '#F6DFD8'],
    patternColor: 'rgba(157, 23, 77, 0.045)',
    accentBg: '#9D174D',
    accentText: '#FFFFFF',
    headlineColor: '#831843',
    headlineAccentBg: '#9D174D',
    headlineAccentText: '#FFFFFF',
    headerBg: 'rgba(255, 255, 255, 0.85)',
    headerBorder: 'rgba(190, 24, 93, 0.14)',
    headerText: '#4A1D32',
    headerSubtext: '#9D174D',
    deliveryBadgeBg: '#9D174D',
    deliveryBadgeText: '#FFFFFF',
    cardBg: '#FFFFFF',
    cardBorder: 'rgba(190, 24, 93, 0.14)',
    cardText: '#1F2937',
    cardSubtext: '#6B7280',
    priceHighlightBg: '#9D174D',
    priceHighlightText: '#FFFFFF',
    priceOldColor: '#9CA3AF',
    discountBadgeBg: '#BE185D',
    discountBadgeText: '#FFFFFF',
    footerBg: 'rgba(157, 23, 77, 0.08)',
    footerText: '#4A1D32',
    footerSubtext: '#9D174D',
    stickerGuideColor: 'rgba(131, 24, 67, 0.55)',
    isLightTheme: true,
  },
  dark: {
    id: 'dark',
    name: 'Super Desconto / Dark',
    subtitle: 'Fundo escuro com destaque neon',
    swatches: ['#090D16', '#FDE047', '#A3E635'],
    bgStops: ['#050811', '#0F172A', '#020617'],
    patternColor: 'rgba(250, 204, 21, 0.055)',
    accentBg: '#FDE047',
    accentText: '#090D16',
    headlineColor: '#FDE047',
    headlineAccentBg: '#BEF264',
    headlineAccentText: '#090D16',
    headerBg: 'rgba(255, 255, 255, 0.07)',
    headerBorder: 'rgba(253, 224, 71, 0.22)',
    headerText: '#F8FAFC',
    headerSubtext: '#CBD5E1',
    deliveryBadgeBg: '#BEF264',
    deliveryBadgeText: '#090D16',
    cardBg: '#FFFFFF',
    cardBorder: 'rgba(253, 224, 71, 0.45)',
    cardText: '#0F172A',
    cardSubtext: '#475569',
    priceHighlightBg: '#FDE047',
    priceHighlightText: '#090D16',
    priceOldColor: '#64748B',
    discountBadgeBg: '#BEF264',
    discountBadgeText: '#090D16',
    footerBg: 'rgba(255, 255, 255, 0.07)',
    footerText: '#F8FAFC',
    footerSubtext: '#FDE047',
    stickerGuideColor: 'rgba(253, 224, 71, 0.65)',
    isLightTheme: false,
  },
};

const TITLE_PRESETS = [
  'OFERTA DO DIA',
  'SOU CLIENTE VIP',
  'ENTREGA RÁPIDA',
  'SUPER DESCONTO',
  'SÓ HOJE',
];

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

interface ResolvedPricing {
  finalPrice: number;
  originalPrice: number;
  hasDiscount: boolean;
  discountPercent: number;
}

const parseNumericPrice = (val: unknown): number => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const cleaned = String(val).replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveProductPricing = (
  product: Product,
  promotions: PromotionRule[] = []
): ResolvedPricing => {
  const salePrice = parseNumericPrice(product.price);
  const rawPromo =
    parseNumericPrice((product as any).promotional_price) ||
    parseNumericPrice(product.promotionalPrice) ||
    parseNumericPrice((product as any).promo_price);

  let effectivePrice =
    rawPromo > 0 && (salePrice <= 0 || rawPromo < salePrice) ? rawPromo : salePrice;

  // Considera Ofertas Relâmpago ativas vinculadas ao produto
  if (promotions.length > 0 && salePrice > 0) {
    const now = Date.now();
    for (const promo of promotions) {
      if (!promo || !promo.isActive || promo.type !== 'LIGHTNING_OFFER') continue;
      if (promo.startDate && new Date(promo.startDate).getTime() > now) continue;
      if (promo.endDate && new Date(promo.endDate).getTime() < now) continue;

      const pct = parseNumericPrice(promo.lightningDiscountPercentage);
      if (pct <= 0 || pct >= 100) continue;

      const targetVal = String(promo.targetValue || '').trim().toLowerCase();
      const matchesTarget =
        (promo.targetType === 'PRODUCT' && promo.targetValue === product.id) ||
        (promo.targetType === 'SPECIFIC_SELECTION' &&
          Array.isArray(promo.specificProductIds) &&
          promo.specificProductIds.includes(product.id)) ||
        (promo.targetType === 'CATEGORY' &&
          Boolean(product.category) &&
          product.category.trim().toLowerCase() === targetVal) ||
        (promo.targetType === 'MANUFACTURER' &&
          Boolean(product.manufacturer) &&
          product.manufacturer.trim().toLowerCase() === targetVal);

      if (!matchesTarget) continue;

      const candidate = Number((salePrice * (1 - pct / 100)).toFixed(2));
      if (candidate > 0 && candidate < effectivePrice) {
        effectivePrice = candidate;
      }
    }
  }

  const rawOriginal = Math.max(
    parseNumericPrice((product as any).original_price),
    parseNumericPrice(product.originalPrice),
    salePrice
  );

  const hasDiscount = rawOriginal > effectivePrice && effectivePrice > 0;
  const discountPercent = hasDiscount
    ? Math.round(((rawOriginal - effectivePrice) / rawOriginal) * 100)
    : 0;

  return {
    finalPrice: effectivePrice,
    originalPrice: rawOriginal,
    hasDiscount,
    discountPercent,
  };
};

const formatBRL = (value: number): string => {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0;
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const splitBRL = (value: number): { reais: string; centavos: string } => {
  const formatted = formatBRL(value);
  const [reais, centavos = '00'] = formatted.split(',');
  return { reais, centavos };
};

const formatPhoneBR = (raw?: string): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return raw || '';
};

const isUsableImageUrl = (url?: string | null): url is string => {
  if (!url) return false;
  const trimmed = String(url).trim();
  if (!trimmed || trimmed === 'IGNORE' || trimmed === 'PENDENTE_CURADORIA') return false;
  if (trimmed.includes('fLz8F3X.png')) return false;
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/') || trimmed.startsWith('/');
};

// Cache em memória de imagens já carregadas com CORS seguro para manter o preview fluido
const imageCache = new Map<string, HTMLImageElement | null>();

const loadSingleImage = (src: string, timeoutMs = 4500): Promise<HTMLImageElement | null> => {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;

    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        finish(img);
      } else {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = src;
  });
};

const loadImageSafe = async (rawUrl?: string | null): Promise<HTMLImageElement | null> => {
  if (!isUsableImageUrl(rawUrl)) return null;
  const key = rawUrl.trim();
  if (imageCache.has(key)) {
    return imageCache.get(key) || null;
  }

  // 1. Tenta carregar diretamente com crossOrigin="anonymous"
  const direct = await loadSingleImage(key, 4000);
  if (direct) {
    imageCache.set(key, direct);
    return direct;
  }

  // 2. Fallback via proxy CORS público já liberado no CSP/index.html (wsrv.nl)
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const proxiedUrl = `https://wsrv.nl/?url=${encodeURIComponent(key)}&output=png&w=900`;
    const proxied = await loadSingleImage(proxiedUrl, 4500);
    if (proxied) {
      imageCache.set(key, proxied);
      return proxied;
    }
  }

  imageCache.set(key, null);
  return null;
};

// Utilitários de desenho Canvas 2D
const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

const wrapTextLines = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] => {
  const words = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const test = `${current} ${words[i]}`;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        // Agrupa o restante na última linha e aplica reticências se necessário
        const rest = [current, ...words.slice(i + 1)].join(' ');
        let clipped = rest;
        while (clipped.length > 3 && ctx.measureText(`${clipped}…`).width > maxWidth) {
          clipped = clipped.slice(0, -1).trimEnd();
        }
        lines.push(clipped === rest ? rest : `${clipped}…`);
        return lines;
      }
    }
  }

  let finalLine = current;
  if (ctx.measureText(finalLine).width > maxWidth) {
    while (finalLine.length > 3 && ctx.measureText(`${finalLine}…`).width > maxWidth) {
      finalLine = finalLine.slice(0, -1).trimEnd();
    }
    finalLine = `${finalLine}…`;
  }
  lines.push(finalLine);
  return lines.slice(0, maxLines);
};

const drawImageContained = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  padding = 0
) => {
  const innerW = Math.max(10, boxW - padding * 2);
  const innerH = Math.max(10, boxH - padding * 2);
  const scale = Math.min(innerW / img.naturalWidth, innerH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;
  const drawX = boxX + (boxW - drawW) / 2;
  const drawY = boxY + (boxH - drawH) / 2;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
};

const drawFallbackProductArt = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tintColor: string
) => {
  ctx.save();
  drawRoundedRect(ctx, x, y, w, h, 28);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();

  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) * 0.22;

  ctx.strokeStyle = tintColor;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = Math.max(6, r * 0.18);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Cruz farmacêutica minimalista
  ctx.fillStyle = tintColor;
  ctx.globalAlpha = 0.28;
  const barLen = r * 1.1;
  const barThick = r * 0.36;
  drawRoundedRect(ctx, cx - barThick / 2, cy - barLen / 2, barThick, barLen, barThick / 2);
  ctx.fill();
  drawRoundedRect(ctx, cx - barLen / 2, cy - barThick / 2, barLen, barThick, barThick / 2);
  ctx.fill();
  ctx.restore();
};

const drawStoreMonogram = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  storeName: string,
  primaryColor: string
) => {
  ctx.save();
  drawRoundedRect(ctx, x, y, size, size, 24);
  ctx.fillStyle = primaryColor || '#10B981';
  ctx.fill();

  const initials = String(storeName || 'FF')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 ${Math.round(size * 0.42)}px "Plus Jakarta Sans", "Inter", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials || 'FF', x + size / 2, y + size / 2 + 2);
  ctx.restore();
};

export const AdminStoryGenerator: React.FC<AdminStoryGeneratorProps> = ({
  products,
  tenant,
  promotions = [],
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [mode, setMode] = useState<StoryMode>('single');
  const [themeId, setThemeId] = useState<StoryThemeId>('flash');
  const [headline, setHeadline] = useState<string>('OFERTA DO DIA');
  const [footerText, setFooterText] = useState<string>(
    'Peça agora pelo WhatsApp ou clique no link'
  );
  const [showDeliverySeal, setShowDeliverySeal] = useState<boolean>(true);
  const [showWhatsappInFooter, setShowWhatsappInFooter] = useState<boolean>(
    Boolean(tenant?.whatsapp)
  );
  const [showLinkGuide, setShowLinkGuide] = useState<boolean>(true);
  const [captionText, setCaptionText] = useState<string>('');

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'promo' | 'with_photo'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const [copiedState, setCopiedState] = useState<'idle' | 'link' | 'caption'>('idle');
  const [canNativeShare, setCanNativeShare] = useState<boolean>(false);

  const availableProducts = useMemo(() => {
    return (products || []).filter((p) => p && p.name && parseNumericPrice(p.price) > 0);
  }, [products]);

  // Seleciona automaticamente o melhor produto inicial (com desconto + foto, ou primeiro disponível)
  useEffect(() => {
    if (selectedIds.length > 0 || availableProducts.length === 0) return;

    const sortedInitial = [...availableProducts].sort((a, b) => {
      const pa = resolveProductPricing(a, promotions);
      const pb = resolveProductPricing(b, promotions);
      const scoreA = (pa.hasDiscount ? 4 : 0) + (isUsableImageUrl(a.image) ? 2 : 0) + (a.isFeatured ? 1 : 0);
      const scoreB = (pb.hasDiscount ? 4 : 0) + (isUsableImageUrl(b.image) ? 2 : 0) + (b.isFeatured ? 1 : 0);
      return scoreB - scoreA;
    });

    if (sortedInitial[0]) {
      setSelectedIds([sortedInitial[0].id]);
    }
  }, [availableProducts, promotions, selectedIds.length]);

  useEffect(() => {
    setCanNativeShare(
      typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    );
  }, []);

  const selectedProducts = useMemo(() => {
    const map = new Map(availableProducts.map((p) => [p.id, p]));
    return selectedIds
      .map((id) => map.get(id))
      .filter((p): p is Product => Boolean(p))
      .slice(0, mode === 'single' ? 1 : 3);
  }, [availableProducts, selectedIds, mode]);

  const filteredProducts = useMemo(() => {
    const term = searchTerm
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return availableProducts
      .filter((p) => {
        if (catalogFilter === 'promo') {
          const pricing = resolveProductPricing(p, promotions);
          if (!pricing.hasDiscount) return false;
        }
        if (catalogFilter === 'with_photo' && !isUsableImageUrl(p.image)) {
          return false;
        }
        if (!term) return true;

        const haystack = [
          p.name,
          p.internalCode,
          p.barcode,
          p.manufacturer,
          p.category,
          p.activePrinciple,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        return haystack.includes(term);
      })
      .slice(0, 60);
  }, [availableProducts, searchTerm, catalogFilter, promotions]);

  const handleModeChange = (nextMode: StoryMode) => {
    setMode(nextMode);
    if (nextMode === 'single' && selectedIds.length > 1) {
      setSelectedIds((prev) => prev.slice(0, 1));
    } else if (nextMode === 'combo' && selectedIds.length === 1 && availableProducts.length >= 2) {
      // Mantém a seleção atual; lojista escolhe livremente até 3 produtos
    }
  };

  const handleToggleProduct = (productId: string) => {
    if (mode === 'single') {
      setSelectedIds([productId]);
      return;
    }

    setSelectedIds((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      if (prev.length >= 3) {
        toast.info('O modo Combo aceita até 3 produtos por Story.', {
          description: 'Remova um item antes de adicionar outro.',
        });
        return prev;
      }
      return [...prev, productId];
    });
  };

  const handleMoveSelected = (index: number, direction: -1 | 1) => {
    setSelectedIds((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const handleRemoveSelected = (productId: string) => {
    setSelectedIds((prev) => prev.filter((id) => id !== productId));
  };

  // URL oficial de divulgação (subdomínio da loja + /produto/:productSlug quando 1 item) com tag ?origem=story
  const offerShareUrl = useMemo(() => {
    const baseStoreUrl = getStoreUrl(tenant).replace(/\/+$/, '');
    const rawUrl =
      selectedProducts.length === 1
        ? `${baseStoreUrl}/produto/${encodeURIComponent(buildProductSlug(selectedProducts[0]))}`
        : baseStoreUrl;
    return appendOriginParam(rawUrl, 'story');
  }, [tenant, selectedProducts]);

  // Legenda curta automática (máximo 120 caracteres, SEM link dentro)
  const MAX_CAPTION_LENGTH = 120;

  const autoShortCaption = useMemo(() => {
    const truncateClean = (text: string, maxChars: number): string => {
      const normalized = String(text || '').replace(/\s+/g, ' ').trim();
      if (maxChars <= 0) return '';
      if (normalized.length <= maxChars) return normalized;
      if (maxChars <= 3) return normalized.slice(0, maxChars);
      return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
    };

    const rawStoreName = (tenant?.name || 'nossa farmácia').replace(/\s+/g, ' ').trim();

    if (selectedProducts.length === 1) {
      const prod = selectedProducts[0];
      const pricing = resolveProductPricing(prod, promotions);
      const priceStr = formatBRL(pricing.finalPrice);

      let storeSafe = truncateClean(rawStoreName, 26);
      const prefix = '🔥 ';
      let suffix = ` por apenas R$ ${priceStr}! Peça agora com entrega rápida na ${storeSafe}. 📲`;

      let availableForProduct = MAX_CAPTION_LENGTH - prefix.length - suffix.length;
      if (availableForProduct < 16) {
        storeSafe = truncateClean(rawStoreName, 18);
        suffix = ` por apenas R$ ${priceStr}! Peça com entrega rápida na ${storeSafe}. 📲`;
        availableForProduct = MAX_CAPTION_LENGTH - prefix.length - suffix.length;
      }

      const shortProduct = truncateClean(prod.name, Math.max(8, availableForProduct));
      return `${prefix}${shortProduct}${suffix}`.slice(0, MAX_CAPTION_LENGTH);
    }

    if (selectedProducts.length > 1) {
      const storeSafe = truncateClean(rawStoreName, 24);
      const prefix = '🔥 Ofertas na ';
      const middle = ': ';
      const suffix = '! Peça agora com entrega rápida. 📲';
      const fixedLen = prefix.length + storeSafe.length + middle.length + suffix.length;
      const availableForList = MAX_CAPTION_LENGTH - fixedLen;
      const joinedNames = selectedProducts
        .map((p) => {
          const pricing = resolveProductPricing(p, promotions);
          const firstWords = String(p.name || '').trim().split(/\s+/).slice(0, 2).join(' ');
          return `${firstWords} R$ ${formatBRL(pricing.finalPrice)}`;
        })
        .join(' · ');

      const shortList = truncateClean(joinedNames, Math.max(12, availableForList));
      return `${prefix}${storeSafe}${middle}${shortList}${suffix}`.slice(0, MAX_CAPTION_LENGTH);
    }

    const storeSafe = truncateClean(rawStoreName, 36);
    return `🔥 Ofertas do dia na ${storeSafe}! Peça agora com entrega rápida. 📲`.slice(
      0,
      MAX_CAPTION_LENGTH
    );
  }, [tenant?.name, selectedProducts, promotions]);

  // Mantém a legenda sincronizada ao trocar produto(s) selecionado(s)
  useEffect(() => {
    setCaptionText(autoShortCaption);
  }, [autoShortCaption]);

  // Motor principal de renderização HTML5 Canvas (1080 x 1920 px)
  const renderStoryCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsRendering(true);
    const theme = STORY_THEMES[themeId];
    const storeName = tenant?.name || 'Minha Farmácia';
    const rawLogo = tenant?.logo || tenant?.logo_url || tenant?.logoUrl || '';
    const formattedPhone = formatPhoneBR(tenant?.whatsapp);

    // Pré-carrega logo e imagens dos produtos em paralelo (com fallback seguro CORS)
    const [logoImg, ...productImgs] = await Promise.all([
      loadImageSafe(rawLogo),
      ...selectedProducts.map((p) => loadImageSafe(p.image)),
    ]);

    // Limpa e desenha fundo gradiente 9:16
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_WIDTH * 0.4, CANVAS_HEIGHT);
    bgGrad.addColorStop(0, theme.bgStops[0]);
    bgGrad.addColorStop(0.52, theme.bgStops[1]);
    bgGrad.addColorStop(1, theme.bgStops[2]);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Geometria de fundo sob medida para cada tema (vetorial nítido)
    ctx.save();
    if (themeId === 'flash') {
      ctx.fillStyle = theme.patternColor;
      for (let i = -300; i < CANVAS_WIDTH + 600; i += 240) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 90, 0);
        ctx.lineTo(i - 420, CANVAS_HEIGHT);
        ctx.lineTo(i - 510, CANVAS_HEIGHT);
        ctx.closePath();
        ctx.fill();
      }
      // Halo suave central atrás do produto
      const halo = ctx.createRadialGradient(540, 820, 40, 540, 820, 520);
      halo.addColorStop(0, 'rgba(254, 240, 138, 0.22)');
      halo.addColorStop(1, 'rgba(254, 240, 138, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 260, CANVAS_WIDTH, 1120);
    } else if (themeId === 'health') {
      // Arcos suaves clínicos
      ctx.strokeStyle = theme.patternColor;
      ctx.lineWidth = 42;
      ctx.beginPath();
      ctx.arc(980, 240, 340, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(100, 1460, 410, 0, Math.PI * 2);
      ctx.stroke();
    } else if (themeId === 'beauty') {
      // Moldura editorial delicada + arcos botânicos suaves
      ctx.fillStyle = theme.patternColor;
      ctx.beginPath();
      ctx.arc(960, 180, 320, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(120, 1680, 360, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(157, 23, 77, 0.14)';
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, 36, 36, CANVAS_WIDTH - 72, CANVAS_HEIGHT - 72, 42);
      ctx.stroke();
    } else if (themeId === 'dark') {
      // Grade sutil + brilho de palco neon
      ctx.strokeStyle = theme.patternColor;
      ctx.lineWidth = 2;
      for (let gx = 0; gx <= CANVAS_WIDTH; gx += 90) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let gy = 0; gy <= CANVAS_HEIGHT; gy += 90) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(CANVAS_WIDTH, gy);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(540, 760, 60, 540, 760, 540);
      glow.addColorStop(0, 'rgba(253, 224, 71, 0.16)');
      glow.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 200, CANVAS_WIDTH, 1140);
    }
    ctx.restore();

    const fontStack = '"Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif';

    // === 1. CABEÇALHO COM IDENTIDADE DA FARMÁCIA (margem superior segura para Stories: y=72) ===
    const headerX = 72;
    const headerY = 74;
    const headerW = CANVAS_WIDTH - 144;
    const headerH = 148;

    ctx.save();
    drawRoundedRect(ctx, headerX, headerY, headerW, headerH, 34);
    ctx.fillStyle = theme.headerBg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.headerBorder;
    ctx.stroke();

    // Logo ou monograma
    const logoBoxSize = 104;
    const logoX = headerX + 24;
    const logoY = headerY + (headerH - logoBoxSize) / 2;

    if (logoImg) {
      drawRoundedRect(ctx, logoX, logoY, logoBoxSize, logoBoxSize, 24);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.save();
      drawRoundedRect(ctx, logoX, logoY, logoBoxSize, logoBoxSize, 24);
      ctx.clip();
      drawImageContained(ctx, logoImg, logoX, logoY, logoBoxSize, logoBoxSize, 10);
      ctx.restore();
    } else {
      drawStoreMonogram(ctx, logoX, logoY, logoBoxSize, storeName, tenant?.primaryColor || '#10B981');
    }

    // Nome da farmácia + selo Entrega Rápida
    const textStartX = logoX + logoBoxSize + 28;
    const sealW = showDeliverySeal ? 248 : 0;
    const maxNameW = headerW - (logoBoxSize + 76) - (showDeliverySeal ? sealW + 18 : 0);

    ctx.fillStyle = theme.headerText;
    ctx.font = `800 36px ${fontStack}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const nameLines = wrapTextLines(ctx, storeName, maxNameW, 2);
    if (nameLines.length === 1) {
      ctx.fillText(nameLines[0], textStartX, headerY + headerH / 2 - 14);
      ctx.fillStyle = theme.headerSubtext;
      ctx.font = `600 23px ${fontStack}`;
      const locationText = [tenant?.neighborhood, tenant?.city].filter(Boolean).join(' • ') || 'Farmácia Online';
      ctx.fillText(
        wrapTextLines(ctx, locationText, maxNameW, 1)[0] || '',
        textStartX,
        headerY + headerH / 2 + 24
      );
    } else {
      ctx.fillText(nameLines[0], textStartX, headerY + headerH / 2 - 22);
      ctx.fillText(nameLines[1], textStartX, headerY + headerH / 2 + 22);
    }

    // Selo "Entrega Rápida"
    if (showDeliverySeal) {
      const sealH = 60;
      const sealX = headerX + headerW - sealW - 22;
      const sealY = headerY + (headerH - sealH) / 2;
      drawRoundedRect(ctx, sealX, sealY, sealW, sealH, 30);
      ctx.fillStyle = theme.deliveryBadgeBg;
      ctx.fill();

      // Ícone de raio simples vetorial
      ctx.fillStyle = theme.deliveryBadgeText;
      ctx.beginPath();
      ctx.moveTo(sealX + 34, sealY + 15);
      ctx.lineTo(sealX + 20, sealY + 33);
      ctx.lineTo(sealX + 31, sealY + 33);
      ctx.lineTo(sealX + 26, sealY + 46);
      ctx.lineTo(sealX + 41, sealY + 27);
      ctx.lineTo(sealX + 30, sealY + 27);
      ctx.closePath();
      ctx.fill();

      ctx.font = `800 22px ${fontStack}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('ENTREGA RÁPIDA', sealX + 49, sealY + sealH / 2 + 1);
    }
    ctx.restore();

    // === 2. TÍTULO DO TOPO ===
    const displayHeadline = (headline.trim() || 'OFERTA DO DIA').toUpperCase();
    ctx.save();
    let headlineSize = 76;
    ctx.font = `900 ${headlineSize}px ${fontStack}`;
    while (ctx.measureText(displayHeadline).width > CANVAS_WIDTH - 144 && headlineSize > 44) {
      headlineSize -= 4;
      ctx.font = `900 ${headlineSize}px ${fontStack}`;
    }

    const headlineY = 294;
    // Faixa sutil ou sombra para destaque editorial
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!theme.isLightTheme) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
    }
    ctx.fillStyle = theme.headlineColor;
    ctx.fillText(displayHeadline, CANVAS_WIDTH / 2, headlineY);
    ctx.restore();

    // Linha decorativa minimalista abaixo do título
    ctx.save();
    drawRoundedRect(ctx, CANVAS_WIDTH / 2 - 90, 344, 180, 8, 4);
    ctx.fillStyle = theme.accentBg;
    ctx.fill();
    ctx.restore();

    // === 3. CONTEÚDO CENTRAL (DESTAQUE ÚNICO OU COMBO ATÉ 3 PRODUTOS) ===
    if (selectedProducts.length === 0) {
      // Estado vazio elegante no canvas
      ctx.save();
      drawRoundedRect(ctx, 84, 420, CANVAS_WIDTH - 168, 960, 44);
      ctx.fillStyle = theme.cardBg;
      ctx.fill();
      ctx.fillStyle = theme.cardSubtext;
      ctx.font = `700 38px ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Selecione um produto ao lado', CANVAS_WIDTH / 2, 880);
      ctx.font = `500 28px ${fontStack}`;
      ctx.fillText('para visualizar sua arte em 9:16', CANVAS_WIDTH / 2, 940);
      ctx.restore();
    } else if (mode === 'single' || selectedProducts.length === 1) {
      const product = selectedProducts[0];
      const productImg = productImgs[0];
      const pricing = resolveProductPricing(product, promotions);

      // Card principal branco centralizado
      const cardX = 76;
      const cardY = 392;
      const cardW = CANVAS_WIDTH - 152;
      const cardH = 1044;

      ctx.save();
      ctx.shadowColor = theme.isLightTheme
        ? 'rgba(131, 24, 67, 0.12)'
        : 'rgba(0, 0, 0, 0.32)';
      ctx.shadowBlur = 46;
      ctx.shadowOffsetY = 20;
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 48);
      ctx.fillStyle = theme.cardBg;
      ctx.fill();
      ctx.restore();

      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 48);
      ctx.lineWidth = 4;
      ctx.strokeStyle = theme.cardBorder;
      ctx.stroke();
      ctx.restore();

      // Área da foto do produto (grande e limpa)
      const imgAreaX = cardX + 54;
      const imgAreaY = cardY + 46;
      const imgAreaW = cardW - 108;
      const imgAreaH = 510;

      ctx.save();
      drawRoundedRect(ctx, imgAreaX, imgAreaY, imgAreaW, imgAreaH, 34);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // Piso radial suave para destacar embalagens brancas
      const floorGrad = ctx.createRadialGradient(
        imgAreaX + imgAreaW / 2,
        imgAreaY + imgAreaH - 36,
        20,
        imgAreaX + imgAreaW / 2,
        imgAreaY + imgAreaH - 36,
        290
      );
      floorGrad.addColorStop(0, 'rgba(15, 23, 42, 0.08)');
      floorGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(imgAreaX, imgAreaY + imgAreaH - 120, imgAreaW, 120);

      if (productImg) {
        drawImageContained(ctx, productImg, imgAreaX, imgAreaY, imgAreaW, imgAreaH, 22);
      } else {
        drawFallbackProductArt(ctx, imgAreaX, imgAreaY, imgAreaW, imgAreaH, theme.accentBg);
      }
      ctx.restore();

      // Selo de Desconto (-XX% OFF) no canto superior direito do palco
      if (pricing.hasDiscount && pricing.discountPercent >= 1) {
        const badgeW = 248;
        const badgeH = 92;
        const badgeX = cardX + cardW - badgeW - 34;
        const badgeY = cardY + 34;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 8;
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 26);
        ctx.fillStyle = theme.discountBadgeBg;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = theme.discountBadgeText;
        ctx.font = `900 40px ${fontStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`-${pricing.discountPercent}% OFF`, badgeX + badgeW / 2, badgeY + badgeH / 2 + 2);
        ctx.restore();
      }

      // Divisor sutil entre foto e informações
      ctx.save();
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.07)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cardX + 64, cardY + 576);
      ctx.lineTo(cardX + cardW - 64, cardY + 576);
      ctx.stroke();
      ctx.restore();

      // Nome do Produto (até 2 linhas bem ajustadas)
      ctx.save();
      ctx.fillStyle = theme.cardText;
      ctx.font = `800 44px ${fontStack}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const titleLines = wrapTextLines(ctx, product.name, cardW - 110, 2);
      const titleCenterY = titleLines.length === 1 ? cardY + 640 : cardY + 628;
      titleLines.forEach((line, idx) => {
        ctx.fillText(line, CANVAS_WIDTH / 2, titleCenterY + idx * 54);
      });

      // Subtítulo discreto (fabricante ou apresentação)
      const subtitle = [product.manufacturer, product.presentation]
        .filter((v) => v && String(v).trim().length > 0)
        .join(' · ');
      if (subtitle) {
        ctx.fillStyle = theme.cardSubtext;
        ctx.font = `600 26px ${fontStack}`;
        const subLine = wrapTextLines(ctx, subtitle, cardW - 140, 1)[0] || '';
        ctx.fillText(subLine, CANVAS_WIDTH / 2, titleLines.length === 1 ? cardY + 694 : cardY + 728);
      }
      ctx.restore();

      // Bloco de Preço Gigante
      const priceBoxX = cardX + 54;
      const priceBoxW = cardW - 108;
      const priceBoxH = 228;
      const priceBoxY = cardY + cardH - priceBoxH - 46;

      ctx.save();
      drawRoundedRect(ctx, priceBoxX, priceBoxY, priceBoxW, priceBoxH, 34);
      ctx.fillStyle = theme.priceHighlightBg;
      ctx.fill();

      // Preço "De R$ XX,XX" riscado
      const { reais, centavos } = splitBRL(pricing.finalPrice);
      const priceCenterY = pricing.hasDiscount ? priceBoxY + 144 : priceBoxY + 124;

      if (pricing.hasDiscount) {
        const oldLabel = `De R$ ${formatBRL(pricing.originalPrice)}`;
        ctx.fillStyle = theme.priceHighlightText;
        ctx.globalAlpha = 0.78;
        ctx.font = `700 32px ${fontStack}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const oldY = priceBoxY + 48;
        ctx.fillText(oldLabel, CANVAS_WIDTH / 2, oldY);

        const oldWidth = ctx.measureText(oldLabel).width;
        ctx.strokeStyle = theme.priceHighlightText;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(CANVAS_WIDTH / 2 - oldWidth / 2 - 8, oldY);
        ctx.lineTo(CANVAS_WIDTH / 2 + oldWidth / 2 + 8, oldY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // "POR R$ XX,XX" em destaque gigante
      ctx.fillStyle = theme.priceHighlightText;
      ctx.textBaseline = 'alphabetic';

      const prefixText = pricing.hasDiscount ? 'POR R$ ' : 'R$ ';
      ctx.font = `800 44px ${fontStack}`;
      const prefixW = ctx.measureText(prefixText).width;

      const mainFontSize = reais.length >= 4 ? 106 : 124;
      ctx.font = `900 ${mainFontSize}px ${fontStack}`;
      const reaisW = ctx.measureText(reais).width;

      const centsText = `,${centavos}`;
      ctx.font = `900 58px ${fontStack}`;
      const centsW = ctx.measureText(centsText).width;

      const totalW = prefixW + reaisW + centsW;
      let cursorX = CANVAS_WIDTH / 2 - totalW / 2;

      ctx.textAlign = 'left';
      ctx.font = `800 44px ${fontStack}`;
      ctx.fillText(prefixText, cursorX, priceCenterY - 12);
      cursorX += prefixW;

      ctx.font = `900 ${mainFontSize}px ${fontStack}`;
      ctx.fillText(reais, cursorX, priceCenterY + 18);
      cursorX += reaisW;

      ctx.font = `900 58px ${fontStack}`;
      ctx.fillText(centsText, cursorX, priceCenterY - 26);
      ctx.restore();
    } else {
      // === MODO COMBO / MINI-ENCARTE (2 OU 3 PRODUTOS EM CARDS VERTICAIS) ===
      const count = selectedProducts.length;
      const listStartY = 394;
      const listAvailableH = 1044;
      const gap = count === 2 ? 38 : 28;
      const itemH = count === 2 ? 440 : Math.floor((listAvailableH - gap * (count - 1)) / count);
      const totalStackH = itemH * count + gap * (count - 1);
      const startY = listStartY + Math.floor((listAvailableH - totalStackH) / 2);
      const cardX = 72;
      const cardW = CANVAS_WIDTH - 144;

      selectedProducts.forEach((product, idx) => {
        const productImg = productImgs[idx];
        const pricing = resolveProductPricing(product, promotions);
        const y = startY + idx * (itemH + gap);

        // Card do item
        ctx.save();
        ctx.shadowColor = theme.isLightTheme
          ? 'rgba(131, 24, 67, 0.1)'
          : 'rgba(0, 0, 0, 0.28)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetY = 12;
        drawRoundedRect(ctx, cardX, y, cardW, itemH, 36);
        ctx.fillStyle = theme.cardBg;
        ctx.fill();
        ctx.restore();

        ctx.save();
        drawRoundedRect(ctx, cardX, y, cardW, itemH, 36);
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.cardBorder;
        ctx.stroke();
        ctx.restore();

        // Miniatura quadrada à esquerda
        const thumbSize = itemH - 52;
        const thumbX = cardX + 26;
        const thumbY = y + 26;

        ctx.save();
        drawRoundedRect(ctx, thumbX, thumbY, thumbSize, thumbSize, 26);
        ctx.fillStyle = '#F8FAFC';
        ctx.fill();
        ctx.clip();
        if (productImg) {
          drawImageContained(ctx, productImg, thumbX, thumbY, thumbSize, thumbSize, 14);
        } else {
          drawFallbackProductArt(ctx, thumbX, thumbY, thumbSize, thumbSize, theme.accentBg);
        }
        ctx.restore();

        // Selo de desconto na miniatura se houver
        if (pricing.hasDiscount && pricing.discountPercent >= 1) {
          const tagW = 132;
          const tagH = 44;
          ctx.save();
          drawRoundedRect(ctx, thumbX + 10, thumbY + 10, tagW, tagH, 14);
          ctx.fillStyle = theme.discountBadgeBg;
          ctx.fill();
          ctx.fillStyle = theme.discountBadgeText;
          ctx.font = `900 22px ${fontStack}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`-${pricing.discountPercent}%`, thumbX + 10 + tagW / 2, thumbY + 10 + tagH / 2 + 1);
          ctx.restore();
        }

        // Informações à direita
        const infoX = thumbX + thumbSize + 32;
        const infoW = cardX + cardW - infoX - 32;

        ctx.save();
        ctx.fillStyle = theme.cardText;
        const nameFontSize = count === 2 ? 36 : 33;
        ctx.font = `800 ${nameFontSize}px ${fontStack}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const lines = wrapTextLines(ctx, product.name, infoW, 2);
        lines.forEach((line, lIdx) => {
          ctx.fillText(line, infoX, y + 36 + lIdx * (nameFontSize + 8));
        });

        const subtitle = product.manufacturer || product.presentation || '';
        if (subtitle) {
          ctx.fillStyle = theme.cardSubtext;
          ctx.font = `600 22px ${fontStack}`;
          const sub = wrapTextLines(ctx, subtitle, infoW, 1)[0] || '';
          ctx.fillText(sub, infoX, y + 36 + lines.length * (nameFontSize + 8) + 8);
        }

        // Preço em destaque na base do card
        const pillH = count === 2 ? 96 : 84;
        const pillY = y + itemH - pillH - 26;

        if (pricing.hasDiscount) {
          const oldStr = `De R$ ${formatBRL(pricing.originalPrice)}`;
          ctx.fillStyle = theme.priceOldColor;
          ctx.font = `700 25px ${fontStack}`;
          ctx.textBaseline = 'bottom';
          const oldY = pillY - 10;
          ctx.fillText(oldStr, infoX + 6, oldY);
          const oldW = ctx.measureText(oldStr).width;
          ctx.strokeStyle = theme.priceOldColor;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(infoX + 4, oldY - 12);
          ctx.lineTo(infoX + 8 + oldW, oldY - 12);
          ctx.stroke();
        }

        const { reais, centavos } = splitBRL(pricing.finalPrice);
        drawRoundedRect(ctx, infoX, pillY, Math.min(infoW, 380), pillH, 22);
        ctx.fillStyle = theme.priceHighlightBg;
        ctx.fill();

        ctx.fillStyle = theme.priceHighlightText;
        ctx.textBaseline = 'alphabetic';
        const baseY = pillY + pillH - (count === 2 ? 22 : 18);
        let px = infoX + 26;

        ctx.font = `800 30px ${fontStack}`;
        ctx.fillText('R$ ', px, baseY - 6);
        px += ctx.measureText('R$ ').width;

        const rSize = count === 2 ? 64 : 56;
        ctx.font = `900 ${rSize}px ${fontStack}`;
        ctx.fillText(reais, px, baseY);
        px += ctx.measureText(reais).width;

        ctx.font = `900 34px ${fontStack}`;
        ctx.fillText(`,${centavos}`, px, baseY - 18);
        ctx.restore();
      });
    }

    // === 4. RODAPÉ CURTO + ÁREA LIMPA RESERVADA PARA FIGURINHA DE LINK DO INSTAGRAM ===
    const footerBoxX = 76;
    const footerBoxY = 1484;
    const footerBoxW = CANVAS_WIDTH - 152;
    const footerBoxH = showWhatsappInFooter && formattedPhone ? 156 : 124;

    ctx.save();
    drawRoundedRect(ctx, footerBoxX, footerBoxY, footerBoxW, footerBoxH, 30);
    ctx.fillStyle = theme.footerBg;
    ctx.fill();

    ctx.fillStyle = theme.footerText;
    ctx.font = `700 30px ${fontStack}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cleanFooter = footerText.trim() || 'Peça agora pelo WhatsApp ou clique no link';
    const footerLines = wrapTextLines(ctx, cleanFooter, footerBoxW - 64, 2);

    if (showWhatsappInFooter && formattedPhone) {
      if (footerLines.length === 1) {
        ctx.fillText(footerLines[0], CANVAS_WIDTH / 2, footerBoxY + 48);
      } else {
        ctx.fillText(footerLines[0], CANVAS_WIDTH / 2, footerBoxY + 36);
        ctx.fillText(footerLines[1], CANVAS_WIDTH / 2, footerBoxY + 72);
      }
      ctx.fillStyle = theme.footerSubtext;
      ctx.font = `800 32px ${fontStack}`;
      ctx.fillText(`WhatsApp: ${formattedPhone}`, CANVAS_WIDTH / 2, footerBoxY + footerBoxH - 36);
    } else {
      const startFY = footerLines.length === 1 ? footerBoxY + footerBoxH / 2 : footerBoxY + 42;
      footerLines.forEach((line, i) => {
        ctx.fillText(line, CANVAS_WIDTH / 2, startFY + i * 38);
      });
    }
    ctx.restore();

    // Área inferior (y = 1668 até 1920 = 252px livres) intencionalmente limpa para o sticker de Link do Instagram
    setIsRendering(false);
  }, [
    themeId,
    tenant,
    selectedProducts,
    promotions,
    headline,
    footerText,
    showDeliverySeal,
    showWhatsappInFooter,
    mode,
  ]);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      renderStoryCanvas();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [renderStoryCanvas]);

  const exportCanvasToBlob = async (): Promise<Blob | null> => {
    await renderStoryCanvas();
    const canvas = canvasRef.current;
    if (!canvas) return null;

    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => resolve(blob), 'image/png', 1.0);
      } catch (err) {
        console.error('[StoryGenerator] Erro ao exportar canvas:', err);
        resolve(null);
      }
    });
  };

  const buildFileName = (): string => {
    const storeSlug = (tenant?.slug || tenant?.name || 'farmacia')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (selectedProducts.length === 1) {
      return `story-${buildProductSlug(selectedProducts[0])}.png`;
    }
    return `story-combo-${storeSlug || 'ofertas'}.png`;
  };

  const handleDownloadPng = async () => {
    if (selectedProducts.length === 0) {
      toast.error('Selecione pelo menos 1 produto para gerar o Story.');
      return;
    }
    setIsExporting(true);
    try {
      const blob = await exportCanvasToBlob();
      if (!blob) {
        toast.error('Não foi possível gerar o arquivo PNG. Tente novamente.');
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = buildFileName();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);

      toast.success('Story 1080×1920 baixado com sucesso!', {
        description: 'Pronto para publicar no Instagram Stories ou Status do WhatsApp.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(offerShareUrl);
      setCopiedState('link');
      toast.success('Link copiado!', {
        description: 'URL limpa pronta para colar na figurinha de Link do Instagram Stories.',
      });
      window.setTimeout(() => setCopiedState('idle'), 2400);
    } catch {
      toast.error('Não foi possível copiar o link automaticamente.');
    }
  };

  const handleCopyCaption = async () => {
    const cleanCaption = captionText.trim().slice(0, MAX_CAPTION_LENGTH);
    if (!cleanCaption) {
      toast.error('A legenda está vazia.');
      return;
    }
    try {
      await navigator.clipboard.writeText(cleanCaption);
      setCopiedState('caption');
      toast.success('Legenda copiada!', {
        description: 'Texto curto (sem link) pronto para colar no Story ou Status do WhatsApp.',
      });
      window.setTimeout(() => setCopiedState('idle'), 2400);
    } catch {
      toast.error('Não foi possível copiar a legenda automaticamente.');
    }
  };

  const handleNativeShare = async () => {
    if (selectedProducts.length === 0) {
      toast.error('Selecione pelo menos 1 produto antes de compartilhar.');
      return;
    }
    setIsSharing(true);
    try {
      const blob = await exportCanvasToBlob();
      if (!blob) {
        toast.error('Falha ao preparar a imagem para compartilhamento.');
        return;
      }

      const file = new File([blob], buildFileName(), { type: 'image/png' });
      const shortCaption = captionText.trim().slice(0, MAX_CAPTION_LENGTH);
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };

      if (nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: headline.trim() || tenant?.name || 'Oferta',
          text: shortCaption,
          url: offerShareUrl,
        });
      } else {
        await navigator.share({
          title: headline.trim() || tenant?.name || 'Oferta',
          text: shortCaption,
          url: offerShareUrl,
        });
        toast.info('Seu navegador compartilhou a legenda e o link.', {
          description: 'Use "Baixar Story" para salvar a imagem na galeria.',
        });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        toast.error('Não foi possível abrir o compartilhamento neste dispositivo.');
      }
    } finally {
      setIsSharing(false);
    }
  };

  const handleResetTexts = () => {
    setHeadline('OFERTA DO DIA');
    setFooterText('Peça agora pelo WhatsApp ou clique no link');
    setShowDeliverySeal(true);
    setShowWhatsappInFooter(Boolean(tenant?.whatsapp));
    setCaptionText(autoShortCaption);
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300">
      {/* Cabeçalho do Módulo */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <p className="text-xs font-semibold text-gray-500">
            Divulgação · Instagram Stories e Status do WhatsApp · 1080×1920 (9:16)
          </p>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-gray-900 mt-1">
            Gerador de Stories
          </h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Crie artes prontas com os produtos do seu estoque, identidade da farmácia e link direto para vender mais todos os dias.
          </p>
        </div>

        <button
          type="button"
          onClick={handleResetTexts}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:text-gray-900 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <RotateCcw size={14} />
          Restaurar Textos
        </button>
      </div>

      {/* Layout Principal: Controles (esquerda) + Preview Celular 9:16 (direita) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* COLUNA ESQUERDA: Controles de Criação */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Modo da Arte + Seleção de Produtos */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">1. Modo e Produtos da Oferta</h2>
                <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                  {availableProducts.length} produtos disponíveis no estoque
                  {selectedProducts.length > 0 && ` · ${selectedProducts.length} selecionado(s)`}
                </p>
              </div>

              {/* Segmented Control */}
              <div className="inline-flex p-1 bg-gray-100 rounded-xl shrink-0 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => handleModeChange('single')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    mode === 'single'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Smartphone size={14} />
                  Destaque Único (1)
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('combo')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    mode === 'combo'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Layers size={14} />
                  Combo / Encarte (até 3)
                </button>
              </div>
            </div>

            {/* Itens Atualmente Selecionados */}
            {selectedProducts.length > 0 && (
              <div className="border-t border-gray-100 pt-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
                  <span>
                    {mode === 'single' ? 'Produto em destaque' : `Itens no Combo (${selectedProducts.length}/3)`}
                  </span>
                  {selectedProducts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSelectedIds([])}
                      className="text-red-600 hover:text-red-700 font-bold"
                    >
                      Limpar seleção
                    </button>
                  )}
                </div>

                <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-gray-50/60">
                  {selectedProducts.map((prod, idx) => {
                    const pricing = resolveProductPricing(prod, promotions);
                    return (
                      <div
                        key={prod.id}
                        className="flex items-center gap-3 px-3.5 py-2.5 bg-white"
                      >
                        <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                          {isUsableImageUrl(prod.image) ? (
                            <img
                              src={prod.image}
                              alt={prod.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-contain p-0.5"
                            />
                          ) : (
                            <ImageIcon size={16} className="text-gray-300" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-gray-900 truncate">{prod.name}</p>
                          <p className="text-xs text-gray-500 tabular-nums mt-0.5">
                            <span className="font-bold text-emerald-700">
                              R$ {formatBRL(pricing.finalPrice)}
                            </span>
                            {pricing.hasDiscount && (
                              <>
                                <span className="mx-1.5 text-gray-300">·</span>
                                <span className="line-through text-gray-400">
                                  R$ {formatBRL(pricing.originalPrice)}
                                </span>
                                <span className="mx-1.5 text-gray-300">·</span>
                                <span className="font-semibold text-red-600">
                                  -{pricing.discountPercent}%
                                </span>
                              </>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {mode === 'combo' && selectedProducts.length > 1 && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleMoveSelected(idx, -1)}
                                disabled={idx === 0}
                                title="Mover para cima"
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              >
                                <ArrowUp size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveSelected(idx, 1)}
                                disabled={idx === selectedProducts.length - 1}
                                title="Mover para baixo"
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                              >
                                <ArrowDown size={14} />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveSelected(prod.id)}
                            title="Remover"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Busca e Filtros no Estoque */}
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar produto por nome, código, EAN ou marca..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-gray-900 focus:outline-none transition-colors"
                  />
                </div>

                <div className="inline-flex p-1 bg-gray-100 rounded-xl shrink-0">
                  {[
                    { id: 'all', label: 'Todos' },
                    { id: 'promo', label: 'Promoções' },
                    { id: 'with_photo', label: 'Com Foto' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setCatalogFilter(f.id as any)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                        catalogFilter === f.id
                          ? 'bg-white text-gray-900 shadow-xs'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lista Compacta de Produtos */}
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[260px] overflow-y-auto divide-y divide-gray-100">
                {filteredProducts.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-sm font-bold text-gray-700">Nenhum produto encontrado</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Tente limpar o filtro ou buscar por outro termo do seu estoque.
                    </p>
                  </div>
                ) : (
                  filteredProducts.map((prod) => {
                    const isSelected = selectedIds.includes(prod.id);
                    const pricing = resolveProductPricing(prod, promotions);

                    return (
                      <button
                        key={prod.id}
                        type="button"
                        onClick={() => handleToggleProduct(prod.id)}
                        className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors ${
                          isSelected
                            ? 'bg-emerald-50/70 hover:bg-emerald-50'
                            : 'bg-white hover:bg-gray-50'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                          {isUsableImageUrl(prod.image) ? (
                            <img
                              src={prod.image}
                              alt={prod.name}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="w-full h-full object-contain p-0.5"
                            />
                          ) : (
                            <ImageIcon size={16} className="text-gray-300" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-gray-900 truncate">{prod.name}</p>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5 tabular-nums">
                            {prod.internalCode ? `Cód. ${prod.internalCode}` : prod.category || 'Produto'}
                            {' · '}
                            Estoque: {prod.stock}
                            {prod.manufacturer ? ` · ${prod.manufacturer}` : ''}
                          </p>
                        </div>

                        <div className="text-right shrink-0 tabular-nums">
                          {pricing.hasDiscount && (
                            <p className="text-[11px] text-gray-400 line-through">
                              R$ {formatBRL(pricing.originalPrice)}
                            </p>
                          )}
                          <p className="text-xs font-black text-gray-900">
                            R$ {formatBRL(pricing.finalPrice)}
                          </p>
                        </div>

                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {isSelected ? <Check size={14} /> : <Plus size={14} />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* 2. Temas Visuais Prontos (1 Clique) */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">2. Tema Visual</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Escolha o estilo pronto com 1 clique. As cores e contrastes se ajustam automaticamente.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.values(STORY_THEMES) as StoryThemeConfig[]).map((t) => {
                const active = themeId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setThemeId(t.id)}
                    className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border text-left transition-all ${
                      active
                        ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{t.name}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{t.subtitle}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {t.swatches.map((hex, i) => (
                        <span
                          key={i}
                          className="w-4 h-4 rounded-full border border-black/15"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Textos e Identidade na Arte */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-gray-900">3. Textos e Identidade</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                A logo e o nome de {tenant?.name || 'sua farmácia'} entram automaticamente no topo da arte.
              </p>
            </div>

            <div className="space-y-2.5">
              <label
                htmlFor="story-headline-input"
                className="block text-xs font-bold text-gray-700"
              >
                Título do Topo
              </label>
              <input
                id="story-headline-input"
                type="text"
                maxLength={32}
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Ex: OFERTA DO DIA"
                className="w-full px-4 py-2.5 text-sm font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-gray-900 focus:outline-none"
              />
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {TITLE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setHeadline(preset)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors whitespace-nowrap ${
                      headline.toUpperCase() === preset
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="story-footer-input"
                className="block text-xs font-bold text-gray-700"
              >
                Texto Curto de Rodapé
              </label>
              <input
                id="story-footer-input"
                type="text"
                maxLength={78}
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="Ex: Peça agora pelo WhatsApp ou clique no link"
                className="w-full px-4 py-2.5 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-gray-900 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1 border-t border-gray-100">
              <label className="inline-flex items-center gap-2.5 text-xs font-semibold text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showDeliverySeal}
                  onChange={(e) => setShowDeliverySeal(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-gray-900"
                />
                Exibir selo &ldquo;Entrega Rápida&rdquo;
              </label>

              {tenant?.whatsapp && (
                <label className="inline-flex items-center gap-2.5 text-xs font-semibold text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showWhatsappInFooter}
                    onChange={(e) => setShowWhatsappInFooter(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 accent-gray-900"
                  />
                  Exibir WhatsApp ({formatPhoneBR(tenant.whatsapp)})
                </label>
              )}
            </div>
          </section>

          {/* 4. Link Limpo & Legenda Curta (máx. 120 caracteres) */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  4. Link da Oferta e Legenda Curta
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Copie o link limpo para a figurinha de Link do Instagram e a legenda curta separadamente.
                </p>
              </div>
              <a
                href={offerShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-gray-900 whitespace-nowrap shrink-0"
              >
                Abrir link
                <ExternalLink size={13} />
              </a>
            </div>

            {/* URL Limpa */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700">
                  {selectedProducts.length === 1
                    ? 'Link Direto do Produto (Figurinha de Link)'
                    : 'Link da Vitrine da Farmácia (Figurinha de Link)'}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl">
                <Tag size={14} className="text-gray-400 shrink-0" />
                <span className="text-xs font-mono text-gray-700 truncate select-all flex-1">
                  {offerShareUrl}
                </span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 whitespace-nowrap shrink-0 transition-colors"
                >
                  {copiedState === 'link' ? (
                    <>
                      <Check size={13} className="text-emerald-600" />
                      <span className="text-emerald-700">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Link2 size={13} />
                      <span>Copiar Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Legenda Curta Editável (máx. 120 caracteres, sem link) */}
            <div className="space-y-2 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="story-caption-input"
                  className="text-xs font-bold text-gray-700"
                >
                  Legenda Curta da Oferta (sem link)
                </label>
                <div className="flex items-center gap-3">
                  {captionText !== autoShortCaption && (
                    <button
                      type="button"
                      onClick={() => setCaptionText(autoShortCaption)}
                      className="text-[11px] font-bold text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      Restaurar automática
                    </button>
                  )}
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      captionText.length >= MAX_CAPTION_LENGTH
                        ? 'text-red-600'
                        : captionText.length >= 105
                        ? 'text-amber-600'
                        : 'text-gray-500'
                    }`}
                  >
                    {captionText.length}/{MAX_CAPTION_LENGTH} caracteres
                  </span>
                </div>
              </div>

              <textarea
                id="story-caption-input"
                rows={2}
                maxLength={MAX_CAPTION_LENGTH}
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
                placeholder="Digite a legenda curta da oferta (máx. 120 caracteres)..."
                className="w-full px-3.5 py-2.5 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-gray-900 focus:outline-none resize-none leading-relaxed"
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCopyCaption}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 whitespace-nowrap transition-colors"
                >
                  {copiedState === 'caption' ? (
                    <>
                      <Check size={13} className="text-emerald-600" />
                      <span className="text-emerald-700">Legenda Copiada</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copiar Legenda</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* COLUNA DIREITA: Preview Fiel em Formato Celular (9:16) + Ações de Exportação */}
        <div className="lg:col-span-5 lg:sticky lg:top-6 space-y-5">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col items-center">
            <div className="w-full flex items-center justify-between gap-2 mb-4">
              <div className="text-xs text-gray-500 font-medium tabular-nums">
                Preview ao vivo · 1080×1920px
              </div>
              <button
                type="button"
                onClick={() => setShowLinkGuide((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 whitespace-nowrap"
              >
                {showLinkGuide ? <Eye size={14} /> : <EyeOff size={14} />}
                {showLinkGuide ? 'Ocultar guia de Link' : 'Mostrar guia de Link'}
              </button>
            </div>

            {/* Moldura de Smartphone 9:16 */}
            <div className="relative w-full max-w-[316px] bg-gray-950 rounded-[2.2rem] p-2.5 shadow-xl border border-gray-800">
              {/* Notch discreto */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-20 h-4 bg-gray-950 rounded-full z-20 pointer-events-none" />

              <div className="relative w-full aspect-[9/16] rounded-[1.65rem] overflow-hidden bg-gray-900">
                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="w-full h-full block"
                />

                {/* Guia visual opcional (NÃO é exportada no PNG) da área reservada para o sticker de Link do Instagram */}
                {showLinkGuide && (
                  <div className="absolute inset-x-4 bottom-3 h-[11.5%] rounded-xl border-2 border-dashed border-white/70 bg-black/25 backdrop-blur-[1px] flex flex-col items-center justify-center pointer-events-none px-2 text-center">
                    <span className="text-[10px] font-bold text-white leading-tight">
                      Área livre para figurinha de Link
                    </span>
                    <span className="text-[9px] text-white/80 leading-tight mt-0.5">
                      Guia visual (não sai na imagem baixada)
                    </span>
                  </div>
                )}

                {isRendering && (
                  <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/50 text-white pointer-events-none">
                    <Loader2 size={14} className="animate-spin" />
                  </div>
                )}
              </div>
            </div>

            {/* Botões de Ação */}
            <div className="w-full space-y-2.5 mt-5">
              <button
                type="button"
                onClick={handleDownloadPng}
                disabled={isExporting || selectedProducts.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-5 rounded-xl bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-bold transition-all active:scale-[0.99] whitespace-nowrap"
              >
                {isExporting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Download size={18} />
                )}
                Baixar Story (PNG Alta Qualidade)
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 text-sm font-bold transition-all active:scale-[0.99] whitespace-nowrap"
                >
                  {copiedState === 'link' ? (
                    <>
                      <Check size={16} className="text-emerald-600 shrink-0" />
                      <span className="text-emerald-700">Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Link2 size={16} className="text-gray-500 shrink-0" />
                      <span>Copiar Link</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleCopyCaption}
                  className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white hover:bg-gray-50 text-gray-900 border border-gray-300 text-sm font-bold transition-all active:scale-[0.99] whitespace-nowrap"
                >
                  {copiedState === 'caption' ? (
                    <>
                      <Check size={16} className="text-emerald-600 shrink-0" />
                      <span className="text-emerald-700">Copiada!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={16} className="text-gray-500 shrink-0" />
                      <span>Copiar Legenda</span>
                    </>
                  )}
                </button>
              </div>

              {canNativeShare && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  disabled={isSharing || selectedProducts.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold transition-all active:scale-[0.99] whitespace-nowrap"
                >
                  {isSharing ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <Share2 size={17} />
                  )}
                  Compartilhar Agora
                </button>
              )}

              <p className="text-[11px] text-gray-500 text-center leading-relaxed pt-1">
                <MessageCircle size={12} className="inline mr-1 -mt-0.5 text-emerald-600" />
                No Instagram, adicione a imagem nos Stories e cole o link na figurinha de <strong>Link</strong> na área inferior.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
