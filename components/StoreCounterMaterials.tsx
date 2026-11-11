import React, { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { PharmacyConfig } from '../types';
import { getStoreUrl, getStoreSlug } from '../lib/store';
import {
  QrCode,
  Download,
  Smartphone,
  ShoppingBag,
  Sparkles,
  Copy,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Printer,
} from 'lucide-react';
import { toast } from 'sonner';

interface StoreCounterMaterialsProps {
  tenant?: Partial<PharmacyConfig> & { id?: string; subdomain?: string };
}

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 1754; // Proporção A4 / A5 vertical em alta definição (150-300 DPI)

function getInitials(name: string): string {
  const words = (name || 'Drogaria')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !['de', 'da', 'do', 'das', 'dos', 'e'].includes(w.toLowerCase()));
  if (words.length === 0) return 'DF';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = (hex || '#059669').replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 5;
    const g = parseInt(clean[1] + clean[1], 16) || 150;
    const b = parseInt(clean[2] + clean[2], 16) || 105;
    return { r, g, b };
  }
  const r = parseInt(clean.slice(0, 2), 16) || 5;
  const g = parseInt(clean.slice(2, 4), 16) || 150;
  const b = parseInt(clean.slice(4, 6), 16) || 105;
  return { r, g, b };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Carrega uma imagem com crossOrigin = "anonymous" e timeout de segurança (3.5s)
 * para nunca travar a renderização ou o download do PNG caso haja bloqueio de CORS.
 */
function loadImageSafe(url?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !url.trim()) {
      resolve(null);
      return;
    }

    const trimmed = url.trim();
    let settled = false;
    const finish = (img: HTMLImageElement | null) => {
      if (!settled) {
        settled = true;
        resolve(img);
      }
    };

    const timer = window.setTimeout(() => {
      finish(null);
    }, 3500);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      window.clearTimeout(timer);
      // Valida se a imagem não contamina o canvas (tainted canvas check)
      try {
        const testCanvas = document.createElement('canvas');
        testCanvas.width = 2;
        testCanvas.height = 2;
        const testCtx = testCanvas.getContext('2d');
        if (testCtx) {
          testCtx.drawImage(img, 0, 0, 2, 2);
          testCanvas.toDataURL('image/png');
        }
        finish(img);
      } catch (_corsErr) {
        finish(null);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    img.src = trimmed;
  });
}

export const StoreCounterMaterials: React.FC<StoreCounterMaterialsProps> = ({ tenant }) => {
  const appArtCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const storeArtCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [appPreviewUrl, setAppPreviewUrl] = useState<string>('');
  const [storePreviewUrl, setStorePreviewUrl] = useState<string>('');
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [copiedUrlKey, setCopiedUrlKey] = useState<string | null>(null);

  const storeBaseUrl = getStoreUrl(tenant).replace(/\/+$/, '');
  const appQrTargetUrl = `${storeBaseUrl}/?baixar=app`;
  const storeQrTargetUrl = storeBaseUrl;
  const cleanDomainLabel = storeBaseUrl.replace(/^https?:\/\//, '');

  const storeName = (tenant?.name || 'Nossa Drogaria').trim();
  const logoUrl = (tenant?.logo_url || tenant?.logo || '').trim();
  const primaryColor = tenant?.primaryColor || '#059669';
  const secondaryColor = tenant?.secondaryColor || '#047857';
  const accentColor = tenant?.accentColor || '#f59e0b';
  const slug = getStoreSlug(tenant) || 'drogaria';

  const drawPlaqueArtwork = useCallback(
    async (
      canvas: HTMLCanvasElement,
      variant: 'app' | 'store',
      loadedLogo: HTMLImageElement | null
    ): Promise<string> => {
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      const targetUrl = variant === 'app' ? appQrTargetUrl : storeQrTargetUrl;
      const rgbPrimary = hexToRgb(primaryColor);

      // 1. Fundo principal em degradê suave e elegante
      const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
      bgGrad.addColorStop(0, primaryColor);
      bgGrad.addColorStop(0.32, secondaryColor);
      bgGrad.addColorStop(0.321, '#F8FAFC');
      bgGrad.addColorStop(1, '#F1F5F9');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Círculos decorativos sutis no cabeçalho
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.beginPath();
      ctx.arc(140, 120, 220, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH - 120, 220, 260, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 2. Cartão branco principal (Plaquinha interna)
      const cardX = 76;
      const cardY = 84;
      const cardW = CANVAS_WIDTH - cardX * 2;
      const cardH = CANVAS_HEIGHT - cardY * 2;

      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.16)';
      ctx.shadowBlur = 48;
      ctx.shadowOffsetY = 18;
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 56);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      // Faixa superior colorida dentro do cartão
      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, 350, 56);
      ctx.clip();
      const headerGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + 350);
      headerGrad.addColorStop(0, primaryColor);
      headerGrad.addColorStop(1, secondaryColor);
      ctx.fillStyle = headerGrad;
      ctx.fillRect(cardX, cardY, cardW, 350);

      // Detalhe luminoso sutil no topo
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.arc(CANVAS_WIDTH / 2, cardY - 40, 380, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 3. Moldura da Logo Oficial da Loja centralizada
      const logoBoxSize = 184;
      const logoBoxX = (CANVAS_WIDTH - logoBoxSize) / 2;
      const logoBoxY = cardY + 42;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      drawRoundedRect(ctx, logoBoxX, logoBoxY, logoBoxSize, logoBoxSize, 42);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.stroke();
      ctx.restore();

      if (loadedLogo && loadedLogo.width > 0 && loadedLogo.height > 0) {
        ctx.save();
        drawRoundedRect(ctx, logoBoxX + 12, logoBoxY + 12, logoBoxSize - 24, logoBoxSize - 24, 30);
        ctx.clip();
        const pad = 18;
        const availW = logoBoxSize - pad * 2;
        const availH = logoBoxSize - pad * 2;
        const scale = Math.min(availW / loadedLogo.width, availH / loadedLogo.height);
        const drawW = loadedLogo.width * scale;
        const drawH = loadedLogo.height * scale;
        const drawX = logoBoxX + (logoBoxSize - drawW) / 2;
        const drawY = logoBoxY + (logoBoxSize - drawH) / 2;
        ctx.drawImage(loadedLogo, drawX, drawY, drawW, drawH);
        ctx.restore();
      } else {
        // Fallback elegante: Iniciais + cor da marca caso a loja não tenha logo ou tenha bloqueio de CORS
        ctx.save();
        drawRoundedRect(ctx, logoBoxX + 14, logoBoxY + 14, logoBoxSize - 28, logoBoxSize - 28, 30);
        ctx.fillStyle = `rgba(${rgbPrimary.r}, ${rgbPrimary.g}, ${rgbPrimary.b}, 0.12)`;
        ctx.fill();
        ctx.fillStyle = primaryColor;
        ctx.font = '900 72px Inter, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(getInitials(storeName), CANVAS_WIDTH / 2, logoBoxY + logoBoxSize / 2 + 4);
        ctx.restore();
      }

      // Nome da Farmácia no topo
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 40px Inter, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxStoreNameWidth = cardW - 120;
      const storeLines = wrapTextLines(ctx, storeName.toUpperCase(), maxStoreNameWidth);
      ctx.fillText(storeLines[0] || storeName.toUpperCase(), CANVAS_WIDTH / 2, logoBoxY + logoBoxSize + 58);
      ctx.restore();

      // Selo identificador do tipo de material
      const badgeText =
        variant === 'app' ? 'APLICATIVO OFICIAL DA DROGARIA' : 'CATÁLOGO DIGITAL & TELE-ENTREGA';
      ctx.save();
      ctx.font = '800 22px Inter, system-ui, -apple-system, sans-serif';
      const badgeWidth = Math.max(460, ctx.measureText(badgeText).width + 72);
      const badgeHeight = 52;
      const badgeX = (CANVAS_WIDTH - badgeWidth) / 2;
      const badgeY = cardY + 350 - badgeHeight / 2;

      ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 26);
      ctx.fillStyle = variant === 'app' ? accentColor : '#0F172A';
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, CANVAS_WIDTH / 2, badgeY + badgeHeight / 2 + 1);
      ctx.restore();

      // 4. Título Principal em Destaque e Subtítulo
      const mainTitle =
        variant === 'app'
          ? 'Acesse o QR Code e Baixe Nosso App!'
          : 'Faça seu Pedido pela Nossa Loja Online!';

      const subtitle =
        variant === 'app'
          ? 'Tenha nossa drogaria na tela do seu celular e peça com muito mais rapidez.'
          : 'Aponte a câmera do seu celular para o QR Code abaixo, consulte preços e receba em casa com entrega rápida.';

      ctx.save();
      ctx.fillStyle = '#0F172A';
      ctx.font = '900 52px Inter, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const titleLines = wrapTextLines(ctx, mainTitle, cardW - 140);
      let currentY = cardY + 410;
      for (const line of titleLines) {
        ctx.fillText(line, CANVAS_WIDTH / 2, currentY);
        currentY += 62;
      }

      // Subtítulo
      currentY += 14;
      ctx.fillStyle = '#475569';
      ctx.font = '600 30px Inter, system-ui, -apple-system, sans-serif';
      const subLines = wrapTextLines(ctx, subtitle, cardW - 160);
      for (const line of subLines) {
        ctx.fillText(line, CANVAS_WIDTH / 2, currentY);
        currentY += 42;
      }
      ctx.restore();

      // 5. Centro: QR Code grande em alta definição com borda estilizada
      const qrBoxSize = 620;
      const qrBoxX = (CANVAS_WIDTH - qrBoxSize) / 2;
      const qrBoxY = 740;

      // Halo decorativo externo com a cor da farmácia
      ctx.save();
      drawRoundedRect(ctx, qrBoxX - 18, qrBoxY - 18, qrBoxSize + 36, qrBoxSize + 36, 52);
      ctx.fillStyle = `rgba(${rgbPrimary.r}, ${rgbPrimary.g}, ${rgbPrimary.b}, 0.08)`;
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = primaryColor;
      ctx.stroke();
      ctx.restore();

      // Cantoneiras de leitura (estilo scanner moderno)
      ctx.save();
      ctx.strokeStyle = secondaryColor;
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      const cornerLen = 58;
      const cPad = 6;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(qrBoxX - cPad, qrBoxY + cornerLen);
      ctx.lineTo(qrBoxX - cPad, qrBoxY - cPad);
      ctx.lineTo(qrBoxX + cornerLen, qrBoxY - cPad);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(qrBoxX + qrBoxSize - cornerLen, qrBoxY - cPad);
      ctx.lineTo(qrBoxX + qrBoxSize + cPad, qrBoxY - cPad);
      ctx.lineTo(qrBoxX + qrBoxSize + cPad, qrBoxY + cornerLen);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(qrBoxX - cPad, qrBoxY + qrBoxSize - cornerLen);
      ctx.lineTo(qrBoxX - cPad, qrBoxY + qrBoxSize + cPad);
      ctx.lineTo(qrBoxX + cornerLen, qrBoxY + qrBoxSize + cPad);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(qrBoxX + qrBoxSize - cornerLen, qrBoxY + qrBoxSize + cPad);
      ctx.lineTo(qrBoxX + qrBoxSize + cPad, qrBoxY + qrBoxSize + cPad);
      ctx.lineTo(qrBoxX + qrBoxSize + cPad, qrBoxY + qrBoxSize - cornerLen);
      ctx.stroke();
      ctx.restore();

      // Fundo branco do QR Code
      ctx.save();
      drawRoundedRect(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 40);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      // Renderiza o QR Code em um canvas auxiliar de alta definição
      const qrTempCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrTempCanvas, targetUrl, {
        width: qrBoxSize - 56,
        margin: 1,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      });
      ctx.drawImage(qrTempCanvas, qrBoxX + 28, qrBoxY + 28, qrBoxSize - 56, qrBoxSize - 56);

      // 6. Rodapé da Plaquinha
      const footerY = qrBoxY + qrBoxSize + 52;

      if (variant === 'app') {
        // Passo a passo curto em destaque
        const stepBarX = cardX + 56;
        const stepBarW = cardW - 112;
        const stepBarH = 96;

        ctx.save();
        drawRoundedRect(ctx, stepBarX, footerY, stepBarW, stepBarH, 28);
        ctx.fillStyle = `rgba(${rgbPrimary.r}, ${rgbPrimary.g}, ${rgbPrimary.b}, 0.10)`;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(${rgbPrimary.r}, ${rgbPrimary.g}, ${rgbPrimary.b}, 0.28)`;
        ctx.stroke();

        ctx.fillStyle = '#0F172A';
        ctx.font = '800 23px Inter, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          '1. Abra a câmera do celular  •  2. Aponte para o QR Code  •  3. Toque em Instalar Aplicativo',
          CANVAS_WIDTH / 2,
          footerY + stepBarH / 2
        );
        ctx.restore();

        // Link da loja abaixo do passo a passo
        ctx.save();
        ctx.fillStyle = primaryColor;
        ctx.font = '900 32px Inter, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cleanDomainLabel, CANVAS_WIDTH / 2, footerY + stepBarH + 62);
        ctx.restore();
      } else {
        // Chamada "Rápido, fácil e sem filas!" + endereço do site da loja
        const ctaBarX = cardX + 90;
        const ctaBarW = cardW - 180;
        const ctaBarH = 88;

        ctx.save();
        drawRoundedRect(ctx, ctaBarX, footerY, ctaBarW, ctaBarH, 44);
        ctx.fillStyle = primaryColor;
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '900 36px Inter, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Rápido, fácil e sem filas!', CANVAS_WIDTH / 2, footerY + ctaBarH / 2 + 2);
        ctx.restore();

        // Endereço do site da loja
        ctx.save();
        ctx.fillStyle = '#0F172A';
        ctx.font = '900 34px Inter, system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cleanDomainLabel, CANVAS_WIDTH / 2, footerY + ctaBarH + 64);
        ctx.restore();
      }

      try {
        return canvas.toDataURL('image/png');
      } catch (_err) {
        return '';
      }
    },
    [appQrTargetUrl, storeQrTargetUrl, cleanDomainLabel, storeName, primaryColor, secondaryColor, accentColor]
  );

  const renderAllPreviews = useCallback(async () => {
    setIsRendering(true);
    try {
      const loadedLogo = await loadImageSafe(logoUrl);

      if (appArtCanvasRef.current) {
        const url1 = await drawPlaqueArtwork(appArtCanvasRef.current, 'app', loadedLogo);
        if (url1) setAppPreviewUrl(url1);
      }

      if (storeArtCanvasRef.current) {
        const url2 = await drawPlaqueArtwork(storeArtCanvasRef.current, 'store', loadedLogo);
        if (url2) setStorePreviewUrl(url2);
      }
    } catch (err) {
      console.error('Erro ao gerar prévia dos materiais de balcão:', err);
    } finally {
      setIsRendering(false);
    }
  }, [logoUrl, drawPlaqueArtwork]);

  useEffect(() => {
    renderAllPreviews();
  }, [renderAllPreviews]);

  const handleDownloadFullArt = async (variant: 'app' | 'store') => {
    try {
      const canvas = variant === 'app' ? appArtCanvasRef.current : storeArtCanvasRef.current;
      let dataUrl = variant === 'app' ? appPreviewUrl : storePreviewUrl;

      if (!dataUrl && canvas) {
        const loadedLogo = await loadImageSafe(logoUrl);
        dataUrl = await drawPlaqueArtwork(canvas, variant, loadedLogo);
      }

      if (!dataUrl && canvas) {
        // Fallback garantido sem logo externa caso algum navegador bloqueie CORS
        dataUrl = await drawPlaqueArtwork(canvas, variant, null);
      }

      if (!dataUrl) {
        toast.error('Não foi possível gerar o arquivo PNG.');
        return;
      }

      const link = document.createElement('a');
      link.download =
        variant === 'app'
          ? `arte-baixe-nosso-app-${slug}.png`
          : `arte-balcao-loja-online-${slug}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success(
        variant === 'app'
          ? 'Arte "Baixe Nosso App" baixada em alta resolução!'
          : 'Arte de Balcão "Peça pela Loja Online" baixada em alta resolução!'
      );
    } catch (err) {
      console.error('Erro ao baixar arte PNG:', err);
      toast.error('Erro ao baixar a arte em PNG.');
    }
  };

  const handleDownloadOnlyQrCode = async (variant: 'app' | 'store') => {
    try {
      const targetUrl = variant === 'app' ? appQrTargetUrl : storeQrTargetUrl;
      const qrDataUrl = await QRCode.toDataURL(targetUrl, {
        width: 1024,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: {
          dark: '#0F172A',
          light: '#FFFFFF',
        },
      });

      const link = document.createElement('a');
      link.download =
        variant === 'app'
          ? `qrcode-baixe-nosso-app-${slug}.png`
          : `qrcode-loja-online-${slug}.png`;
      link.href = qrDataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('QR Code em alta definição (1024x1024 PNG) baixado com sucesso!');
    } catch (err) {
      console.error('Erro ao gerar QR Code isolado:', err);
      toast.error('Não foi possível baixar o QR Code.');
    }
  };

  const handleCopyUrl = (url: string, key: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrlKey(key);
    toast.success('Link copiado para a área de transferência!');
    setTimeout(() => setCopiedUrlKey(null), 2500);
  };

  return (
    <div className="rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Canvases ocultos de alta resolução (1240x1754 px - formato A4/A5 vertical) */}
      <canvas ref={appArtCanvasRef} className="hidden" />
      <canvas ref={storeArtCanvasRef} className="hidden" />

      {/* Cabeçalho da Central */}
      <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-emerald-50/70 via-teal-50/40 to-blue-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0">
            <QrCode size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-black text-base uppercase tracking-wider text-gray-900">
                Materiais de Balcão e QR Codes
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 flex items-center gap-1">
                <Printer size={11} /> Prontos para Impressão (A5 / A4)
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Artes geradas automaticamente com a logo e as cores da sua drogaria para colocar no balcão, caixa ou sacolas.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={renderAllPreviews}
          disabled={isRendering}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 shadow-xs transition-all cursor-pointer shrink-0"
        >
          <RefreshCw size={14} className={isRendering ? 'animate-spin text-emerald-600' : 'text-gray-500'} />
          <span>Atualizar Artes</span>
        </button>
      </div>

      {/* Grid com os 2 Geradores lado a lado */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ===================================================================
            GERADOR 1: QR Code "Baixe Nosso App"
        =================================================================== */}
        <div className="rounded-3xl border border-gray-200 bg-gray-50/60 p-5 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <Smartphone size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 block">
                    Gerador 1 • Instalação Direta
                  </span>
                  <h4 className="font-black text-gray-900 text-base">
                    QR Code "Baixe Nosso App"
                  </h4>
                </div>
              </div>
              <a
                href={appQrTargetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-2xs"
              >
                <span>Testar</span>
                <ExternalLink size={12} />
              </a>
            </div>

            {/* Link de Destino */}
            <div className="bg-white rounded-2xl border border-gray-200 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                  Link de destino do QR Code (abre destacando o App):
                </span>
                <p className="text-xs font-mono font-bold text-gray-800 truncate select-all mt-0.5">
                  {appQrTargetUrl}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCopyUrl(appQrTargetUrl, 'app')}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
              >
                {copiedUrlKey === 'app' ? (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span className="text-emerald-700">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>

            {/* Pré-visualização da Plaquinha 1 */}
            <div className="bg-gradient-to-b from-gray-100 to-gray-200/70 rounded-2xl p-4 flex flex-col items-center justify-center border border-gray-200/80">
              <div className="flex items-center justify-between w-full mb-2.5 px-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1">
                  <Sparkles size={11} className="text-emerald-600" /> Pré-visualização da Arte (A5/A4)
                </span>
                <span className="text-[10px] font-bold text-gray-400">1240 × 1754 px (Alta Resolução)</span>
              </div>

              {appPreviewUrl ? (
                <img
                  src={appPreviewUrl}
                  alt="Prévia da Arte Baixe Nosso App"
                  className="w-full max-w-[300px] rounded-xl shadow-lg border border-black/5 object-contain bg-white"
                />
              ) : (
                <div className="w-full max-w-[300px] aspect-[1240/1754] rounded-xl bg-white border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-400">
                  Gerando pré-visualização...
                </div>
              )}
            </div>
          </div>

          {/* Botões de Ação do Gerador 1 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleDownloadFullArt('app')}
              className="w-full py-3.5 px-4 rounded-2xl font-black text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <Download size={17} />
              <span>Baixar Arte Pronta (PNG)</span>
            </button>

            <button
              type="button"
              onClick={() => handleDownloadOnlyQrCode('app')}
              className="w-full py-3.5 px-4 rounded-2xl font-bold text-xs sm:text-sm bg-white hover:bg-gray-100 text-gray-800 border-2 border-gray-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <QrCode size={17} className="text-emerald-600" />
              <span>Baixar Apenas QR Code (PNG)</span>
            </button>
          </div>
        </div>

        {/* ===================================================================
            GERADOR 2: QR Code "Peça pela Loja Online" (Para Balcão)
        =================================================================== */}
        <div className="rounded-3xl border border-gray-200 bg-gray-50/60 p-5 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  <ShoppingBag size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 block">
                    Gerador 2 • Display de Balcão
                  </span>
                  <h4 className="font-black text-gray-900 text-base">
                    QR Code "Peça pela Loja Online"
                  </h4>
                </div>
              </div>
              <a
                href={storeQrTargetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-800 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-2xs"
              >
                <span>Testar</span>
                <ExternalLink size={12} />
              </a>
            </div>

            {/* Link de Destino */}
            <div className="bg-white rounded-2xl border border-gray-200 p-3 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 block">
                  Link de destino do QR Code (catálogo direto da loja):
                </span>
                <p className="text-xs font-mono font-bold text-gray-800 truncate select-all mt-0.5">
                  {storeQrTargetUrl}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCopyUrl(storeQrTargetUrl, 'store')}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer"
              >
                {copiedUrlKey === 'store' ? (
                  <>
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span className="text-emerald-700">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copiar</span>
                  </>
                )}
              </button>
            </div>

            {/* Pré-visualização da Plaquinha 2 */}
            <div className="bg-gradient-to-b from-gray-100 to-gray-200/70 rounded-2xl p-4 flex flex-col items-center justify-center border border-gray-200/80">
              <div className="flex items-center justify-between w-full mb-2.5 px-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 flex items-center gap-1">
                  <Sparkles size={11} className="text-blue-600" /> Pré-visualização da Arte (A5/A4)
                </span>
                <span className="text-[10px] font-bold text-gray-400">1240 × 1754 px (Alta Resolução)</span>
              </div>

              {storePreviewUrl ? (
                <img
                  src={storePreviewUrl}
                  alt="Prévia da Arte Peça pela Loja Online"
                  className="w-full max-w-[300px] rounded-xl shadow-lg border border-black/5 object-contain bg-white"
                />
              ) : (
                <div className="w-full max-w-[300px] aspect-[1240/1754] rounded-xl bg-white border border-gray-200 flex items-center justify-center text-xs font-bold text-gray-400">
                  Gerando pré-visualização...
                </div>
              )}
            </div>
          </div>

          {/* Botões de Ação do Gerador 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => handleDownloadFullArt('store')}
              className="w-full py-3.5 px-4 rounded-2xl font-black text-xs sm:text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <Download size={17} />
              <span>Baixar Arte de Balcão (PNG)</span>
            </button>

            <button
              type="button"
              onClick={() => handleDownloadOnlyQrCode('store')}
              className="w-full py-3.5 px-4 rounded-2xl font-bold text-xs sm:text-sm bg-white hover:bg-gray-100 text-gray-800 border-2 border-gray-200 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
            >
              <QrCode size={17} className="text-blue-600" />
              <span>Baixar Apenas QR Code (PNG)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
